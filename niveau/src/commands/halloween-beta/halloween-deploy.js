const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { MAIN_GUILD_ID } = require('../../halloween2026/config');
const { markDeployed } = require('../../halloween2026/store');
const { pushGuild } = require('../../halloween2026/register');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('halloween-deploy')
        .setDescription('[Admin] Active l\'update Halloween sur le serveur principal.')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    async execute(interaction) {
        if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
            return interaction.reply({ content: 'Réservé aux admins.', ephemeral: true });
        }
        await interaction.deferReply({ ephemeral: true });
        try {
            markDeployed(MAIN_GUILD_ID);
            const names = await pushGuild(interaction.client, MAIN_GUILD_ID);
            return interaction.editReply(
                `Update Halloween active sur le serveur principal (${MAIN_GUILD_ID}).\nCommandes : ${names.join(', ')}\nCtrl+Maj+R si le menu / tarde.`,
            );
        } catch (e) {
            return interaction.editReply(`Échec : ${e?.message || e}`);
        }
    },
};
