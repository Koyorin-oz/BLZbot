/**
 * Système de vérification et attribution des rôles TOP
 * Vérifie périodiquement les classements et attribue/retire les rôles TOP
 */

const db = require('../database/database');
const { checkQuestProgress } = require('./quests');
const logger = require('./logger');
const roleConfig = require('../config/role.config.json');

let _warnedTopRoles50013 = false;

// Définition des rôles TOP par catégorie (sauf RP et streak)
const TOP_ROLES = roleConfig.topRoles;

// Couleurs par défaut pour les rôles TOP (or, argent, bronze)
const TOP_ROLE_COLORS = roleConfig.topRoleColors;

/**
 * Récupère le classement pour une catégorie donnée
 * @param {string} category - 'stars', 'level', 'counting', 'guild'
 * @returns {Array} - [{id, position}, ...]
 */
function getTopUsers(category) {
    let query = '';
    switch (category) {
        case 'stars':
            query = 'SELECT id, username FROM users ORDER BY stars DESC LIMIT 10';
            break;
        case 'level':
            query = 'SELECT id, username FROM users ORDER BY level DESC, xp DESC LIMIT 10';
            break;
        case 'counting':
            query = 'SELECT id, username FROM users ORDER BY points_comptage DESC LIMIT 10';
            break;
        case 'guild':
            // Pour les guildes, on retourne le chef des guildes top (basé sur leur level)
            query = `
                SELECT g.owner_id as id, u.username 
                FROM guilds g 
                LEFT JOIN users u ON g.owner_id = u.id 
                ORDER BY g.level DESC, g.treasury DESC 
                LIMIT 10
            `;
            break;
        default:
            return [];
    }

    try {
        const users = db.prepare(query).all();
        return users.map((user, index) => ({
            id: user.id,
            username: user.username,
            position: index + 1
        }));
    } catch (err) {
        logger.error(`Erreur lors de la récupération du top ${category}:`, err);
        return [];
    }
}

/**
 * Met à jour les rôles TOP pour une catégorie
 * @param {Guild} guild - L'objet Guild Discord
 * @param {Collection} members - Collection de tous les membres (pré-fetchée)
 * @param {string} category - 'stars', 'level', 'counting', 'guild'
 */
async function updateTopRolesForCategory(guild, members, category) {
    try {
        const topUsers = getTopUsers(category);
        const rolesConfig = TOP_ROLES[category];
        if (!rolesConfig) return;

        // Récupérer ou créer les rôles
        const roles = {};
        for (const [position, roleName] of Object.entries(rolesConfig)) {
            let role = guild.roles.cache.find(r => r.name === roleName);
            if (!role) {
                const normalize = (str) => str.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
                role = guild.roles.cache.find(r => normalize(r.name) === normalize(roleName));
            }
            if (!role) {
                try {
                    role = await guild.roles.create({
                        name: roleName,
                        color: TOP_ROLE_COLORS[position] || '#808080',
                        reason: `Création automatique du rôle TOP ${category}`
                    });
                    logger.info(`[TOP-ROLES] Rôle créé: ${roleName}`);
                } catch (createErr) {
                    logger.error(`[TOP-ROLES] Impossible de créer le rôle ${roleName}:`, createErr.message);
                    continue;
                }
            }
            roles[position] = role;
        }

        // Utiliser la collection pré-fetchée pour vérifier les rôles (0 appels gateway)
        for (const [memberId, member] of members) {
            const userTopEntry = topUsers.find(u => u.id === memberId);

            for (const [position, role] of Object.entries(roles)) {
                const posNum = parseInt(position);
                const shouldHaveRole = userTopEntry && userTopEntry.position <= posNum;
                const hasRole = member.roles.cache.has(role.id);

                try {
                    if (shouldHaveRole && !hasRole) {
                        await member.roles.add(role);
                        logger.info(`[TOP-ROLES] Ajouté ${role.name} à ${member.user.tag} (Position ${userTopEntry.position})`);
                    } else if (!shouldHaveRole && hasRole) {
                        await member.roles.remove(role);
                        logger.info(`[TOP-ROLES] Retiré ${role.name} de ${member.user.tag}`);
                    }
                } catch (err) {
                    if (err.code === 50013) {
                        if (!_warnedTopRoles50013) {
                            _warnedTopRoles50013 = true;
                            logger.warn(
                                '[TOP-ROLES] Permissions insuffisantes (50013) — place le rôle du bot au-dessus des rôles TOP.'
                            );
                        }
                    } else {
                        logger.error(`[TOP-ROLES] Erreur de modification de rôle pour ${member.user.tag}:`, err.message);
                    }
                }
            }
        }

        logger.info(`[TOP-ROLES] Catégorie ${category} mise à jour.`);
    } catch (err) {
        logger.error(`[TOP-ROLES] Erreur lors de la mise à jour des rôles ${category}:`, err);
    }
}

