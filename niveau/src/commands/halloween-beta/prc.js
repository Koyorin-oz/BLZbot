const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { isLive } = require('../../halloween2026/live');
const { manualPrc } = require('../../halloween2026/hooks');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('prc')
        .setDescription('[Admin] Ping revive chat manuel dans le général.')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    async execute(interaction) {
        if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
            return interaction.reply({ content: 'Réservé aux admins.', ephemeral: true });
        }
        if (!isLive(interaction.guildId)) {
            return interaction.reply({ content: 'Update Halloween pas encore sur ce serveur.', ephemeral: true });
        }
        return manualPrc(interaction);
    },
};
