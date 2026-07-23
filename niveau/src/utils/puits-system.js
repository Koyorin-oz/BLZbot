/**
 * ============================================
 * SYSTÈME DE PUITS DE COMBAT - MAJ Mars 2026
 * ============================================
 * 
 * Remplace l'ancien Battle Pass linéaire de 50 paliers.
 * 
 * CONCEPT :
 * - Le Pass de Combat est transformé en "Puits à récompenses"
 * - Le joueur accumule des PT (Points de Tirage) via messages (10 PT) et vocal (20 PT/min)
 * - Quand il a assez de PT, il débloque un tirage
 * - Chaque tirage donne une récompense aléatoire du pool
 * - 50 tirages pour vider le puits (70 pour les VIP)
 * - Les tirages sont stackables (on peut les faire d'un coup)
 * - Dès le premier tirage on peut obtenir la meilleure récompense
 * 
 * COÛTS EN PT :
 * - Tirage 0-5 :   500 PT  (VIP: 300 PT)
 * - Tirage 5-10 :  1000 PT (VIP: 600 PT)
 * - Tirage 10-25 : 2000 PT (VIP: 1200 PT)
 * - Tirage 25-50 : 4000 PT (VIP: 2400 PT)
 * - Tirage 50-70 : 3500 PT (VIP seulement)
 * 
 * GAINS PT :
 * - 10 PT par message
 * - 20 PT par minute de vocal
 */

const db = require('../database/database');
const logger = require('./logger');

// ==========================================
// CONFIGURATION DU PUITS
// ==========================================

/** Coûts en PT par tranche de tirages (non-VIP) */
const TIRAGE_COSTS = [
    { from: 0, to: 5, cost: 500 },
    { from: 5, to: 10, cost: 1000 },
    { from: 10, to: 25, cost: 2000 },
    { from: 25, to: 50, cost: 4000 },
];

/** Coûts en PT par tranche de tirages (VIP) */
const TIRAGE_COSTS_VIP = [
    { from: 0, to: 5, cost: 300 },
    { from: 5, to: 10, cost: 600 },
    { from: 10, to: 25, cost: 1200 },
    { from: 25, to: 50, cost: 2400 },
    { from: 50, to: 70, cost: 3500 },
];

/** Max tirages selon le statut */
const MAX_TIRAGES_FREE = 50;
const MAX_TIRAGES_VIP = 70;

/** PT gagnés par action */
const PT_PER_MESSAGE = 10;
const PT_PER_VOICE_MINUTE = 20;

// ==========================================
// POOL DE RÉCOMPENSES DU PUITS
// ==========================================

/**
 * Pool de récompenses standard (non-VIP)
 * Les poids déterminent la probabilité relative
 * Les tirages sont stackables et aléatoires
 */
