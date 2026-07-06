const db = require('../../database/database');
const logger = require('../logger');
const { PermissionFlagsBits } = require('discord.js');
const { GUILD_RANKS } = require('../db-guilds');

/**
 * Matrice de progression des upgrades de guilde
 * Les seuils de valeur remplacent le concept de niveau de guilde.
 * guild_value = seuil de valeur totale de la guilde requis pour cet upgrade
 */
const UPGRADE_MATRIX = {
    1: {
        level: 1,
        requirements: { guild_value: 0, treasury: 0, wars_won: 0, wars_won_percentage: 0, item: null },
        cost: { stars: 0, item: null },
        unlocks: ['Base guild'],
        slots_gained: 0, // 5 places de base
        treasury_capacity: 0
    },
    2: {
        level: 2,
        requirements: { guild_value: 15000, treasury: 0, wars_won: 0, wars_won_percentage: 0, item: null },
        cost: { stars: 175000, item: null },
        unlocks: ['Trésorerie', '+1 place'], // Total 6
        slots_gained: 1,
        treasury_capacity: 750000
    },
    3: {
        level: 3,
        requirements: { guild_value: 30000, treasury: 500000, wars_won: 0, wars_won_percentage: 0, item: null },
        cost: { stars: 500000, item: null },
        unlocks: ['+1 place'], // Total 7
        slots_gained: 1,
        treasury_capacity: 1500000
    },
    4: {
        level: 4,
        requirements: { guild_value: 60000, treasury: 1250000, wars_won: 0, wars_won_percentage: 0, item: null },
        cost: { stars: 1000000, item: null },
        unlocks: ['Guilds Tools', '+1 place'], // Total 8
        slots_gained: 1,
        treasury_capacity: 3500000
    },
    5: {
        level: 5,
        requirements: { guild_value: 90000, treasury: 2500000, wars_won: 0, wars_won_percentage: 0, item: null },
        cost: { stars: 2500000, item: null },
        unlocks: ['Salon de guilde privé', '+0 place'], // Total 8
        slots_gained: 0,
        treasury_capacity: 7500000
    },
    6: {
        level: 6,
        requirements: { guild_value: 120000, treasury: 5000000, wars_won: 0, wars_won_percentage: 0, item: null },
        cost: { stars: 5000000, item: null },
        unlocks: ['Guerre de guildes', '+0 place'], // Total 8
        slots_gained: 0,
        treasury_capacity: 10000000
    },
    7: {
        level: 7,
        requirements: { guild_value: 150000, treasury: 0, wars_won: 1, wars_won_percentage: 0, item: null },
        cost: { stars: 7500000, item: null },
        unlocks: ['Rôles Personnalisés', '+1 place'], // Total 9
        slots_gained: 1,
        treasury_capacity: 12500000
    },
    8: {
        level: 8,
        requirements: { guild_value: 180000, treasury: 0, wars_won: 0, wars_won_percentage: 70, item: 'mega_boost' },
        cost: { stars: 10000000, item: 'mega_boost' },
        unlocks: ['Nouveaux Guilds Tools', '+1 place'], // Total 10
        slots_gained: 1,
        treasury_capacity: 15000000
    },
    9: {
        level: 9,
        requirements: { guild_value: 240000, treasury: 0, wars_won: 0, wars_won_percentage: 80, item: 'mega_boost' },
        cost: { stars: 12500000, item: 'mega_boost' },
        unlocks: ['+0 place'], // Total 10
        slots_gained: 0,
        treasury_capacity: 15000000
    },
    10: {
        level: 10,
        requirements: { guild_value: 300000, treasury: 0, wars_won: 0, wars_won_percentage: 80, item: 'guild_upgrader' },
        cost: { stars: 15000000, item: 'guild_upgrader', mega_boost: 2 },
        unlocks: ['+1 place'], // Total 11 (+ jusqu'à 4 places achetables avec joker_guilde = max 15)
        slots_gained: 1,
        treasury_capacity: 15000000
    }
};

/**
 * Récupère les prérequis d'un upgrade
 */
function getUpgradeRequirements(upgradeLevel) {
    return UPGRADE_MATRIX[upgradeLevel] || null;
}

