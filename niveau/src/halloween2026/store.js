const { db } = require('../utils/db-halloween');

function col(name, ddl) {
    const cols = db.prepare('PRAGMA table_info(event_users)').all();
    if (!cols.some((c) => c.name === name)) db.exec(ddl);
}

col('fantomes', 'ALTER TABLE event_users ADD COLUMN fantomes INTEGER NOT NULL DEFAULT 0');
col('colliers', 'ALTER TABLE event_users ADD COLUMN colliers INTEGER NOT NULL DEFAULT 0');
col('perm_xp', 'ALTER TABLE event_users ADD COLUMN perm_xp INTEGER NOT NULL DEFAULT 0');
col('streak_done', 'ALTER TABLE event_users ADD COLUMN streak_done INTEGER NOT NULL DEFAULT 0');
col('msg_mod', 'ALTER TABLE event_users ADD COLUMN msg_mod INTEGER NOT NULL DEFAULT 0');

db.exec(`
    CREATE TABLE IF NOT EXISTS hw_road (
        user_id TEXT NOT NULL,
        quest_id TEXT NOT NULL,
        progress INTEGER NOT NULL DEFAULT 0,
        done INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (user_id, quest_id)
    );
    CREATE TABLE IF NOT EXISTS hw_meta (
        key TEXT PRIMARY KEY,
        value TEXT
    );
    CREATE TABLE IF NOT EXISTS hw_curse (
        user_id TEXT PRIMARY KEY,
        until_ms INTEGER NOT NULL,
        by_user TEXT
    );
`);

function meta(key, value) {
    if (value === undefined) {
        const row = db.prepare('SELECT value FROM hw_meta WHERE key = ?').get(key);
        return row ? row.value : null;
    }
    db.prepare('INSERT INTO hw_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, String(value));
    return value;
}

function isDeployed(guildId) {
    return meta(`deployed:${guildId}`) === '1';
}

function markDeployed(guildId) {
    meta(`deployed:${guildId}`, '1');
}

function roadRow(userId, questId) {
    let row = db.prepare('SELECT * FROM hw_road WHERE user_id = ? AND quest_id = ?').get(userId, questId);
    if (!row) {
        db.prepare('INSERT INTO hw_road (user_id, quest_id) VALUES (?, ?)').run(userId, questId);
        row = db.prepare('SELECT * FROM hw_road WHERE user_id = ? AND quest_id = ?').get(userId, questId);
    }
    return row;
}

function addProgress(userId, questId, amount, goal) {
    const row = roadRow(userId, questId);
    if (row.done) return { justDone: false, row };
    const progress = Math.min(goal, row.progress + amount);
    const done = progress >= goal ? 1 : 0;
    db.prepare('UPDATE hw_road SET progress = ?, done = ? WHERE user_id = ? AND quest_id = ?').run(progress, done, userId, questId);
    return { justDone: done === 1 && row.done === 0, row: { ...row, progress, done } };
}

function bumpMsg(userId) {
    const { getOrCreateEventUser } = require('../utils/db-halloween');
    const u = getOrCreateEventUser(userId);
    const mod = (u.msg_mod || 0) + 1;
    const citrouille = mod % 3 === 0 ? 1 : 0;
    const next = mod % 3;
    db.prepare('UPDATE event_users SET msg_mod = ? WHERE user_id = ?').run(next, userId);
    return citrouille;
}

function addItem(userId, field, n) {
    const { getOrCreateEventUser } = require('../utils/db-halloween');
    getOrCreateEventUser(userId);
    db.prepare(`UPDATE event_users SET ${field} = ${field} + ? WHERE user_id = ?`).run(n, userId);
}

function takeItem(userId, field, n) {
    const { getOrCreateEventUser } = require('../utils/db-halloween');
    const u = getOrCreateEventUser(userId);
    if ((u[field] || 0) < n) return false;
    db.prepare(`UPDATE event_users SET ${field} = ${field} - ? WHERE user_id = ?`).run(n, userId);
    return true;
}

function setFlag(userId, field, value) {
    const { getOrCreateEventUser } = require('../utils/db-halloween');
    getOrCreateEventUser(userId);
    db.prepare(`UPDATE event_users SET ${field} = ? WHERE user_id = ?`).run(value, userId);
}

function curse(userId, byUser, ms = 2 * 60 * 60 * 1000) {
    db.prepare('INSERT INTO hw_curse (user_id, until_ms, by_user) VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET until_ms = excluded.until_ms, by_user = excluded.by_user')
        .run(userId, Date.now() + ms, byUser);
}

function clearCurse(userId) {
    db.prepare('DELETE FROM hw_curse WHERE user_id = ?').run(userId);
}

function curseUntil(userId) {
    const row = db.prepare('SELECT until_ms FROM hw_curse WHERE user_id = ?').get(userId);
    if (!row) return 0;
    if (row.until_ms <= Date.now()) {
        clearCurse(userId);
        return 0;
    }
    return row.until_ms;
}

function isCursed(userId) {
    return curseUntil(userId) > Date.now();
}

function hasPermXp(userId) {
    const { getOrCreateEventUser } = require('../utils/db-halloween');
    return getOrCreateEventUser(userId).perm_xp === 1;
}

function completedCount(userId) {
    const row = db.prepare('SELECT COUNT(*) AS n FROM hw_road WHERE user_id = ? AND done = 1').get(userId);
    return row?.n || 0;
}

module.exports = {
    db,
    meta,
    isDeployed,
    markDeployed,
    roadRow,
    addProgress,
    bumpMsg,
    addItem,
    takeItem,
    setFlag,
    curse,
    clearCurse,
    curseUntil,
    isCursed,
    hasPermXp,
    completedCount,
};