const PUITS_REWARDS_FREE = [
    // Starss
    { id: 'starss_30k', type: 'starss', amount: 30000, name: '30 000 Starss', weight: 7, emoji: '⭐' },
    { id: 'starss_50k', type: 'starss', amount: 50000, name: '50 000 Starss', weight: 7, emoji: '⭐' },
    // Coffres
    { id: 'coffre_normal', type: 'item', itemId: 'coffre_normal', amount: 1, name: 'Coffre au trésor', weight: 12, emoji: '📦' },
    { id: 'coffre_mega', type: 'item', itemId: 'coffre_mega', amount: 1, name: 'Méga coffre au trésor', weight: 5, emoji: '🎁' },
    { id: 'coffre_legendaire', type: 'item', itemId: 'coffre_legendaire', amount: 1, name: 'Coffre au trésor légendaire', weight: 1, emoji: '👑' },
    // Boosts et items
    { id: 'double_daily', type: 'item', itemId: 'double_daily', amount: 1, name: 'Double Daily', weight: 4, emoji: '📅' },
    { id: 'reset_boutique', type: 'item', itemId: 'reset_boutique', amount: 1, name: 'Reset Boutique', weight: 3, emoji: '🔄' },
    { id: 'joker_guilde', type: 'item', itemId: 'joker_guilde', amount: 1, name: 'Joker de Guilde', weight: 1, emoji: '🃏' },
    { id: 'streak_keeper', type: 'item', itemId: 'streak_keeper', amount: 1, name: 'Streak Keeper', weight: 1, emoji: '🔥' },
    { id: 'mega_boost', type: 'item', itemId: 'mega_boost', amount: 1, name: 'Mega Boost', weight: 1, emoji: '🚀' },
    { id: 'remboursement', type: 'item', itemId: 'remboursement', amount: 1, name: 'Remboursement', weight: 1, emoji: '💸' },
    // Multiplicateurs (EXP, Starss, RP)
    { id: 'x2_exp', type: 'boost', boostType: 'xp', amount: 1, name: 'x2 EXP', weight: 3, emoji: '⚡' },
    { id: 'x2_starss', type: 'boost', boostType: 'starss', amount: 1, name: 'x2 Starss', weight: 3, emoji: '💰' },
    { id: 'x2_rp', type: 'boost', boostType: 'points', amount: 1, name: 'x2 RP', weight: 1, emoji: '✨' },
];

/**
 * Pool de récompenses VIP (tirages 50-70)
 * Uniquement accessible aux VIP, meilleures récompenses
 */
const PUITS_REWARDS_VIP = [
    // Starss plus élevées
    { id: 'starss_100k_vip', type: 'starss', amount: 100000, name: '100 000 Starss', weight: 5, emoji: '🌟' },
    // Coffres premium
    { id: 'coffre_mega_vip', type: 'item', itemId: 'coffre_mega', amount: 1, name: 'Méga Coffre au trésor', weight: 5, emoji: '🎁' },
    { id: 'coffre_legendaire_vip', type: 'item', itemId: 'coffre_legendaire', amount: 1, name: 'Coffre au trésor légendaire', weight: 3, emoji: '👑' },
    // Items premium
    { id: 'mega_boost_vip', type: 'item', itemId: 'mega_boost', amount: 1, name: 'Mega Boost', weight: 1, emoji: '🚀' },
    { id: 'reset_boutique_vip', type: 'item', itemId: 'reset_boutique', amount: 1, name: 'Reset Boutique', weight: 3, emoji: '🔄' },
    { id: 'double_daily_vip', type: 'item', itemId: 'double_daily', amount: 1, name: 'Double Daily', weight: 3, emoji: '📅' },
];

// ==========================================
// REQUÊTES PRÉPARÉES
// ==========================================

const getUserPuitsStmt = db.prepare('SELECT tirage_points, total_tirages, is_vip, vip_expires_at FROM users WHERE id = ?');
const addTiragePointsStmt = db.prepare('UPDATE users SET tirage_points = tirage_points + ? WHERE id = ?');
const consumeTiragePointsStmt = db.prepare('UPDATE users SET tirage_points = tirage_points - ?, total_tirages = total_tirages + 1 WHERE id = ?');
const resetPuitsStmt = db.prepare('UPDATE users SET tirage_points = 0, total_tirages = 0 WHERE id = ?');
const insertTirageHistoryStmt = db.prepare('INSERT INTO puits_tirages (user_id, tirage_number, reward_type, reward_id, reward_amount, timestamp) VALUES (?, ?, ?, ?, ?, ?)');
const getTirageHistoryStmt = db.prepare('SELECT * FROM puits_tirages WHERE user_id = ? ORDER BY tirage_number ASC');
const getMonthlyTiragesCountStmt = db.prepare('SELECT COUNT(*) as count FROM puits_tirages WHERE user_id = ? AND timestamp > ?');

// ==========================================
// FONCTIONS PRINCIPALES
// ==========================================

/**
 * Vérifie si un utilisateur est VIP actif
 * @param {object} userData - Données utilisateur avec is_vip et vip_expires_at
 * @returns {boolean}
 */
