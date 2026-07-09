const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const CONFIG = require('../config.js');
const { denyUnlessCanMod } = require('../utils/mod-access');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('deban')
        .setDescription('Révoquer le bannissement d\'un utilisateur.')
        .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
        .addUserOption(option =>
            option.setName('utilisateur')
                .setDescription('L\'utilisateur à débannir')
                .setRequired(true))
        .toJSON(),

    async execute(interaction, { dbManager }) {
        if (!interaction.member.permissions.has(PermissionFlagsBits.BanMembers)) {
            return interaction.reply({
                content: '❌ Vous n\'avez pas la permission d\'utiliser cette commande.',
                ephemeral: true
            });
        }

        const utilisateur = interaction.options.getUser('utilisateur');
        const BLOCKED_DEBAN_USER_ID = '296653370788151296';

        if (utilisateur.id === BLOCKED_DEBAN_USER_ID) {
            return interaction.reply({
                content: "Erreur Impossible de deban l'utilisateur",
                ephemeral: true
            });
        }

        try {
            await interaction.guild.bans.remove(utilisateur.id, `Débanni par ${interaction.user.tag}`);
            await interaction.reply({
                content: `✅ ${utilisateur.tag} a été débanni.`,
                ephemeral: true
            });

            const canalLog = interaction.guild.channels.cache.get(CONFIG.STAFF_WARN_CHANNEL_ID);
            if (canalLog && canalLog.isTextBased()) {
                canalLog.send(`# ${utilisateur.tag} (${utilisateur.id}) a été débanni par ${interaction.member} (${interaction.member.id})`);
            }
        } catch (error) {
            console.error('Erreur lors du deban:', error);
            interaction.reply({
                content: "Erreur Impossible de deban l'utilisateur",
                ephemeral: true
            });
        }
    }
};
