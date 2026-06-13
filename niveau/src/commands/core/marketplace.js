/**
 * Commande /marketplace - Système de Marketplace P2P (MAJ Mars 2026)
 * 
 * Sous-commandes :
 * - /marketplace parcourir : Voir les annonces actives
 * - /marketplace vendre <item> <quantité> <prix> : Mettre en vente un item
 * - /marketplace acheter <id> : Acheter une annonce
 * - /marketplace annuler <id> : Annuler une de ses annonces
 * - /marketplace mes-annonces : Voir ses annonces actives
 * - /marketplace rechercher <item> : Chercher un item spécifique
 */

const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, ComponentType } = require('discord.js');
const { getOrCreateUser } = require('../../utils/db-users');
const { createListing, buyListing, cancelListing, getActiveListings, getUserListings, getAllUserListings, searchListingsByItem, getMarketplaceStats, isItemSellable, MAX_ACTIVE_LISTINGS, MIN_LEVEL_MARKETPLACE } = require('../../utils/marketplace-system');
const { getItem, ITEMS } = require('../../utils/items');
const { getUserInventory } = require('../../utils/db-users');
const { handleCommandError } = require('../../utils/error-handler');

// Items disponibles à la vente pour un utilisateur (basé sur son inventaire)
function getSellableItemsForUser(userId) {
    const inventory = getUserInventory(userId);
    return inventory
        .filter(inv => inv.quantity > 0 && isItemSellable(inv.item_id))
        .map(inv => {
            const item = getItem(inv.item_id);
            return item ? { name: `${item.name} (x${inv.quantity})`, value: item.id } : null;
        })
        .filter(Boolean);
}

// Items disponibles (pour recherche, pas besoin d'inventaire)
function getSellableItems() {
    return Object.values(ITEMS)
        .filter(item => isItemSellable(item.id))
        .map(item => ({ name: `${item.name} (${item.rarity || 'N/A'})`, value: item.id }));
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('marketplace')
        .setDescription('Marketplace - Achetez et vendez des items entre joueurs !')
        .addSubcommand(sub =>
            sub.setName('parcourir')
                .setDescription('Voir les annonces actives du marketplace.'))
        .addSubcommand(sub =>
            sub.setName('vendre')
                .setDescription('Mettre un item en vente sur le marketplace.')
                .addStringOption(opt =>
                    opt.setName('item')
                        .setDescription('L\'item à vendre')
                        .setRequired(true)
                        .setAutocomplete(true))
                .addIntegerOption(opt =>
                    opt.setName('quantite')
                        .setDescription('Quantité à vendre')
                        .setRequired(true)
                        .setMinValue(1)
                        .setMaxValue(99))
                .addIntegerOption(opt =>
                    opt.setName('prix')
                        .setDescription('Prix en Starss')
                        .setRequired(true)
                        .setMinValue(1000)))
        .addSubcommand(sub =>
            sub.setName('acheter')
                .setDescription('Acheter une annonce du marketplace.')
                .addIntegerOption(opt =>
                    opt.setName('id')
                        .setDescription('ID de l\'annonce à acheter')
                        .setRequired(true)))
        .addSubcommand(sub =>
            sub.setName('annuler')
                .setDescription('Annuler une de vos annonces.')
                .addIntegerOption(opt =>
                    opt.setName('id')
                        .setDescription('ID de l\'annonce à annuler')
                        .setRequired(true)))
        .addSubcommand(sub =>
            sub.setName('mes-annonces')
                .setDescription('Voir vos annonces actives.'))
        .addSubcommand(sub =>
            sub.setName('rechercher')
                .setDescription('Rechercher un item sur le marketplace.')
                .addStringOption(opt =>
                    opt.setName('item')
                        .setDescription('L\'item à rechercher')
                        .setRequired(true)
                        .setAutocomplete(true))),

    async autocomplete(interaction) {
        const focusedValue = interaction.options.getFocused().toLowerCase();
        const subcommand = interaction.options.getSubcommand();

        let choices;
        if (subcommand === 'vendre') {
            // Pour vendre : montrer seulement les items que l'utilisateur possède
            choices = getSellableItemsForUser(interaction.user.id)
                .filter(item => item.name.toLowerCase().includes(focusedValue))
                .slice(0, 25);
        } else {
            // Pour rechercher : montrer tous les items vendables
            choices = getSellableItems()
                .filter(item => item.name.toLowerCase().includes(focusedValue))
                .slice(0, 25);
        }
        await interaction.respond(choices);
    },

    async execute(interaction) {
        try {
            const userId = interaction.user.id;
            const userData = getOrCreateUser(userId, interaction.user.username);

            // Vérification du niveau minimum
            if (userData.level < MIN_LEVEL_MARKETPLACE) {
                return interaction.reply({
                    content: `❌ Vous devez être au moins **niveau ${MIN_LEVEL_MARKETPLACE}** pour accéder au marketplace. (Niveau actuel: ${userData.level})`,
                    ephemeral: true,
                });
            }

            const subcommand = interaction.options.getSubcommand();

            switch (subcommand) {
                case 'parcourir':
                    await handleParcourir(interaction);
                    break;
                case 'vendre':
                    await handleVendre(interaction, userId);
                    break;
                case 'acheter':
                    await handleAcheter(interaction, userId);
                    break;
                case 'annuler':
                    await handleAnnuler(interaction, userId);
                    break;
                case 'mes-annonces':
                    await handleMesAnnonces(interaction, userId);
                    break;
                case 'rechercher':
                    await handleRechercher(interaction);
                    break;
            }
        } catch (error) {
            await handleCommandError(interaction, error);
        }
    }
};