function isUserVip(userData) {
    if (!userData) return false;
    return userData.is_vip === 1 && (userData.vip_expires_at === 0 || userData.vip_expires_at > Date.now());
}

/**
 * Obtient le coût en PT du prochain tirage pour un utilisateur
 * @param {number} currentTirages - Nombre de tirages déjà effectués
 * @param {boolean} isVip - Si l'utilisateur est VIP
 * @returns {number|null} Le coût en PT, ou null si max atteint
 */
function getTirageCost(currentTirages, isVip) {
    const costs = isVip ? TIRAGE_COSTS_VIP : TIRAGE_COSTS;
    const maxTirages = isVip ? MAX_TIRAGES_VIP : MAX_TIRAGES_FREE;

    if (currentTirages >= maxTirages) {
        return null; // Puits vidé
    }

    for (const tier of costs) {
        if (currentTirages >= tier.from && currentTirages < tier.to) {
            return tier.cost;
        }
    }

    return null; // Ne devrait pas arriver
}

/**
 * Obtient le nombre de tirages disponibles pour un utilisateur (qu'il peut faire maintenant)
 * @param {string} userId
 * @returns {{ available: number, cost: number|null, totalTirages: number, tiragePoints: number, isVip: boolean, maxTirages: number }}
 */
function getPuitsStatus(userId) {
    const userData = getUserPuitsStmt.get(userId);
    if (!userData) {
        return { available: 0, cost: null, totalTirages: 0, tiragePoints: 0, isVip: false, maxTirages: MAX_TIRAGES_FREE };
    }

    const vip = isUserVip(userData);
    const maxTirages = vip ? MAX_TIRAGES_VIP : MAX_TIRAGES_FREE;
    const currentTirages = userData.total_tirages || 0;
    const tiragePoints = userData.tirage_points || 0;

    // Calculer combien de tirages on peut faire avec les PT actuels
    let availableTirages = 0;
    let remainingPT = tiragePoints;
    let simulatedTirages = currentTirages;

    while (simulatedTirages < maxTirages) {
        const cost = getTirageCost(simulatedTirages, vip);
        if (cost === null || remainingPT < cost) break;
        remainingPT -= cost;
        simulatedTirages++;
        availableTirages++;
    }

    const nextCost = getTirageCost(currentTirages, vip);

    return {
        available: availableTirages,
        cost: nextCost,
        totalTirages: currentTirages,
        tiragePoints: tiragePoints,
        isVip: vip,
        maxTirages: maxTirages,
        puitsComplete: currentTirages >= maxTirages,
    };
}

/**
 * Tire une récompense aléatoire du pool pondéré
 * @param {Array} pool - Le pool de récompenses
 * @returns {object} La récompense tirée
 */
function rollReward(pool) {
    const totalWeight = pool.reduce((sum, r) => sum + r.weight, 0);
    let random = Math.random() * totalWeight;

    for (const reward of pool) {
        if (random < reward.weight) {
            return { ...reward };
        }
        random -= reward.weight;
    }

    // Fallback
    return { ...pool[0] };
}

/**
 * Effectue un ou plusieurs tirages dans le puits
 * @param {string} userId
 * @param {number} count - Nombre de tirages à effectuer (1 par défaut)
 * @returns {{ success: boolean, rewards: Array, message: string, newStatus: object }}
 */
