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
const { getAllUserQuests } = require('./db-quests');
const { QUESTS, checkQuestProgress } = require('./quests');
const { renderGuildProfileV2 } = require('./canvas-guild-profile-v2');
const { getOngoingWar } = require('./guild/guild-wars');
const { handleCommandError } = require('./error-handler');
const { getItem, PASSIVE_ITEMS } = require('./items');
const logger = require('./logger');
const { renderQuestsCardFiche2, renderAchievementsCardFiche2 } = require('./canvas-fiche2-quests-trophies');

const Q_PREFIX = 'pv2_q';
const A_PREFIX = 'pv2_a';
const BACK = 'pv2_back';
const INV = 'pv2_inv';
const GUILD = 'pv2_guild';

/**
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 * @param {Awaited<ReturnType<import('./profil-v2-data')['loadFiche2ProfileData']>>} session
 * @param {{ headerText?: string }} [opts]
 */
async function sendProfilV2WithButtons(interaction, session, opts = {}) {
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
    const container = new ContainerBuilder();
    if (opts.headerText) {
        container.addTextDisplayComponents(new TextDisplayBuilder().setContent(opts.headerText));
    }
    container.addMediaGalleryComponents(mediaGallery).addActionRowComponents(buildButtons(false));

    const message = await interaction.editReply({
        content: null,
        files: [file],
        components: [container],
        flags: MessageFlags.IsComponentsV2,
    });

    const collector = message.createMessageComponentCollector({
        componentType: ComponentType.Button,
        time: 10 * 60 * 1000,
    });

    collector.on('collect', async (i) => {
        try {
            if (i.user.id !== interaction.user.id) {
                const errorText = new TextDisplayBuilder().setContent(
                    "Seul l'auteur de la commande peut utiliser ces boutons. Utilise `/profil-v2` pour voir le tien."
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
                const cont = new ContainerBuilder();
                if (opts.headerText) {
                    cont.addTextDisplayComponents(new TextDisplayBuilder().setContent(opts.headerText));
                }
                cont.addMediaGalleryComponents(mg).addActionRowComponents(buildButtons(false));
                await i.editReply({ content: null, files: [mainFile], components: [cont], flags: MessageFlags.IsComponentsV2 });
            }
        } catch (err) {
            logger.error('profil-v2 boutons:', err);
            await handleCommandError(i, err, interaction.client);
        }
    });

    collector.on('end', () => {
        interaction.editReply({ components: [] }).catch(() => {});
    });

    return message;
}

module.exports = { sendProfilV2WithButtons };
