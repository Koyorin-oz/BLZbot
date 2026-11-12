const Database = require('better-sqlite3');
const path = require('path');
const logger = require('./logger');
const { resolveDatabasePath } = require('../../../utils/database-path');

// Crée une nouvelle instance de la base de données pour l'événement
const dbPath = resolveDatabasePath(path.join(__dirname, '../database/Noël.sqlite'));
const db = new Database(dbPath);
logger.info('Connexion à la base de données Noël.sqlite établie.');

// Optimisations et configuration de la base de données
db.pragma('journal_mode = WAL');
db.pragma('synchronous = 1');

// --- Fonction de Migration pour Corriger la Table user_multipliers ---
function migrateUserMultipliersTable() {
    try {
        // Vérifier si la table existe
        const tableExists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='user_multipliers'").get();
        
        if (!tableExists) {
            // Table n'existe pas, pas de migration nécessaire
            return;
        }
        
        // Vérifier si c'est une clé primaire composée en inspectant la création
        const tableCreation = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='user_multipliers'").get();
        
        if (tableCreation && tableCreation.sql && tableCreation.sql.includes('PRIMARY KEY (user_id, multiplier_type)')) {
            logger.info('✓ Table user_multipliers a déjà le bon schéma avec clé composée.');
            return;
        }
        
        logger.info('⚠️ Migration en cours: correction du schéma user_multipliers...');
        
        // Sauvegarder les anciennes données
        const oldData = db.prepare('SELECT * FROM user_multipliers').all();
        logger.info(`  Sauvegarde de ${oldData.length} entrées...`);
        
        // Supprimer l'ancienne table
        db.exec('DROP TABLE IF EXISTS user_multipliers_old');
        db.exec('ALTER TABLE user_multipliers RENAME TO user_multipliers_old');
        
        // Créer la nouvelle table avec le bon schéma
        db.exec(`
            CREATE TABLE user_multipliers (
                user_id TEXT NOT NULL,
                multiplier_type TEXT NOT NULL,
                expiry_time INTEGER NOT NULL,
                PRIMARY KEY (user_id, multiplier_type)
            )
        `);
        
        // Restaurer les données (dédupliquées)
        const seenKeys = new Set();
        let importCount = 0;
        for (const row of oldData) {
            const key = `${row.user_id}:${row.multiplier_type}`;
            if (!seenKeys.has(key)) {
                db.prepare('INSERT INTO user_multipliers (user_id, multiplier_type, expiry_time) VALUES (?, ?, ?)')
                    .run(row.user_id, row.multiplier_type, row.expiry_time);
                seenKeys.add(key);
                importCount++;
            }
        }
        
        // Nettoyer la table temporaire
        db.exec('DROP TABLE IF EXISTS user_multipliers_old');
        
        logger.info(`✓ Migration réussie: ${importCount} entrées importées sur ${oldData.length}.`);
    } catch (error) {
        logger.error('❌ Erreur lors de la migration de user_multipliers:', error);
        // Ne pas bloquer si la migration échoue
    }
}