async function handleParcourir(interaction) {
    await interaction.deferReply();

    const listings = getActiveListings(25);
    const stats = getMarketplaceStats();

    if (listings.length === 0) {
        const embed = new EmbedBuilder()
            .setTitle('🏪 Marketplace')
            .setColor('#e67e22')
            .setDescription('Le marketplace est vide pour le moment.\nSoyez le premier à mettre quelque chose en vente avec `/marketplace vendre` !')
            .setFooter({ text: `${stats.totalSold} ventes réalisées au total` });

        return interaction.editReply({ embeds: [embed] });
    }

    const embed = new EmbedBuilder()
        .setTitle('🏪 Marketplace')
        .setColor('#e67e22')
        .setDescription(`**${stats.activeListings}** annonce(s) active(s) | **${stats.totalSold}** ventes totales`)
        .setFooter({ text: 'Utilisez /marketplace acheter <id> pour acheter' });

    const listingLines = listings.map(l => {
        const item = getItem(l.item_id);
        const itemName = item ? item.name : l.item_id;
        const expireDate = new Date(l.expires_at);
        const expireStr = `<t:${Math.floor(l.expires_at / 1000)}:R>`;

        let priceStr = '';
        if (l.price_type === 'starss') {
            priceStr = `${l.price_amount.toLocaleString('fr-FR')} Starss`;
        } else {
            const priceItem = getItem(l.price_item_id);
            priceStr = `${l.price_amount}x ${priceItem?.name || l.price_item_id}`;
        }

        return `**#${l.id}** | **${l.quantity}x ${itemName}** → ${priceStr}\n┗ Vendeur: ${l.seller_name || 'Inconnu'} | Expire: ${expireStr}`;
    });

    // Grouper par pages de 10
    const pageSize = 10;
    embed.setDescription(
        `**${stats.activeListings}** annonce(s) active(s)\n\n` +
        listingLines.slice(0, pageSize).join('\n\n')
    );

    await interaction.editReply({ embeds: [embed] });
}

async function handleVendre(interaction, userId) {
    const itemId = interaction.options.getString('item');
    const quantity = interaction.options.getInteger('quantite');
    const price = interaction.options.getInteger('prix');

    const result = createListing(userId, itemId, quantity, price, 'starss', null);

    const embed = new EmbedBuilder()
        .setColor(result.success ? '#2ecc71' : '#e74c3c')
        .setDescription(result.message);

    if (result.success) {
        embed.setTitle('🏪 Annonce créée');
        const item = getItem(itemId);
        embed.addFields(
            { name: 'Item', value: `${quantity}x ${item?.name || itemId}`, inline: true },
            { name: 'Prix', value: `${price.toLocaleString('fr-FR')} Starss`, inline: true },
            { name: 'ID Annonce', value: `#${result.listingId}`, inline: true },
        );
        embed.setFooter({ text: 'L\'annonce expire dans 7 jours. L\'item a été retiré de votre inventaire.' });
    }

    await interaction.reply({ embeds: [embed], ephemeral: !result.success });
}

