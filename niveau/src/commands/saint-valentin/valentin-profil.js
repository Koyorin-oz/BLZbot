const { SlashCommandBuilder, AttachmentBuilder } = require('discord.js');
const { getEventState, getOrCreateEventUser, getPartner, getMarriageTimestamp, getAllUnlocks, getUserRank, getDailyMessageCount } = require('../../utils/db-valentin');
const { generateValentinProfileCanvas } = require('../../utils/canvas-valentin-profile');
const logger = require('../../utils/logger');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('valentin-profil')
        .setDescription('Affiche ton profil de l\'événement Saint-Valentin')
        .addUserOption(option =>
            option.setName('utilisateur')
                .setDescription('Utilisateur dont afficher le profil (par défaut: toi)')
                .setRequired(false)
        ),

    async execute(interaction) {
        if (!getEventState('valentin')) {
            return interaction.reply({ content: "Il n'y a pas d'événement Saint-Valentin actif pour le moment.", ephemeral: true });
        }

        await interaction.deferReply();

        try {
            const targetUser = interaction.options.getUser('utilisateur') || interaction.user;
            const eventUser = getOrCreateEventUser(targetUser.id, targetUser.username);

            if (!eventUser) {
                throw new Error('Impossible de récupérer les données utilisateur');
            }

            // Récupérer les infos de mariage
            const partnerId = getPartner(targetUser.id);
            let partnerUsername = null;
            let marriageTimestamp = null;

            if (partnerId) {
                try {
                    // Essayer de récupérer le nom du partenaire depuis le guild
                    const guild = interaction.guild;
                    if (guild) {
                        const partnerMember = await guild.members.fetch(partnerId).catch(() => null);
                        partnerUsername = partnerMember ? (partnerMember.displayName || partnerMember.user.username) : null;
                    }

                    // Fallback vers le nom dans la DB de l'événement
                    if (!partnerUsername) {
                        const partnerEvent = getOrCreateEventUser(partnerId, 'unknown');
                        partnerUsername = partnerEvent.username !== 'unknown' ? partnerEvent.username : `ID: ${partnerId}`;
                    }

                    marriageTimestamp = getMarriageTimestamp(targetUser.id);
                } catch (e) {
                    partnerUsername = `ID: ${partnerId}`;
                }
            }

            // Récupérer les items débloqués
            const unlocks = getAllUnlocks(targetUser.id);

            // Récupérer le classement
            const rank = getUserRank(targetUser.id, 'coeurs');

            // Récupérer les messages du jour
            const dailyMessages = getDailyMessageCount(targetUser.id);

            // Essayer d'obtenir le membre du serveur (pour displayName)
            let displayUser = targetUser;
            try {
                const member = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
                if (member) {
                    displayUser = member;
                }
            } catch (e) { /* utiliser targetUser */ }

            // Générer l'image du profil
            const imageBuffer = await generateValentinProfileCanvas(displayUser, eventUser, {
                partnerUsername,
                marriageTimestamp,
                unlocks,
                rank,
                dailyMessages,
            });

            const attachment = new AttachmentBuilder(imageBuffer, { name: 'valentin-profil.png' });

            await interaction.editReply({ files: [attachment] });
            logger.info(`Profil Saint-Valentin affiché pour ${targetUser.username}`);

        } catch (error) {
            logger.error('Erreur lors de l\'affichage du profil Saint-Valentin:', error);
            await interaction.editReply({ content: '❌ Une erreur s\'est produite lors de la génération de ton profil Saint-Valentin.' });
        }
    },
};
