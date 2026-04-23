const path = require('node:path');
const fs = require('node:fs');
const {
    AttachmentBuilder,
    ButtonBuilder,
    ButtonStyle,
    ActionRowBuilder,
    ComponentType,
    ContainerBuilder,
    MediaGalleryBuilder,
    MessageFlags,
    TextDisplayBuilder,
    SectionBuilder,
} = require('discord.js');
const { getOrCreateUser, getUserInventory } = require('./db-users');
const { getGuildOfUser, getGuildById, getGuildMembersWithDetails } = require('./db-guilds');
const { getDisplayRank, RANKS } = require('./ranks');
const { getAllUserQuests } = require('./db-quests');
const { QUESTS, checkQuestProgress, syncUserBadges } = require('./quests');
const { renderProfilePreviewVariant } = require('./canvas-profile-variants');
const { renderGuildProfileV2 } = require('./canvas-guild-profile-v2');
const { getOngoingWar } = require('./guild/guild-wars');
const { getPreviewStaffTitleForUser } = require('./preview-invoker-staff-title');
const { handleCommandError } = require('./error-handler');
const { getItem, PASSIVE_ITEMS } = require('./items');
const logger = require('./logger');
const { renderQuestsCardFiche2, renderAchievementsCardFiche2 } = require('./canvas-fiche2-quests-trophies');

