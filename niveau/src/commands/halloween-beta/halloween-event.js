const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { isLive } = require('../../halloween2026/live');
const { spawn } = require('../../halloween2026/events');

const REPLIES = {
    ok: 'Event lancé dans le général.',
    busy: 'Un event est déjà en cours, attends qu\'il se termine.',
    off: 'Update Halloween pas encore sur ce serveur.',
    nochannel: 'Salon général introuvable.',
};

module.exports = {
    data: new SlashCommandBuilder()
        .setName('halloween-event')
        .setDescription('[Admin] Lance un event Halloween tout de suite dans le général.')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addStringOption((o) => o.setName('type').setDescription('Laisser vide = au hasard').setRequired(false).addChoices(
            { name: '🎃 Citrouille géante', value: 'citrouille' },
            { name: '🍬 Sac de bonbons', value: 'bonbons' },
            { name: '👻 Fantôme farceur', value: 'fantome' },
            { name: '🧪 Chaudron mystère', value: 'chaudron' },
            { name: '✍️ Réécris la phrase', value: 'phrase' },
        )),

    async execute(interaction) {
        if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
            return interaction.reply({ content: 'Réservé aux admins.', ephemeral: true });
        }
        if (!isLive(interaction.guildId)) {
            return interaction.reply({ content: REPLIES.off, ephemeral: true });
        }
        await interaction.deferReply({ ephemeral: true });
        const status = await spawn(interaction.client, interaction.guild, {
            force: true,
            kind: interaction.options.getString('type'),
        });
        return interaction.editReply(REPLIES[status] || 'Impossible de lancer l\'event.');
    },
};
