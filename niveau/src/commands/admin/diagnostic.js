const path = require('path');
const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const { BLZ_EMBED_STRIP_INT } = require(path.join(__dirname, '..', '..', '..', '..', 'blz-embed-theme'));
const { getOrCreateUser, getResourceHistory, getResourceSummary, checkUserInventory, getUserInventory } = require('../../utils/db-users');
const { getGuildOfUser } = require('../../utils/db-guilds');
const db = require('../../database/database');
const logger = require('../../utils/logger');
const roleConfig = require('../../config/role.config.json');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('diagnostic')
        .setDescription('⚙️ [ADMIN] Affiche les informations de diagnostic d\'un utilisateur.')
        .addUserOption(option =>
            option.setName('utilisateur')
                .setDescription('L\'utilisateur à diagnostiquer')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('période')
                .setDescription('Période d\'historique à afficher')
                .setRequired(false)
                .addChoices(
                    { name: '1 heure', value: '1' },
                    { name: '6 heures', value: '6' },
                    { name: '24 heures', value: '24' },
                    { name: '7 jours', value: '168' }
                ))
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });

        const targetUser = interaction.options.getUser('utilisateur');
        const period = parseInt(interaction.options.getString('période') || '24');

        const userData = getOrCreateUser(targetUser.id, targetUser.username);
        if (!userData) {
            return interaction.editReply({ content: '❌ Utilisateur non trouvé dans la base de données.' });
        }

        const now = Date.now();
        const member = await interaction.guild.members.fetch(targetUser.id).catch(() => null);

        // === BOOSTS ACTIFS ===
        const activeBoosts = [];

        // === NERF VOCAL ===
        const dailyVoiceXP = userData.daily_voice_xp || 0;
        const dailyVoicePoints = userData.daily_voice_points || 0;
        const lastVoiceReset = userData.daily_voice_last_reset || 0;
        const todayReset = new Date().setHours(0, 0, 0, 0);

        if (lastVoiceReset !== 0 && lastVoiceReset >= todayReset) {
            if (dailyVoiceXP >= 15000 || dailyVoicePoints >= 7000) {
                activeBoosts.push(`⛔ **NERF VOCAL VOCAL** (Hard Cap atteint - 0 gain)`);
            } else if (dailyVoiceXP >= 10000 || dailyVoicePoints >= 5000) {
                activeBoosts.push(`⚠️ **NERF VOCAL** (Soft Cap atteint - gains /5)`);
            }
        }

        // Boosts temporaires
        if (userData.xp_boost_x4_until > now) {
            const remaining = Math.round((userData.xp_boost_x4_until - now) / 60000);
            activeBoosts.push(`⚡⚡ **XP Boost x4** (${remaining} min restantes)`);
        } else if (userData.xp_boost_until > now) {
            const remaining = Math.round((userData.xp_boost_until - now) / 60000);
            activeBoosts.push(`⚡ **XP Boost x2** (${remaining} min restantes)`);
        }
        if (userData.points_boost_until > now) {
            const remaining = Math.round((userData.points_boost_until - now) / 60000);
            activeBoosts.push(`✨ **Points Boost x2** (${remaining} min restantes)`);
        }
        if (userData.stars_boost_until && userData.stars_boost_until > now) {
            const remaining = Math.round((userData.stars_boost_until - now) / 60000);
            activeBoosts.push(`💸 **Stars Boost x2** (${remaining} min restantes)`);
        }
        if (userData.counting_boost_until && userData.counting_boost_until > now) {
            const remaining = Math.round((userData.counting_boost_until - now) / 60000);
            activeBoosts.push(`💯 **Comptage Boost x2** (${remaining} min restantes)`);
        }

        // Boosts Noël
        try {
            const { getActiveMultiplier } = require('../../utils/db-noel');
            const christmasMultiplier = getActiveMultiplier(targetUser.id);
            if (christmasMultiplier) {
                const remaining = Math.round((christmasMultiplier.expires_at - now) / 60000);
                activeBoosts.push(`🎄 **Noël: ${christmasMultiplier.multiplier_type}** (${remaining} min restantes)`);
            }
        } catch (e) { /* Module non chargé */ }

        // Items passifs
        if (checkUserInventory(targetUser.id, 'couronne') > 0) {
            activeBoosts.push(`👑 **Couronne** (+20% XP permanent)`);
        }
        if (checkUserInventory(targetUser.id, 'micro') > 0) {
            activeBoosts.push(`🎤 **Micro** (+15% Points permanent)`);
        }
        if (checkUserInventory(targetUser.id, 'ecran') > 0) {
            activeBoosts.push(`🖥️ **Écran** (+20% Stars permanent)`);
        }

        // Rôle VIP/Booster
        if (member) {
            const vipIds = [roleConfig.roleIds.vip, ...(roleConfig.roleIds.vipAliases || [])];
            const hasVip = vipIds.some(id => member.roles.cache.has(id));
            if (hasVip) {
                activeBoosts.push(`💎 **VIP/Booster** (+30% XP/Stars, +20% Points)`);
            }
        }

        // Guilde
        const userGuild = getGuildOfUser(targetUser.id);
        if (userGuild) {
            const { calculateGuildBoosts } = require('../../utils/guild/guild-boosters');
            const guildBoosts = calculateGuildBoosts(userGuild);
            if (guildBoosts.xp > 0 || guildBoosts.points > 0 || guildBoosts.stars > 0) {
                activeBoosts.push(`🏰 **Guilde ${userGuild.name}** (+${Math.round(guildBoosts.xp * 100)}% XP, +${Math.round(guildBoosts.points * 100)}% Points, +${Math.round(guildBoosts.stars * 100)}% Stars)`);
            }
        }

        // === HISTORIQUE DES GAINS ===
        const summary = getResourceSummary(targetUser.id, period);
        const history = getResourceHistory(targetUser.id, 20);

        // Calculer les totaux
        let totalXp = 0, totalPoints = 0, totalStars = 0;
        const sourceBreakdown = {};

        for (const entry of summary) {
            if (entry.resource_type === 'xp') totalXp += entry.total;
            else if (entry.resource_type === 'points') totalPoints += entry.total;
            else if (entry.resource_type === 'stars') totalStars += entry.total;

            if (!sourceBreakdown[entry.source]) {
                sourceBreakdown[entry.source] = { xp: 0, points: 0, stars: 0, count: 0 };
            }
            sourceBreakdown[entry.source][entry.resource_type] += entry.total;
            sourceBreakdown[entry.source].count += entry.count;
        }

        // === EMBEDS ===
        const mainEmbed = new EmbedBuilder()
            .setTitle(`🔍 Diagnostic - ${targetUser.username}`)
            .setColor(BLZ_EMBED_STRIP_INT)
            .setThumbnail(targetUser.displayAvatarURL())
            .addFields(
                {
                    name: '📊 Stats Actuelles',
                    value: `**Niveau:** ${userData.level}\n**XP:** ${userData.xp.toLocaleString('fr-FR')} / ${userData.xp_needed.toLocaleString('fr-FR')}\n**Points:** ${userData.points.toLocaleString('fr-FR')}\n**Stars:** ${userData.stars.toLocaleString('fr-FR')}\n**Tirages Puits:** ${userData.total_tirages || 0}`,
                    inline: true
                },
                {
                    name: '📈 Streak',
                    value: `**Actuel:** ${userData.streak || 0}\n**Dernier update:** ${userData.last_streak_timestamp ? `<t:${Math.floor(userData.last_streak_timestamp / 1000)}:R>` : 'Jamais'}`,
                    inline: true
                }
            )
            .setTimestamp();

        // Boosts Actifs
        const boostsEmbed = new EmbedBuilder()
            .setTitle('⚡ Multiplicateurs Actifs')
            .setColor(activeBoosts.length > 0 ? 0x00FF00 : 0xFF0000)
            .setDescription(activeBoosts.length > 0 ? activeBoosts.join('\n') : '❌ Aucun boost actif');

        // Historique par source
        let sourceText = '';
        for (const [source, data] of Object.entries(sourceBreakdown)) {
            const parts = [];
            if (data.xp > 0) parts.push(`${data.xp.toLocaleString('fr-FR')} XP`);
            if (data.points > 0) parts.push(`${data.points.toLocaleString('fr-FR')} Points`);
            if (data.stars > 0) parts.push(`${data.stars.toLocaleString('fr-FR')} Stars`);
            sourceText += `**${source}** (${data.count}x): ${parts.join(', ')}\n`;
        }

        const historyEmbed = new EmbedBuilder()
            .setTitle(`📜 Gains des ${period}h dernières`)
            .setColor(BLZ_EMBED_STRIP_INT)
            .addFields(
                {
                    name: '💰 Totaux',
                    value: `**XP:** ${totalXp.toLocaleString('fr-FR')}\n**Points:** ${totalPoints.toLocaleString('fr-FR')}\n**Stars:** ${totalStars.toLocaleString('fr-FR')}`,
                    inline: true
                },
                {
                    name: '📊 Moyennes/h',
                    value: `~${Math.round(totalXp / period).toLocaleString('fr-FR')} XP/h\n~${Math.round(totalPoints / period).toLocaleString('fr-FR')} RP/h`,
                    inline: true
                }
            );

        if (sourceText) {
            historyEmbed.addFields({
                name: '📌 Répartition par source',
                value: sourceText.substring(0, 1024) || 'Aucune donnée',
                inline: false
            });
        }

        // Dernières actions
        let recentText = '';
        for (let i = 0; i < Math.min(10, history.length); i++) {
            const entry = history[i];
            const time = Math.floor(entry.timestamp / 1000);
            recentText += `<t:${time}:R> **${entry.source}** +${entry.amount.toLocaleString('fr-FR')} ${entry.resource_type}\n`;
        }

        const recentEmbed = new EmbedBuilder()
            .setTitle('🕐 10 Derniers Gains')
            .setColor(BLZ_EMBED_STRIP_INT)
            .setDescription(recentText || 'Aucun historique disponible');

        // === STATS AVANCÉES ===
        // Achats boutique aujourd'hui
        const today = new Date().toISOString().slice(0, 10);
        const shopPurchases = db.prepare(`
            SELECT item_id, SUM(quantity) as qty 
            FROM shop_purchases 
            WHERE user_id = ? AND purchase_date = ?
            GROUP BY item_id
        `).all(targetUser.id, today);

        // Puits de Combat stats
        const puitsStats = db.prepare(`
            SELECT COUNT(*) as count FROM puits_tirages WHERE user_id = ?
        `).get(targetUser.id);

        // Inventaire complet valorisé
        const inventory = getUserInventory(targetUser.id);
        let inventoryValue = 0;
        const inventoryItems = [];
        const { ITEMS } = require('../../utils/items');
        for (const inv of inventory) {
            const item = ITEMS[inv.item_id];
            if (item) {
                const value = (item.price || 0) * inv.quantity;
                inventoryValue += value;
                if (inv.quantity > 0) {
                    inventoryItems.push(`${item.name} x${inv.quantity}`);
                }
            }
        }

        // Coffres ouverts (approximation via historique)
        const chestGains = history.filter(h => h.source === 'coffre').length;

        // Quêtes complétées
        const questsCompleted = db.prepare(`
            SELECT COUNT(*) as count FROM quest_progress WHERE user_id = ? AND completed = 1
        `).get(targetUser.id);

        // Daily claims
        const lastDaily = userData.daily_last_claimed;
        const dailyStatus = lastDaily && (Date.now() - lastDaily < 24 * 60 * 60 * 1000)
            ? `✅ Réclamé <t:${Math.floor(lastDaily / 1000)}:R>`
            : '❌ Non réclamé aujourd\'hui';

        // Stats embed
        const statsEmbed = new EmbedBuilder()
            .setTitle('📦 Stats Détaillées')
            .setColor(0x3498DB)
            .addFields(
                {
                    name: '🛒 Achats Boutique (Aujourd\'hui)',
                    value: shopPurchases.length > 0
                        ? shopPurchases.map(p => `${p.item_id}: ${p.qty}x`).join(', ')
                        : 'Aucun achat',
                    inline: true
                },
                {
                    name: '� Puits de Combat',
                    value: `Tirages: ${userData.total_tirages || 0}\nHistorique: ${puitsStats?.count || 0}`,
                    inline: true
                },
                {
                    name: '📅 Daily',
                    value: dailyStatus,
                    inline: true
                },
                {
                    name: '🎯 Quêtes Complétées',
                    value: `${questsCompleted?.count || 0} quêtes`,
                    inline: true
                },
                {
                    name: '📦 Coffres Ouverts (${period}h)',
                    value: `${chestGains} ouvert(s)`,
                    inline: true
                },
                {
                    name: '💰 Valeur Inventaire',
                    value: `~${inventoryValue.toLocaleString('fr-FR')} ⭐`,
                    inline: true
                }
            );

        // Inventaire items (limité)
        if (inventoryItems.length > 0) {
            statsEmbed.addFields({
                name: '🎒 Inventaire',
                value: inventoryItems.slice(0, 15).join(', ') + (inventoryItems.length > 15 ? ` ... (+${inventoryItems.length - 15})` : ''),
                inline: false
            });
        }

        // Alertes potentielles
        const alerts = [];

        // XP anormal
        if (totalXp > 50000 && period <= 1) {
            alerts.push(`⚠️ **+${totalXp.toLocaleString('fr-FR')} XP en 1h** - Progression très rapide !`);
        }
        if (totalXp > 200000 && period <= 24) {
            alerts.push(`🔥 **+${totalXp.toLocaleString('fr-FR')} XP en 24h** - Niveau anormalement élevé`);
        }

        // Puits de Combat progression
        if ((userData.total_tirages || 0) >= 25) {
            alerts.push(`🎰 **${userData.total_tirages} tirages** au Puits - Tier 4 atteint`);
        }

        // Stars anormales
        if (userData.stars > 10000000) {
            alerts.push(`💰 **${userData.stars.toLocaleString('fr-FR')} Stars** - Fortune suspecte`);
        }

        // Gains par source
        const vocalData = sourceBreakdown['vocal'];
        const coffreData = sourceBreakdown['coffre'];
        if (vocalData && vocalData.xp > totalXp * 0.8) {
            alerts.push(`📢 **${Math.round(vocalData.xp / totalXp * 100)}%** des gains viennent du vocal`);
        }
        if (coffreData && coffreData.xp > 30000) {
            alerts.push(`📦 **${coffreData.xp.toLocaleString('fr-FR')} XP** des coffres en ${period}h`);
        }

        // Streak anormale
        if (userData.streak > 100) {
            alerts.push(`🔥 **Streak de ${userData.streak} jours** - Vérifier authenticité`);
        }

        // Inventaire trop riche
        if (inventoryValue > 5000000) {
            alerts.push(`🎒 **Inventaire valorisé à ${inventoryValue.toLocaleString('fr-FR')} Stars**`);
        }

        // Niveau vs XP incohérent
        const expectedLevel = Math.floor(Math.sqrt(userData.xp / 50));
        if (Math.abs(userData.level - expectedLevel) > 10) {
            alerts.push(`📊 Niveau ${userData.level} vs ~${expectedLevel} attendu (décalage)`);
        }

        const embeds = [mainEmbed, boostsEmbed, historyEmbed, statsEmbed, recentEmbed];

        if (alerts.length > 0) {
            const alertEmbed = new EmbedBuilder()
                .setTitle('🚨 Alertes (' + alerts.length + ')')
                .setColor(0xFF0000)
                .setDescription(alerts.join('\n'));
            embeds.push(alertEmbed);
        }

        await interaction.editReply({ embeds: embeds });
    }
};