function performTirages(userId, count = 1) {
    const userData = getUserPuitsStmt.get(userId);
    if (!userData) {
        return { success: false, rewards: [], message: '❌ Utilisateur non trouvé.' };
    }

    const vip = isUserVip(userData);
    const maxTirages = vip ? MAX_TIRAGES_VIP : MAX_TIRAGES_FREE;
    let currentTirages = userData.total_tirages || 0;
    let remainingPT = userData.tirage_points || 0;

    if (currentTirages >= maxTirages) {
        return { success: false, rewards: [], message: '🏆 Votre puits est déjà vidé ! Attendez le reset mensuel.' };
    }

    const rewards = [];
    let totalPTSpent = 0;

    for (let i = 0; i < count; i++) {
        if (currentTirages >= maxTirages) break;

        const cost = getTirageCost(currentTirages, vip);
        if (cost === null || remainingPT < cost) {
            if (rewards.length === 0) {
                return {
                    success: false,
                    rewards: [],
                    message: `❌ Pas assez de PT ! Vous avez **${remainingPT} PT** mais le prochain tirage coûte **${cost} PT**.`
                };
            }
            break; // On a fait ce qu'on pouvait
        }

        remainingPT -= cost;
        totalPTSpent += cost;
        currentTirages++;

        // Déterminer le pool de récompenses
        // Tirages 50-70 utilisent le pool VIP exclusif
        const pool = (currentTirages > MAX_TIRAGES_FREE && vip) ? PUITS_REWARDS_VIP : PUITS_REWARDS_FREE;
        const reward = rollReward(pool);
        reward.tirageNumber = currentTirages;

        rewards.push(reward);

        // Enregistrer le tirage dans l'historique
        insertTirageHistoryStmt.run(
            userId,
            currentTirages,
            reward.type,
            reward.id,
            reward.amount || 0,
            Date.now()
        );
    }

    // Mettre à jour la BDD en une transaction
    db.transaction(() => {
        db.prepare('UPDATE users SET tirage_points = tirage_points - ?, total_tirages = ? WHERE id = ?')
            .run(totalPTSpent, currentTirages, userId);
    })();

    const newStatus = getPuitsStatus(userId);

    return {
        success: true,
        rewards: rewards,
        message: `🎰 Vous avez effectué **${rewards.length} tirage(s)** ! (-${totalPTSpent} PT)`,
        newStatus: newStatus,
    };
}

/**
 * Applique les récompenses d'un tirage à un utilisateur
 * @param {object} client - Discord client
 * @param {string} userId - ID Discord
 * @param {Array} rewards - Liste des récompenses du tirage
 * @returns {Array<string>} Messages de récompenses
 */
async function applyTirageRewards(client, userId, rewards) {
    const { grantResources, addItemToInventory } = require('./db-users');
    const { rebornEconomyActive, addRebornStars, addRebornInventory } = require('./reborn-integration');
    const useReborn = rebornEconomyActive();
    const messages = [];

    for (const reward of rewards) {
        switch (reward.type) {
            case 'starss':
                if (useReborn) {
                    addRebornStars(userId, reward.amount);
                } else {
                    await grantResources(client, userId, { stars: reward.amount, source: 'puits' });
                }
                messages.push(`${reward.emoji} **${reward.name}**`);
                break;

            case 'item':
                if (useReborn) {
                    addRebornInventory(userId, reward.itemId, reward.amount);
                } else {
                    addItemToInventory(userId, reward.itemId, reward.amount);
                }
                messages.push(`${reward.emoji} **${reward.name}** x${reward.amount}`);
                break;

            case 'boost':
                // Activer un boost temporaire (1h)
                const boostDuration = 60 * 60 * 1000; // 1 heure
                const boostEnd = Date.now() + boostDuration;
                if (reward.boostType === 'xp') {
                    db.prepare('UPDATE users SET xp_boost_until = ? WHERE id = ?').run(boostEnd, userId);
                } else if (reward.boostType === 'points') {
                    db.prepare('UPDATE users SET points_boost_until = ? WHERE id = ?').run(boostEnd, userId);
                } else if (reward.boostType === 'starss') {
                    db.prepare('UPDATE users SET stars_boost_until = ? WHERE id = ?').run(boostEnd, userId);
                }
                messages.push(`${reward.emoji} **${reward.name}** (1h)`);
                break;

            default:
                messages.push(`❓ **${reward.name || 'Récompense inconnue'}**`);
        }
    }

    return messages;
}