// Exécuter la migration AVANT setupTables
migrateUserMultipliersTable();

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
            rubans INTEGER NOT NULL DEFAULT 0,
            cadeaux_surprise_count INTEGER NOT NULL DEFAULT 0,
            claimed_calendar_rewards TEXT NOT NULL DEFAULT '[]'
        );
    `);
    db.exec(`
        CREATE TABLE IF NOT EXISTS user_multipliers (
            user_id TEXT NOT NULL,
            multiplier_type TEXT NOT NULL,
            expiry_time INTEGER NOT NULL,
            PRIMARY KEY (user_id, multiplier_type)
        );
    `);
    db.exec(`
        CREATE TABLE IF NOT EXISTS calendar_cooldowns (
            user_id TEXT PRIMARY KEY,
            last_claimed INTEGER NOT NULL
        );
    `);
    db.exec(`
        CREATE TABLE IF NOT EXISTS ruban_cooldowns (
            user_id TEXT PRIMARY KEY,
            last_message INTEGER,
            last_voice INTEGER,
            last_image INTEGER,
            last_reaction INTEGER
        );
    `);
    logger.info('Tables de la base de données Noël vérifiées/créées.');
    
    const event = db.prepare('SELECT * FROM event_state WHERE event_name = ?').get('noël');
    if (!event) {
        db.prepare('INSERT INTO event_state (event_name, is_active) VALUES (?, ?)').run('noël', 0);
        logger.info("Entrée initiale pour l'événement 'noël' créée et désactivée par défaut.");
    }
}
setupTables();

// --- Fonctions de Gestion de l'Événement ---

function getEventState(eventName = 'noël') {
    const row = db.prepare('SELECT is_active FROM event_state WHERE event_name = ?').get(eventName);
    return row ? row.is_active === 1 : false;
}

function setEventState(eventName = 'noël', isActive) {
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
        db.prepare('UPDATE event_users SET username = ? WHERE user_id = ?').run(username, userId);
        user.username = username;
    }
    user.claimed_calendar_rewards = JSON.parse(user.claimed_calendar_rewards);
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

function grantRubans(userId, amount) {
    const username = getUsernameFromMainDb(userId);
    getOrCreateEventUser(userId, username);
    
    db.prepare(`
        UPDATE event_users 
        SET rubans = rubans + ?
        WHERE user_id = ?
    `).run(amount, userId);
    
    const updatedUser = getOrCreateEventUser(userId, username);
    return updatedUser;
}

function grantEventCurrency(userId, { rubans = 0, cadeaux_surprise = 0 }) {
    const username = getUsernameFromMainDb(userId);
    getOrCreateEventUser(userId, username);
    
    db.prepare(`
        UPDATE event_users 
        SET 
            rubans = rubans + ?,
            cadeaux_surprise_count = cadeaux_surprise_count + ?
        WHERE user_id = ?
    `).run(rubans, cadeaux_surprise, userId);
    
    const updatedUser = getOrCreateEventUser(userId, username);
    return updatedUser;
}

function grantGifts(userId, amount) {
    const username = getUsernameFromMainDb(userId);
    getOrCreateEventUser(userId, username);
    
    db.prepare(`
        UPDATE event_users 
        SET cadeaux_surprise_count = cadeaux_surprise_count + ?
        WHERE user_id = ?
    `).run(amount, userId);
    
    const updatedUser = getOrCreateEventUser(userId, username);
    return updatedUser;
}

// --- Fonctions de Gestion des Multiplicateurs ---

function getActiveMultiplier(userId, multiplierType = null) {
    if (multiplierType) {
        // Chercher un type spécifique
        const multiplier = db.prepare('SELECT multiplier_type, expiry_time FROM user_multipliers WHERE user_id = ? AND multiplier_type = ?').get(userId, multiplierType);
        if (!multiplier) return null;
        
        if (multiplier.expiry_time < Date.now()) {
            db.prepare('DELETE FROM user_multipliers WHERE user_id = ? AND multiplier_type = ?').run(userId, multiplier.multiplier_type);
            return null;
        }
        
        const remaining = multiplier.expiry_time - Date.now();
        return {
            type: multiplier.multiplier_type,
            expiry_time: multiplier.expiry_time,
            remaining: remaining > 0 ? remaining : 0
        };
    } else {
        // Chercher n'importe quel multiplicateur (premier non expiré)
        const multipliers = db.prepare('SELECT multiplier_type, expiry_time FROM user_multipliers WHERE user_id = ?').all(userId);
        
        for (const mult of multipliers) {
            if (mult.expiry_time >= Date.now()) {
                const remaining = mult.expiry_time - Date.now();
                return {
                    multiplier_type: mult.multiplier_type,
                    type: mult.multiplier_type,
                    expiry_time: mult.expiry_time,
                    remaining: remaining > 0 ? remaining : 0
                };
            } else {
                db.prepare('DELETE FROM user_multipliers WHERE user_id = ? AND multiplier_type = ?').run(userId, mult.multiplier_type);
            }
        }
        return null;
    }
}

function setMultiplier(userId, multiplierType, durationMs) {
    // Vérifier s'il y a déjà un multiplicateur du même type actif
    const existingMultiplier = getActiveMultiplier(userId, multiplierType);
    
    let expiryTime;
    if (existingMultiplier) {
        // Si un multiplicateur du même type existe, ajouter la durée du boost au temps restant
        expiryTime = existingMultiplier.expiry_time + durationMs;
        const addedHours = Math.floor(durationMs / 3600000);
        logger.info(`Multiplicateur ${multiplierType} prolongé de ${addedHours}h pour ${userId}. Nouveau temps d'expiration: ${new Date(expiryTime).toLocaleString('fr-FR')}`);
    } else {
        // Sinon, créer un nouveau multiplicateur avec la durée normale
        expiryTime = Date.now() + durationMs;
        logger.info(`Multiplicateur ${multiplierType} activé pour ${userId} jusqu'à ${new Date(expiryTime).toLocaleString('fr-FR')}`);
    }
    
    db.prepare('INSERT OR REPLACE INTO user_multipliers (user_id, multiplier_type, expiry_time) VALUES (?, ?, ?)').run(userId, multiplierType, expiryTime);
}

function getMultiplierRemainingTime(userId) {
    const multiplier = getActiveMultiplier(userId);
    if (!multiplier) return null;
    
    const remaining = multiplier.expiry_time - Date.now();
    if (remaining <= 0) {
        db.prepare('DELETE FROM user_multipliers WHERE user_id = ?').run(userId);
        return null;
    }
    
    return remaining;
}

function removeMultiplier(userId) {
    db.prepare('DELETE FROM user_multipliers WHERE user_id = ?').run(userId);
}

// --- Fonctions de Gestion du Calendrier ---

function addClaimedCalendarReward(userId, day) {
    const username = getUsernameFromMainDb(userId);
    const user = getOrCreateEventUser(userId, username);
    const rewards = user.claimed_calendar_rewards;
    
    if (!rewards.includes(day)) {
        rewards.push(day);
        const rewardsJSON = JSON.stringify(rewards);
        db.prepare('UPDATE event_users SET claimed_calendar_rewards = ? WHERE user_id = ?').run(rewardsJSON, userId);
    }
}

