const Database = require('better-sqlite3');
const path = require('path');
const logger = require('./logger');
const { resolveDatabasePath } = require('../../../utils/database-path');

// Crée une nouvelle instance de la base de données pour l'événement
const dbPath = resolveDatabasePath(path.join(__dirname, '../database/Haloween.sqlite'));
const db = new Database(dbPath);
logger.info('Connexion à la base de données Haloween.sqlite établie.');

// Optimisations et configuration de la base de données
db.pragma('journal_mode = WAL');
db.pragma('synchronous = 1');

// --- Initialisation des Tables ---
function setupTables() {
    db.exec(`
        CREATE TABLE IF NOT EXISTS event_state (
            event_name TEXT PRIMARY KEY,
            is_active INTEGER NOT NULL DEFAULT 0
        );
    `);
    db.exec(`
        CREATE TABLE IF NOT EXISTS event_users (
            user_id TEXT PRIMARY KEY,
            username TEXT NOT NULL,
            citrouilles INTEGER NOT NULL DEFAULT 0,
            bonbons INTEGER NOT NULL DEFAULT 0,
            bonbons_surprise_count INTEGER NOT NULL DEFAULT 0,
            claimed_rewards TEXT NOT NULL DEFAULT '[]'
        );
    `);
    db.exec(`
        CREATE TABLE IF NOT EXISTS bonbon_daily_cooldowns (
            user_id TEXT PRIMARY KEY,
            last_claimed INTEGER NOT NULL
        );
    `);
    logger.info('Tables de la base de données Halloween vérifiées/créées.');
    
    const event = db.prepare('SELECT * FROM event_state WHERE event_name = ?').get('halloween');
    if (!event) {
        db.prepare('INSERT INTO event_state (event_name, is_active) VALUES (?, ?)').run('halloween', 0);
        logger.info("Entrée initiale pour l'événement 'halloween' créée et désactivée par défaut.");
    }
}
setupTables();

// --- Fonctions de Gestion de l'Événement ---

function getEventState(eventName = 'halloween') {
    const row = db.prepare('SELECT is_active FROM event_state WHERE event_name = ?').get(eventName);
    return row ? row.is_active === 1 : false;
}

function setEventState(eventName = 'halloween', isActive) {
    const stateValue = isActive ? 1 : 0;
    db.prepare('UPDATE event_state SET is_active = ? WHERE event_name = ?').run(stateValue, eventName);
    logger.info(`L'événement '${eventName}' est maintenant ${isActive ? 'ACTIF' : 'INACTIF'}.`);
}

// --- Fonctions de Gestion des Utilisateurs de l'Événement ---

function getOrCreateEventUser(userId, username) {
    let user = db.prepare('SELECT * FROM event_users WHERE user_id = ?').get(userId);
    if (!user) {
        db.prepare('INSERT INTO event_users (user_id, username) VALUES (?, ?)').run(userId, username || 'unknown');
        user = db.prepare('SELECT * FROM event_users WHERE user_id = ?').get(userId);
    } else if (username && username !== 'unknown' && user.username !== username) {
        // Mettre à jour le username si un vrai nom est fourni et différent
        db.prepare('UPDATE event_users SET username = ? WHERE user_id = ?').run(username, userId);
        user.username = username;
    }
    // Parse claimed_rewards from JSON string to array
    user.claimed_rewards = JSON.parse(user.claimed_rewards);
    return user;
}

function getUsernameFromMainDb(userId) {
    const mainDb = require('../database/database');
    try {
        const user = mainDb.prepare('SELECT username FROM users WHERE id = ?').get(userId);
        return user ? user.username : 'unknown';
    } catch (error) {
        logger.error(`Erreur lors de la récupération du username pour ${userId}:`, error);
        return 'unknown';
    }
}

