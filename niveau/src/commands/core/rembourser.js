const { SlashCommandBuilder } = require('discord.js');
const db = require('../../database/database');
const { getOrCreateUser, updateUserBalance } = require('../../utils/db-users');
const { adjustWarInitialValues } = require('../../utils/guild/guild-wars');
const logger = require('../../utils/logger');
const { handleCommandError } = require('../../utils/error-handler');

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
                // Utiliser le cache si disponible
                if (!userCache[loan.lenderId]) {
                    const lender = await interaction.client.users.fetch(loan.lenderId);
                    userCache[loan.lenderId] = lender.username;
                }

                return {
                    name: `${userCache[loan.lenderId]} - ${loan.amount} starss`,
                    value: loan.id.toString()
                };
            } catch (e) {
                // Fallback sur l'ID si fetch échoue
                return {
                    name: `ID ${loan.lenderId} - ${loan.amount} starss`,
                    value: loan.id.toString()
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
            const { getEffectiveStars, moveLoanStars } = require('../../utils/loan-system');
            const borrowerStars = getEffectiveStars(borrower.id, borrower.username);

            if (borrowerStars < amount) {
                return interaction.reply({ content: `Vous n'avez que **${borrowerStars}** starss, vous ne pouvez pas rembourser **${amount}** starss.`, ephemeral: true });
            }

            // Calculer le montant total à rembourser (principal + intérêt).
            // Math.round pour rester cohérent avec getTotalDebt / pénalités de retard.
            const totalWithInterest = Math.round(loan.amount * (1 + loan.interest / 100));

            // Calcul de la dette restante : montant total - ce qui a déjà été remboursé
            const alreadyRepaid = loan.repaid_amount || 0;
            const remainingDebt = totalWithInterest - alreadyRepaid;

            // Récupérer le prêteur
            let lender;
            try {
                lender = await interaction.client.users.fetch(loan.lenderId);
            } catch (error) {
                return interaction.reply({ content: 'Impossible de trouver le prêteur de cette dette.', ephemeral: true });
            }

            if (amount > remainingDebt) {
                // Si trop donné, rembourser juste ce qu'il faut
                const finalAmount = remainingDebt;

                // Retirer de l'emprunteur
                updateUserBalance(borrower.id, { stars: -finalAmount });

                // Ajouter au prêteur
                getOrCreateUser(loan.lenderId, lender.username);
                updateUserBalance(loan.lenderId, { stars: finalAmount });

                // Ajuster les valeurs initiales de guerre (les prêts ne comptent pas)
                adjustWarInitialValues(borrower.id, { stars: -finalAmount });
                adjustWarInitialValues(loan.lenderId, { stars: finalAmount });

                // Marquer comme remboursé
                const updateLoanStmt = db.prepare('UPDATE loans SET repaid = ?, repaid_amount = ? WHERE id = ?');
                updateLoanStmt.run(1, totalWithInterest, loanId);

                // Check Quests
                const { checkQuestProgress } = require('../../utils/quests');
                checkQuestProgress(interaction.client, 'LOAN_REPAID', borrower);
                checkQuestProgress(interaction.client, 'LOAN_REPAID_BIG', borrower, { repayAmount: totalWithInterest });

                await interaction.reply({
                    content: `✅ Vous avez remboursé **${finalAmount}** starss (au lieu de ${amount}). Dette complètement remboursée!`,
                    ephemeral: true
                });

                // Notifier le prêteur
                try {
                    await lender.send(`✅ ${borrower.username} a remboursé sa dette de **${finalAmount}** starss!`);
                } catch (error) {
                    logger.error(`Impossible d'envoyer un DM au prêteur ${loan.lenderId}:`, error.message);
                }

                logger.info(`${borrower.username} a remboursé ${finalAmount} starss à ${lender.username}.`);
            } else {
                // Rembourser le montant spécifié (partiel ou exact)
                updateUserBalance(borrower.id, { stars: -amount });

                getOrCreateUser(loan.lenderId, lender.username);
                updateUserBalance(loan.lenderId, { stars: amount });

                // Ajuster les valeurs initiales de guerre (les prêts ne comptent pas)
                adjustWarInitialValues(borrower.id, { stars: -amount });
                adjustWarInitialValues(loan.lenderId, { stars: amount });

                // Vérifier si complètement remboursé
                const newRepaidAmount = alreadyRepaid + amount;
                const isFullyRepaid = newRepaidAmount >= totalWithInterest;

                if (isFullyRepaid) {
                    const updateLoanStmt = db.prepare('UPDATE loans SET repaid = ?, repaid_amount = ? WHERE id = ?');
                    updateLoanStmt.run(1, totalWithInterest, loanId);

                    // Check Quests
                    const { checkQuestProgress } = require('../../utils/quests');
                    checkQuestProgress(interaction.client, 'LOAN_REPAID', borrower);
                    checkQuestProgress(interaction.client, 'LOAN_REPAID_BIG', borrower, { repayAmount: totalWithInterest });

                    await interaction.reply({
                        content: `✅ Vous avez remboursé **${amount}** starss. Dette complètement remboursée!`,
                        ephemeral: true
                    });

                    try {
                        await lender.send(`✅ ${borrower.username} a remboursé sa dette complètement (**${totalWithInterest}** starss au total)!`);
                    } catch (error) {
                        logger.error(`Impossible d'envoyer un DM au prêteur ${loan.lenderId}:`, error.message);
                    }
                } else {
                    // Mise à jour du montant remboursé partiellement
                    const updateLoanStmt = db.prepare('UPDATE loans SET repaid_amount = ? WHERE id = ?');
                    updateLoanStmt.run(newRepaidAmount, loanId);

                    const remaining = totalWithInterest - newRepaidAmount;
                    await interaction.reply({
                        content: `✅ Vous avez remboursé **${amount}** starss. Il vous reste **${remaining}** starss à rembourser.`,
                        ephemeral: true
                    });

                    try {
                        await lender.send(`${borrower.username} a remboursé **${amount}** starss. Il en reste **${remaining}** à rembourser.`);
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
