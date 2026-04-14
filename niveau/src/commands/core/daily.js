const { SlashCommandBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder, ComponentType, ContainerBuilder, MediaGalleryBuilder, MessageFlags, TextDisplayBuilder } = require('discord.js');
const { getOrCreateUser, grantResources, updateDailyClaim, addItemToInventory, getUserInventory } = require('../../utils/db-users');
const { msToTime } = require('../../utils/time');
const { checkQuestProgress } = require('../../utils/quests');
const logger = require('../../utils/logger');
const { renderDailyCard } = require('../../utils/canvas-daily');
const { handleCommandError } = require('../../utils/error-handler');

const rewards = [
    { name: '10 000 Starss', chance: 0.30, type: 'stars', amount: 10000 },
    { name: '500 EXP', chance: 0.30, type: 'xp', amount: 500 },
    { name: '500 RP', chance: 0.20, type: 'points', amount: 500 },
    { name: '25 000 Starss', chance: 0.10, type: 'stars', amount: 25000 },
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

module.exports = {
    data: new SlashCommandBuilder()
        .setName('daily')
        .setDescription('Réclamez votre récompense journalière aléatoire !'),

    async execute(interaction) {
        try {
            await interaction.deferReply();

            const userId = interaction.user.id;
            const user = getOrCreateUser(userId, interaction.user.username);

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
                // ============================================
                // CLAIM SUCCESS
                // ============================================
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

                    // Récupérer les infos du membre
                    const member = await interaction.guild.members.fetch(userId).catch(() => null);
                    const displayName = member?.displayName || interaction.user.username;
                    const highestRoleName = member?.roles.highest?.name !== '@everyone' ? member?.roles.highest?.name : 'Membre';
                    const avatarURL = member?.displayAvatarURL({ extension: 'png', size: 256 });

                    // Rendu avec timeout
                    let png;
                    try {
                        png = await Promise.race([
                            renderDailyCard({
                                username: interaction.user.username,
                                displayName: displayName,
                                highestRoleName: highestRoleName,
                                avatarURL: avatarURL,
                                rewardName: reward.name,
                                rewardType: rewardType,
                                rewardAmount: reward.type === 'item' ? null : reward.amount,
                                rewardEmoji: rewardEmoji,
                                isSuccess: true
                            }),
                            new Promise((_, reject) => 
                                setTimeout(() => reject(new Error('Timeout')), 15000)
                            )
                        ]);
                    } catch(renderError) {
                        logger.error('Erreur rendu canvas daily:', renderError);
                        return interaction.editReply({ 
                            content: `✅ Récompense obtenue: **${reward.name}** !` 
                        });
                    }

                    const file = new AttachmentBuilder(png, { name: 'daily.png' });
                    const mediaGallery = new MediaGalleryBuilder()
                        .addItems({ media: { url: 'attachment://daily.png' } });

                    const actionRow = new ActionRowBuilder().addComponents(
                        new ButtonBuilder()
                            .setCustomId('daily_close')
                            .setLabel('Fermer')
                            .setStyle(ButtonStyle.Secondary)
                    );

                    const container = new ContainerBuilder()
                        .addMediaGalleryComponents(mediaGallery)
                        .addActionRowComponents(actionRow);

                    const message = await interaction.editReply({
                        content: null,
                        files: [file],
                        components: [container],
                        flags: MessageFlags.IsComponentsV2
                    });

                    // Collector
                    const collector = message.createMessageComponentCollector({
                        componentType: ComponentType.Button,
                        time: 5 * 60 * 1000
                    });

                    collector.on('collect', async i => {
                        if (i.user.id !== interaction.user.id) {
                            const errorText = new TextDisplayBuilder().setContent("Seul l'auteur de la commande peut interagir.");
                            const errorContainer = new ContainerBuilder().addTextDisplayComponents(errorText);
                            return i.reply({
                                components: [errorContainer],
                                flags: MessageFlags.IsComponentsV2,
                                ephemeral: true
                            });
                        }

                        if (i.customId === 'daily_close') {
                            try {
                                await i.update({ components: [] });
                            } catch(e) {
                                logger.warn('Erreur fermeture daily:', e.message);
                            }
                            collector.stop();
                        }
                    });

                } catch(claimError) {
                    logger.error('Erreur claim daily:', claimError);
                    await interaction.editReply({ 
                        content: '❌ Une erreur est survenue.' 
                    });
                }

            } else {
                // ============================================
                // COOLDOWN
                // ============================================
                try {
                    const tomorrowMidnight = new Date(midnightLocal);
                    tomorrowMidnight.setDate(tomorrowMidnight.getDate() + 1);
                    const remainingTime = tomorrowMidnight.getTime() - now.getTime();

                    const inventory = getUserInventory(userId);
                    const doubleDailyItem = inventory.find(item => item.item_id === 'double_daily');
                    const hasDoubleDailyCount = doubleDailyItem ? doubleDailyItem.quantity : 0;

                    // Récupérer les infos du membre
                    const member = await interaction.guild.members.fetch(userId).catch(() => null);
                    const displayName = member?.displayName || interaction.user.username;
                    const highestRoleName = member?.roles.highest?.name !== '@everyone' ? member?.roles.highest?.name : 'Membre';
                    const avatarURL = member?.displayAvatarURL({ extension: 'png', size: 256 });

                    // Rendu avec timeout
                    let png;
                    try {
                        png = await Promise.race([
                            renderDailyCard({
                                username: interaction.user.username,
                                displayName: displayName,
                                highestRoleName: highestRoleName,
                                avatarURL: avatarURL,
                                remainingTime: msToTime(remainingTime),
                                doubleDailyCount: hasDoubleDailyCount,
                                isSuccess: false
                            }),
                            new Promise((_, reject) => 
                                setTimeout(() => reject(new Error('Timeout')), 15000)
                            )
                        ]);
                    } catch(renderError) {
                        logger.error('Erreur rendu canvas daily (cooldown):', renderError);
                        return interaction.editReply({ 
                            content: `⏳ Réessayez dans **${msToTime(remainingTime)}**.` 
                        });
                    }

                    const file = new AttachmentBuilder(png, { name: 'daily.png' });
                    const mediaGallery = new MediaGalleryBuilder()
                        .addItems({ media: { url: 'attachment://daily.png' } });

                    const actionRow = new ActionRowBuilder().addComponents(
                        new ButtonBuilder()
                            .setCustomId('daily_close')
                            .setLabel('Fermer')
                            .setStyle(ButtonStyle.Secondary)
                    );

                    const container = new ContainerBuilder()
                        .addMediaGalleryComponents(mediaGallery)
                        .addActionRowComponents(actionRow);

                    const message = await interaction.editReply({
                        content: null,
                        files: [file],
                        components: [container],
                        flags: MessageFlags.IsComponentsV2
                    });

                    // Collector
                    const collector = message.createMessageComponentCollector({
                        componentType: ComponentType.Button,
                        time: 5 * 60 * 1000
                    });

                    collector.on('collect', async i => {
                        if (i.user.id !== interaction.user.id) {
                            const errorText = new TextDisplayBuilder().setContent("Seul l'auteur de la commande peut interagir.");
                            const errorContainer = new ContainerBuilder().addTextDisplayComponents(errorText);
                            return i.reply({
                                components: [errorContainer],
                                flags: MessageFlags.IsComponentsV2,
                                ephemeral: true
                            });
                        }

                        if (i.customId === 'daily_close') {
                            try {
                                await i.update({ components: [] });
                            } catch(e) {
                                logger.warn('Erreur fermeture daily:', e.message);
                            }
                            collector.stop();
                        }
                    });

                } catch(cooldownError) {
                    logger.error('Erreur cooldown daily:', cooldownError);
                    await interaction.editReply({ 
                        content: '❌ Une erreur est survenue.' 
                    });
                }
            }

        } catch (error) {
            logger.error('Erreur /daily:', error);
            try {
                await handleCommandError(interaction, error, interaction.client);
            } catch(handlerError) {
                logger.error('Erreur handler:', handlerError);
                await interaction.editReply({ 
                    content: '❌ Erreur critique.' 
                }).catch(() => {});
            }
        }
    },
};