const Database = require('better-sqlite3');
const path = require('path');
const logger = require('./logger');
const { resolveDatabasePath } = require('../../../utils/database-path');

const dbPath = resolveDatabasePath(path.resolve(__dirname, '../database/giveaway.sqlite'));
const db = new Database(dbPath);
logger.info('Connexion à la base de données giveaway.sqlite établie.');

db.pragma('journal_mode = WAL');
db.pragma('synchronous = 1');

function setupTables() {
    db.exec(`CREATE TABLE IF NOT EXISTS giveaways (id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id TEXT NOT NULL, channel_id TEXT NOT NULL, message_id TEXT, title TEXT NOT NULL, description TEXT, winner_count INTEGER NOT NULL DEFAULT 1, duration INTEGER NOT NULL, created_at INTEGER NOT NULL, ends_at INTEGER NOT NULL, is_active INTEGER NOT NULL DEFAULT 1, creator_id TEXT NOT NULL, repeat_interval INTEGER NOT NULL DEFAULT 0);`);
    db.exec(`CREATE TABLE IF NOT EXISTS giveaway_rewards (id INTEGER PRIMARY KEY AUTOINCREMENT, giveaway_id INTEGER NOT NULL, type TEXT NOT NULL, value TEXT NOT NULL, FOREIGN KEY (giveaway_id) REFERENCES giveaways(id) ON DELETE CASCADE);`);
    db.exec(`CREATE TABLE IF NOT EXISTS giveaway_conditions (id INTEGER PRIMARY KEY AUTOINCREMENT, giveaway_id INTEGER NOT NULL, type TEXT NOT NULL, value TEXT NOT NULL, FOREIGN KEY (giveaway_id) REFERENCES giveaways(id) ON DELETE CASCADE);`);
    db.exec(`CREATE TABLE IF NOT EXISTS giveaway_participants (giveaway_id INTEGER NOT NULL, user_id TEXT NOT NULL, joined_at INTEGER NOT NULL, PRIMARY KEY (giveaway_id, user_id), FOREIGN KEY (giveaway_id) REFERENCES giveaways(id) ON DELETE CASCADE);`);
    logger.info('Tables de la base de données giveaway vérifiées/créées.');

    // Migration : ajouter la colonne manquante (APRÈS la création des tables)
    try {
        const columns = db.prepare('PRAGMA table_info(giveaways)').all();
        const hasRepeatInterval = columns.some(col => col.name === 'repeat_interval');
        if (!hasRepeatInterval) {
            db.exec('ALTER TABLE giveaways ADD COLUMN repeat_interval INTEGER NOT NULL DEFAULT 0');
            logger.info('Colonne "repeat_interval" ajoutée à la table "giveaways".');
        }
    } catch (error) {
        logger.error('Erreur lors de la migration de la base de données giveaway:', error);
    }
}
setupTables();

function createGiveaway(guildId, channelId, title, description, winnerCount, duration, creatorId, rewards = [], conditions = [], repeatInterval = 0) {
    const now = Date.now();
    const endsAt = now + duration;
    const insertGiveaway = db.prepare(`INSERT INTO giveaways (guild_id, channel_id, title, description, winner_count, duration, created_at, ends_at, creator_id, repeat_interval) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    const result = insertGiveaway.run(guildId, channelId, title, description, winnerCount, duration, now, endsAt, creatorId, repeatInterval);
    const giveawayId = result.lastInsertRowid;

    const insertReward = db.prepare('INSERT INTO giveaway_rewards (giveaway_id, type, value) VALUES (?, ?, ?)');
    rewards.forEach(reward => insertReward.run(giveawayId, reward.type, reward.value));

    const insertCondition = db.prepare('INSERT INTO giveaway_conditions (giveaway_id, type, value) VALUES (?, ?, ?)');
    conditions.forEach(condition => insertCondition.run(giveawayId, condition.type, condition.value));

    return giveawayId;
}

function updateGiveawayMessageId(giveawayId, messageId) {
    db.prepare('UPDATE giveaways SET message_id = ? WHERE id = ?').run(messageId, giveawayId);
}

function getGiveaway(giveawayId) {
    const giveaway = db.prepare('SELECT * FROM giveaways WHERE id = ?').get(giveawayId);
    if (!giveaway) return null;
    giveaway.rewards = db.prepare('SELECT * FROM giveaway_rewards WHERE giveaway_id = ?').all(giveawayId);
    giveaway.conditions = db.prepare('SELECT * FROM giveaway_conditions WHERE giveaway_id = ?').all(giveawayId);
    giveaway.participants = db.prepare('SELECT user_id FROM giveaway_participants WHERE giveaway_id = ?').all(giveawayId).map(p => p.user_id);
    return giveaway;
}

function addParticipant(giveawayId, userId) {
    db.prepare('INSERT OR IGNORE INTO giveaway_participants (giveaway_id, user_id, joined_at) VALUES (?, ?, ?)').run(giveawayId, userId, Date.now());
}

function removeParticipant(giveawayId, userId) {
    return db.prepare('DELETE FROM giveaway_participants WHERE giveaway_id = ? AND user_id = ?').run(giveawayId, userId);
}

function canParticipate(giveawayId, userId, userData) {
    const conditions = db.prepare('SELECT * FROM giveaway_conditions WHERE giveaway_id = ?').all(giveawayId);

    // 1. Check exclusions first (Blocking)
    const excludedRoles = conditions.filter(c => c.type === 'role_excluded');
    for (const condition of excludedRoles) {
        if (userData.roles?.includes(condition.value)) return false;
    }

    // 2. Check requirements (OR logic: ANY required role allows entry)
    const requiredRoles = conditions.filter(c => c.type === 'role_required');
    if (requiredRoles.length > 0) {
        const hasRequiredRole = requiredRoles.some(condition => userData.roles?.includes(condition.value));
        if (!hasRequiredRole) return false; // Has NO required roles
    }

    return true;
}

function endGiveaway(giveawayId) {
    const giveaway = getGiveaway(giveawayId);
    if (!giveaway || !giveaway.is_active) return null;

    db.prepare('UPDATE giveaways SET is_active = 0 WHERE id = ?').run(giveawayId);

    const participants = giveaway.participants;
    let winners = [];
    if (participants.length > 0) {
        const shuffled = [...participants].sort(() => 0.5 - Math.random());
        const winnerCount = Math.min(giveaway.winner_count, participants.length);
        winners = shuffled.slice(0, winnerCount);
    }

    return { winners, rewards: giveaway.rewards, participantCount: participants.length };
}

function getExpiredGiveaways() {
    return db.prepare('SELECT * FROM giveaways WHERE is_active = 1 AND ends_at <= ?').all(Date.now());
}

module.exports = {
    createGiveaway,
    updateGiveawayMessageId,
    getGiveaway,
    addParticipant,
    canParticipate,
    endGiveaway,
    getExpiredGiveaways,
    removeParticipant
};