async function handleAcheter(interaction, userId) {
    const listingId = interaction.options.getInteger('id');

    // Confirmation avant achat
    await interaction.deferReply();

    const result = buyListing(userId, listingId);

    const embed = new EmbedBuilder()
        .setColor(result.success ? '#2ecc71' : '#e74c3c')
        .setTitle(result.success ? '✅ Achat effectué' : '❌ Erreur')
        .setDescription(result.message);

    await interaction.editReply({ embeds: [embed] });
}

async function handleAnnuler(interaction, userId) {
    const listingId = interaction.options.getInteger('id');

    const result = cancelListing(userId, listingId);

    const embed = new EmbedBuilder()
        .setColor(result.success ? '#2ecc71' : '#e74c3c')
        .setDescription(result.message);

    await interaction.reply({ embeds: [embed], ephemeral: !result.success });
}

async function handleMesAnnonces(interaction, userId) {
    await interaction.deferReply({ ephemeral: true });

    const listings = getAllUserListings(userId);

    if (listings.length === 0) {
        return interaction.editReply({ content: '📦 Vous n\'avez aucune annonce.' });
    }

    const statusEmoji = {
        active: '🟢',
        sold: '✅',
        cancelled: '🔴',
        expired: '⏰',
    };

    const activeCount = listings.filter(l => l.status === 'active').length;

    const embed = new EmbedBuilder()
        .setTitle('📦 Vos annonces')
        .setColor('#3498db')
        .setDescription(`${activeCount}/${MAX_ACTIVE_LISTINGS} emplacements actifs utilisés`);

    const lines = listings.map(l => {
        const item = getItem(l.item_id);
        const itemName = item ? item.name : l.item_id;
        let priceStr = l.price_type === 'starss'
            ? `${l.price_amount.toLocaleString('fr-FR')} Starss`
            : `${l.price_amount}x ${getItem(l.price_item_id)?.name || l.price_item_id}`;

        const emoji = statusEmoji[l.status] || '❓';
        const statusLabel = l.status === 'active' ? `Expire <t:${Math.floor(l.expires_at / 1000)}:R>` : l.status.toUpperCase();

        return `${emoji} **#${l.id}** | **${l.quantity}x ${itemName}** → ${priceStr}\n┗ ${statusLabel}`;
    });

    embed.addFields({ name: 'Annonces', value: lines.join('\n\n') });
    embed.setFooter({ text: 'Utilisez /marketplace annuler <id> pour annuler une annonce active' });

    await interaction.editReply({ embeds: [embed] });
}

async function handleRechercher(interaction) {
    await interaction.deferReply();

    const itemId = interaction.options.getString('item');
    const item = getItem(itemId);

    if (!item) {
        return interaction.editReply({ content: '❌ Item inconnu.' });
    }

    const listings = searchListingsByItem(itemId);

    if (listings.length === 0) {
        return interaction.editReply({
            content: `🔍 Aucune annonce trouvée pour **${item.name}**.`
        });
    }

    const embed = new EmbedBuilder()
        .setTitle(`🔍 Résultats pour "${item.name}"`)
        .setColor('#3498db')
        .setDescription(`${listings.length} annonce(s) trouvée(s), triées par prix croissant :`);

    const lines = listings.map(l => {
        let priceStr = l.price_type === 'starss'
            ? `${l.price_amount.toLocaleString('fr-FR')} Starss`
            : `${l.price_amount}x ${getItem(l.price_item_id)?.name || l.price_item_id}`;

        return `**#${l.id}** | **${l.quantity}x** → ${priceStr} | Expire: <t:${Math.floor(l.expires_at / 1000)}:R>`;
    });

    embed.addFields({ name: 'Annonces', value: lines.join('\n') });
    await interaction.editReply({ embeds: [embed] });
}