function grantEventCurrency(userId, { citrouilles = 0, bonbons = 0, bonbons_surprise = 0 }) {
    // Essayer de récupérer le username depuis la base principale
    const username = getUsernameFromMainDb(userId);
    const user = getOrCreateEventUser(userId, username);
    
    db.prepare(`
        UPDATE event_users 
        SET 
            citrouilles = citrouilles + ?,
            bonbons = bonbons + ?,
            bonbons_surprise_count = bonbons_surprise_count + ?
        WHERE user_id = ?
    `).run(citrouilles, bonbons, bonbons_surprise, userId);
    
    const updatedUser = getOrCreateEventUser(userId, username);
    return updatedUser;
}

// --- Fonctions de Gestion du Daily Bonbon ---

function getDailyBonbonCooldown(userId) {
    return db.prepare('SELECT last_claimed FROM bonbon_daily_cooldowns WHERE user_id = ?').get(userId);
}

function setDailyBonbonCooldown(userId) {
    const now = Date.now();
    db.prepare('INSERT OR REPLACE INTO bonbon_daily_cooldowns (user_id, last_claimed) VALUES (?, ?)').run(userId, now);
}

// --- Fonctions de Gestion des Récompenses de Palier ---

function addClaimedReward(userId, rewardId) {
    const username = getUsernameFromMainDb(userId);
    const user = getOrCreateEventUser(userId, username);
    const rewards = user.claimed_rewards;
    if (!rewards.includes(rewardId)) {
        rewards.push(rewardId);
        const rewardsJSON = JSON.stringify(rewards);
        db.prepare('UPDATE event_users SET claimed_rewards = ? WHERE user_id = ?').run(rewardsJSON, userId);
    }
}

function getLeaderboard(type) {
    const allowedColumns = ['bonbons', 'citrouilles', 'bonbons_surprise_count'];
    if (!allowedColumns.includes(type)) {
        throw new Error(`Invalid leaderboard column: ${type}`);
    }
    return db.prepare(`SELECT user_id, username, ${type} FROM event_users ORDER BY ${type} DESC LIMIT 10`).all();
}

function getUserRank(userId, type) {
    const allowedColumns = ['bonbons', 'citrouilles', 'bonbons_surprise_count'];
    if (!allowedColumns.includes(type)) {
        throw new Error(`Invalid leaderboard column: ${type}`);
    }
    const allUsers = db.prepare(`SELECT user_id, ${type} FROM event_users ORDER BY ${type} DESC`).all();
    const userIndex = allUsers.findIndex(user => user.user_id === userId);
    return userIndex !== -1 ? userIndex + 1 : 'Non classé(e)';
}

function resetEventUser(userId) {
    try {
        db.prepare('DELETE FROM event_users WHERE user_id = ?').run(userId);
        db.prepare('DELETE FROM bonbon_daily_cooldowns WHERE user_id = ?').run(userId);
        logger.info(`Données d'événement Halloween réinitialisées pour l'utilisateur ${userId}.`);
    } catch (error) {
        logger.error(`Erreur lors de la réinitialisation des données d'événement Halloween pour ${userId}:`, error);
    }
}

function updateAllUnknownUsernames() {
    try {
        const unknownUsers = db.prepare('SELECT user_id FROM event_users WHERE username = ?').all('unknown');
        let updatedCount = 0;
        
        for (const user of unknownUsers) {
            const username = getUsernameFromMainDb(user.user_id);
            if (username !== 'unknown') {
                db.prepare('UPDATE event_users SET username = ? WHERE user_id = ?').run(username, user.user_id);
                updatedCount++;
            }
        }
        
        if (updatedCount > 0) {
            logger.info(`${updatedCount} username(s) "unknown" mis à jour dans la base Halloween.`);
        }
        return updatedCount;
    } catch (error) {
        logger.error('Erreur lors de la mise à jour des usernames unknown:', error);
        return 0;
    }
}


module.exports = { 
    db,
    getEventState,
    setEventState,
    getOrCreateEventUser,
    grantEventCurrency,
    getDailyBonbonCooldown,
    setDailyBonbonCooldown,
    addClaimedReward,
    getLeaderboard,
    getUserRank,
    resetEventUser,
    updateAllUnknownUsernames
};
