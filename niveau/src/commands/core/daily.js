const {
    SlashCommandBuilder,
    AttachmentBuilder,
    ButtonBuilder,
    ButtonStyle,
    ActionRowBuilder,
    ComponentType,
    MessageFlags,
} = require('discord.js');
const { getOrCreateUser, grantResources, updateDailyClaim, addItemToInventory, getUserInventory } = require('../../utils/db-users');
const { msToTime } = require('../../utils/time');
const { checkQuestProgress } = require('../../utils/quests');
const logger = require('../../utils/logger');
const { renderDailyCard } = require('../../utils/canvas-daily');
const { handleCommandError } = require('../../utils/error-handler');
const path = require('node:path');

logger.info(`[daily] module canvas: ${path.normalize(require.resolve('../../utils/canvas-daily'))}`);

const rewards = [
    { name: '10 000 Starss', chance: 0.3, type: 'stars', amount: 10000 },
    { name: '500 EXP', chance: 0.3, type: 'xp', amount: 500 },
    { name: '500 RP', chance: 0.2, type: 'points', amount: 500 },
    { name: '25 000 Starss', chance: 0.1, type: 'stars', amount: 25000 },
    { name: 'Coffre au trésor', chance: 0.09, type: 'item', itemId: 'coffre_normal' },
    { name: 'Méga coffre au trésor', chance: 0.01, type: 'item', itemId: 'coffre_mega' },
];

function getRandomReward() {
    const rand = Math.random();
    let cumulativeChance = 0;
    for (const reward of rewards) {
        cumulativeChance += reward.chance;
        if (rand < cumulativeChance) {
            return reward;
        }
    }
    return rewards[0];
}

function buildCloseRow() {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('daily_close').setLabel('Fermer').setStyle(ButtonStyle.Secondary)
    );
}

