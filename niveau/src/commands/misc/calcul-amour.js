const { SlashCommandBuilder, AttachmentBuilder } = require('discord.js');
const { buildLoveCalcCard } = require('../../utils/canvas-love-calc');
const db = require('../../database/database');
const { getOrCreateUser } = require('../../utils/db-users');

const LOVE_RESULT_TTL_MS = 2 * 60 * 60 * 1000;

function getLovePercentage(userIdA, userIdB) {
    const [member1Id, member2Id] = [userIdA, userIdB].sort();
    const now = Date.now();

    return db.transaction(() => {
        const previous = db.prepare(`
            SELECT percentage, created_at
            FROM love_calculations
            WHERE member1_id = ? AND member2_id = ?
            ORDER BY created_at DESC
            LIMIT 1
        `).get(member1Id, member2Id);

        if (previous && now - previous.created_at < LOVE_RESULT_TTL_MS) {
            return previous.percentage;
        }

        const percentage = userIdA === userIdB ? 100 : Math.floor(Math.random() * 101);
        db.prepare(`
            INSERT INTO love_calculations (member1_id, member2_id, percentage, created_at)
            VALUES (?, ?, ?, ?)
        `).run(member1Id, member2Id, percentage, now);

        return percentage;
    })();
}

function pickLovePhrase(percent, nameA, nameB) {
    if (percent >= 90) return `🔥 ${nameA} + ${nameB} = duo légendaire !`;
    if (percent >= 70) return '❤️ Ça sent très très bon cette histoire.';
    if (percent >= 45) return '😊 Du potentiel… continuez de discuter.';
    if (percent >= 20) return '😅 C’est compliqué, mais pas impossible.';
    return '💀 Ouch… ce ship est en danger.';
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('calcul-amour')
        .setDescription('Compatibilité entre deux membres.')
        .addUserOption((o) =>
            o.setName('membre1').setDescription('Premier membre').setRequired(true)
        )
        .addUserOption((o) =>
            o.setName('membre2').setDescription('Deuxième membre').setRequired(true)
        ),

    async execute(interaction) {
        await interaction.deferReply();

        const user1 = interaction.options.getUser('membre1', true);
        const user2 = interaction.options.getUser('membre2', true);

        if (!interaction.guild) {
            return interaction.editReply('Cette commande ne fonctionne que sur un serveur.');
        }

        const member1 = await interaction.guild.members.fetch(user1.id).catch(() => null);
        const member2 = await interaction.guild.members.fetch(user2.id).catch(() => null);

        if (!member1 || !member2) {
            return interaction.editReply('Impossible de récupérer les membres.');
        }

        const percent = getLovePercentage(user1.id, user2.id);
        const phrase = pickLovePhrase(percent, member1.displayName, member2.displayName);
        const buffer = await buildLoveCalcCard(user1, user2, percent);
        const file = new AttachmentBuilder(buffer, { name: 'calcul-amour.png' });
        const user1Settings = getOrCreateUser(user1.id, user1.username);
        const user2Settings = getOrCreateUser(user2.id, user2.username);
        const pingUserIds = [...new Set([
            user1Settings.notify_love_calc !== 0 ? user1.id : null,
            user2Settings.notify_love_calc !== 0 ? user2.id : null,
        ].filter(Boolean))];
        const displayUser1 = pingUserIds.includes(user1.id) ? `<@${user1.id}>` : `**${member1.displayName}**`;
        const displayUser2 = pingUserIds.includes(user2.id) ? `<@${user2.id}>` : `**${member2.displayName}**`;

        return interaction.editReply({
            content: `💘 ${displayUser1} + ${displayUser2} = **${percent}%**\n${phrase}`,
            files: [file],
            allowedMentions: { users: pingUserIds },
        });
    },
};
