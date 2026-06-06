const db = require('../database/database');

function createCountdown(row) {
    const stmt = db.prepare(`
        INSERT INTO countdowns (guild_id, channel_id, message_id, title, subtitle, target_ms, created_by, created_at, active)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
    `);
    const info = stmt.run(
        row.guildId,
        row.channelId || null,
        row.messageId || null,
        row.title,
        row.subtitle || null,
        row.targetMs,
        row.createdBy,
        Date.now(),
    );
    return info.lastInsertRowid;
}

function updateMessage(id, channelId, messageId) {
    db.prepare('UPDATE countdowns SET channel_id = ?, message_id = ? WHERE id = ?').run(channelId, messageId, id);
}

function listActive(guildId) {
    return db
        .prepare(
            'SELECT * FROM countdowns WHERE guild_id = ? AND active = 1 ORDER BY target_ms ASC',
        )
        .all(guildId);
}

function listAllActive() {
    return db.prepare('SELECT * FROM countdowns WHERE active = 1 ORDER BY target_ms ASC').all();
}

function getById(id) {
    return db.prepare('SELECT * FROM countdowns WHERE id = ?').get(id);
}

function deactivate(id) {
    db.prepare('UPDATE countdowns SET active = 0 WHERE id = ?').run(id);
}

module.exports = {
    createCountdown,
    updateMessage,
    listActive,
    listAllActive,
    getById,
    deactivate,
};