/**
 * Vérifie les quêtes TOP pour tous les utilisateurs dans le top 10
 * @param {Client} client - Client Discord
 */
async function checkTopQuests(client) {
    try {
        let isTopQuestsActive = false;
        try {
            const topQuestState = db.prepare('SELECT value FROM bot_settings WHERE key = ?').get('top_quests_enabled');
            isTopQuestsActive = topQuestState && topQuestState.value === '1';
        } catch (err) {
            // Table ou clé inexistante
        }

        if (!isTopQuestsActive) return;

        const topLevel = getTopUsers('level');
        for (const user of topLevel) {
            await checkQuestProgress(client, 'TOP_RANK_CHECK', { id: user.id, username: user.username }, user.position);
        }

        const topCounting = getTopUsers('counting');
        for (const user of topCounting) {
            await checkQuestProgress(client, 'TOP_PC_CHECK', { id: user.id, username: user.username }, user.position);
        }

        logger.info('[TOP-ROLES] Vérification des quêtes TOP terminée');
    } catch (err) {
        logger.error('[TOP-ROLES] Erreur lors de la vérification des quêtes TOP:', err);
    }
}

/**
 * Met à jour tous les rôles TOP et vérifie les quêtes
 * UN SEUL fetch de tous les membres, réutilisé pour toutes les catégories
 * @param {Client} client - Client Discord
 */
async function updateAllTopRoles(client) {
    logger.info('[TOP-ROLES] Début de la mise à jour des rôles TOP...');

    try {
        const guild = await client.guilds.fetch(process.env.GUILD_ID);
        if (!guild) {
            logger.error(`[TOP-ROLES] Guild ${process.env.GUILD_ID} introuvable`);
            return;
        }

        // OPTIMISATION: Au lieu de fetch TOUS les membres (Opcode 8 rate limit),
        // on ne fetch que ceux qui sont dans les tops.

        const categories = ['stars', 'level', 'counting', 'guild'];
        const allTopUserIds = new Set();

        // 1. Récupérer tous les IDs concernés
        for (const cat of categories) {
            const users = getTopUsers(cat);
            users.forEach(u => allTopUserIds.add(u.id));
        }

        logger.info(`[TOP-ROLES] ${allTopUserIds.size} utilisateurs uniques à vérifier.`);

        // 2. Fetcher uniquement ces membres proprement
        // On construit une map {id: member} pour passer à updateTopRolesForCategory
        const relevantMembers = new Map();

        for (const userId of allTopUserIds) {
            try {
                const member = await guild.members.fetch(userId).catch(() => null);
                if (member) {
                    relevantMembers.set(userId, member);
                }
            } catch (e) {
                // Ignore missing members
            }
        }

        logger.info(`[TOP-ROLES] ${relevantMembers.size} membres trouvés sur Discord.`);

        // 3. Mettre à jour les rôles
        await updateTopRolesForCategory(guild, relevantMembers, 'stars');
        await updateTopRolesForCategory(guild, relevantMembers, 'level');
        await updateTopRolesForCategory(guild, relevantMembers, 'counting');
        await updateTopRolesForCategory(guild, relevantMembers, 'guild');

        await checkTopQuests(client);
    } catch (err) {
        if (err.code === 10004) {
            logger.warn(
                `[TOP-ROLES] Ignoré — GUILD_ID=${process.env.GUILD_ID} inconnu pour ce bot (Unknown Guild).`
            );
        } else {
            logger.error('[TOP-ROLES] Erreur:', err.message || err);
        }
    }

    logger.info('[TOP-ROLES] Mise à jour des rôles TOP terminée');
}

/**
 * Récupère le meilleur rang TOP d'un utilisateur parmi toutes les catégories
 * @param {string} userId - ID de l'utilisateur
 * @returns {object|null} - {position: 1/5/10, category: 'stars'|'level'|'counting'|'guild'} ou null
 */
function getBestTopRank(userId) {
    const categories = ['stars', 'level', 'counting', 'guild'];
    let bestRank = null;

    for (const category of categories) {
        const topUsers = getTopUsers(category);
        const userEntry = topUsers.find(u => u.id === userId);

        if (userEntry) {
            // Déterminer le niveau TOP (1, 5, ou 10)
            let topLevel = null;
            if (userEntry.position === 1) topLevel = 1;
            else if (userEntry.position <= 5) topLevel = 5;
            else if (userEntry.position <= 10) topLevel = 10;

            if (topLevel) {
                // Comparer avec le meilleur rang actuel (plus petit = meilleur)
                if (!bestRank || topLevel < bestRank.position) {
                    bestRank = { position: topLevel, category: category, exactPosition: userEntry.position };
                }
            }
        }
    }

    return bestRank;
}

module.exports = {
    updateAllTopRoles,
    updateTopRolesForCategory,
    checkTopQuests,
    getTopUsers,
    getBestTopRank,
    TOP_ROLES
};

