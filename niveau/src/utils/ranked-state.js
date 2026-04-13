/**
 * Ranked System State Manager
 * Gère l'état du système de classement v2, notamment les pénalités AFK
 */

const logger = require('./logger');
const { economyGuildId, voiceTrackingKey } = require('./economy-scope');

// Map des utilisateurs pénalisés: clé (guilde:user ou user seul) -> { expireAt, reason }
const penalizedUsers = new Map();

function penaltyKey(userId) {
    const gid = economyGuildId.getStore();
    return voiceTrackingKey(gid, userId);
}

// Durée de pénalité par défaut en ms (15 minutes)
const DEFAULT_PENALTY_DURATION = 15 * 60 * 1000;

/**
 * Vérifie si un utilisateur est actuellement pénalisé
 * @param {string} userId L'ID de l'utilisateur
 * @returns {boolean} True si l'utilisateur est pénalisé
 */
function isUserPenalized(userId) {
    const penalty = penalizedUsers.get(userId);
    if (!penalty) return false;

    // Vérifier si la pénalité a expiré
    if (Date.now() >= penalty.expireAt) {
        penalizedUsers.delete(userId);
        logger.info(`[RANKED] La pénalité de l'utilisateur ${userId} a expiré.`);
        return false;
    }

    return true;
}

/**
 * Applique une pénalité à un utilisateur
 * @param {string} userId L'ID de l'utilisateur
 * @param {number} durationMs Durée de la pénalité en ms (défaut: 15 minutes)
 * @param {string} reason Raison de la pénalité
 */
function penalizeUser(userId, durationMs = DEFAULT_PENALTY_DURATION, reason = 'AFK Voice Check') {
    const expireAt = Date.now() + durationMs;
    penalizedUsers.set(userId, {
        expireAt,
        reason,
        appliedAt: Date.now()
    });
    logger.info(`[RANKED] Pénalité appliquée à ${userId}: ${reason} (expire dans ${Math.round(durationMs / 60000)} min)`);
}

/**
 * Supprime la pénalité d'un utilisateur
 * @param {string} userId L'ID de l'utilisateur
 * @returns {boolean} True si une pénalité a été supprimée
 */
function clearPenalty(userId) {
    const hadPenalty = penalizedUsers.has(userId);
    penalizedUsers.delete(userId);
    if (hadPenalty) {
        logger.info(`[RANKED] Pénalité supprimée pour ${userId}.`);
    }
    return hadPenalty;
}

/**
 * Obtient le multiplicateur de gain RP pour un utilisateur
 * @param {string} userId L'ID de l'utilisateur
 * @returns {number} 0.5 si pénalisé, 1 sinon
 */
function getRPMultiplier(userId) {
    return isUserPenalized(userId) ? 0.5 : 1;
}

/**
 * Obtient les informations de pénalité d'un utilisateur
 * @param {string} userId L'ID de l'utilisateur
 * @returns {object|null} Infos de pénalité ou null si pas pénalisé
 */
function getPenaltyInfo(userId) {
    const penalty = penalizedUsers.get(userId);
    if (!penalty) return null;

    // Vérifier si expirée
    if (Date.now() >= penalty.expireAt) {
        penalizedUsers.delete(userId);
        return null;
    }

    return {
        ...penalty,
        remainingMs: penalty.expireAt - Date.now(),
        remainingMinutes: Math.ceil((penalty.expireAt - Date.now()) / 60000)
    };
}

/**
 * Obtient toutes les pénalités actives (pour debug)
 * @returns {Array} Liste des pénalités actives
 */
function getAllPenalties() {
    const now = Date.now();
    const active = [];

    for (const [userId, penalty] of penalizedUsers.entries()) {
        if (now < penalty.expireAt) {
            active.push({
                userId,
                ...penalty,
                remainingMs: penalty.expireAt - now,
                remainingMinutes: Math.ceil((penalty.expireAt - now) / 60000)
            });
        } else {
            // Nettoyer les pénalités expirées
            penalizedUsers.delete(userId);
        }
    }

    return active;
}

module.exports = {
    isUserPenalized,
    penalizeUser,
    clearPenalty,
    getRPMultiplier,
    getPenaltyInfo,
    getAllPenalties,
    DEFAULT_PENALTY_DURATION
};
