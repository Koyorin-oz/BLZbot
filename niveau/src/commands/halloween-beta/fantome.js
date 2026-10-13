const { SlashCommandBuilder } = require('discord.js');
const { isLive } = require('../../halloween2026/live');
const store = require('../../halloween2026/store');
const { progress } = require('../../halloween2026/rewards');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('fantome')
        .setDescription('Envoie un fantôme : -30% RP, EXP et starss pendant 2h, plus d\'events.')
        .addUserOption((o) => o.setName('cible').setDescription('La personne').setRequired(true)),

    async execute(interaction) {
        if (!isLive(interaction.guildId)) {
            return interaction.reply({ content: 'Update Halloween pas encore sur ce serveur.', ephemeral: true });
        }
        const target = interaction.options.getUser('cible');
        if (target.bot || target.id === interaction.user.id) {
            return interaction.reply({ content: 'Cible invalide.', ephemeral: true });
        }
        if (!store.takeItem(interaction.user.id, 'fantomes', 1)) {
            return interaction.reply({ content: 'Tu n\'as pas de fantôme. Boutique : /halloween-boutique.', ephemeral: true });
        }
        store.curse(target.id, interaction.user.id);
        await progress(interaction.client, interaction.guild, interaction.user.id, 'ghost', 1);
        return interaction.reply({
            content: `${target} est maudit 2h (−30% RP, EXP, starss, pas de mini-jeux ni events Halloween).`,
        });
    },
};
