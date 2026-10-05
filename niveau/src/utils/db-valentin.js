const Database = require("better-sqlite3");
const path = require("path");
const logger = require("./logger");
const { parisDateKey } = require("../../../utils/paris-time");

// Crée une nouvelle instance de la base de données pour l'événement
const dbPath = path.join(__dirname, "../database/Valentin.sqlite");
const db = new Database(dbPath);
logger.info("Connexion à la base de données Valentin.sqlite établie.");

// Optimisations et configuration de la base de données
db.pragma("journal_mode = WAL");
db.pragma("synchronous = 1");

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
            coeurs INTEGER NOT NULL DEFAULT 0,
            claimed_rewards TEXT NOT NULL DEFAULT '[]'
        );
    `);
  db.exec(`
        CREATE TABLE IF NOT EXISTS marriages (
            user1_id TEXT NOT NULL,
            user2_id TEXT NOT NULL,
            timestamp INTEGER NOT NULL,
            PRIMARY KEY (user1_id, user2_id)
        );
    `);
  db.exec(`
        CREATE TABLE IF NOT EXISTS daily_activity (
            user_id TEXT NOT NULL,
            day TEXT NOT NULL,
            message_count INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (user_id, day)
        );
    `);
  db.exec(`
        CREATE TABLE IF NOT EXISTS valentin_unlocks (
            user_id TEXT,
            unlock_id TEXT,
            timestamp INTEGER,
            PRIMARY KEY (user_id, unlock_id)
        );
    `);
  logger.info("Tables de la base de données Valentin vérifiées/créées.");

  const event = db
    .prepare("SELECT * FROM event_state WHERE event_name = ?")
    .get("valentin");
  if (!event) {
    db.prepare(
      "INSERT INTO event_state (event_name, is_active) VALUES (?, ?)",
    ).run("valentin", 0);
    logger.info(
      "Entrée initiale pour l'événement 'valentin' créée et désactivée par défaut.",
    );
  }
}
setupTables();

// --- Fonctions de Gestion de l'Événement ---

function getEventState(eventName = "valentin") {
  const row = db
    .prepare("SELECT is_active FROM event_state WHERE event_name = ?")
    .get(eventName);
  return row ? row.is_active === 1 : false;
}

function setEventState(eventName = "valentin", isActive) {
  const stateValue = isActive ? 1 : 0;
  db.prepare("UPDATE event_state SET is_active = ? WHERE event_name = ?").run(
    stateValue,
    eventName,
  );
  logger.info(
    `L'événement '${eventName}' est maintenant ${isActive ? "ACTIF" : "INACTIF"}.`,
  );
}

// --- Fonctions de Gestion des Utilisateurs de l'Événement ---

function getOrCreateEventUser(userId, username) {
  let user = db
    .prepare("SELECT * FROM event_users WHERE user_id = ?")
    .get(userId);
  if (!user) {
    db.prepare("INSERT INTO event_users (user_id, username) VALUES (?, ?)").run(
      userId,
      username || "unknown",
    );
    user = db
      .prepare("SELECT * FROM event_users WHERE user_id = ?")
      .get(userId);
  } else if (username && username !== "unknown" && user.username !== username) {
    db.prepare("UPDATE event_users SET username = ? WHERE user_id = ?").run(
      username,
      userId,
    );
    user.username = username;
  }
  user.claimed_rewards = JSON.parse(user.claimed_rewards);
  return user;
}

function getUsernameFromMainDb(userId) {
  const mainDb = require("../database/database");
  try {
    const user = mainDb
      .prepare("SELECT username FROM users WHERE id = ?")
      .get(userId);
    return user ? user.username : "unknown";
  } catch (error) {
    logger.error(
      `Erreur lors de la récupération du username pour ${userId}:`,
      error,
    );
    return "unknown";
  }
}

function grantEventCurrency(userId, { coeurs = 0 }) {
  const username = getUsernameFromMainDb(userId);
  getOrCreateEventUser(userId, username);

  db.prepare(
    `
        UPDATE event_users 
        SET coeurs = coeurs + ?
        WHERE user_id = ?
    `,
  ).run(coeurs, userId);

  const updatedUser = getOrCreateEventUser(userId, username);
  return updatedUser;
}