/**
 * Alias pour compatibilité avec l'ancien code
 */
function getUpgradeInfo(level) {
    const data = UPGRADE_MATRIX[level];
    if (!data) return null;

    return {
        guild_value: data.requirements.guild_value,
        cost: data.cost.stars,
        slots: data.slots_gained,
        treasury_capacity: data.treasury_capacity,
        treasury_req: data.requirements.treasury,
        wars_won_req: data.requirements.wars_won,
        wars_won_percent_req: data.requirements.wars_won_percentage,
        mega_boost_req: data.cost.item === 'mega_boost' ? 1 : (data.cost.mega_boost || 0),
        guild_upgrader_req: data.cost.item === 'guild_upgrader' ? 1 : 0
    };
}

/**
 * Vérifie si une guilde peut effectuer un upgrade
 * @param {Object} guild - La guilde
 * @param {number} nextLevel - Le niveau d'upgrade suivant
 * @param {Object} ownerInventory - L'inventaire du chef de guilde (avec quantités)
 * @returns {Object} { canUpgrade: boolean, missingRequirements: string[] }
 */
function canUpgrade(guild, nextLevel, ownerInventory) {
    const upgradeData = UPGRADE_MATRIX[nextLevel];
    if (!upgradeData) {
        return { canUpgrade: false, missingRequirements: ['Upgrade invalide'] };
    }

    const missing = [];
    const req = upgradeData.requirements;

    // Vérifier la valeur de guilde
    if (req.guild_value > 0) {
        const { calculateGuildValue } = require('../trophy-value-system');
        const guildValue = calculateGuildValue(guild.id);
        if (guildValue < req.guild_value) {
            missing.push(`Valeur de guilde ${req.guild_value.toLocaleString('fr-FR')} requise (actuellement ${guildValue.toLocaleString('fr-FR')})`);
        }
    }

    // Vérifier la trésorerie
    if (req.treasury > 0 && guild.treasury < req.treasury) {
        missing.push(`${req.treasury.toLocaleString('fr-FR')} starss en trésorerie requis`);
    }

    // Vérifier les starss du chef pour U2 (trésorerie pas encore débloquée)
    if (nextLevel === 2) {
        const { getOrCreateUser } = require('../db-users');
        const owner = getOrCreateUser(guild.owner_id, 'unknown');
        if (owner.stars < upgradeData.cost.stars) {
            missing.push(`${upgradeData.cost.stars.toLocaleString('fr-FR')} starss requis dans l'inventaire du chef (actuellement ${owner.stars.toLocaleString('fr-FR')})`);
        }
    }

    // Vérifier les guerres gagnées
    if (req.wars_won > 0 && guild.wars_won < req.wars_won) {
        missing.push(`${req.wars_won} guerre(s) gagnée(s) requise(s)`);
    }

    // Vérifier les guerres gagnées avec pourcentage
    if (req.wars_won_percentage === 70 && guild.wars_won_70 < 1) {
        missing.push('1 guerre gagnée à 70%+ requise');
    }
    if (req.wars_won_percentage === 80 && guild.wars_won_80 < 1) {
        missing.push('1 guerre gagnée à 80%+ requise');
    }
    if (req.wars_won_percentage === 90 && guild.wars_won_90 < 1) {
        missing.push('1 guerre gagnée à 90%+ requise');
    }

    // Vérifier les items requis
    const cost = upgradeData.cost;

    // Vérifier le coût en starss
    if (cost.stars > 0 && nextLevel !== 2) {
        // Pour les upgrades après U2, vérifier la trésorerie
        if (guild.treasury < cost.stars) {
            missing.push(`${cost.stars.toLocaleString('fr-FR')} starss en trésorerie requis pour l'achat`);
        }
    }
    // Note: Pour U2, la vérification des starss du chef est déjà faite plus haut

    // Vérifier l'item principal requis
    if (cost.item) {
        const itemInInventory = ownerInventory.find(i => i.item_id === cost.item);
        if (!itemInInventory || itemInInventory.quantity < 1) {
            const itemName = cost.item === 'mega_boost' ? 'MEGA BOOST' : cost.item === 'guild_upgrader' ? 'Guild Upgrader' : cost.item;
            missing.push(`${itemName} requis dans l'inventaire du chef`);
        }
    }

    // Vérifier les mega boosts additionnels (Upgrade 10)
    if (cost.mega_boost && cost.mega_boost > 0) {
        const megaBoostInInventory = ownerInventory.find(i => i.item_id === 'mega_boost');
        if (!megaBoostInInventory || megaBoostInInventory.quantity < cost.mega_boost) {
            missing.push(`${cost.mega_boost} MEGA BOOST(s) supplémentaire(s) requis`);
        }
    }

    return {
        canUpgrade: missing.length === 0,
        missingRequirements: missing
    };
}

