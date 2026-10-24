const { SlashCommandBuilder } = require('discord.js');
const { isLive } = require('../../halloween2026/live');
const store = require('../../halloween2026/store');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('collier')
        .setDescription('Retire la malédiction fantôme (1 charge).'),

    async execute(interaction) {
        if (!isLive(interaction.guildId)) {
            return interaction.reply({ content: 'Update Halloween pas encore sur ce serveur.', ephemeral: true });
        }
        if (!store.isCursed(interaction.user.id)) {
            return interaction.reply({ content: 'Tu n\'es pas maudit.', ephemeral: true });
        }
        if (!store.takeItem(interaction.user.id, 'colliers', 1)) {
            return interaction.reply({ content: 'Plus de charge. Le collier s\'achète à la boutique (3 charges).', ephemeral: true });
        }
        store.clearCurse(interaction.user.id);
        return interaction.reply({ content: 'Malédiction retirée. Une charge en moins.', ephemeral: true });
    },
};