function hasClaimedCalendarReward(userId, day) {
    const username = getUsernameFromMainDb(userId);
    const user = getOrCreateEventUser(userId, username);
    return user.claimed_calendar_rewards.includes(day);
}

function getCalendarCooldown(userId) {
    return db.prepare('SELECT last_claimed FROM calendar_cooldowns WHERE user_id = ?').get(userId);
}

function setCalendarCooldown(userId) {
    const now = Date.now();
    db.prepare('INSERT OR REPLACE INTO calendar_cooldowns (user_id, last_claimed) VALUES (?, ?)').run(userId, now);
}

function canClaimCalendarToday(userId) {
    const cooldown = getCalendarCooldown(userId);
    if (!cooldown) return true;
    
    const lastClaimed = new Date(cooldown.last_claimed);
    const today = new Date();
    
    // Vérifier si le dernier claim était avant aujourd'hui à 00h00 (Paris)
    const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' });
    const lastClaimedDate = formatter.format(lastClaimed);
    const todayDate = formatter.format(today);
    
    return lastClaimedDate !== todayDate;
}

// --- Fonctions de Gestion des Cooldowns des Rubans ---

function getRubanCooldown(userId) {
    return db.prepare('SELECT * FROM ruban_cooldowns WHERE user_id = ?').get(userId);
}

function canClaimRubans(userId, type) {
    const cooldown = getRubanCooldown(userId);
    if (!cooldown) return true;
    
    const now = Date.now();
    const cooldownDuration = 60000; // 1 minute par défaut
    
    const lastClaimedKey = `last_${type}`;
    const lastClaimed = cooldown[lastClaimedKey];
    
    if (!lastClaimed) return true;
    return now - lastClaimed >= cooldownDuration;
}

function setRubanCooldown(userId, type) {
    const now = Date.now();
    const typeKey = `last_${type}`;
    
    const cooldown = getRubanCooldown(userId) || {};
    cooldown.user_id = userId;
    cooldown[typeKey] = now;
    
    db.prepare(`
        INSERT OR REPLACE INTO ruban_cooldowns (user_id, last_message, last_voice, last_image, last_reaction)
        VALUES (?, ?, ?, ?, ?)
    `).run(
        userId,
        cooldown.last_message || null,
        cooldown.last_voice || null,
        cooldown.last_image || null,
        cooldown.last_reaction || null
    );
}

// --- Fonctions de Leaderboard ---

function getLeaderboard(type = 'rubans') {
    const allowedColumns = ['rubans', 'cadeaux_surprise_count'];
    if (!allowedColumns.includes(type)) {
        throw new Error(`Invalid leaderboard column: ${type}`);
    }
    return db.prepare(`SELECT user_id, username, ${type} FROM event_users ORDER BY ${type} DESC LIMIT 10`).all();
}

function getUserRank(userId, type = 'rubans') {
    const allowedColumns = ['rubans', 'cadeaux_surprise_count'];
    if (!allowedColumns.includes(type)) {
        throw new Error(`Invalid leaderboard column: ${type}`);
    }
    const allUsers = db.prepare(`SELECT user_id, ${type} FROM event_users ORDER BY ${type} DESC`).all();
    const userIndex = allUsers.findIndex(user => user.user_id === userId);
    return userIndex !== -1 ? userIndex + 1 : 'Non classé(e)';
}

// --- Fonctions de Réinitialisation ---

function resetEventUser(userId) {
    try {
        db.prepare('DELETE FROM event_users WHERE user_id = ?').run(userId);
        db.prepare('DELETE FROM user_multipliers WHERE user_id = ?').run(userId);
        logger.info(`Utilisateur ${userId} réinitialisé pour l'événement Noël.`);
    } catch (error) {
        logger.error(`Erreur lors de la réinitialisation de l'utilisateur ${userId}:`, error);
        throw error;
    }
}

function resetAllEventUsers() {
    try {
        db.prepare('DELETE FROM event_users').run();
        db.prepare('DELETE FROM user_multipliers').run();
        logger.info("Tous les utilisateurs ont été réinitialisés pour l'événement Noël.");
    } catch (error) {
        logger.error('Erreur lors de la réinitialisation de tous les utilisateurs:', error);
        throw error;
    }
}

module.exports = {
    getEventState,
    setEventState,
    getOrCreateEventUser,
    grantRubans,
    grantEventCurrency,
    grantGifts,
    getActiveMultiplier,
    setMultiplier,
    getMultiplierRemainingTime,
    removeMultiplier,
    addClaimedCalendarReward,
    hasClaimedCalendarReward,
    getCalendarCooldown,
    setCalendarCooldown,
    canClaimCalendarToday,
    getRubanCooldown,
    canClaimRubans,
    setRubanCooldown,
    getLeaderboard,
    getUserRank,
    resetEventUser,
    resetAllEventUsers,
};
