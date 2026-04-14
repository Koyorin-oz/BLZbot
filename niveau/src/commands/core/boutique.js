
const { SlashCommandBuilder, TextDisplayBuilder, SectionBuilder, ContainerBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder, ComponentType, MessageFlags, ModalBuilder, StringSelectMenuBuilder, LabelBuilder } = require('discord.js');
const { getOrCreateUser, grantResources, addItemToInventory } = require('../../utils/db-users');
const { getItem, getAllItems } = require('../../utils/items');
const { getDailyShopItems, canPurchaseItem, recordPurchase, checkLegendaryChestSpawn, removeLegendaryChest } = require('../../utils/shop-system.js');
const db = require('../../database/database');
const logger = require('../../utils/logger');

const FIXED_BOOSTS = [
    getItem('xp_boost'),
    getItem('points_boost'),
    getItem('starss_boost'),
    getItem('counting_boost'),
];

const FIXED_CHESTS = [
    getItem('coffre_normal'),
    getItem('coffre_mega'),
];

const ITEMS_PER_PAGE = 8; // Laisser de la place pour le header et les contrôles

module.exports = {
    data: new SlashCommandBuilder()
        .setName('boutique')
        .setDescription('Achetez des items et des boosts.'),

    async execute(interaction) {
        const userId = interaction.user.id;
        let user = getOrCreateUser(userId, interaction.user.username);

        const dailyItems = getDailyShopItems(userId);
        const legendaryChestAvailable = checkLegendaryChestSpawn(userId);

        // Préparer tous les items disponibles dans une liste unique
        let allShopItems = [];
        const seenItemIds = new Set(); // Tracker les IDs déjà ajoutés pour éviter les doublons

        // 1. Items du jour
        dailyItems.forEach(shopItem => {
            const item = getItem(shopItem.item_id);
            if (item && !seenItemIds.has(item.id)) {
                seenItemIds.add(item.id);
                allShopItems.push({ ...item, type: 'daily', purchaseInfo: canPurchaseItem(userId, item.id, item.rarity) });
            }
        });

        // 2. Boosts
        FIXED_BOOSTS.forEach(boost => {
            if (boost && !seenItemIds.has(boost.id)) {
                seenItemIds.add(boost.id);
                allShopItems.push({ ...boost, type: 'boost' });
            }
        });

        // 3. Coffres
        FIXED_CHESTS.forEach(chest => {
            if (chest && !seenItemIds.has(chest.id)) {
                seenItemIds.add(chest.id);
                allShopItems.push({ ...chest, type: 'chest' });
            }
        });

        // 4. Coffre Légendaire
        if (legendaryChestAvailable) {
            const legendaryChest = getItem('coffre_legendaire');
            if (legendaryChest && !seenItemIds.has(legendaryChest.id)) {
                seenItemIds.add(legendaryChest.id);
                allShopItems.push({ ...legendaryChest, type: 'legendary' });
            }
        }

        let currentPage = 0;
        const totalPages = Math.ceil(allShopItems.length / ITEMS_PER_PAGE);

        const generateMessagePayload = (page) => {
            const components = [];

            const container = new ContainerBuilder();

            // Header Section
            const headerText = new TextDisplayBuilder()
                .setContent(`# 🛒 Boutique\nVotre solde : **${user.stars.toLocaleString('fr-FR')}** Starss 💸`);

            container.addTextDisplayComponents(headerText);

            // Items for current page
            const startIdx = page * ITEMS_PER_PAGE;
            const endIdx = startIdx + ITEMS_PER_PAGE;
            const pageItems = allShopItems.slice(startIdx, endIdx);

            pageItems.forEach(item => {
                let description = `**Prix:** ${item.price.toLocaleString('fr-FR')} Starss`;
                if (item.description) {
                    description += `\n${item.description}`;
                }
                let canBuy = true;
                let buyLabel = 'Acheter';
                let buyStyle = ButtonStyle.Success;

                if (item.type === 'daily') {
                    description += `\n*Rareté: ${item.rarity}*`;
                    if (!item.purchaseInfo.canPurchase) {
                        canBuy = false;
                        buyLabel = 'Épuisé';
                        buyStyle = ButtonStyle.Secondary;
                        description += `\n❌ **Stock épuisé**`;
                    }
                } else if (item.type === 'boost') {
                    // Vérification du cooldown 12h pour les boosts
                    const now = Date.now();
                    const boostCooldown = 12 * 60 * 60 * 1000; // 12 heures
                    let lastPurchase = 0;

                    if (item.id === 'xp_boost') lastPurchase = user.last_xp_boost || 0;
                    else if (item.id === 'points_boost') lastPurchase = user.last_points_boost || 0;
                    else if (item.id === 'starss_boost') lastPurchase = user.last_stars_boost || 0;
                    else if (item.id === 'counting_boost') lastPurchase = user.last_counting_boost || 0;

                    if (now - lastPurchase < boostCooldown) {
                        canBuy = false;
                        buyLabel = 'Recharge';
                        buyStyle = ButtonStyle.Secondary;
                        description += `\n⏳ **Dispo: <t:${Math.floor((lastPurchase + boostCooldown) / 1000)}:R>**`;
                    } else {
                        description += `\n*Durée: 1 heure*`;
                    }
                } else if (item.type === 'legendary') {
                    description += `\n⭐ **Offre Limitée !**`;
                    buyStyle = ButtonStyle.Primary;
                }

                if (user.stars < item.price) {
                    canBuy = false;
                }

                const itemText = new TextDisplayBuilder()
                    .setContent(`### ${item.emoji || ''} ${item.name}\n${description}`);

                const buyButton = new ButtonBuilder()
                    .setCustomId(`buy_${item.id}`)
                    .setLabel(buyLabel)
                    .setStyle(buyStyle)
                    .setDisabled(!canBuy || buyLabel === 'Épuisé');

                if (item.price > 0) {
                    buyButton.setEmoji('💸');
                }

                const itemSection = new SectionBuilder()
                    .addTextDisplayComponents(itemText)
                    .setButtonAccessory(buyButton);

                container.addSectionComponents(itemSection);
            });

            // Navigation Buttons
            const navRow = new ActionRowBuilder();

            const prevButton = new ButtonBuilder()
                .setCustomId('shop_prev')
                .setLabel('◀️ Précédent')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(page === 0);

            const nextButton = new ButtonBuilder()
                .setCustomId('shop_next')
                .setLabel('Suivant ▶️')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(page >= totalPages - 1);

            const pageIndicator = new ButtonBuilder()
                .setCustomId('shop_page_info')
                .setLabel(`Page ${page + 1}/${totalPages}`)
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(true);

            const alertButton = new ButtonBuilder()
                .setCustomId('shop_alert_menu')
                .setLabel('🔔 Créer une alerte')
                .setStyle(ButtonStyle.Primary);

            navRow.addComponents(prevButton, pageIndicator, nextButton, alertButton);

            components.push(container, navRow);

            return {
                components: components,
                flags: 32768,
                ephemeral: true
            };
        };

        const response = await interaction.reply(generateMessagePayload(currentPage));

        const collector = response.createMessageComponentCollector({
            componentType: ComponentType.Button,
            time: 10 * 60 * 1000,
        });

        collector.on('collect', async (i) => {
            if (i.user.id !== userId) return i.reply({ content: 'Vous ne pouvez pas utiliser ce menu.', ephemeral: true }).catch(() => null);

            const customId = i.customId;

            if (customId === 'shop_alert_menu') {
                const allItems = getAllItems();
                // Récupérer les alertes déjà actives pour cet utilisateur
                const existingAlerts = db.prepare('SELECT item_id FROM shop_alerts WHERE user_id = ?').all(userId).map(a => a.item_id);

                // Préparer les options pour le menu de sélection
                const options = Object.values(allItems).map(item => {
                    const isWatched = existingAlerts.includes(item.id);
                    return {
                        label: (isWatched ? '✅ ' : '') + item.name.replace(/⚡ |✨ |💸 |💯 |🎤 |🖥️ |👑 |⭐ /g, ''), // Nettoyer les emojis pour le label
                        value: item.id,
                        description: `Prix: ${item.price.toLocaleString('fr-FR')} Starss`,
                        emoji: item.emoji || '🔍'
                    };
                }).slice(0, 25); // Limite Discord

                // Création du menu de sélection
                const select = new StringSelectMenuBuilder()
                    .setCustomId('alert_items_selection')
                    .setPlaceholder('Choisissez les items à surveiller...')
                    .setMinValues(1)
                    .setMaxValues(Math.min(options.length, 10))
                    .setRequired(true)
                    .addOptions(options);

                // Création du modal en JSON brut pour supporter les composants V2 (Type 18) et le flag 32768
                const modalData = {
                    title: '🔔 Alertes boutique',
                    custom_id: 'shop_alert_modal',
                    flags: 32768,
                    components: [
                        {
                            type: 18, // InputRow / Section en V2
                            label: 'Quels items souhaitez-vous surveiller ?',
                            component: select.toJSON() // Contient le StringSelectMenuBuilder
                        }
                    ]
                };

                // Afficher le modal
                await i.showModal(modalData);

                // Attendre la réponse du modal
                try {
                    const submitted = await i.awaitModalSubmit({
                        time: 60000,
                        filter: (submission) => submission.customId === 'shop_alert_modal' && submission.user.id === userId,
                    });

                    // Récupérer les valeurs sélectionnées (API V2)
                    const selectedIds = submitted.fields.fields.get('alert_items_selection')?.values || [];

                    const addedItems = [];
                    const removedItems = [];

                    for (const itemId of selectedIds) {
                        const item = allItems[itemId];
                        if (item) {
                            try {
                                // Vérifier si l'alerte existe déjà (Toggle logic)
                                const exists = db.prepare('SELECT 1 FROM shop_alerts WHERE user_id = ? AND item_id = ?').get(userId, itemId);
                                if (exists) {
                                    db.prepare('DELETE FROM shop_alerts WHERE user_id = ? AND item_id = ?').run(userId, itemId);
                                    removedItems.push(item.name);
                                } else {
                                    db.prepare('INSERT INTO shop_alerts (user_id, item_id, created_at) VALUES (?, ?, ?)').run(userId, itemId, Date.now());
                                    addedItems.push(item.name);
                                }
                            } catch (err) {
                                logger.error(`Erreur toggle alerte pour ${itemId}: ${err.message}`);
                            }
                        }
                    }

                    if (addedItems.length > 0 || removedItems.length > 0) {
                        let msg = '';
                        if (addedItems.length > 0) msg += `✅ Alertes activées pour : ${addedItems.join(', ')}.\n`;
                        if (removedItems.length > 0) msg += `❌ Alertes désactivées pour : ${removedItems.join(', ')}.`;

                        await submitted.reply({
                            content: msg.trim(),
                            ephemeral: true
                        });
                    } else {
                        await submitted.reply({ content: `ℹ️ Aucun changement n'a été effectué.`, ephemeral: true });
                    }

                } catch (error) {
                    if (error.code !== 'InteractionCollectorError') {
                        logger.error(`Erreur modal alertes: ${error.message}`);
                    }
                }
                return;
            }

            if (customId === 'shop_prev') {
                currentPage = Math.max(0, currentPage - 1);
                await i.update(generateMessagePayload(currentPage));
                return;
            }

            if (customId === 'shop_next') {
                currentPage = Math.min(totalPages - 1, currentPage + 1);
                await i.update(generateMessagePayload(currentPage));
                return;
            }

            if (customId.startsWith('buy_')) {
                const itemId = customId.replace('buy_', '');
                const selectedItem = getItem(itemId);

                // Rafraîchir l'utilisateur
                user = getOrCreateUser(userId, i.user.username);

                if (!selectedItem) {
                    return i.reply({ content: 'Cet item n\'est plus disponible.', ephemeral: true });
                }

                // Vérifications
                if (selectedItem.type === 'item' && selectedItem.rarity) {
                    const purchaseCheck = canPurchaseItem(userId, itemId, selectedItem.rarity);
                    if (!purchaseCheck.canPurchase) {
                        return i.reply({
                            content: `❌ Vous avez déjà acheté le maximum d'exemplaires de cet item aujourd'hui.`,
                            ephemeral: true
                        });
                    }
                }

                if (user.stars < selectedItem.price) {
                    return i.reply({ content: `Il vous manque **${(selectedItem.price - user.stars).toLocaleString('fr-FR')}** Starss pour acheter cet item.`, ephemeral: true });
                }

                // Vérification sécurité du cooldown boost
                if (selectedItem.type === 'boost') {
                    const now = Date.now();
                    const boostCooldown = 12 * 60 * 60 * 1000;
                    let last = 0;
                    if (itemId === 'xp_boost') last = user.last_xp_boost || 0;
                    else if (itemId === 'points_boost') last = user.last_points_boost || 0;
                    else if (itemId === 'starss_boost') last = user.last_stars_boost || 0;
                    else if (itemId === 'counting_boost') last = user.last_counting_boost || 0;

                    if (now - last < boostCooldown) {
                        return i.reply({ content: `⏳ Ce boost est en recharge ! Revenez <t:${Math.floor((last + boostCooldown) / 1000)}:R>.`, ephemeral: true });
                    }
                }

                await i.deferUpdate();

                // Traitement de l'achat

                // Vérifier la quête d'achat
                if (selectedItem.rarity) {
                    const { checkQuestProgress } = require('../../utils/quests');
                    checkQuestProgress(i.client, 'SHOP_BUY', i.user, { itemRarity: selectedItem.rarity });
                }

                if (itemId === 'coffre_legendaire') {
                    removeLegendaryChest(userId);
                    // Retirer de la liste locale pour l'affichage immédiat
                    const idx = allShopItems.findIndex(x => x.id === 'coffre_legendaire');
                    if (idx !== -1) allShopItems.splice(idx, 1);
                }

                grantResources(i.client, userId, { stars: -selectedItem.price, source: 'boutique' });
                user.stars -= selectedItem.price; // Update local state for display

                // Effets
                const boostDuration = 60 * 60 * 1000;
                let message = `Félicitations ! Vous avez acheté **${selectedItem.name}** !`;

                const now = Date.now();
                switch (itemId) {
                    case 'xp_boost':
                        db.prepare('UPDATE users SET xp_boost_until = ?, last_xp_boost = ? WHERE id = ?').run(now + boostDuration, now, userId);
                        user.last_xp_boost = now;
                        message += `\n🚀 **Boost XP (x2)** activé pour 1 heure !`;
                        break;
                    case 'points_boost':
                        db.prepare('UPDATE users SET points_boost_until = ?, last_points_boost = ? WHERE id = ?').run(now + boostDuration, now, userId);
                        user.last_points_boost = now;
                        message += `\n🚀 **Boost Points de Rang (x2)** activé pour 1 heure !`;
                        break;
                    case 'starss_boost':
                        db.prepare('UPDATE users SET stars_boost_until = ?, last_stars_boost = ? WHERE id = ?').run(now + boostDuration, now, userId);
                        user.last_stars_boost = now;
                        message += `\n🚀 **Boost Starss (x2)** activé pour 1 heure !`;
                        break;
                    case 'counting_boost':
                        db.prepare('UPDATE users SET counting_boost_until = ?, last_counting_boost = ? WHERE id = ?').run(now + boostDuration, now, userId);
                        user.last_counting_boost = now;
                        message += `\n🚀 **Boost Points Comptage (x2)** activé pour 1 heure !`;
                        break;
                    default:
                        // Check specific limit for passive items (micro, ecran, couronne)
                        const { PASSIVE_ITEMS } = require('../../utils/items');
                        const { checkUserInventory } = require('../../utils/db-users');

                        if (PASSIVE_ITEMS.includes(itemId)) {
                            const currentQty = checkUserInventory(userId, itemId);
                            if (currentQty >= 2) {
                                return i.followUp({
                                    content: `❌ Vous ne pouvez pas posséder plus de 2 exemplaires de **${selectedItem.name}** (Déjà actif : ${currentQty}/2).`,
                                    ephemeral: true
                                });
                            }

                            addItemToInventory(userId, itemId, 1);
                            message += `\n✅ **Item passif activé !** (Niveau actuel : ${currentQty + 1}/2)\n*Cet item est consommé directement et n'apparaît pas dans l'inventaire.*`;
                        } else {
                            addItemToInventory(userId, itemId, 1);
                        }

                        if (selectedItem.type === 'item' && selectedItem.rarity) {
                            recordPurchase(userId, itemId, 1);
                            // Mettre à jour l'info d'achat locale
                            const shopItemIdx = allShopItems.findIndex(x => x.id === itemId);
                            if (shopItemIdx !== -1) {
                                allShopItems[shopItemIdx].purchaseInfo = canPurchaseItem(userId, itemId, selectedItem.rarity);
                            }
                        }
                        break;
                }

                // Confirmation éphémère
                await i.followUp({ content: message, ephemeral: true });

                // Mettre à jour le message du shop (solde et stock)
                await i.editReply(generateMessagePayload(currentPage));
            }
        });

    },
};