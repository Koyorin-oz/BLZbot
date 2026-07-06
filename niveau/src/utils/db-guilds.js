const db = require('../database/database');
const logger = require('./logger');

// Constantes pour les rangs de guilde - À utiliser partout pour éviter les incohérences
const GUILD_RANKS = {
    CHEF: 'chef',
    SOUS_CHEF: 'sous-chef',
    MEMBRE: 'membre'
};

/**
 * Parse le champ sub_chiefs (et maintenant custom_roles_config) de manière sécurisée
 * Gère les cas où c'est déjà un tableau ou une chaîne JSON
 */
function safeJSONParse(data, defaultValue = []) {
    if (typeof data === 'object' && data !== null) return data;
    if (!data) return defaultValue;
    try {
        return JSON.parse(data);
    } catch (e) {
        // logger.error('Erreur parsing JSON:', e); // Silence logs for routine operations
        return defaultValue;
    }
}

function parseSubChiefs(subChiefs) {
    return safeJSONParse(subChiefs, []);
}

function parseCustomRoles(config) {
    return safeJSONParse(config, []);
}

// --- Requêtes Préparées ---
const getGuildOfUserStmt = db.prepare(`
    SELECT g.* FROM guilds g
    JOIN guild_members gm ON g.id = gm.guild_id
    WHERE gm.user_id = ?
`);
const getGuildByNameStmt = db.prepare('SELECT * FROM guilds WHERE name = ?');
const createGuildStmt = db.prepare('INSERT INTO guilds (name, owner_id, emoji, created_at) VALUES (?, ?, ?, ?)');
const addMemberToGuildStmt = db.prepare('INSERT INTO guild_members (user_id, guild_id) VALUES (?, ?)');
const getGuildMembersStmt = db.prepare('SELECT user_id FROM guild_members WHERE guild_id = ?');
const getMemberLevelsStmt = db.prepare('SELECT level FROM users WHERE id = ?');
const updateGuildLevelStmt = db.prepare('UPDATE guilds SET level = ? WHERE id = ?');
const createInvitationStmt = db.prepare('INSERT INTO guild_invitations (guild_id, target_user_id, inviter_user_id, timestamp) VALUES (?, ?, ?, ?)');
const getRecentUserInvitesStmt = db.prepare('SELECT timestamp FROM guild_invitations WHERE target_user_id = ? ORDER BY timestamp DESC LIMIT 1');
const getRecentInviterInvitesStmt = db.prepare('SELECT timestamp FROM guild_invitations WHERE inviter_user_id = ?');
const getGuildMemberCountStmt = db.prepare('SELECT COUNT(user_id) as count FROM guild_members WHERE guild_id = ?');
const getAllGuildsStmt = db.prepare('SELECT * FROM guilds ORDER BY level DESC');
const removeMemberFromGuildStmt = db.prepare('DELETE FROM guild_members WHERE user_id = ?');
const getGuildMembersDetailsStmt = db.prepare(`
    SELECT u.id, u.username, u.level, IFNULL(u.total_value, 0) as total_value
    FROM users u
    JOIN guild_members gm ON u.id = gm.user_id
    WHERE gm.guild_id = ?
    ORDER BY u.total_value DESC
`);
const increaseGuildSlotsStmt = db.prepare('UPDATE guilds SET member_slots = member_slots + ? WHERE id = ?');
const addRefusalStmt = db.prepare('INSERT OR IGNORE INTO guild_application_refusals (guild_id, user_id) VALUES (?, ?)');
const checkRefusalStmt = db.prepare('SELECT 1 FROM guild_application_refusals WHERE guild_id = ? AND user_id = ?');
const updateGuildDetailsStmt = db.prepare('UPDATE guilds SET name = ?, emoji = ? WHERE id = ?');
const deleteGuildMembersStmt = db.prepare('DELETE FROM guild_members WHERE guild_id = ?');
const deleteGuildStmt = db.prepare('DELETE FROM guilds WHERE id = ?');
const changeGuildOwnerStmt = db.prepare('UPDATE guilds SET owner_id = ? WHERE id = ?');

