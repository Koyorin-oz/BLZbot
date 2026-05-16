const path = require('path');
const Database = require('better-sqlite3');
const { migrate } = require('./migrate');

const defaultPath = path.join(__dirname, '..', '..', 'data', 'reborn.sqlite');
const dbPath = (process.env.REBORN_DB_PATH || '').trim() || defaultPath;

const dbDir = path.dirname(dbPath);
require('fs').mkdirSync(dbDir, { recursive: true });

const db = new Database(dbPath);

db.pragma('journal_mode = WAL');
migrate(db);

module.exports = db;
