const path = require('node:path');

const QUESTS_LOG_CHANNEL_ID = String(
    process.env.BLZ_QUESTS_LOG_CHANNEL_ID || process.env.QUEST_CHANNEL || '1454479460798566410',
).trim();

function loadNotifyHelper() {
    try {
        return require(path.join(__dirname, '..', '..', '..', 'niveau', 'src', 'utils', 'quest-unlock-notify'));
    } catch {
        return null;
    }
}

/**
 * Poste une complétion de quête REBORN (quotidienne / hebdo / sélection) au format « Succès Déverrouillé ».
 * @param {import('discord.js').Client} client
 * @param {string} userId
 * @param {{ daily?: object, weekly?: object, selection?: object }} unlocked
 */
async function notifyQuestUnlocks(client, userId, unlocked) {
    if (!unlocked || !QUESTS_LOG_CHANNEL_ID) return;

    const helper = loadNotifyHelper();
    const user = await client.users.fetch(userId).catch(() => null);
    if (!user) return;

    const entries = [];
    if (unlocked.daily) {
        entries.push({
            quest: {
                name: 'Quête quotidienne',
                description: unlocked.daily.label || 'Objectif du jour validé.',
                rarity: 'Commune',
            },
            rewardText: `+${Number(unlocked.daily.reward || 0).toLocaleString('fr-FR')} Starss`,
        });
    }
    if (unlocked.weekly) {
        entries.push({
            quest: {
                name: 'Quête hebdomadaire',
                description: unlocked.weekly.label || 'Objectif de la semaine validé.',
                rarity: 'Rare',
            },
            rewardText: `+${Number(unlocked.weekly.reward || 0).toLocaleString('fr-FR')} Starss`,
        });
    }
    if (unlocked.selection) {
        entries.push({
            quest: {
                name: unlocked.selection.label || 'Quête spéciale',
                description: 'Objectif de la sélection validé.',
                rarity: 'Épique',
            },
            rewardText: `+${Number(unlocked.selection.reward || 0).toLocaleString('fr-FR')} Starss`,
        });
    }
    if (!entries.length) return;

    try {
        for (const { quest, rewardText } of entries) {
            if (helper?.sendQuestUnlockNotification) {
                process.env.QUEST_CHANNEL = QUESTS_LOG_CHANNEL_ID;
                await helper.sendQuestUnlockNotification(client, user, quest, rewardText, {
                    shouldPing: true,
                    channelId: QUESTS_LOG_CHANNEL_ID,
                });
            } else {
                const ch = await client.channels.fetch(QUESTS_LOG_CHANNEL_ID).catch(() => null);
                if (!ch?.send) continue;
                await ch.send({
                    content: `<@${userId}>`,
                    embeds: [
                        {
                            author: { name: user.username, icon_url: user.displayAvatarURL() },
                            title: 'Nouveau Succès',
                            description: `**${quest.name}**\n- ${quest.description}`,
                            color: 0x3498db,
                            footer: { text: `Rareté: ${quest.rarity} | Récompense : ${rewardText}` },
                        },
                    ],
                    allowedMentions: { users: [userId] },
                });
            }
        }
    } catch (e) {
        console.warn('[questNotify] envoi KO', e?.message || e);
    }
}

module.exports = { notifyQuestUnlocks };
