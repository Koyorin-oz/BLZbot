const path = require('path');
const { migrate } = require('./migrate');
const { resolveDatabasePath } = require('../../../utils/database-path');

const repoRoot = path.join(__dirname, '..', '..', '..');
let Database;
try {
  Database = require(path.join(repoRoot, 'node_modules', 'better-sqlite3'));
} catch {
  Database = require('better-sqlite3');
}

const defaultPath = path.join(__dirname, '..', '..', 'data', 'reborn.sqlite');
const configuredPath = (process.env.REBORN_DB_PATH || '').trim() || defaultPath;
const dbPath = resolveDatabasePath(configuredPath);

const dbDir = path.dirname(dbPath);
require('fs').mkdirSync(dbDir, { recursive: true });

const db = new Database(dbPath);

db.pragma('journal_mode = WAL');
migrate(db);

module.exports = db;