// --- Custom Roles & Penalty Statements ---
const getGuildCustomRolesStmt = db.prepare('SELECT custom_roles_config FROM guilds WHERE id = ?');
const updateGuildCustomRolesStmt = db.prepare('UPDATE guilds SET custom_roles_config = ? WHERE id = ?');
const setMemberRoleStmt = db.prepare('UPDATE guild_members SET role_id = ? WHERE guild_id = ? AND user_id = ?');
const getMemberRoleStmt = db.prepare('SELECT role_id FROM guild_members WHERE guild_id = ? AND user_id = ?');
const updateLastPenaltyCheckStmt = db.prepare('UPDATE guilds SET last_penalty_check = ? WHERE id = ?');
const deductPenaltyStarsStmt = db.prepare('UPDATE users SET stars = MAX(0, stars - ?) WHERE id = ?');

// --- Fonctions ---

function getGuildOfUser(userId) {
    const guild = getGuildOfUserStmt.get(userId) || null;
    if (guild) {
        guild.sub_chiefs = parseSubChiefs(guild.sub_chiefs);
    }
    return guild;
}

function getGuildByName(name) {
    const guild = getGuildByNameStmt.get(name) || null;
    if (guild) {
        guild.sub_chiefs = parseSubChiefs(guild.sub_chiefs);
    }
    return guild;
}

function createGuild(name, ownerId, emoji) {
    const result = createGuildStmt.run(name, ownerId, emoji, Date.now());
    logger.info(`Guilde "${name}" créée par ${ownerId} avec l'émoji ${emoji}.`);
    return result.lastInsertRowid;
}

function addMemberToGuild(userId, guildId) {
    addMemberToGuildStmt.run(userId, guildId);
    logger.info(`Membre ${userId} ajouté à la guilde ${guildId}.`);
}

function updateGuildLevel(guildId) {
    const members = getGuildMembersStmt.all(guildId);
    if (!members || members.length === 0) {
        updateGuildLevelStmt.run(0, guildId);
        return;
    }
    let totalLevel = 0;
    for (const member of members) {
        const user = getMemberLevelsStmt.get(member.user_id);
        if (user) {
            totalLevel += user.level;
        }
    }
    updateGuildLevelStmt.run(totalLevel, guildId);
    logger.info(`Niveau de la guilde ${guildId} mis à jour : ${totalLevel}`);
}

function createInvitation(guildId, targetUserId, inviterUserId) {
    const result = createInvitationStmt.run(guildId, targetUserId, inviterUserId, Date.now());
    logger.info(`Invitation créée pour ${targetUserId} par ${inviterUserId} pour la guilde ${guildId}.`);
    return result.lastInsertRowid;
}

function getLatestInviteForUser(targetUserId) {
    return getRecentUserInvitesStmt.get(targetUserId) || null;
}

function getRecentInvitesByInviter(inviterUserId) {
    const oneHourAgo = Date.now() - (60 * 60 * 1000);
    return getRecentInviterInvitesStmt.all(inviterUserId).filter(inv => inv.timestamp > oneHourAgo);
}

function getGuildMemberCount(guildId) {
    return getGuildMemberCountStmt.get(guildId).count;
}

function getAllGuilds() {
    return getAllGuildsStmt.all();
}

function removeMemberFromGuild(userId) {
    const guild = getGuildOfUser(userId);
    removeMemberFromGuildStmt.run(userId);

    if (guild) {
        removeGuildSubChief(guild.id, userId);
    }
    logger.info(`Membre ${userId} retiré d'une guilde.`);
}

const getGuildByIdStmt = db.prepare('SELECT * FROM guilds WHERE id = ?');

function getGuildMembersWithDetails(guildId) {
    const guild = getGuildByIdStmt.get(guildId);
    if (!guild) return [];

    const subChiefs = parseSubChiefs(guild.sub_chiefs);
    const members = getGuildMembersDetailsStmt.all(guildId);

    return members.map(member => {
        let role = GUILD_RANKS.MEMBRE;
        if (member.id === guild.owner_id) {
            role = GUILD_RANKS.CHEF;
        } else if (subChiefs.includes(member.id)) {
            role = GUILD_RANKS.SOUS_CHEF;
        }
        return { ...member, role };
    });
}

function addGuildSubChief(guildId, userId) {
    const guild = getGuildByIdStmt.get(guildId);
    if (!guild) return false;

    let subChiefs = parseSubChiefs(guild.sub_chiefs);
    if (!subChiefs.includes(userId)) {
        subChiefs.push(userId);
        db.prepare('UPDATE guilds SET sub_chiefs = ? WHERE id = ?').run(JSON.stringify(subChiefs), guildId);
        logger.info(`User ${userId} ajouté comme ${GUILD_RANKS.SOUS_CHEF} à la guilde ${guildId}.`);
        return true;
    }
    return false;
}

