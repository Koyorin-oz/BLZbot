const { SlashCommandBuilder } = require('discord.js');
const db = require('../../database/database');
const { getOrCreateUser } = require('../../utils/db-users');
const { adjustWarInitialValues } = require('../../utils/guild/guild-wars');
const logger = require('../../utils/logger');
const { handleCommandError } = require('../../utils/error-handler');
const { getEffectiveStars, moveLoanStars, computeLoanTotalWithInterest } = require('../../utils/loan-system');

const markLoanRepaidStmt = db.prepare('UPDATE loans SET repaid = 1, repaid_amount = ? WHERE id = ? AND repaid = 0');
const markLoanPartialStmt = db.prepare('UPDATE loans SET repaid_amount = ? WHERE id = ? AND repaid = 0');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('rembourser')
        .setDescription('Rembourser une dette avant la date limite.')
        .addIntegerOption(option =>
            option.setName('montant')
                .setDescription('Le montant à rembourser')
                .setRequired(true)
                .setMinValue(1))
        .addStringOption(option =>
            option.setName('dette')
                .setDescription('La dette à rembourser')
                .setRequired(true)
                .setAutocomplete(true)),

    async autocomplete(interaction) {
        const borrowerId = interaction.user.id;

        // Récupérer les dettes non remboursées de l'utilisateur
        const getLoansStmt = db.prepare(`
            SELECT id, lenderId, amount, accepted, repaid FROM loans 
            WHERE borrowerId = ? AND repaid = 0 AND accepted = 1
            ORDER BY expiresAt ASC
            LIMIT 25
        `);
        const loans = getLoansStmt.all(borrowerId);

        // Créer un cache de usernames pour éviter plusieurs fetches
        const userCache = {};

        // Récupérer les usernames des prêteurs avec timeout
        const choices = await Promise.all(loans.map(async (loan) => {
            try {
                if (!userCache[loan.lenderId]) {
                    const lender = await interaction.client.users.fetch(loan.lenderId);
                    userCache[loan.lenderId] = lender.username;
                }

                const totalDue = computeLoanTotalWithInterest(loan);
                const remaining = Math.max(0, totalDue - (loan.repaid_amount || 0));

                return {
                    name: `${userCache[loan.lenderId]} — ${remaining.toLocaleString('fr-FR')} ⭐ restants`,
                    value: loan.id.toString(),
                };
            } catch (e) {
                const totalDue = computeLoanTotalWithInterest(loan);
                const remaining = Math.max(0, totalDue - (loan.repaid_amount || 0));
                return {
                    name: `ID ${loan.lenderId} — ${remaining.toLocaleString('fr-FR')} ⭐ restants`,
                    value: loan.id.toString(),
                };
            }
        }));

        // Répondre avec gestion d'erreur
        try {
            await interaction.respond(choices.length > 0 ? choices :
                [{ name: 'Aucune dette à rembourser', value: '0' }]);
        } catch (error) {
            // Ignorer les erreurs d'interaction expirée
            if (error.code !== 10062) {
                console.error('Erreur autocomplete:', error);
            }
        }
    },

    async execute(interaction) {
        try {
            const borrower = interaction.user;
            const amount = interaction.options.getInteger('montant');
            const loanIdStr = interaction.options.getString('dette');
            const loanId = parseInt(loanIdStr);

            // Vérification que la dette sélectionnée est valide
            if (isNaN(loanId) || loanId === 0) {
                return interaction.reply({ content: 'Veuillez sélectionner une dette valide.', ephemeral: true });
            }

            const getLoanStmt = db.prepare('SELECT * FROM loans WHERE id = ? AND borrowerId = ?');
            const loan = getLoanStmt.get(loanId, borrower.id);

            if (!loan) {
                return interaction.reply({ content: 'Cette dette n\'existe pas.', ephemeral: true });
            }

            if (!loan.accepted) {
                return interaction.reply({ content: 'Cette dette n\'a pas été acceptée.', ephemeral: true });
            }

            if (loan.repaid) {
                return interaction.reply({ content: 'Cette dette a déjà été remboursée.', ephemeral: true });
            }

            getOrCreateUser(borrower.id, borrower.username);
            const borrowerStars = getEffectiveStars(borrower.id, borrower.username);

            if (borrowerStars < amount) {
                return interaction.reply({ content: `Vous n'avez que **${borrowerStars}** starss, vous ne pouvez pas rembourser **${amount}** starss.`, ephemeral: true });
            }

            const totalWithInterest = computeLoanTotalWithInterest(loan);
            const alreadyRepaid = loan.repaid_amount || 0;
            const remainingDebt = totalWithInterest - alreadyRepaid;

            if (remainingDebt <= 0) {
                markLoanRepaidStmt.run(totalWithInterest, loanId);
                return interaction.reply({ content: 'Cette dette est déjà entièrement remboursée.', ephemeral: true });
            }

            // Récupérer le prêteur
            let lender;
            try {
                lender = await interaction.client.users.fetch(loan.lenderId);
            } catch (error) {
                return interaction.reply({ content: 'Impossible de trouver le prêteur de cette dette.', ephemeral: true });
            }

            if (amount > remainingDebt) {
                const finalAmount = remainingDebt;

                const locked = markLoanRepaidStmt.run(totalWithInterest, loanId);
                if (locked.changes === 0) {
                    return interaction.reply({ content: 'Cette dette a déjà été remboursée.', ephemeral: true });
                }

                const usedReborn = moveLoanStars(borrower.id, -finalAmount, borrower.username);
                getOrCreateUser(loan.lenderId, lender.username);
                moveLoanStars(loan.lenderId, finalAmount, lender.username);

                if (!usedReborn) {
                    adjustWarInitialValues(borrower.id, { stars: -finalAmount });
                    adjustWarInitialValues(loan.lenderId, { stars: finalAmount });
                }

                const { checkQuestProgress } = require('../../utils/quests');
                checkQuestProgress(interaction.client, 'LOAN_REPAID', borrower);
                checkQuestProgress(interaction.client, 'LOAN_REPAID_BIG', borrower, { repayAmount: totalWithInterest });

                await interaction.reply({
                    content: `✅ Vous avez remboursé **${finalAmount.toLocaleString('fr-FR')}** starss (au lieu de ${amount.toLocaleString('fr-FR')}). Dette complètement remboursée !`,
                    ephemeral: true,
                });

                try {
                    await lender.send(`✅ ${borrower.username} a remboursé sa dette de **${finalAmount.toLocaleString('fr-FR')}** starss !`);
                } catch (error) {
                    logger.error(`Impossible d'envoyer un DM au prêteur ${loan.lenderId}:`, error.message);
                }

                logger.info(`${borrower.username} a remboursé ${finalAmount} starss à ${lender.username}.`);
            } else {
                const newRepaidAmount = alreadyRepaid + amount;
                const isFullyRepaid = newRepaidAmount >= totalWithInterest;

                if (isFullyRepaid) {
                    const locked = markLoanRepaidStmt.run(totalWithInterest, loanId);
                    if (locked.changes === 0) {
                        return interaction.reply({ content: 'Cette dette a déjà été remboursée.', ephemeral: true });
                    }
                } else {
                    const locked = markLoanPartialStmt.run(newRepaidAmount, loanId);
                    if (locked.changes === 0) {
                        return interaction.reply({ content: 'Cette dette a déjà été remboursée.', ephemeral: true });
                    }
                }

                const usedReborn = moveLoanStars(borrower.id, -amount, borrower.username);
                getOrCreateUser(loan.lenderId, lender.username);
                moveLoanStars(loan.lenderId, amount, lender.username);

                if (!usedReborn) {
                    adjustWarInitialValues(borrower.id, { stars: -amount });
                    adjustWarInitialValues(loan.lenderId, { stars: amount });
                }

                if (isFullyRepaid) {
                    const { checkQuestProgress } = require('../../utils/quests');
                    checkQuestProgress(interaction.client, 'LOAN_REPAID', borrower);
                    checkQuestProgress(interaction.client, 'LOAN_REPAID_BIG', borrower, { repayAmount: totalWithInterest });

                    await interaction.reply({
                        content: `✅ Vous avez remboursé **${amount.toLocaleString('fr-FR')}** starss. Dette complètement remboursée !`,
                        ephemeral: true,
                    });

                    try {
                        await lender.send(`✅ ${borrower.username} a remboursé sa dette complètement (**${totalWithInterest.toLocaleString('fr-FR')}** starss au total) !`);
                    } catch (error) {
                        logger.error(`Impossible d'envoyer un DM au prêteur ${loan.lenderId}:`, error.message);
                    }
                } else {
                    const remaining = totalWithInterest - newRepaidAmount;
                    await interaction.reply({
                        content: `✅ Vous avez remboursé **${amount.toLocaleString('fr-FR')}** starss. Il vous reste **${remaining.toLocaleString('fr-FR')}** starss à rembourser.`,
                        ephemeral: true,
                    });

                    try {
                        await lender.send(`${borrower.username} a remboursé **${amount.toLocaleString('fr-FR')}** starss. Il en reste **${remaining.toLocaleString('fr-FR')}** à rembourser.`);
                    } catch (error) {
                        logger.error(`Impossible d'envoyer un DM au prêteur ${loan.lenderId}:`, error.message);
                    }
                }

                logger.info(`${borrower.username} a remboursé ${amount} starss à ${lender.username}.`);
            }
        } catch (error) {
            await handleCommandError(interaction, error);
        }
    }
};
