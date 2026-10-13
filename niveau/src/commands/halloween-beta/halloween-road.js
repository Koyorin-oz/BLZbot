const { SlashCommandBuilder, AttachmentBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { ROAD } = require('../../halloween2026/config');
const { isLive } = require('../../halloween2026/live');
const store = require('../../halloween2026/store');
const { questOpen } = require('../../halloween2026/config');
const { renderHalloweenRoad } = require('../../utils/canvas-halloween-road');

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
        await interaction.deferReply({ ephemeral: true });

        const quests = ROAD.map((q) => {
            const row = store.roadRow(interaction.user.id, q.id);
            return {
                day: `${q.date.slice(8)}/10`,
                label: q.label,
                reward: q.reward,
                progress: row.progress,
                goal: q.goal,
                done: row.done === 1,
                open: questOpen(q),
            };
        });
        const done = store.completedCount(interaction.user.id);
        const png = await renderHalloweenRoad({
            username: interaction.user.username,
            done,
            quests,
        });
        const file = new AttachmentBuilder(png, { name: 'halloween-road.png' });

        const row = done >= 9
            ? [new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('hw26:streak:xp').setLabel('x2 EXP jusqu\'au reset').setStyle(ButtonStyle.Primary),
                new ButtonBuilder().setCustomId('hw26:streak:role').setLabel('Rôle Fantôme d\'Halloween').setStyle(ButtonStyle.Secondary),
            )]
            : [];

        return interaction.editReply({ files: [file], components: row });
    },
};