function removeGuildSubChief(guildId, userId) {
    const guild = getGuildByIdStmt.get(guildId);
    if (!guild) return false;

    let subChiefs = parseSubChiefs(guild.sub_chiefs);
    const initialLength = subChiefs.length;
    subChiefs = subChiefs.filter(id => id !== userId);

    if (subChiefs.length < initialLength) {
        db.prepare('UPDATE guilds SET sub_chiefs = ? WHERE id = ?').run(JSON.stringify(subChiefs), guildId);
        logger.info(`User ${userId} retiré comme ${GUILD_RANKS.SOUS_CHEF} de la guilde ${guildId}.`);
        return true;
    }
    return false;
}

function updateGuildOwnerAndSubChiefs(guildId, newOwnerId, newSubChiefs) {
    const currentGuild = getGuildByIdStmt.get(guildId);
    if (!currentGuild) return false;

    const oldOwnerId = currentGuild.owner_id;

    // S'assurer que newSubChiefs est un tableau
    let updatedSubChiefs = Array.isArray(newSubChiefs) ? [...newSubChiefs] : parseSubChiefs(newSubChiefs);

    // IMPORTANT: Retirer le nouveau propriétaire des sous-chefs s'il y était (éviter les doublons)
    updatedSubChiefs = updatedSubChiefs.filter(id => id !== newOwnerId);

    // Si l'ancien propriétaire n'est pas le nouveau et n'est pas déjà sous-chef, l'ajouter comme sous-chef
    if (oldOwnerId !== newOwnerId && !updatedSubChiefs.includes(oldOwnerId)) {
        updatedSubChiefs.push(oldOwnerId);
    }

    db.prepare('UPDATE guilds SET owner_id = ?, sub_chiefs = ? WHERE id = ?').run(newOwnerId, JSON.stringify(updatedSubChiefs), guildId);
    logger.info(`Guilde ${guildId}: propriétaire changé de ${oldOwnerId} vers ${newOwnerId}. Sous-chefs: [${updatedSubChiefs.join(', ')}]`);
    return true;
}

function increaseGuildSlots(guildId, amount) {
    increaseGuildSlotsStmt.run(amount, guildId);
    logger.info(`Places de guilde augmentées de ${amount} pour la guilde ${guildId}.`);
}

function addGuildApplicationRefusal(guildId, userId) {
    addRefusalStmt.run(guildId, userId);
    logger.info(`User ${userId} has been marked as refused for guild ${guildId}.`);
}

function hasBeenRefusedByGuild(guildId, userId) {
    const result = checkRefusalStmt.get(guildId, userId);
    return !!result;
}

function updateGuildDetails(guildId, newName, newEmoji) {
    updateGuildDetailsStmt.run(newName, newEmoji, guildId);
    logger.info(`Les détails de la guilde ${guildId} ont été mis à jour : Nom=${newName}, Emoji=${newEmoji}`);
}

const dissolveGuildTransaction = db.transaction((guildId) => {
    deleteGuildMembersStmt.run(guildId);
    // On supprime aussi les refus de postulation liés à la guilde
    db.prepare('DELETE FROM guild_application_refusals WHERE guild_id = ?').run(guildId);

    // Supprimer les données de guerre
    // 1. Supprimer les membres des guerres impliquant cette guilde
    const wars = db.prepare('SELECT id FROM guild_wars WHERE guild1_id = ? OR guild2_id = ?').all(guildId, guildId);
    for (const war of wars) {
        db.prepare('DELETE FROM guild_war_members WHERE war_id = ?').run(war.id);
        db.prepare('DELETE FROM war_mvps WHERE war_id = ?').run(war.id);
    }
    // 2. Supprimer les guerres elles-mêmes
    db.prepare('DELETE FROM guild_wars WHERE guild1_id = ? OR guild2_id = ?').run(guildId, guildId);
    // 3. Supprimer les déclarations de guerre (en attente ou non)
    db.prepare('DELETE FROM guild_war_declarations WHERE from_guild_id = ? OR to_guild_id = ?').run(guildId, guildId);

    // Supprimer la progression des quêtes de guilde
    db.prepare('DELETE FROM guild_quest_progress WHERE guild_id = ?').run(guildId);

    // Supprimer la guilde
    deleteGuildStmt.run(guildId);
    logger.info(`Guilde ${guildId} a été dissoute (membres, guerres, quêtes, refus nettoyés).`);
});

function dissolveGuild(guildId) {
    dissolveGuildTransaction(guildId);
}