/**
 * Effectue un upgrade de guilde
 * @param {Object} client - Le client Discord
 * @param {Object} guild - La guilde
 * @param {string} ownerId - L'ID du chef de guilde
 * @param {Object} ownerInventory - L'inventaire du chef
 * @param {boolean} useUpgrader - Si true, utilise un guild_upgrader pour upgrade sans payer (mais avec les conditions)
 * @returns {Object} { success: boolean, message: string, newLevel: number }
 */
async function performUpgrade(client, guild, ownerId, ownerInventory, useUpgrader = false) {
    const nextLevel = guild.upgrade_level + 1;
    const upgradeData = UPGRADE_MATRIX[nextLevel];

    if (!upgradeData) {
        return { success: false, message: 'Niveau d\'upgrade maximum atteint !', newLevel: guild.upgrade_level };
    }

    // Si guild_upgrader utilisé, vérifier qu'il est dans l'inventaire
    if (useUpgrader) {
        const hasUpgrader = ownerInventory.some(inv => inv.item_id === 'guild_upgrader' && inv.quantity >= 1);
        if (!hasUpgrader) {
            return {
                success: false,
                message: '❌ Vous n\'avez pas de guild_upgrader dans votre inventaire.',
                newLevel: guild.upgrade_level
            };
        }
    }

    // Vérifier les prérequis (toujours vérifier les conditions)
    const checkResult = canUpgrade(guild, nextLevel, ownerInventory, false);
    if (!checkResult.canUpgrade) {
        return {
            success: false,
            message: `Prérequis manquants:\n${checkResult.missingRequirements.map(r => `• ${r}`).join('\n')}`,
            newLevel: guild.upgrade_level
        };
    }

    // Transaction pour effectuer l'upgrade
    const transaction = db.transaction(() => {
        // Si guild_upgrader utilisé, ne payer que les items (pas les starss)
        if (!useUpgrader) {
            // Déduire le coût en starss
            if (upgradeData.cost.stars > 0) {
                if (nextLevel === 2) {
                    // Pour U1 → U2, déduire des starss du chef (trésorerie pas encore débloquée)
                    db.prepare('UPDATE users SET stars = stars - ? WHERE id = ?').run(upgradeData.cost.stars, ownerId);
                } else {
                    // Pour les autres upgrades, déduire de la trésorerie
                    db.prepare('UPDATE guilds SET treasury = treasury - ? WHERE id = ?').run(upgradeData.cost.stars, guild.id);
                }
            }
        }

        // Supprimer les items de l'inventaire du chef (toujours requis)
        if (upgradeData.cost.item) {
            db.prepare('UPDATE user_inventory SET quantity = quantity - 1 WHERE user_id = ? AND item_id = ?')
                .run(ownerId, upgradeData.cost.item);
            db.prepare('DELETE FROM user_inventory WHERE quantity <= 0').run();
        }

        // Supprimer les mega boosts additionnels (toujours requis)
        if (upgradeData.cost.mega_boost && upgradeData.cost.mega_boost > 0) {
            db.prepare('UPDATE user_inventory SET quantity = quantity - ? WHERE user_id = ? AND item_id = ?')
                .run(upgradeData.cost.mega_boost, ownerId, 'mega_boost');
            db.prepare('DELETE FROM user_inventory WHERE quantity <= 0').run();
        }

        // Si guild_upgrader utilisé, le consommer
        if (useUpgrader) {
            db.prepare('UPDATE user_inventory SET quantity = quantity - 1 WHERE user_id = ? AND item_id = ?')
                .run(ownerId, 'guild_upgrader');
            db.prepare('DELETE FROM user_inventory WHERE quantity <= 0').run();
            logger.info(`Guild Upgrader utilisé pour la guilde ${guild.name} (upgrade sans payer)`);
        }

        // Mettre à jour le niveau d'upgrade et les places
        const newSlots = guild.member_slots + upgradeData.slots_gained;
        const newCapacity = upgradeData.treasury_capacity;

        db.prepare('UPDATE guilds SET upgrade_level = ?, member_slots = ?, treasury_capacity = ? WHERE id = ?')
            .run(nextLevel, newSlots, newCapacity, guild.id);

        logger.info(`Guilde ${guild.name} (${guild.id}) a atteint l'upgrade ${nextLevel}`);
    });

    try {
        transaction();

        // Déblocages spéciaux
        await handleUpgradeUnlocks(client, guild, nextLevel);

        return {
            success: true,
            message: `🎉 Upgrade ${nextLevel} réussi !\n\n**Déblocages:**\n${upgradeData.unlocks.map(u => `• ${u}`).join('\n')}`,
            newLevel: nextLevel
        };
    } catch (error) {
        logger.error('Erreur lors de l\'upgrade de guilde:', error);
        return {
            success: false,
            message: 'Une erreur est survenue lors de l\'upgrade.',
            newLevel: guild.upgrade_level
        };
    }
}