/**
 * Ajoute des PT à un utilisateur (appelé depuis messageCreate et voiceStateUpdate)
 * @param {string} userId
 * @param {number} amount - Montant de PT
 */
function grantTiragePoints(userId, amount) {
    try {
        addTiragePointsStmt.run(amount, userId);
    } catch (error) {
        logger.error(`[PUITS] Erreur grantTiragePoints pour ${userId}:`, error);
    }
}

/**
 * Récupère l'historique des tirages du mois en cours
 * @param {string} userId
 * @returns {Array}
 */
function getTirageHistory(userId) {
    return getTirageHistoryStmt.all(userId);
}

/**
 * Reset mensuel du puits (appelé par le scheduler)
 * Remet les tirages et l'historique à zéro
 */
function resetAllPuits() {
    try {
        db.transaction(() => {
            // Reset les compteurs utilisateurs
            db.prepare('UPDATE users SET total_tirages = 0, tirage_points = 0').run();

            // Archiver puis supprimer l'historique des tirages
            db.prepare('DELETE FROM puits_tirages').run();

            // Reset l'ancien battle pass aussi (table conservée pour compatibilité)
            db.prepare('UPDATE users SET seasonal_xp = 0').run();
            try { db.prepare('DELETE FROM battle_pass').run(); } catch(e) { /* table peut ne plus exister */ }
        })();

        logger.info('[PUITS] Reset mensuel effectué - tous les puits ont été réinitialisés.');
    } catch (error) {
        logger.error('[PUITS] Erreur lors du reset mensuel:', error);
    }
}

/**
 * Planifie le reset saisonnier (1er samedi du mois à 13h)
 * Remplace l'ancien scheduleBattlePassReset
 */
function scheduleSeasonalReset() {
    const schedule = require('node-schedule');
    const rule = new schedule.RecurrenceRule();
    rule.dayOfWeek = 6; // Samedi
    rule.hour = 13;
    rule.minute = 0;

    schedule.scheduleJob(rule, () => {
        logger.info('[PUITS] Exécution du reset saisonnier...');
        resetAllPuits();
    });

    logger.info('[PUITS] Reset saisonnier planifié (1er samedi du mois à 13h).');
}

/**
 * Obtient un résumé formaté du puits pour l'affichage
 * @param {string} userId
 * @returns {object}
 */
function getPuitsDisplayData(userId) {
    const status = getPuitsStatus(userId);
    const history = getTirageHistory(userId);

    // Calculer la progression vers le prochain tirage
    let progressPercent = 0;
    if (status.cost && status.cost > 0) {
        // PT restants après les tirages précédents
        progressPercent = Math.min(100, Math.floor((status.tiragePoints / status.cost) * 100));
    }

    // Déterminer le tier actuel
    let currentTier = 'Tier 1';
    if (status.totalTirages >= 25) currentTier = 'Tier 4';
    else if (status.totalTirages >= 10) currentTier = 'Tier 3';
    else if (status.totalTirages >= 5) currentTier = 'Tier 2';

    return {
        ...status,
        history: history,
        progressPercent: progressPercent,
        currentTier: currentTier,
        tiragesRemaining: status.maxTirages - status.totalTirages,
    };
}

// ==========================================
// EXPORTS
// ==========================================

module.exports = {
    // Fonctions principales
    getPuitsStatus,
    performTirages,
    applyTirageRewards,
    grantTiragePoints,
    getTirageHistory,
    resetAllPuits,
    scheduleSeasonalReset,
    getPuitsDisplayData,
    
    // Helpers
    getTirageCost,
    isUserVip,
    rollReward,
    
    // Constantes exportées pour les commandes/UI
    PT_PER_MESSAGE,
    PT_PER_VOICE_MINUTE,
    MAX_TIRAGES_FREE,
    MAX_TIRAGES_VIP,
    TIRAGE_COSTS,
    TIRAGE_COSTS_VIP,
    PUITS_REWARDS_FREE,
    PUITS_REWARDS_VIP,
};