function changeGuildOwner(guildId, newOwnerId) {
    changeGuildOwnerStmt.run(newOwnerId, guildId);
    logger.info(`Le chef de la guilde ${guildId} a été changé pour ${newOwnerId}.`);
}


/**
 * Récupère le top 10 des guildes.
 * @returns {Array<object>}
 */
function getGuildLeaderboard() {
    const stmt = db.prepare(`
        SELECT id, name, level, emoji
        FROM guilds
        ORDER BY level DESC
        LIMIT 10
    `);
    return stmt.all();
}

/**
 * Récupère le rang d'une guilde.
 * @param {number} guildId L'ID de la guilde.
 * @returns {number | string} Le rang de la guilde ou 'Non classée'.
 */
function getGuildRank(guildId) {
    const stmt = db.prepare(`
        SELECT rank FROM (
            SELECT id, RANK() OVER (ORDER BY level DESC) as rank
            FROM guilds
        ) WHERE id = ?
    `);
    const result = stmt.get(guildId);
    return result ? result.rank : 'Non classée';
}

function getGuildById(guildId) {
    return getGuildByIdStmt.get(guildId);
}

function getWarsWon(guildId) {
    const stmt = db.prepare('SELECT COUNT(*) as count FROM guild_wars WHERE winner_id = ?');
    return stmt.get(guildId).count;
}

function isGuildInWar(guildId) {
    const stmt = db.prepare('SELECT COUNT(*) as count FROM guild_wars WHERE (guild1_id = ? OR guild2_id = ?) AND status = \'ongoing\'');
    return stmt.get(guildId, guildId).count > 0;
}

/**
 * Met à jour la trésorerie d'une guilde
 */
function updateGuildTreasury(guildId, amount) {
    db.prepare('UPDATE guilds SET treasury = treasury + ? WHERE id = ?').run(amount, guildId);
    logger.info(`Trésorerie de la guilde ${guildId} mise à jour: +${amount}`);
}

/**
 * Met à jour le niveau d'upgrade d'une guilde
 */
function updateGuildUpgrade(guildId, upgradeLevel) {
    db.prepare('UPDATE guilds SET upgrade_level = ? WHERE id = ?').run(upgradeLevel, guildId);
    logger.info(`Upgrade de la guilde ${guildId} mis à jour: ${upgradeLevel}`);
}

/**
 * Récupère une guerre spécifique
 */
function getGuildWar(warId) {
    return db.prepare('SELECT * FROM guild_wars WHERE id = ?').get(warId);
}

/**
 * Enregistre le résultat d'une guerre
 */
function recordWarResult(warId, winnerId) {
    db.prepare('UPDATE guild_wars SET status = ?, winner_id = ? WHERE id = ?')
        .run('finished', winnerId, warId);
    logger.info(`Guerre ${warId} terminée. Gagnant: ${winnerId}`);
}

/**
 * Récupère la progression d'une quête de guilde
 */
function getGuildQuestProgress(guildId, questId) {
    return db.prepare('SELECT * FROM guild_quest_progress WHERE guild_id = ? AND quest_id = ?')
        .get(guildId, questId);
}

/**
 * Marque une quête de guilde comme complétée
 */
function completeGuildQuestInDb(guildId, questId) {
    db.prepare('INSERT OR REPLACE INTO guild_quest_progress (guild_id, quest_id, completed, completed_at) VALUES (?, ?, 1, ?)')
        .run(guildId, questId, Date.now());
    logger.info(`Quête ${questId} complétée pour la guilde ${guildId}`);
}

const getGuildMemberStmt = db.prepare('SELECT user_id FROM guild_members WHERE guild_id = ? AND user_id = ?');

function getGuildMember(guildId, userId) {
    const member = getGuildMemberStmt.get(guildId, userId);
    if (!member) return null;

    const guild = getGuildById(guildId);
    if (!guild) return null;

    let rank = GUILD_RANKS.MEMBRE;
    if (guild.owner_id === userId) {
        rank = GUILD_RANKS.CHEF;
    } else {
        const subChiefs = parseSubChiefs(guild.sub_chiefs);
        if (subChiefs.includes(userId)) {
            rank = GUILD_RANKS.SOUS_CHEF;
        }
    }
    return { userId, guildId, rank };
}

// --- Fonctions Rôles Personnalisés ---

function getGuildCustomRoles(guildId) {
    const result = getGuildCustomRolesStmt.get(guildId);
    return parseCustomRoles(result ? result.custom_roles_config : null);
}