/**
 * Charge tout le contexte nécessaire à la fiche 2 + boutons (/profil).
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 */
async function loadFiche2ProfileData(interaction) {
    const targetUser = interaction.options.getUser('membre') || interaction.user;
    const member = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
    if (!member) {
        return { error: 'Membre introuvable sur ce serveur.' };
    }

    syncUserBadges(targetUser.id, member);

    const user = getOrCreateUser(targetUser.id, targetUser.username);
    const guild = getGuildOfUser(targetUser.id);
    user.guild_name = guild ? guild.name : 'Aucune Guilde';
    user.guild_level = guild ? guild.level : 1;
    user.guild_emoji = guild ? guild.emoji : '🛡️';
    user.guild_treasury = guild ? guild.treasury : 0;
    user.guild_treasury_capacity = guild ? guild.treasury_capacity : 0;
    user.guild_upgrade_level = guild ? guild.upgrade_level : 1;
    user.guild_total_treasury_generated = guild ? guild.total_treasury_generated : 0;
    user.guild_wars_won = guild ? guild.wars_won : 0;

    if (guild) {
        const guildMembers = getGuildMembersWithDetails(guild.id);
        user.guild_members = guildMembers.length;
        user.guild_member_slots = guild.member_slots;
        const { calculateDailyIncome } = require('./guild/guild-treasury');
        user.guild_treasury_income = calculateDailyIncome(guild);
    } else {
        user.guild_members = 0;
        user.guild_member_slots = 5;
        user.guild_treasury_income = 0;
    }

    let guildState = 'En Paix';
    if (guild) {
        const war = getOngoingWar(guild.id);
        if (war) guildState = 'En Guerre';
    }
    user.guild_state = guildState;

    const rank = getDisplayRank(targetUser.id, user.points);
    const rankIndex = RANKS.findIndex((r) => r.name === rank.name);
    const nextRank = rankIndex < RANKS.length - 1 ? RANKS[rankIndex + 1] : null;

    const { getTotalDebt, getClosestDebtDeadline } = require('./loan-system');
    const totalDebt = getTotalDebt(targetUser.id);
    const debtTimeRemaining = getClosestDebtDeadline(targetUser.id);

    const today = new Date().setHours(0, 0, 0, 0);
    let dailyVoiceXP = user.daily_voice_xp || 0;
    let dailyVoicePoints = user.daily_voice_points || 0;
    if ((user.daily_voice_last_reset || 0) < today) {
        dailyVoiceXP = 0;
        dailyVoicePoints = 0;
    }
    let vocalNerfStatus = null;
    if (dailyVoiceXP >= 15000 || dailyVoicePoints >= 7000) {
        vocalNerfStatus = '⛔ Limite vocale journalière (0 gains).';
    } else if (dailyVoiceXP >= 10000 || dailyVoicePoints >= 5000) {
        vocalNerfStatus = '⚠️ Gains vocaux /5.';
    }

    let highestRoleName = 'Membre';
    if (member.roles.highest && member.roles.highest.name !== '@everyone') {
        highestRoleName = member.roles.highest.name;
    }

    let rankIconPath = path.resolve(__dirname, '..', 'assets', 'rank-icons', `${rankIndex + 1}.png`);
    if (!fs.existsSync(rankIconPath)) {
        rankIconPath = path.resolve(__dirname, '..', 'assets', 'rank-icons', '1.png');
    }

    const { PROFILE_PREVIEW_VARIANTS } = require('./canvas-profile-variants');
    const meta = PROFILE_PREVIEW_VARIANTS.find((v) => v.id === 'fiche_2');

    const previewHasGuild = Boolean(guild);

    const renderMainPngBuffer = async () => {
        const u = getOrCreateUser(targetUser.id, targetUser.username);
        const g = getGuildOfUser(targetUser.id);
        u.guild_name = g ? g.name : 'Aucune Guilde';
        u.guild_level = g ? g.level : 1;
        u.guild_emoji = g ? g.emoji : '🛡️';
        u.guild_treasury = g ? g.treasury : 0;
        u.guild_treasury_capacity = g ? g.treasury_capacity : 0;
        u.guild_upgrade_level = g ? g.upgrade_level : 1;
        u.guild_total_treasury_generated = g ? g.total_treasury_generated : 0;
        u.guild_wars_won = g ? g.wars_won : 0;
        if (g) {
            const guildMembers = getGuildMembersWithDetails(g.id);
            u.guild_members = guildMembers.length;
            u.guild_member_slots = g.member_slots;
            const { calculateDailyIncome } = require('./guild/guild-treasury');
            u.guild_treasury_income = calculateDailyIncome(g);
        } else {
            u.guild_members = 0;
            u.guild_member_slots = 5;
            u.guild_treasury_income = 0;
        }
        let gs = 'En Paix';
        if (g) {
            const war = getOngoingWar(g.id);
            if (war) gs = 'En Guerre';
        }
        u.guild_state = gs;

        const todayR = new Date().setHours(0, 0, 0, 0);
        let dvx = u.daily_voice_xp || 0;
        let dvp = u.daily_voice_points || 0;
        if ((u.daily_voice_last_reset || 0) < todayR) {
            dvx = 0;
            dvp = 0;
        }
        let vns = null;
        if (dvx >= 15000 || dvp >= 7000) vns = '⛔ Limite vocale journalière (0 gains).';
        else if (dvx >= 10000 || dvp >= 5000) vns = '⚠️ Gains vocaux /5.';

        const invokerStaffTitle = await getPreviewInvokerStaffTitle(interaction.client, interaction.user.id);
        const r = getDisplayRank(targetUser.id, u.points);
        const ri = RANKS.findIndex((x) => x.name === r.name);
        const nr = ri < RANKS.length - 1 ? RANKS[ri + 1] : null;
        let rip = path.resolve(__dirname, '..', 'assets', 'rank-icons', `${ri + 1}.png`);
        if (!fs.existsSync(rip)) rip = path.resolve(__dirname, '..', 'assets', 'rank-icons', '1.png');

        return renderProfilePreviewVariant(
            {
                user: u,
                member,
                rank: r,
                nextRank: nr,
                highestRoleName,
                rankIconPath: rip,
                totalDebt: getTotalDebt(targetUser.id),
                debtTimeRemaining: getClosestDebtDeadline(targetUser.id),
                vocalNerfStatus: vns,
                userId: targetUser.id,
                invokerStaffTitle,
                invokerMember: interaction.member,
                invokerUser: interaction.user,
                previewHasGuild: Boolean(g),
            },
            'fiche_2'
        );
    };

    return {
        targetUser,
        member,
        user,
        guild,
        rank,
        nextRank,
        rankIconPath,
        totalDebt,
        debtTimeRemaining,
        vocalNerfStatus,
        highestRoleName,
        previewHasGuild,
        meta,
        renderMainPngBuffer,
    };
}

