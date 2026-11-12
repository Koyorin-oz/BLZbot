const logger = require('../utils/logger');
const Database = require('better-sqlite3');
const path = require('path');

// DB séparée pour les badges
const { resolveDatabasePath } = require('../../../utils/database-path');
const dbBadges = new Database(resolveDatabasePath(path.join(__dirname, 'badges.sqlite')));

// Activer WAL mode pour les performances
dbBadges.pragma('journal_mode = WAL');

// Créer la table des badges
dbBadges.exec(`
    CREATE TABLE IF NOT EXISTS user_badges (
        user_id TEXT NOT NULL,
        badge_id TEXT NOT NULL,
        earned_at INTEGER NOT NULL,
        PRIMARY KEY (user_id, badge_id)
    );
`);

logger.info('Base de données badges initialisée.');

// Prepared statements
const grantBadgeStmt = dbBadges.prepare('INSERT OR IGNORE INTO user_badges (user_id, badge_id, earned_at) VALUES (?, ?, ?)');
const getUserBadgesStmt = dbBadges.prepare('SELECT badge_id FROM user_badges WHERE user_id = ? ORDER BY earned_at ASC');

function grantBadge(userId, badgeId) {
    grantBadgeStmt.run(userId, badgeId, Date.now());
}

function getUserBadges(userId, limit = 8) {
    if (limit) {
        return dbBadges.prepare('SELECT badge_id FROM user_badges WHERE user_id = ? ORDER BY earned_at ASC LIMIT ?').all(userId, limit);
    }
    return getUserBadgesStmt.all(userId);
}

module.exports = { dbBadges, grantBadge, getUserBadges };
