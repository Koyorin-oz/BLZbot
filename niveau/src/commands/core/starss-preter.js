const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const db = require('../../database/database');
const { getOrCreateUser } = require('../../utils/db-users');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('starss-preter')
        .setDescription('Prêter des starss à un autre utilisateur.')
        .addUserOption(option => option.setName('utilisateur').setDescription('L\'utilisateur à qui prêter').setRequired(true))
        .addIntegerOption(option => option.setName('montant').setDescription('Le montant de starss à prêter').setRequired(true))
        .addStringOption(option => option.setName('temps').setDescription('La durée du prêt (ex: 24h, 3d, 7d)').setRequired(true))
        .addIntegerOption(option => option.setName('interet').setDescription('Le taux d\'intérêt en pourcentage (1-10)').setRequired(false)),
    async execute(interaction) {
        try {
            await interaction.deferReply();
            const lender = interaction.user;
            const borrower = interaction.options.getUser('utilisateur');
            const amount = interaction.options.getInteger('montant');
            const timeInput = interaction.options.getString('temps');
            const interest = interaction.options.getInteger('interet') || 0;

            if (lender.id === borrower.id) {
                return interaction.editReply({ content: 'Vous ne pouvez pas vous prêter des starss à vous-même.' });
            }

            if (amount <= 0) {
                return interaction.editReply({ content: 'Le montant doit être positif.' });
            }

            if (interest < 0 || interest > 10) {
                return interaction.editReply({ content: 'Le taux d\'intérêt doit être compris entre 0 et 10%.' });
            }

            const timeRegex = /^(\d+)([hd])$/;
            const match = timeInput.match(timeRegex);

            if (!match) {
                return interaction.editReply({ content: 'Format de temps invalide. Utilisez un format comme "24h", "3d", "7d".' });
            }

            const value = parseInt(match[1]);
            const unit = match[2];
            let durationMs;

            if (unit === 'h') {
                durationMs = value * 60 * 60 * 1000;
            } else { // 'd'
                durationMs = value * 24 * 60 * 60 * 1000;
            }

            if (durationMs < 24 * 60 * 60 * 1000 || durationMs > 7 * 24 * 60 * 60 * 1000) {
                return interaction.editReply({ content: 'La durée du prêt doit être comprise entre 24 heures et 7 jours.' });
            }

            getOrCreateUser(lender.id, lender.username);
            const { getEffectiveStars, getTotalDebt } = require('../../utils/loan-system');
            const lenderStars = getEffectiveStars(lender.id, lender.username);

            if (lenderStars < amount) {
                return interaction.editReply({ content: 'Vous n\'avez pas assez de starss pour prêter ce montant.' });
            }

            // Limite: maximum 5M de prêt
            if (amount > 5_000_000) {
                return interaction.editReply({ content: 'Le montant maximum d\'un prêt est de **5,000,000** starss.' });
            }

            // Vérifier le nombre de dettes acceptées de l'emprunteur
            const getBorrowerLoansStmt = db.prepare(`
                SELECT COUNT(*) as count FROM loans 
                WHERE borrowerId = ? AND accepted = 1 AND repaid = 0
            `);
            const borrowerLoans = getBorrowerLoansStmt.get(borrower.id);

            if (borrowerLoans.count >= 10) {
                return interaction.editReply({ content: 'L\'emprunteur a déjà le maximum de **10 dettes** en cours. Il ne peut pas emprunter plus.' });
            }

            const currentDebt = getTotalDebt(borrower.id);

            if (currentDebt + amount > 5_000_000) {
                return interaction.editReply({ content: `La dette totale de l'emprunteur ne peut pas dépasser **5,000,000** starss. Actuellement: ${currentDebt.toLocaleString('fr-FR')} starss.` });
            }

            const expiresAt = new Date(Date.now() + durationMs);

            const insertLoanStmt = db.prepare('INSERT INTO loans (lenderId, borrowerId, amount, interest, expiresAt) VALUES (?, ?, ?, ?, ?)');
            const info = insertLoanStmt.run(lender.id, borrower.id, amount, interest, expiresAt.toISOString());
            const loanId = info.lastInsertRowid;

            const row = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId(`accept-loan-${loanId}`)
                        .setLabel('Accepter')
                        .setStyle(ButtonStyle.Success),
                    new ButtonBuilder()
                        .setCustomId(`decline-loan-${loanId}`)
                        .setLabel('Refuser')
                        .setStyle(ButtonStyle.Danger)
                );

            await interaction.editReply({
                content: `${borrower}, ${lender.username} vous propose un prêt de ${amount} starss avec un intérêt de ${interest}% à rembourser avant le ${expiresAt.toLocaleDateString('fr-FR')}. Vous avez 1 heure pour accepter.`,
                components: [row]
            });
        } catch (error) {
            if (error.code !== 10062) {
                const { handleCommandError } = require('../../utils/error-handler');
                await handleCommandError(interaction, error);
            }
        }
    }
};
