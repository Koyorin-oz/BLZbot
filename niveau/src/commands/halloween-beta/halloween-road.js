const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { ROAD } = require('../../halloween2026/config');
const { isLive } = require('../../halloween2026/live');
const store = require('../../halloween2026/store');
const { questOpen } = require('../../halloween2026/config');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('halloween-road')
        .setDescription('Road Halloween : quêtes du jour et bonus 9/9.'),

    async execute(interaction) {
        if (!isLive(interaction.guildId)) {
            return interaction.reply({ content: 'Update Halloween pas encore sur ce serveur.', ephemeral: true });
        }
        const { memberHasShopRole, progress } = require('../../halloween2026/rewards');
        if (await memberHasShopRole(interaction.member)) {
            await progress(interaction.client, interaction.guild, interaction.user.id, 'roles', 1);
        }
        const lines = ROAD.map((q) => {
            const row = store.roadRow(interaction.user.id, q.id);
            const open = questOpen(q);
            const state = row.done ? 'fait' : open ? `${row.progress}/${q.goal}` : 'fermé';
            return `**${q.date.slice(8)}/10** ${q.label} — ${state} — ${q.reward}`;
        });
        const done = store.completedCount(interaction.user.id);
        const embed = new EmbedBuilder()
            .setTitle('Road Halloween')
            .setColor(0xe67e22)
            .setDescription(lines.join('\n'))
            .setFooter({ text: `${done}/9 quêtes` });

        const row = done >= 9
            ? [new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('hw26:streak:xp').setLabel('x2 EXP jusqu\'au reset').setStyle(ButtonStyle.Primary),
                new ButtonBuilder().setCustomId('hw26:streak:role').setLabel('Rôle Fantôme d\'Halloween').setStyle(ButtonStyle.Secondary),
            )]
            : [];

        return interaction.reply({ embeds: [embed], components: row, ephemeral: true });
    },
};