/**
 * Gère les déblocages spéciaux après un upgrade
 */
async function handleUpgradeUnlocks(client, guild, upgradeLevel) {
    try {
        // Upgrade 5: Créer le salon privé de guilde
        if (upgradeLevel === 5) {
            await createGuildPrivateChannel(client, guild);
        }

        // Marquer la quête d'upgrade comme complétée (sera gérée par guild-quests.js)
        logger.info(`Déblocages de l'upgrade ${upgradeLevel} appliqués pour la guilde ${guild.name}`);
    } catch (error) {
        logger.error('Erreur lors des déblocages d\'upgrade:', error);
    }
}

/**
 * Crée un salon privé pour la guilde (Upgrade 5)
 */
async function createGuildPrivateChannel(client, guild) {
    try {
        const guildChannelCategoryId = process.env.GUILD_CATEGORY;
        if (!guildChannelCategoryId) {
            logger.warn('Variable GUILD_CATEGORY non définie, impossible de créer le salon de guilde');
            return;
        }

        // Récupérer le serveur Discord (le premier serveur où le bot est)
        const discordGuild = client.guilds.cache.first();
        if (!discordGuild) {
            logger.error('❌ Aucun serveur Discord trouvé');
            throw new Error('Le bot n\'est connecté à aucun serveur Discord');
        }

        // Récupérer la catégorie depuis le serveur
        const category = discordGuild.channels.cache.get(guildChannelCategoryId);
        if (!category || category.type !== 4) { // 4 = GUILD_CATEGORY
            logger.error(`❌ Catégorie GUILD_CATEGORY introuvable ou invalide (ID: ${guildChannelCategoryId}). Vérifiez votre fichier .env`);
            throw new Error(`La catégorie GUILD_CATEGORY (${guildChannelCategoryId}) n'existe pas ou n'est pas une catégorie valide sur le serveur ${discordGuild.name}.`);
        }

        // Formater le nom du salon: 『{emoji}』{nom-guilde} (espaces → ・)
        const guildName = guild.name.replace(/\s+/g, '・'); // Remplacer espaces par ・
        const channelName = `『${guild.emoji}』${guildName}`;

        // Récupérer tous les membres de la guilde
        const guildMembers = db.prepare('SELECT user_id FROM guild_members WHERE guild_id = ?').all(guild.id);
        const memberIds = guildMembers.map(m => m.user_id);

        // Créer les permissions: seuls les membres de la guilde peuvent voir/écrire
        const permissionOverwrites = [
            {
                id: discordGuild.id, // @everyone
                deny: [PermissionFlagsBits.ViewChannel]
            }
        ];

        // Ajouter chaque membre avec permissions
        for (const memberId of memberIds) {
            // Vérifier que le membre existe sur le serveur Discord
            try {
                await discordGuild.members.fetch(memberId);
                const permissions = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory];

                // Le chef de guilde peut supprimer et épingler des messages
                if (memberId === guild.owner_id) {
                    permissions.push(PermissionFlagsBits.ManageMessages);
                }

                permissionOverwrites.push({
                    id: memberId,
                    allow: permissions
                });
            } catch (error) {
                logger.warn(`Membre ${memberId} introuvable sur le serveur, permissions non ajoutées`);
            }
        }

        // Créer le salon
        const newChannel = await discordGuild.channels.create({
            name: channelName,
            type: 0, // GUILD_TEXT
            parent: guildChannelCategoryId,
            permissionOverwrites: permissionOverwrites
        });

        // Stocker l'ID du salon dans la DB
        db.prepare('UPDATE guilds SET channel_id = ? WHERE id = ?').run(newChannel.id, guild.id);

        // Créer le Dashboard avec ContainerBuilder
        const { ContainerBuilder, TextDisplayBuilder, SectionBuilder, MessageFlags } = require('discord.js');

        const container = new ContainerBuilder();

        // Header
        const headerText = new TextDisplayBuilder()
            .setContent(`# 🏰 QG de ${guild.emoji} ${guild.name}\n*Bienvenue dans votre espace privé. Ici, vous préparez vos guerres et gérez votre empire.*`);

        container.addTextDisplayComponents(headerText);

        // Stats Section
        const statsSection = new SectionBuilder()
            .addTextDisplayComponents(
                new TextDisplayBuilder().setContent(`### 📊 Statistiques\n**Niveau:** ${guild.level} | **Membres:** ${guildMembers.length}/${guild.member_slots}\n**Trésorerie:** ${guild.treasury.toLocaleString('fr-FR')} ⭐`)
            );

        container.addSectionComponents(statsSection);

        // Info Section
        const infoSection = new SectionBuilder()
            .addTextDisplayComponents(
                new TextDisplayBuilder().setContent(`### ℹ️ Informations\nCe message sera mis à jour automatiquement avec les dernières infos de guerre et de quêtes.`)
            );

        container.addSectionComponents(infoSection);

        // Envoyer le Dashboard et l'épingler
        const dashboardMsg = await newChannel.send({
            components: [container],
            flags: MessageFlags.IsComponentsV2
        });

        await dashboardMsg.pin().catch(e => logger.warn('Impossible d\'épingler le dashboard', e));

        logger.info(`Salon privé créé pour la guilde ${guild.name}: ${newChannel.id}`);
    } catch (error) {
        logger.error('Erreur lors de la création du salon privé de guilde:', error);
    }
}

