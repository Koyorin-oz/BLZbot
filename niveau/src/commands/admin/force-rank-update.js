const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { updateUserRank } = require('../../utils/ranks');
const { getOrCreateUser } = require('../../utils/db-users');
const logger = require('../../utils/logger');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('force-rank-update')
        .setDescription('Force la mise à jour du rang d\'un utilisateur (Admin)')
        .addUserOption((option) =>
            option
                .setName('utilisateur')
                .setDescription('L\'utilisateur dont le rang doit être mis à jour')
                .setRequired(false)
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    async execute(interaction) {
        const targetUser = interaction.options.getUser('utilisateur') || interaction.user;

        try {
            await interaction.deferReply();

            // Récupérer les données de l'utilisateur
            const userData = getOrCreateUser(targetUser.id, targetUser.username);

            // Forcer la mise à jour du rang
            await updateUserRank(interaction.client, targetUser.id);

            await interaction.editReply({
                content:
                    `✅ **Rang mis à jour !**\n\n` +
                    `👤 Utilisateur : ${targetUser}\n` +
                    `⚔️ Points RP actuels : **${userData.points.toLocaleString()}**\n\n` +
                    `Le rôle de rang Discord a été synchronisé avec les points RP.`,
            });

            logger.info(
                `[ADMIN] Rang forcé pour ${targetUser.tag} (${targetUser.id}) par ${interaction.user.tag} - ${userData.points} RP`
            );
        } catch (error) {
            logger.error('Erreur lors de la mise à jour forcée du rang:', error);
            const reply = {
                content: `❌ Erreur lors de la mise à jour du rang : ${error.message || String(error)}`,
            };
            if (interaction.deferred) {
                await interaction.editReply(reply);
            } else {
                await interaction.reply(reply);
            }
        }
    },
};