function saveGuildCustomRoles(guildId, roles) {
    updateGuildCustomRolesStmt.run(JSON.stringify(roles), guildId);
}

function assignMemberRole(guildId, userId, roleId) {
    setMemberRoleStmt.run(roleId, guildId, userId);
}

function getMemberRole(guildId, userId) {
    return getMemberRoleStmt.get(guildId, userId)?.role_id || null;
}

// --- Logique Places & Pénalités ---

/**
 * Calcule le nombre maximum de places pour une guilde
 * Base (Upgrade 1) = 3
 * Upgrade 2-10 = Selon UPGRADE_MATRIX
 * Jokers = Max 3 (+1 par joker)
 */
function getGuildMaxSlots(guild) {
    // Le plus simple est de lire member_slots de la DB, car il inclut les jokers.
    // La DB a été mise à jour par les transactions d'upgrade.
    return guild.member_slots;
}

/**
 * Vérifie si une guilde dépasse sa limite de membres
 * @returns {boolean} True si dépassement
 */
function isGuildOverLimit(guildId) {
    const guild = getGuildById(guildId);
    if (!guild) return false;

    const memberCount = getGuildMemberCount(guildId);
    const maxSlots = getGuildMaxSlots(guild);

    return memberCount > maxSlots;
}

/**
 * Applique les pénalités si la guilde est en surcharge
 * Pénalité: (membres_en_trop * 1000 * jours_depuis_maj) stars par membre
 * Nous appliquons une pénalité quotidienne de 1000 stars * excès.
 */
function checkGuildPenalties(guildId) {
    const guild = getGuildById(guildId);
    if (!guild) return { isRestricted: false };

    const memberCount = getGuildMemberCount(guildId);
    const maxSlots = getGuildMaxSlots(guild);

    if (memberCount <= maxSlots) return { isRestricted: false };

    // La guilde est en surcharge -> Restriction active
    const excessMembers = memberCount - maxSlots;
    const now = Date.now();
    const oneDay = 24 * 60 * 60 * 1000;

    // Vérifier si on doit appliquer la pénalité financière (une fois par 24h)
    if (now - (guild.last_penalty_check || 0) > oneDay) {
        const penaltyPerMember = excessMembers * 1000;

        // Appliquer à tous les membres
        const members = getGuildMembersStmt.all(guildId);
        for (const m of members) {
            deductPenaltyStarsStmt.run(penaltyPerMember, m.user_id);
        }

        updateLastPenaltyCheckStmt.run(now, guildId);
        logger.info(`Pénalité guilde appliquée pour ${guild.name}: -${penaltyPerMember} stars/membre (Surcharge: ${excessMembers})`);
    }

    return {
        isRestricted: true,
        reason: `⚠️ Surcharge de membres (${memberCount}/${maxSlots}). Fonctionnalités bloquées.`,
        excess: excessMembers
    };
}

/**
 * Calcule le nombre maximum de slots autorisés pour une guilde
 * Prend en compte la limite absolue de 15 membres (5 de base + 10 achetables)
 */
function getGuildMaxSlots(guild) {
    const absoluteMax = 15;
    return Math.min(guild.member_slots || 5, absoluteMax);
}

module.exports = {
    // Constante des rangs pour utilisation externe
    GUILD_RANKS,
    // Fonctions
    getGuildOfUser,
    getGuildByName,
    createGuild,
    addMemberToGuild,
    updateGuildLevel,
    createInvitation,
    getLatestInviteForUser,
    getRecentInvitesByInviter,
    getGuildMemberCount,
    getAllGuilds,
    removeMemberFromGuild,
    getGuildMembersWithDetails,
    getGuildMember,
    increaseGuildSlots,
    addGuildApplicationRefusal,
    hasBeenRefusedByGuild,
    updateGuildDetails,
    dissolveGuild,
    changeGuildOwner,
    getGuildLeaderboard,
    getGuildRank,
    addGuildSubChief,
    removeGuildSubChief,
    updateGuildOwnerAndSubChiefs,
    getGuildById,
    getWarsWon,
    isGuildInWar,
    updateGuildTreasury,
    updateGuildUpgrade,
    getGuildWar,
    recordWarResult,
    getGuildQuestProgress,
    completeGuildQuestInDb,
    getGuildCustomRoles,
    saveGuildCustomRoles,
    assignMemberRole,
    getMemberRole,
    isGuildOverLimit,
    checkGuildPenalties,
    getGuildMaxSlots
};