const Q_PREFIX = 'pv2_q';
const A_PREFIX = 'pv2_a';
const BACK = 'pv2_back';
const INV = 'pv2_inv';
const GUILD = 'pv2_guild';

/**
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 * @param {Awaited<ReturnType<typeof loadFiche2ProfileData>>} session
 */
async function sendProfilV2WithButtons(interaction, session) {
    const { targetUser, member, guild, renderMainPngBuffer } = session;

    const buildMainFile = async () => {
        const buf = await renderMainPngBuffer();
        return new AttachmentBuilder(buf, { name: 'profil-v2-main.png' });
    };

    const isOwnProfile = targetUser.id === interaction.user.id;

    const buildButtons = (isSubView = false) => {
        const buttons = [];
        if (isSubView) {
            buttons.push(
                new ButtonBuilder().setCustomId(`${BACK}_${targetUser.id}`).setLabel('⬅️ Retour').setStyle(ButtonStyle.Secondary)
            );
        }
        if (isOwnProfile) {
            buttons.push(
                new ButtonBuilder().setCustomId(`${Q_PREFIX}_${targetUser.id}`).setLabel('🎯 Quêtes').setStyle(ButtonStyle.Primary)
            );
        }
        buttons.push(
            new ButtonBuilder().setCustomId(`${A_PREFIX}_${targetUser.id}`).setLabel('🏆 Trophées').setStyle(ButtonStyle.Success)
        );
        if (isOwnProfile) {
            buttons.push(
                new ButtonBuilder().setCustomId(`${INV}_${targetUser.id}`).setLabel('📦 Inventaire').setStyle(ButtonStyle.Primary)
            );
        }
        if (guild) {
            buttons.push(
                new ButtonBuilder().setCustomId(`${GUILD}_${guild.id}`).setLabel('🛡️ Guilde').setStyle(ButtonStyle.Secondary)
            );
        }
        return new ActionRowBuilder().addComponents(buttons);
    };

    const buildPaginationButtons = (page, totalPages, kind) => {
        const base = kind === 'q' ? Q_PREFIX : A_PREFIX;
        const buttons = [
            new ButtonBuilder()
                .setCustomId(`${base}_${targetUser.id}_${Math.max(0, page - 1)}`)
                .setLabel('⬅️')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(page === 0),
            new ButtonBuilder()
                .setCustomId(`${BACK}_${targetUser.id}`)
                .setLabel('🏠 Retour')
                .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId(`${base}_${targetUser.id}_${Math.min(totalPages - 1, page + 1)}`)
                .setLabel('➡️')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(page >= totalPages - 1),
        ];
        return new ActionRowBuilder().addComponents(buttons);
    };

    const file = await buildMainFile();
    const mediaGallery = new MediaGalleryBuilder().addItems({ media: { url: 'attachment://profil-v2-main.png' } });
    const container = new ContainerBuilder().addMediaGalleryComponents(mediaGallery).addActionRowComponents(buildButtons(false));

    const message = await interaction.editReply({
        content: null,
        files: [file],
        components: [container],
        flags: MessageFlags.IsComponentsV2,
    });

    // Garde une référence du dernier rendu pour pouvoir le réafficher sans boutons quand le collector expire.
    const currentRender = {
        attachmentName: 'profil-v2-main.png',
        buildBuffer: renderMainPngBuffer,
    };

    // Collector long (24h) — on évite un timeout court qui modifierait le message et ferait disparaître le canvas.
    // Les boutons restent cliquables tant que le bot tourne ; si le bot redémarre, le message garde son canvas visible.
    const collector = message.createMessageComponentCollector({
        componentType: ComponentType.Button,
        time: 24 * 60 * 60 * 1000,
    });

    collector.on('collect', async (i) => {
        try {
            if (i.user.id !== interaction.user.id) {
                const errorText = new TextDisplayBuilder().setContent(
                    "Seul l'auteur de la commande peut utiliser ces boutons. Utilise `/profil` pour voir le tien."
                );
                const errorContainer = new ContainerBuilder().addTextDisplayComponents(errorText);
                return i.reply({ components: [errorContainer], flags: MessageFlags.IsComponentsV2, ephemeral: true });
            }

            if (i.customId.startsWith(`${INV}_`)) {
                await i.deferUpdate();
            } else {
                const loadingText = new TextDisplayBuilder().setContent('⏳ Génération…');
                const loadingContainer = new ContainerBuilder().addTextDisplayComponents(loadingText);
                await i.update({ files: [], components: [loadingContainer], flags: MessageFlags.IsComponentsV2 });
            }

            /* Quêtes */
            if (i.customId.startsWith(`${Q_PREFIX}_`)) {
                const qBase = `${Q_PREFIX}_${targetUser.id}`;
                let page = 0;
                if (i.customId === qBase) page = 0;
                else if (i.customId.startsWith(`${qBase}_`)) {
                    page = parseInt(i.customId.slice(qBase.length + 1), 10) || 0;
                }
                const QUESTS_PER_PAGE = 5;

                if (i.customId === qBase) {
                    const uSync = getOrCreateUser(targetUser.id, targetUser.username);
                    await checkQuestProgress(interaction.client, 'LEVEL_REACH', uSync, { newLevel: uSync.level });
                    await checkQuestProgress(interaction.client, 'BALANCE_REACH', uSync, { newBalance: uSync.stars });
                }

                const userQuestsData = getAllUserQuests(targetUser.id);
                const pendingQuests = [];
                for (const questId in QUESTS) {
                    const questInfo = QUESTS[questId];
                    if (questInfo.rarity === 'Halloween' || questInfo.rarity === 'Noël') continue;
                    const userProgress = userQuestsData.find((q) => q.quest_id === questId);
                    if (!userProgress || !userProgress.completed) {
                        const isNumericGoal = typeof questInfo.goal === 'number';
                        pendingQuests.push({
                            name: questInfo.name || 'Quête',
                            description: questInfo.description || '',
                            progress: userProgress?.progress || 0,
                            goal: questInfo.goal,
                            rarity: questInfo.rarity || 'Commune',
                            isNumeric: isNumericGoal,
                        });
                    }
                }
                const totalPages = Math.ceil(pendingQuests.length / QUESTS_PER_PAGE) || 1;
                const p = Math.max(0, Math.min(page, totalPages - 1));
                const sliced = pendingQuests.slice(p * QUESTS_PER_PAGE, (p + 1) * QUESTS_PER_PAGE);

                const png = await renderQuestsCardFiche2({ quests: sliced });
                const qFile = new AttachmentBuilder(png, { name: 'profil-v2-quests.png' });
                const mg = new MediaGalleryBuilder().addItems({ media: { url: 'attachment://profil-v2-quests.png' } });
                const comps =
                    totalPages > 1
                        ? [new ContainerBuilder().addMediaGalleryComponents(mg).addActionRowComponents(buildPaginationButtons(p, totalPages, 'q'))]
                        : [new ContainerBuilder().addMediaGalleryComponents(mg).addActionRowComponents(buildButtons(true))];

                currentRender.attachmentName = 'profil-v2-quests.png';
                currentRender.buildBuffer = async () => {
                    const freshQuestsData = getAllUserQuests(targetUser.id);
                    const freshPending = [];
                    for (const qId in QUESTS) {
                        const qInfo = QUESTS[qId];
                        if (qInfo.rarity === 'Halloween' || qInfo.rarity === 'Noël') continue;
                        const up = freshQuestsData.find((q) => q.quest_id === qId);
                        if (!up || !up.completed) {
                            freshPending.push({
                                name: qInfo.name || 'Quête',
                                description: qInfo.description || '',
                                progress: up?.progress || 0,
                                goal: qInfo.goal,
                                rarity: qInfo.rarity || 'Commune',
                                isNumeric: typeof qInfo.goal === 'number',
                            });
                        }
                    }
                    const freshTotal = Math.ceil(freshPending.length / QUESTS_PER_PAGE) || 1;
                    const pp = Math.max(0, Math.min(p, freshTotal - 1));
                    return renderQuestsCardFiche2({ quests: freshPending.slice(pp * QUESTS_PER_PAGE, (pp + 1) * QUESTS_PER_PAGE) });
                };

                await i.editReply({ content: null, files: [qFile], components: comps, flags: MessageFlags.IsComponentsV2 });
            } else if (i.customId.startsWith(`${A_PREFIX}_`)) {
                const aBase = `${A_PREFIX}_${targetUser.id}`;
                let page = 0;
                if (i.customId === aBase) page = 0;
                else if (i.customId.startsWith(`${aBase}_`)) {
                    page = parseInt(i.customId.slice(aBase.length + 1), 10) || 0;
                }
                const ACH = 8;

                const userQuestsData = getAllUserQuests(targetUser.id);
                const completed = [];
                for (const questId in QUESTS) {
                    const questInfo = QUESTS[questId];
                    if (questInfo.rarity === 'Halloween' || questInfo.rarity === 'Noël') continue;
                    const userProgress = userQuestsData.find((q) => q.quest_id === questId);
                    if (userProgress && userProgress.completed) {
                        completed.push({
                            name: questInfo.name || 'Trophée',
                            description: questInfo.description || '',
                            rarity: questInfo.rarity || 'Commune',
                        });
                    }
                }
                const totalPages = Math.ceil(completed.length / ACH) || 1;
                const p = Math.max(0, Math.min(page, totalPages - 1));
                const sliced = completed.slice(p * ACH, (p + 1) * ACH);

                const png = await renderAchievementsCardFiche2({ achievements: sliced });
                const aFile = new AttachmentBuilder(png, { name: 'profil-v2-trophies.png' });
                const mg = new MediaGalleryBuilder().addItems({ media: { url: 'attachment://profil-v2-trophies.png' } });
                const comps =
                    totalPages > 1
                        ? [new ContainerBuilder().addMediaGalleryComponents(mg).addActionRowComponents(buildPaginationButtons(p, totalPages, 'a'))]
                        : [new ContainerBuilder().addMediaGalleryComponents(mg).addActionRowComponents(buildButtons(true))];

                currentRender.attachmentName = 'profil-v2-trophies.png';
                currentRender.buildBuffer = async () => {
                    const freshQuestsData = getAllUserQuests(targetUser.id);
                    const freshCompleted = [];
                    for (const qId in QUESTS) {
                        const qInfo = QUESTS[qId];
                        if (qInfo.rarity === 'Halloween' || qInfo.rarity === 'Noël') continue;
                        const up = freshQuestsData.find((q) => q.quest_id === qId);
                        if (up && up.completed) {
                            freshCompleted.push({
                                name: qInfo.name || 'Trophée',
                                description: qInfo.description || '',
                                rarity: qInfo.rarity || 'Commune',
                            });
                        }
                    }
                    const freshTotal = Math.ceil(freshCompleted.length / ACH) || 1;
                    const pp = Math.max(0, Math.min(p, freshTotal - 1));
                    return renderAchievementsCardFiche2({ achievements: freshCompleted.slice(pp * ACH, (pp + 1) * ACH) });
                };

                await i.editReply({ content: null, files: [aFile], components: comps, flags: MessageFlags.IsComponentsV2 });
            } else if (i.customId.startsWith(`${GUILD}_`)) {
                const currentGuild = getGuildOfUser(targetUser.id);
                if (!currentGuild) {
                    await i.editReply({ content: "Cet utilisateur n'est pas dans une guilde.", files: [], components: [] });
                    return;
                }
                const members = getGuildMembersWithDetails(currentGuild.id);
                const owner = await i.client.users.fetch(currentGuild.owner_id).catch(() => null);
                const war = getOngoingWar(currentGuild.id);
                let warInfo = null;
                if (war) {
                    const opponentId = war.guild1_id === currentGuild.id ? war.guild2_id : war.guild1_id;
                    const opponent = getGuildById(opponentId);
                    warInfo = { status: 'ongoing', opponent: opponent ? opponent.name : 'Inconnu', timeRemaining: war.end_time - Date.now() };
                }
                const png = await renderGuildProfileV2({
                    guild: currentGuild,
                    members: members.slice(0, 10),
                    owner: owner || { username: 'Inconnu' },
                    warInfo,
                    totalMembers: members.length,
                });
                const gFile = new AttachmentBuilder(png, { name: 'profil-v2-guild.png' });
                const mg = new MediaGalleryBuilder().addItems({ media: { url: 'attachment://profil-v2-guild.png' } });
                const cont = new ContainerBuilder().addMediaGalleryComponents(mg).addActionRowComponents(buildButtons(true));

                currentRender.attachmentName = 'profil-v2-guild.png';
                currentRender.buildBuffer = async () => {
                    const freshGuild = getGuildOfUser(targetUser.id);
                    if (!freshGuild) return png;
                    const freshMembers = getGuildMembersWithDetails(freshGuild.id);
                    const freshOwner = await i.client.users.fetch(freshGuild.owner_id).catch(() => null);
                    const freshWar = getOngoingWar(freshGuild.id);
                    let freshWarInfo = null;
                    if (freshWar) {
                        const oppId = freshWar.guild1_id === freshGuild.id ? freshWar.guild2_id : freshWar.guild1_id;
                        const opp = getGuildById(oppId);
                        freshWarInfo = { status: 'ongoing', opponent: opp ? opp.name : 'Inconnu', timeRemaining: freshWar.end_time - Date.now() };
                    }
                    return renderGuildProfileV2({
                        guild: freshGuild,
                        members: freshMembers.slice(0, 10),
                        owner: freshOwner || { username: 'Inconnu' },
                        warInfo: freshWarInfo,
                        totalMembers: freshMembers.length,
                    });
                };

                await i.editReply({ content: null, files: [gFile], components: [cont], flags: MessageFlags.IsComponentsV2 });
            } else if (i.customId.startsWith(`${INV}_`)) {
                const inventory = getUserInventory(targetUser.id);
                const ITEMS_PER_PAGE = 8;
                const visibleInventory = inventory.filter((inv) => {
                    const item = getItem(inv.item_id);
                    return item && !PASSIVE_ITEMS.includes(item.id);
                });
                if (visibleInventory.length === 0) {
                    const emptyText = new TextDisplayBuilder().setContent('# 🎒 Inventaire\nVotre inventaire est vide.');
                    const emptyContainer = new ContainerBuilder().addTextDisplayComponents(emptyText);
                    await i.followUp({ components: [emptyContainer], flags: MessageFlags.IsComponentsV2, ephemeral: true });
                    return;
                }
                let currentInvPage = 0;
                const generateInventoryPayload = (page) => {
                    const freshInventory = getUserInventory(targetUser.id).filter((inv) => {
                        const item = getItem(inv.item_id);
                        return item && !PASSIVE_ITEMS.includes(item.id);
                    });
                    const totalPages = Math.ceil(freshInventory.length / ITEMS_PER_PAGE) || 1;
                    if (page >= totalPages) page = Math.max(0, totalPages - 1);
                    const containerInv = new ContainerBuilder();
                    const headerText = new TextDisplayBuilder().setContent(
                        `# 🎒 Inventaire de ${targetUser.username}\n*Page ${page + 1}/${totalPages}*`
                    );
                    containerInv.addTextDisplayComponents(headerText);
                    const startIdx = page * ITEMS_PER_PAGE;
                    const pageItems = freshInventory.slice(startIdx, startIdx + ITEMS_PER_PAGE);
                    pageItems.forEach((invItem) => {
                        const item = getItem(invItem.item_id);
                        if (!item) return;
                        const description = `**Quantité:** ${invItem.quantity}\n*${item.description || 'Aucune description'}*`;
                        const itemText = new TextDisplayBuilder().setContent(`### ${item.emoji || ''} ${item.name}\n${description}`);
                        const itemSection = new SectionBuilder().addTextDisplayComponents(itemText);
                        const useButton = new ButtonBuilder()
                            .setCustomId(`pv2inv_use_${item.id}`)
                            .setLabel('Utiliser')
                            .setStyle(ButtonStyle.Success);
                        itemSection.setButtonAccessory(useButton);
                        containerInv.addSectionComponents(itemSection);
                    });
                    const navRow = new ActionRowBuilder();
                    navRow.addComponents(
                        new ButtonBuilder().setCustomId('pv2inv_prev').setLabel('◀️').setStyle(ButtonStyle.Secondary).setDisabled(page === 0),
                        new ButtonBuilder()
                            .setCustomId('pv2inv_next')
                            .setLabel('▶️')
                            .setStyle(ButtonStyle.Secondary)
                            .setDisabled(page >= totalPages - 1)
                    );
                    return { components: [containerInv, navRow], flags: MessageFlags.IsComponentsV2, ephemeral: true };
                };
                const invResponse = await i.followUp(generateInventoryPayload(currentInvPage));
                const invCollector = invResponse.createMessageComponentCollector({
                    componentType: ComponentType.Button,
                    time: 5 * 60 * 1000,
                });
                invCollector.on('collect', async (invI) => {
                    if (invI.user.id !== interaction.user.id) {
                        const t = new TextDisplayBuilder().setContent("Ceci n'est pas ton inventaire.");
                        return invI.reply({ components: [new ContainerBuilder().addTextDisplayComponents(t)], flags: MessageFlags.IsComponentsV2, ephemeral: true });
                    }
                    if (invI.customId === 'pv2inv_prev') {
                        currentInvPage = Math.max(0, currentInvPage - 1);
                        await invI.update(generateInventoryPayload(currentInvPage));
                    } else if (invI.customId === 'pv2inv_next') {
                        const freshInv = getUserInventory(targetUser.id).filter((inv) => {
                            const item = getItem(inv.item_id);
                            return item && !PASSIVE_ITEMS.includes(item.id);
                        });
                        currentInvPage = Math.min(Math.ceil(freshInv.length / ITEMS_PER_PAGE) - 1, currentInvPage + 1);
                        await invI.update(generateInventoryPayload(currentInvPage));
                    } else if (invI.customId.startsWith('pv2inv_use_')) {
                        const itemId = invI.customId.replace('pv2inv_use_', '');
                        const item = getItem(itemId);
                        if (!item) return invI.reply({ content: 'Objet inconnu.', ephemeral: true });
                        try {
                            const { useItem } = require('./item-effects');
                            await invI.deferReply({ ephemeral: true });
                            await useItem(invI, itemId);
                        } catch (err) {
                            logger.error('Erreur utilisation item (profil-v2):', err);
                            if (!invI.replied && !invI.deferred) await invI.reply({ content: 'Erreur.', ephemeral: true });
                        }
                    }
                });
            } else if (i.customId.startsWith(`${BACK}_`)) {
                const mainFile = await buildMainFile();
                const mg = new MediaGalleryBuilder().addItems({ media: { url: 'attachment://profil-v2-main.png' } });
                const cont = new ContainerBuilder().addMediaGalleryComponents(mg).addActionRowComponents(buildButtons(false));

                currentRender.attachmentName = 'profil-v2-main.png';
                currentRender.buildBuffer = renderMainPngBuffer;

                await i.editReply({ content: null, files: [mainFile], components: [cont], flags: MessageFlags.IsComponentsV2 });
            }
        } catch (err) {
            logger.error('profil-v2 boutons:', err);
            await handleCommandError(i, err, interaction.client);
        }
    });

    collector.on('end', () => {
        // Volontairement vide : on ne modifie PAS le message pour que le canvas reste visible à vie.
        // (Les boutons deviennent inertes au bout de 24h ou quand le bot redémarre, mais l'image reste.)
    });

    return message;
}

module.exports = { loadFiche2ProfileData, sendProfilV2WithButtons };