async function sendDailyCanvasReply(interaction, pngBuffer) {
    const file = new AttachmentBuilder(pngBuffer, { name: 'daily.png' });
    const message = await interaction.editReply({
        files: [file],
        components: [buildCloseRow()],
        flags: MessageFlags.Ephemeral,
    });

    const collector = message.createMessageComponentCollector({
        componentType: ComponentType.Button,
        time: 5 * 60 * 1000,
    });

    collector.on('collect', async (i) => {
        if (i.user.id !== interaction.user.id) {
            return i.reply({ content: "Seul l'auteur de la commande peut utiliser ce bouton.", ephemeral: true });
        }
        if (i.customId === 'daily_close') {
            try {
                await i.update({ components: [] });
            } catch (e) {
                logger.warn('Erreur fermeture daily:', e.message);
            }
            collector.stop();
        }
    });
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('daily')
        .setDescription('Réclamer la récompense journalière.'),

    async execute(interaction) {
        try {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });

            const userId = interaction.user.id;
            let user = getOrCreateUser(userId, interaction.user.username);

            const now = new Date();
            const midnightLocal = new Date(now);
            midnightLocal.setHours(0, 0, 0, 0);

            const canClaim = !user.daily_last_claimed || user.daily_last_claimed === 0;

            let lastClaimedMidnight;
            if (!canClaim) {
                const lastClaimedDate = new Date(user.daily_last_claimed);
                lastClaimedMidnight = new Date(lastClaimedDate);
                lastClaimedMidnight.setHours(0, 0, 0, 0);
            }

            if (canClaim || lastClaimedMidnight < midnightLocal) {
                try {
                    const reward = getRandomReward();
                    let rewardType = '';
                    let rewardEmoji = '';

                    switch (reward.type) {
                        case 'stars':
                            await grantResources(interaction.client, userId, { stars: reward.amount, source: 'daily' });
                            rewardType = 'stars';
                            rewardEmoji = '⭐';
                            break;
                        case 'xp':
                            await grantResources(interaction.client, userId, { xp: reward.amount, source: 'daily' });
                            rewardType = 'xp';
                            rewardEmoji = '🚀';
                            break;
                        case 'points':
                            await grantResources(interaction.client, userId, { points: reward.amount, source: 'daily' });
                            rewardType = 'points';
                            rewardEmoji = '🏆';
                            break;
                        case 'item':
                            addItemToInventory(userId, reward.itemId, 1);
                            rewardType = 'item';
                            rewardEmoji = '🎁';
                            if (reward.itemId === 'coffre_normal') {
                                checkQuestProgress(interaction.client, 'DAILY_CHEST_REWARD', interaction.user);
                            } else if (reward.itemId === 'coffre_mega') {
                                checkQuestProgress(interaction.client, 'DAILY_MEGA_CHEST_REWARD', interaction.user);
                            }
                            break;
                    }

                    updateDailyClaim(userId);
                    checkQuestProgress(interaction.client, 'DAILY_CLAIM', interaction.user);
                    user = getOrCreateUser(userId, interaction.user.username);

                    const member = await interaction.guild.members.fetch(userId).catch(() => null);
                    const displayName = member?.displayName || interaction.user.username;
                    const highestRoleName =
                        member?.roles.highest?.name !== '@everyone' ? member?.roles.highest?.name : 'Membre';
                    const avatarURL = member?.displayAvatarURL({ extension: 'png', size: 256 });

                    let png;
                    try {
                        png = await Promise.race([
                            renderDailyCard({
                                user,
                                username: interaction.user.username,
                                displayName,
                                highestRoleName,
                                avatarURL,
                                rewardName: reward.name,
                                rewardType,
                                rewardAmount: reward.type === 'item' ? null : reward.amount,
                                rewardEmoji,
                                isSuccess: true,
                            }),
                            new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 15000)),
                        ]);
                    } catch (renderError) {
                        logger.error('Erreur rendu canvas daily:', renderError);
                        return interaction.editReply({
                            content: `✅ Récompense obtenue: **${reward.name}** !`,
                            flags: MessageFlags.Ephemeral,
                        });
                    }

                    await sendDailyCanvasReply(interaction, png);
                } catch (claimError) {
                    logger.error('Erreur claim daily:', claimError);
                    await interaction.editReply({
                        content: '❌ Une erreur est survenue.',
                    });
                }
            } else {
                try {
                    const tomorrowMidnight = new Date(midnightLocal);
                    tomorrowMidnight.setDate(tomorrowMidnight.getDate() + 1);
                    const remainingTime = tomorrowMidnight.getTime() - now.getTime();

                    const inventory = getUserInventory(userId);
                    const doubleDailyItem = inventory.find((item) => item.item_id === 'double_daily');
                    const hasDoubleDailyCount = doubleDailyItem ? doubleDailyItem.quantity : 0;

                    user = getOrCreateUser(userId, interaction.user.username);

                    const member = await interaction.guild.members.fetch(userId).catch(() => null);
                    const displayName = member?.displayName || interaction.user.username;
                    const highestRoleName =
                        member?.roles.highest?.name !== '@everyone' ? member?.roles.highest?.name : 'Membre';
                    const avatarURL = member?.displayAvatarURL({ extension: 'png', size: 256 });

                    let png;
                    try {
                        png = await Promise.race([
                            renderDailyCard({
                                user,
                                username: interaction.user.username,
                                displayName,
                                highestRoleName,
                                avatarURL,
                                remainingTime: msToTime(remainingTime),
                                doubleDailyCount: hasDoubleDailyCount,
                                isSuccess: false,
                            }),
                            new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 15000)),
                        ]);
                    } catch (renderError) {
                        logger.error('Erreur rendu canvas daily (cooldown):', renderError);
                        return interaction.editReply({
                            content: `⏳ Réessayez dans **${msToTime(remainingTime)}**.`,
                        });
                    }

                    await sendDailyCanvasReply(interaction, png);
                } catch (cooldownError) {
                    logger.error('Erreur cooldown daily:', cooldownError);
                    await interaction.editReply({
                        content: '❌ Une erreur est survenue.',
                    });
                }
            }
        } catch (error) {
            logger.error('Erreur /daily:', error);
            try {
                await handleCommandError(interaction, error, interaction.client);
            } catch (handlerError) {
                logger.error('Erreur handler:', handlerError);
                await interaction.editReply({
                    content: '❌ Erreur critique.',
                }).catch(() => {});
            }
        }
    },
};