/**
 * Met à jour les permissions d'un salon de guilde quand un membre rejoint/quitte
 */
async function updateGuildChannelPermissions(client, guild, userId, action = 'add') {
    try {
        if (!guild.channel_id) return;

        const channel = await client.channels.fetch(guild.channel_id).catch(() => null);
        if (!channel) {
            logger.warn(`Salon de guilde ${guild.channel_id} introuvable`);
            return;
        }

        if (action === 'add') {
            const permissions = {
                ViewChannel: true,
                SendMessages: true,
                ReadMessageHistory: true
            };

            // Le chef de guilde peut supprimer et épingler des messages
            if (userId === guild.owner_id) {
                permissions.ManageMessages = true;
            }

            await channel.permissionOverwrites.create(userId, permissions);
            logger.info(`Permissions ajoutées pour ${userId} dans le salon de ${guild.name}`);
        } else if (action === 'remove') {
            await channel.permissionOverwrites.delete(userId);
            logger.info(`Permissions retirées pour ${userId} du salon de ${guild.name}`);
        }
    } catch (error) {
        logger.error('Erreur lors de la mise à jour des permissions du salon de guilde:', error);
    }
}

/**
 * Ajoute une place à une guilde en utilisant un joker_guilde
 * @param {string} guildId - L'ID de la guilde
 * @param {string} userId - L'ID de l'utilisateur (chef ou sous-chef)
 * @returns {Object} { success: boolean, message: string, newSlots: number }
 */