// --- Fonctions de Mariage ---

function getPartner(userId) {
  const row = db
    .prepare("SELECT * FROM marriages WHERE user1_id = ? OR user2_id = ?")
    .get(userId, userId);
  if (!row) return null;
  return row.user1_id === userId ? row.user2_id : row.user1_id;
}

function createMarriage(user1Id, user2Id) {
  // Supprimer tout mariage existant pour les deux utilisateurs
  removeMarriage(user1Id);
  removeMarriage(user2Id);

  db.prepare(
    "INSERT INTO marriages (user1_id, user2_id, timestamp) VALUES (?, ?, ?)",
  ).run(user1Id, user2Id, Date.now());
  logger.info(`Mariage créé entre ${user1Id} et ${user2Id}`);
}

function removeMarriage(userId) {
  db.prepare("DELETE FROM marriages WHERE user1_id = ? OR user2_id = ?").run(
    userId,
    userId,
  );
}

// --- Fonctions d'Activité ---

function incrementDailyMessageCount(userId) {
  const today = parisDateKey();
  db.prepare(
    `
        INSERT INTO daily_activity (user_id, day, message_count)
        VALUES (?, ?, 1)
        ON CONFLICT(user_id, day) DO UPDATE SET message_count = message_count + 1
    `,
  ).run(userId, today);
}

function getDailyMessageCount(userId) {
  const today = parisDateKey();
  const row = db
    .prepare(
      "SELECT message_count FROM daily_activity WHERE user_id = ? AND day = ?",
    )
    .get(userId, today);
  return row ? row.message_count : 0;
}

// --- Fonctions de Déblocage (Items Passifs) ---

const hasUnlockedStmt = db.prepare(
  "SELECT 1 FROM valentin_unlocks WHERE user_id = ? AND unlock_id = ?",
);
const unlockItemStmt = db.prepare(
  "INSERT OR IGNORE INTO valentin_unlocks (user_id, unlock_id, timestamp) VALUES (?, ?, ?)",
);

function hasUnlocked(userId, unlockId) {
  return !!hasUnlockedStmt.get(userId, unlockId);
}

function unlockItem(userId, unlockId) {
  unlockItemStmt.run(userId, unlockId, Date.now());
}

function getAllUnlocks(userId) {
  return db
    .prepare(
      "SELECT unlock_id, timestamp FROM valentin_unlocks WHERE user_id = ?",
    )
    .all(userId);
}

function getLeaderboard(type = "coeurs") {
  const allowedColumns = ["coeurs"];
  if (!allowedColumns.includes(type)) {
    throw new Error(`Invalid leaderboard column: ${type}`);
  }
  return db
    .prepare(
      `SELECT user_id, username, ${type} FROM event_users ORDER BY ${type} DESC LIMIT 10`,
    )
    .all();
}

function getUserRank(userId, type = "coeurs") {
  const allowedColumns = ["coeurs"];
  if (!allowedColumns.includes(type)) {
    throw new Error(`Invalid leaderboard column: ${type}`);
  }
  const allUsers = db
    .prepare(`SELECT user_id, ${type} FROM event_users ORDER BY ${type} DESC`)
    .all();
  const userIndex = allUsers.findIndex((user) => user.user_id === userId);
  return userIndex !== -1 ? userIndex + 1 : "Non classé(e)";
}

function getMarriageTimestamp(userId) {
  const row = db
    .prepare(
      "SELECT timestamp FROM marriages WHERE user1_id = ? OR user2_id = ?",
    )
    .get(userId, userId);
  return row ? row.timestamp : null;
}

module.exports = {
  db,
  getEventState,
  setEventState,
  getOrCreateEventUser,
  grantEventCurrency,
  getPartner,
  createMarriage,
  removeMarriage,
  getMarriageTimestamp,
  incrementDailyMessageCount,
  getDailyMessageCount,
  hasUnlocked,
  unlockItem,
  getAllUnlocks,
  getLeaderboard,
  getUserRank,
};
