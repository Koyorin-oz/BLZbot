const { SlashCommandBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder, ComponentType, ContainerBuilder, MediaGalleryBuilder, MessageFlags, TextDisplayBuilder, SectionBuilder } = require('discord.js');
const path = require('node:path');
const { getOrCreateUser, getUserInventory } = require('../../utils/db-users');
const { getGuildOfUser, getGuildById, getGuildMembersWithDetails } = require('../../utils/db-guilds');
const { getDisplayRank, RANKS } = require('../../utils/ranks');
const { renderProfileCard } = require('../../utils/canvas-profile');
const { renderQuestsCardFiche2, renderAchievementsCardFiche2 } = require('../../utils/canvas-fiche2-quests-trophies');
const { getAllUserQuests } = require('../../utils/db-quests');
const { QUESTS, checkQuestProgress, syncUserBadges } = require('../../utils/quests');
const { renderGuildProfileV2 } = require('../../utils/canvas-guild-profile-v2');
const { getOngoingWar } = require('../../utils/guild/guild-wars');
const { handleCommandError } = require('../../utils/error-handler');
const { getItem, PASSIVE_ITEMS } = require('../../utils/items');
const logger = require('../../utils/logger');
const db = require('../../database/database');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('profile')
        .setDescription("Affiche votre profil ou celui d'un autre membre.")
        .addUserOption(option =>
            option.setName('membre')
                .setDescription("Le membre dont vous voulez voir le profil.")
                .setRequired(false)),

    async execute(interaction) {
        try {
            await interaction.deferReply();

            const targetUser = interaction.options.getUser('membre') || interaction.user;
            const member = await interaction.guild.members.fetch(targetUser.id).catch(() => null);

            if (!member) {
                return interaction.editReply({ content: 'Impossible de trouver ce membre sur le serveur.' });
            }

            const user = getOrCreateUser(targetUser.id, targetUser.username);

            // Synchronisation des badges
            syncUserBadges(targetUser.id, member);
            const guild = getGuildOfUser(targetUser.id);
            user.guild_name = guild ? guild.name : 'Aucune Guilde';
            user.guild_level = guild ? guild.level : 1;
            user.guild_emoji = guild ? guild.emoji : '🛡️';
            user.guild_treasury = guild ? guild.treasury : 0;
            user.guild_treasury_capacity = guild ? guild.treasury_capacity : 0;
            user.guild_upgrade_level = guild ? guild.upgrade_level : 1;
            user.guild_total_treasury_generated = guild ? guild.total_treasury_generated : 0;
            user.guild_wars_won = guild ? guild.wars_won : 0;

            // Calculer le nombre de membres et les slots
            if (guild) {
                const guildMembers = getGuildMembersWithDetails(guild.id);
                user.guild_members = guildMembers.length;
                user.guild_member_slots = guild.member_slots;

                // Calculer le revenu journalier de la trésorerie
                const { calculateDailyIncome } = require('../../utils/guild/guild-treasury');
                user.guild_treasury_income = calculateDailyIncome(guild);
            } else {
                user.guild_members = 0;
                user.guild_member_slots = 5;
                user.guild_treasury_income = 0;
            }

            // Déterminer l'état de la guilde (guerre ou paix)
            let guildState = 'En Paix';
            if (guild) {
                const war = getOngoingWar(guild.id);
                if (war) {
                    guildState = 'En Guerre';
                }
            }
            user.guild_state = guildState;

            const rank = getDisplayRank(targetUser.id, user.points);


            const { getTotalDebt, getClosestDebtDeadline } = require('../../utils/loan-system');
            const totalDebt = getTotalDebt(targetUser.id);
            const debtTimeRemaining = getClosestDebtDeadline(targetUser.id);

            // --- Calcul du statut Nerf Vocal ---
            const today = new Date().setHours(0, 0, 0, 0);
            let dailyVoiceXP = user.daily_voice_xp || 0;
            let dailyVoicePoints = user.daily_voice_points || 0;

            // Si le last reset date d'avant aujourd'hui, on considère que c'est 0 pour l'affichage
            if ((user.daily_voice_last_reset || 0) < today) {
                dailyVoiceXP = 0;
                dailyVoicePoints = 0;
            }

            let vocalNerfStatus = null;
            // Hard Caps: 15,000 XP ou 7,000 RP (Points)
            if (dailyVoiceXP >= 15000 || dailyVoicePoints >= 7000) {
                vocalNerfStatus = "⛔ STOP : Vous avez atteint la limite journalière en vocal (0 gains).";
            }
            // Soft Caps: 10,000 XP ou 5,000 RP
            else if (dailyVoiceXP >= 10000 || dailyVoicePoints >= 5000) {
                vocalNerfStatus = "⚠️ Vos revenus vocaux sont divisés par 5.";
            }

            let highestRoleName = 'Membre';
            if (member.roles.highest && member.roles.highest.name !== '@everyone') {
                highestRoleName = member.roles.highest.name;
            }

            const rankIndex = RANKS.findIndex(r => r.name === rank.name);
            const nextRank = (rankIndex < RANKS.length - 1) ? RANKS[rankIndex + 1] : null;

            let rankIconPath;
            // Icône basée sur l'index du rang
            rankIconPath = path.resolve(__dirname, '..', '..', 'assets', 'rank-icons', `${rankIndex + 1}.png`);

            // Fallback si le fichier n'existe pas
            const fs = require('fs');
            if (!fs.existsSync(rankIconPath)) {
                rankIconPath = path.resolve(__dirname, '..', '..', 'assets', 'rank-icons', '1.png');
            }

            const renderMainProfile = async () => {
                const png = await renderProfileCard({
                    user: user,
                    member: member,
                    rank: rank,
                    nextRank: nextRank,
                    highestRoleName: highestRoleName,
                    rankIconPath: rankIconPath,
                    totalDebt: totalDebt,
                    debtTimeRemaining: debtTimeRemaining,
                    vocalNerfStatus: vocalNerfStatus,
                    userId: targetUser.id
                });
                return new AttachmentBuilder(png, { name: 'profile.png' });
            };

            // Build buttons
            const isOwnProfile = targetUser.id === interaction.user.id;
            const buildButtons = (isSubView = false) => {
                const buttons = [];

                // Back button (only in sub-views)
                if (isSubView) {
                    buttons.push(
                        new ButtonBuilder()
                            .setCustomId(`profile_back_${targetUser.id}`)
                            .setLabel('⬅️ Retour')
                            .setStyle(ButtonStyle.Secondary)
                    );
                }

                // Quests button (only for own profile)
                if (isOwnProfile) {
                    buttons.push(
                        new ButtonBuilder()
                            .setCustomId(`profile_quests_${targetUser.id}`)
                            .setLabel('🎯 Quêtes')
                            .setStyle(ButtonStyle.Primary)
                    );
                }

                // Achievements button (now Trophées)
                buttons.push(
                    new ButtonBuilder()
                        .setCustomId(`profile_achievements_${targetUser.id}`)
                        .setLabel('🏆 Trophées')
                        .setStyle(ButtonStyle.Success)
                );

                // Inventory button (only for own profile)
                if (isOwnProfile) {
                    buttons.push(
                        new ButtonBuilder()
                            .setCustomId(`profile_inventory_${targetUser.id}`)
                            .setLabel('📦 Inventaire')
                            .setStyle(ButtonStyle.Primary)
                    );
                }

                // Guild button (only if user is in a guild)
                if (guild) {
                    buttons.push(
                        new ButtonBuilder()
                            .setCustomId(`profile_guild_${guild.id}`)
                            .setLabel('🛡️ Guilde')
                            .setStyle(ButtonStyle.Secondary)
                    );
                }

                return new ActionRowBuilder().addComponents(buttons);
            };

            const file = await renderMainProfile();

            // V2 Component Construction
            const mediaGallery = new MediaGalleryBuilder()
                .addItems({ media: { url: 'attachment://profile.png' } });

            const container = new ContainerBuilder()
                .addMediaGalleryComponents(mediaGallery)
                .addActionRowComponents(buildButtons());

            const message = await interaction.editReply({
                content: null,
                files: [file],
                components: [container],
                flags: MessageFlags.IsComponentsV2
            });

            // Collector for button interactions
            const collector = message.createMessageComponentCollector({
                componentType: ComponentType.Button,
                time: 10 * 60 * 1000
            });

            // Helper to build pagination buttons
            const buildPaginationButtons = (currentId, page, totalPages, type) => {
                const buttons = [];

                // Previous button
                buttons.push(
                    new ButtonBuilder()
                        .setCustomId(`${type}_${targetUser.id}_${page - 1}`)
                        .setLabel('⬅️')
                        .setStyle(ButtonStyle.Secondary)
                        .setDisabled(page === 0)
                );

                // Back to profile button (center)
                buttons.push(
                    new ButtonBuilder()
                        .setCustomId(`profile_back_${targetUser.id}`)
                        .setLabel('🏠 Retour')
                        .setStyle(ButtonStyle.Secondary)
                );

                // Next button
                buttons.push(
                    new ButtonBuilder()
                        .setCustomId(`${type}_${targetUser.id}_${page + 1}`)
                        .setLabel('➡️')
                        .setStyle(ButtonStyle.Secondary)
                        .setDisabled(page >= totalPages - 1)
                );

                return new ActionRowBuilder().addComponents(buttons);
            };

            collector.on('collect', async i => {
                try {
                    // Check if the user who clicked the button is the one who initiated the command
                    if (i.user.id !== interaction.user.id) {
                        const errorText = new TextDisplayBuilder().setContent("Seul l'auteur de la commande peut interagir avec ces boutons. Utilisez `/profile` pour voir le vôtre.");
                        const errorContainer = new ContainerBuilder().addTextDisplayComponents(errorText);
                        return i.reply({ 
                            components: [errorContainer], 
                            flags: MessageFlags.IsComponentsV2, 
                            ephemeral: true 
                        });
                    }

                    // Pour le bouton inventaire, on envoie un followUp éphémère sans toucher au profil
                    if (i.customId.startsWith('profile_inventory')) {
                        await i.deferUpdate();
                    } else {
                        // Afficher message de chargement (V2)
                        const loadingText = new TextDisplayBuilder().setContent('⏳ Veuillez patienter, génération en cours...');
                        const loadingContainer = new ContainerBuilder().addTextDisplayComponents(loadingText);
                        await i.update({
                            files: [],
                            components: [loadingContainer],
                            flags: MessageFlags.IsComponentsV2
                        });
                    }

                    // ============================================
                    // BOUTON: Quêtes (pending quests)
                    // ============================================
                    if (i.customId.startsWith('profile_quests')) {
                        // Extract page from customId (format: profile_quests_userId_page)
                        const parts = i.customId.split('_');
                        const page = parts.length > 3 ? parseInt(parts[3]) : 0;
                        const QUESTS_PER_PAGE = 5;

                        // Synchronisation des quêtes (comme dans acces-quetes.js)
                        // On le fait seulement à la première ouverture (page 0) ou à chaque fois ?
                        // Pour être sûr, on le fait à chaque fois qu'on clique sur le bouton principal, 
                        // mais peut-être pas nécessaire pour la pagination.
                        // Faisons-le si on vient du menu principal (parts.length <= 3)
                        if (parts.length <= 3) {
                            const userForSync = getOrCreateUser(targetUser.id, targetUser.username);
                            await checkQuestProgress(interaction.client, 'LEVEL_REACH', userForSync, { newLevel: userForSync.level });
                            await checkQuestProgress(interaction.client, 'BALANCE_REACH', userForSync, { newBalance: userForSync.stars });
                        }

                        const userQuestsData = getAllUserQuests(targetUser.id);
                        const pendingQuests = [];

                        for (const questId in QUESTS) {
                            const questInfo = QUESTS[questId];
                            if (questInfo.rarity === 'Halloween' || questInfo.rarity === 'Noël') continue;

                            const userProgress = userQuestsData.find(q => q.quest_id === questId);
                            if (!userProgress || !userProgress.completed) {
                                const isNumericGoal = typeof questInfo.goal === 'number';
                                pendingQuests.push({
                                    name: questInfo.name || 'Quête inconnue',
                                    description: questInfo.description || 'Description non disponible',
                                    progress: userProgress?.progress || 0,
                                    goal: questInfo.goal,
                                    rarity: questInfo.rarity || 'Commune',
                                    isNumeric: isNumericGoal
                                });
                            }
                        }

                        // Pagination logic
                        const totalPages = Math.ceil(pendingQuests.length / QUESTS_PER_PAGE) || 1;
                        const safePage = Math.max(0, Math.min(page, totalPages - 1));
                        const start = safePage * QUESTS_PER_PAGE;
                        const end = start + QUESTS_PER_PAGE;
                        const slicedQuests = pendingQuests.slice(start, end);

                        const png = await renderQuestsCard({ quests: slicedQuests });
                        const file = new AttachmentBuilder(png, { name: 'quests.png' });

                        const mediaGallery = new MediaGalleryBuilder()
                            .addItems({ media: { url: 'attachment://quests.png' } });

                        // Use pagination buttons if needed, or just standard back button if only 1 page
                        let components;
                        if (totalPages > 1) {
                            components = [
                                new ContainerBuilder()
                                    .addMediaGalleryComponents(mediaGallery)
                                    .addActionRowComponents(buildPaginationButtons(i.customId, safePage, totalPages, 'profile_quests'))
                            ];
                        } else {
                            components = [
                                new ContainerBuilder()
                                    .addMediaGalleryComponents(mediaGallery)
                                    .addActionRowComponents(buildButtons(true))
                            ];
                        }

                        await i.editReply({
                            content: null,
                            files: [file],
                            components: components,
                            flags: MessageFlags.IsComponentsV2
                        });
                    }

                    // ============================================
                    // BOUTON: Succès (completed achievements)
                    // ============================================
                    else if (i.customId.startsWith('profile_achievements')) {
                        // Extract page from customId (format: profile_achievements_userId_page)
                        const parts = i.customId.split('_');
                        const page = parts.length > 3 ? parseInt(parts[3]) : 0;
                        const ACHIEVEMENTS_PER_PAGE = 8; // Matches canvas limit

                        const userQuestsData = getAllUserQuests(targetUser.id);
                        const completedAchievements = [];

                        for (const questId in QUESTS) {
                            const questInfo = QUESTS[questId];
                            if (questInfo.rarity === 'Halloween' || questInfo.rarity === 'Noël') continue;

                            const userProgress = userQuestsData.find(q => q.quest_id === questId);
                            if (userProgress && userProgress.completed) {
                                completedAchievements.push({
                                    name: questInfo.name || 'Succès inconnu',
                                    description: questInfo.description || 'Succès débloqué',
                                    rarity: questInfo.rarity || 'Commune'
                                });
                            }
                        }

                        // Pagination logic
                        const totalPages = Math.ceil(completedAchievements.length / ACHIEVEMENTS_PER_PAGE) || 1;
                        const safePage = Math.max(0, Math.min(page, totalPages - 1));
                        const start = safePage * ACHIEVEMENTS_PER_PAGE;
                        const end = start + ACHIEVEMENTS_PER_PAGE;
                        const slicedAchievements = completedAchievements.slice(start, end);

                        const png = await renderAchievementsCard({ achievements: slicedAchievements });
                        const file = new AttachmentBuilder(png, { name: 'achievements.png' });

                        const mediaGallery = new MediaGalleryBuilder()
                            .addItems({ media: { url: 'attachment://achievements.png' } });

                        // Use pagination buttons if needed, or just standard back button if only 1 page
                        let components;
                        if (totalPages > 1) {
                            components = [
                                new ContainerBuilder()
                                    .addMediaGalleryComponents(mediaGallery)
                                    .addActionRowComponents(buildPaginationButtons(i.customId, safePage, totalPages, 'profile_achievements'))
                            ];
                        } else {
                            components = [
                                new ContainerBuilder()
                                    .addMediaGalleryComponents(mediaGallery)
                                    .addActionRowComponents(buildButtons(true))
                            ];
                        }

                        await i.editReply({
                            content: null,
                            files: [file],
                            components: components,
                            flags: MessageFlags.IsComponentsV2
                        });
                    }

                    // ============================================
                    // BOUTON: Guilde (guild profile)
                    // ============================================
                    else if (i.customId.startsWith('profile_guild')) {
                        // Re-fetch guild data to ensure it's current
                        const currentGuild = getGuildOfUser(targetUser.id);

                        if (!currentGuild) {
                            await i.editReply({ content: 'Cet utilisateur n\'est pas dans une guilde.', files: [], components: [] });
                            return;
                        }

                        const members = getGuildMembersWithDetails(currentGuild.id);
                        const owner = await interaction.client.users.fetch(currentGuild.owner_id).catch(() => null);
                        const totalMembers = members.length;

                        // Info guerre
                        const war = getOngoingWar(currentGuild.id);
                        let warInfo = null;
                        if (war) {
                            const opponentId = war.guild1_id === currentGuild.id ? war.guild2_id : war.guild1_id;
                            const opponent = getGuildById(opponentId);
                            warInfo = {
                                status: 'ongoing',
                                opponent: opponent ? opponent.name : 'Inconnu',
                                timeRemaining: war.end_time - Date.now()
                            };
                        }

                        const png = await renderGuildProfileV2({
                            guild: currentGuild,
                            members: members.slice(0, 10),
                            owner: owner || { username: 'Inconnu' },
                            warInfo: warInfo,
                            totalMembers: totalMembers
                        });
                        const file = new AttachmentBuilder(png, { name: 'guild_profile.png' });

                        const mediaGallery = new MediaGalleryBuilder()
                            .addItems({ media: { url: 'attachment://guild_profile.png' } });

                        const container = new ContainerBuilder()
                            .addMediaGalleryComponents(mediaGallery)
                            .addActionRowComponents(buildButtons(true));

                        await i.editReply({
                            content: null,
                            files: [file],
                            components: [container],
                            flags: MessageFlags.IsComponentsV2
                        });
                    }

                    // ============================================
                    // BOUTON: Inventaire — affiche le /inventaire complet en éphémère
                    // ============================================
                    else if (i.customId.startsWith('profile_inventory')) {
                        const inventory = getUserInventory(targetUser.id);
                        const ITEMS_PER_PAGE = 8;

                        const visibleInventory = inventory.filter(inv => {
                            const item = getItem(inv.item_id);
                            return item && !PASSIVE_ITEMS.includes(item.id);
                        });

                        if (visibleInventory.length === 0) {
                            const emptyText = new TextDisplayBuilder()
                                .setContent('# 🎒 Inventaire\nVotre inventaire est vide.');
                            const emptyContainer = new ContainerBuilder().addTextDisplayComponents(emptyText);
                            await i.followUp({ components: [emptyContainer], flags: MessageFlags.IsComponentsV2, ephemeral: true });
                            return;
                        }

                        let currentInvPage = 0;

                        const generateInventoryPayload = (page) => {
                            const freshInventory = getUserInventory(targetUser.id).filter(inv => {
                                const item = getItem(inv.item_id);
                                return item && !PASSIVE_ITEMS.includes(item.id);
                            });
                            const totalPages = Math.ceil(freshInventory.length / ITEMS_PER_PAGE);
                            if (page >= totalPages) page = Math.max(0, totalPages - 1);

                            if (freshInventory.length === 0) {
                                const emptyText = new TextDisplayBuilder().setContent('# 🎒 Inventaire\nVotre inventaire est vide.');
                                return { components: [new ContainerBuilder().addTextDisplayComponents(emptyText)], flags: MessageFlags.IsComponentsV2, ephemeral: true };
                            }

                            const container = new ContainerBuilder();

                            const headerText = new TextDisplayBuilder()
                                .setContent(`# 🎒 Inventaire de ${targetUser.username}\n*Page ${page + 1}/${totalPages}*`);
                            container.addTextDisplayComponents(headerText);

                            const startIdx = page * ITEMS_PER_PAGE;
                            const pageItems = freshInventory.slice(startIdx, startIdx + ITEMS_PER_PAGE);

                            pageItems.forEach(invItem => {
                                const item = getItem(invItem.item_id);
                                if (!item) return;

                                const description = `**Quantité:** ${invItem.quantity}\n*${item.description || 'Aucune description'}*`;
                                const itemText = new TextDisplayBuilder()
                                    .setContent(`### ${item.emoji || ''} ${item.name}\n${description}`);
                                const itemSection = new SectionBuilder()
                                    .addTextDisplayComponents(itemText);

                                const useButton = new ButtonBuilder()
                                    .setCustomId(`profinv_use_${item.id}`)
                                    .setLabel('Utiliser')
                                    .setStyle(ButtonStyle.Success);
                                itemSection.setButtonAccessory(useButton);
                                container.addSectionComponents(itemSection);
                            });

                            const navRow = new ActionRowBuilder();
                            navRow.addComponents(
                                new ButtonBuilder()
                                    .setCustomId('profinv_prev')
                                    .setLabel('◀️')
                                    .setStyle(ButtonStyle.Secondary)
                                    .setDisabled(page === 0),
                                new ButtonBuilder()
                                    .setCustomId('profinv_next')
                                    .setLabel('▶️')
                                    .setStyle(ButtonStyle.Secondary)
                                    .setDisabled(page >= totalPages - 1)
                            );

                            return { components: [container, navRow], flags: MessageFlags.IsComponentsV2, ephemeral: true };
                        };

                        const invResponse = await i.followUp(generateInventoryPayload(currentInvPage));

                        const invCollector = invResponse.createMessageComponentCollector({
                            componentType: ComponentType.Button,
                            time: 5 * 60 * 1000,
                        });

                        invCollector.on('collect', async (invI) => {
                            if (invI.user.id !== interaction.user.id) {
                                const errorText = new TextDisplayBuilder().setContent("Ceci n'est pas votre inventaire.");
                                const errorContainer = new ContainerBuilder().addTextDisplayComponents(errorText);
                                return invI.reply({ 
                                    components: [errorContainer], 
                                    flags: MessageFlags.IsComponentsV2, 
                                    ephemeral: true 
                                });
                            }

                            if (invI.customId === 'profinv_prev') {
                                currentInvPage = Math.max(0, currentInvPage - 1);
                                await invI.update(generateInventoryPayload(currentInvPage));
                            } else if (invI.customId === 'profinv_next') {
                                const freshInv = getUserInventory(targetUser.id).filter(inv => {
                                    const item = getItem(inv.item_id);
                                    return item && !PASSIVE_ITEMS.includes(item.id);
                                });
                                currentInvPage = Math.min(Math.ceil(freshInv.length / ITEMS_PER_PAGE) - 1, currentInvPage + 1);
                                await invI.update(generateInventoryPayload(currentInvPage));
                            } else if (invI.customId.startsWith('profinv_use_')) {
                                const itemId = invI.customId.replace('profinv_use_', '');
                                const item = getItem(itemId);
                                if (!item) return invI.reply({ content: 'Item inconnu.', ephemeral: true });

                                try {
                                    const { useItem } = require('../../utils/item-effects');
                                    await invI.deferReply({ ephemeral: true });
                                    await useItem(invI, itemId);
                                } catch (error) {
                                    logger.error('Erreur utilisation item depuis profil:', error);
                                    if (!invI.replied && !invI.deferred) {
                                        await invI.reply({ content: 'Une erreur est survenue.', ephemeral: true });
                                    }
                                }
                            }
                        });
                    }

                    // ============================================
                    // BOUTON: Retour (Back to Profile)
                    // ============================================
                    else if (i.customId.startsWith('profile_back')) {
                        const file = await renderMainProfile();

                        const mediaGallery = new MediaGalleryBuilder()
                            .addItems({ media: { url: 'attachment://profile.png' } });

                        const container = new ContainerBuilder()
                            .addMediaGalleryComponents(mediaGallery)
                            .addActionRowComponents(buildButtons(false));

                        await i.editReply({
                            content: null,
                            files: [file],
                            components: [container],
                            flags: MessageFlags.IsComponentsV2
                        });
                    }

                } catch (error) {
                    logger.error('Erreur lors de la gestion des boutons du profil:', error);
                    await handleCommandError(i, error, interaction.client);
                    throw error; // Re-throw pour propagation
                }
            });

            collector.on('end', () => {
                // Disable buttons after timeout
                interaction.editReply({ components: [] }).catch(() => { });
            });

        } catch (error) {
            await handleCommandError(interaction, error, interaction.client);
        }
    },
};