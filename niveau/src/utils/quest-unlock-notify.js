const { EmbedBuilder } = require('discord.js');

const RARITY_COLORS = {
    Commune: 0x95a5a6,
    Rare: 0x3498db,
    Épique: 0x9b59b6,
    Légendaire: 0xf1c40f,
    Mythique: 0xe74c3c,
    Goatesque: 0x00ffff,
    Halloween: 0xe67e22,
};

function resolveQuestLogChannelId() {
    return String(process.env.QUEST_CHANNEL || process.env.BLZ_QUESTS_LOG_CHANNEL_ID || '').trim();
}

function formatQuestLogDate(d = new Date()) {
    const p = (n) => String(n).padStart(2, '0');
    return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function formatQuestDescription(quest) {
    const name = String(quest?.name || 'Succès').trim();
    let line = String(quest?.description || '').trim();
    if (line && !line.startsWith('-')) line = `- ${line}`;
    return line ? `**${name}**\n${line}` : `**${name}**`;
}

function formatQuestRewardFooter(quest, rewardText) {
    const rarity = quest?.rarity || 'Commune';
    const rewards = String(rewardText || 'Aucune').trim();
    return `Rareté: ${rarity} | Récompense : ${rewards} • ${formatQuestLogDate()}`;
}

/**
 * Embed « Succès Déverrouillé » (salon quêtes).
 * @param {import('discord.js').User} user
 * @param {{ name: string, description?: string, rarity?: string }} quest
 * @param {string} rewardText
 */
function buildQuestUnlockEmbed(user, quest, rewardText) {
    const rarity = quest?.rarity || 'Commune';
    const embed = new EmbedBuilder()
        .setAuthor({
            name: user.username || user.tag || 'Joueur',
            iconURL: typeof user.displayAvatarURL === 'function' ? user.displayAvatarURL() : undefined,
        })
        .setTitle('Succès Déverrouillé !')
        .setDescription(formatQuestDescription(quest))
        .setColor(RARITY_COLORS[rarity] ?? 0x5865f2)
        .setFooter({ text: formatQuestRewardFooter(quest, rewardText) });
    return embed;
}

/**
 * @param {import('discord.js').Client} client
 * @param {import('discord.js').User|{ id: string, username?: string }} user
 * @param {{ name: string, description?: string, rarity?: string }} quest
 * @param {string} rewardText
 * @param {{ shouldPing?: boolean }} [opts]
 */
async function sendQuestUnlockNotification(client, user, quest, rewardText, opts = {}) {
    const channelId = resolveQuestLogChannelId();
    if (!channelId) return false;

    const ch = await client.channels.fetch(channelId).catch(() => null);
    if (!ch || typeof ch.send !== 'function') return false;

    let fullUser = user;
    if (user?.id && typeof client.users?.fetch === 'function') {
        fullUser = (await client.users.fetch(user.id).catch(() => null)) || user;
    }

    const shouldPing = opts.shouldPing !== false;
    const embed = buildQuestUnlockEmbed(fullUser, quest, rewardText);

    await ch.send({
        content: `<@${fullUser.id}>`,
        embeds: [embed],
        allowedMentions: shouldPing ? { users: [fullUser.id] } : { parse: [] },
    });
    return true;
}

module.exports = {
    resolveQuestLogChannelId,
    buildQuestUnlockEmbed,
    sendQuestUnlockNotification,
    formatQuestDescription,
    formatQuestRewardFooter,
};