function addGuildSlotWithJoker(guildId, userId) {
    const { getGuildById, getGuildMember } = require('../db-guilds');
    const { getOrCreateUser } = require('../db-users');

    // Vérifier que la guilde existe
    const guild = getGuildById(guildId);
    if (!guild) {
        return { success: false, message: '❌ Guilde non trouvée.', newSlots: 0 };
    }

    // Vérifier que l'utilisateur est chef ou sous-chef
    const member = getGuildMember(guildId, userId);
    if (!member || (member.rank !== GUILD_RANKS.CHEF && member.rank !== GUILD_RANKS.SOUS_CHEF)) {
        return { success: false, message: '❌ Seul le chef ou un sous-chef peut utiliser un joker_guilde.', newSlots: 0 };
    }

    // Vérifier la limite de places (max avec jokers)
    const { MAX_MEMBERS_WITH_JOKERS } = require('./guild-overstaffing');
    if (guild.member_slots >= MAX_MEMBERS_WITH_JOKERS) {
        return { success: false, message: `❌ Votre guilde a déjà atteint le maximum de ${MAX_MEMBERS_WITH_JOKERS} places.`, newSlots: guild.member_slots };
    }

    // Vérifier que l'utilisateur possède un joker_guilde
    const userInventory = db.prepare('SELECT * FROM user_inventory WHERE user_id = ? AND item_id = ?').all(userId, 'joker_guilde');
    const hasJoker = userInventory.some(inv => inv.item_id === 'joker_guilde' && inv.quantity >= 1);

    if (!hasJoker) {
        return { success: false, message: '❌ Vous n\'avez pas de joker_guilde dans votre inventaire.', newSlots: 0 };
    }

    // Transaction pour ajouter la place
    const transaction = db.transaction(() => {
        // Consommer le joker
        db.prepare('UPDATE user_inventory SET quantity = quantity - 1 WHERE user_id = ? AND item_id = ?')
            .run(userId, 'joker_guilde');
        db.prepare('DELETE FROM user_inventory WHERE quantity <= 0').run();

        // Ajouter une place
        db.prepare('UPDATE guilds SET member_slots = member_slots + 1 WHERE id = ?').run(guildId);

        // Incrémenter le compteur de jokers utilisés
        db.prepare('UPDATE guilds SET joker_guilde_uses = COALESCE(joker_guilde_uses, 0) + 1 WHERE id = ?').run(guildId);

        logger.info(`Joker_guilde utilisé par ${userId} pour ajouter une place à la guilde ${guild.name}`);
    });

    try {
        transaction();
        return {
            success: true,
            message: `✅ Place ajoutée ! Votre guilde a maintenant **${guild.member_slots + 1}** places.`,
            newSlots: guild.member_slots + 1
        };
    } catch (error) {
        logger.error('Erreur lors de l\'ajout d\'une place avec joker:', error);
        return { success: false, message: '❌ Erreur lors de l\'ajout de la place.', newSlots: 0 };
    }
}

/**
 * Met à jour le nom du salon privé de guilde
 */
async function updateGuildPrivateChannelName(client, guild, newName, newEmoji) {
    try {
        if (!guild.channel_id) return;

        const channel = await client.channels.fetch(guild.channel_id).catch(() => null);
        if (!channel) {
            logger.warn(`Salon de guilde ${guild.channel_id} introuvable pour renommage`);
            return;
        }

        // Formater le nom du salon: 『{emoji}』{nom-guilde} (espaces → ・)
        const formattedName = newName.replace(/\s+/g, '・');
        const channelName = `『${newEmoji}』${formattedName}`;

        await channel.setName(channelName);
        logger.info(`Salon de guilde renommé en: ${channelName}`);
    } catch (error) {
        logger.error('Erreur lors du renommage du salon de guilde:', error);
    }
}

module.exports = {
    UPGRADE_MATRIX,
    getUpgradeRequirements,
    getUpgradeInfo, // Alias pour compatibilité
    canUpgrade,
    performUpgrade,
    handleUpgradeUnlocks,
    createGuildPrivateChannel,
    updateGuildChannelPermissions,
    addGuildSlotWithJoker,
    updateGuildPrivateChannelName
};
