const db = require('../database/database');

/** Max 4 lignes de paires de boutons + 1 ligne navigation = 5 (limite Discord). */
const PAGE_SIZE = 4;

/**
 * Enregistre un morceau joué / ajouté à la file pour l’utilisateur (serveur courant, DB économie).
 * @param {string} guildId
 * @param {string} userId
 * @param {string} title
 * @param {string} url
 */
function recordUserPlayedTrack(guildId, userId, title, url) {
    if (!guildId || !userId || !url) return;
    const t = String(title || 'Sans titre').slice(0, 200);
    const now = Date.now();
    try {
        db.prepare(
            `INSERT INTO user_youtube_playlist (guild_id, user_id, title, url, added_at)
             VALUES (?, ?, ?, ?, ?)
             ON CONFLICT(guild_id, user_id, url) DO UPDATE SET
               title = excluded.title,
               added_at = excluded.added_at`
        ).run(String(guildId), String(userId), t, String(url), now);
    } catch (e) {
        /* table absente ou erreur — ne pas bloquer la musique */
    }
}

/**
 * @param {string} guildId
 * @param {string} userId
 * @returns {number}
 */
function countUserPlaylist(guildId, userId) {
    try {
        const row = db
            .prepare(
                'SELECT COUNT(*) AS c FROM user_youtube_playlist WHERE guild_id = ? AND user_id = ?'
            )
            .get(String(guildId), String(userId));
        return row?.c ?? 0;
    } catch {
        return 0;
    }
}

/**
 * @param {string} guildId
 * @param {string} userId
 * @param {number} page 0-based
 */
function getUserPlaylistPage(guildId, userId, page) {
    const offset = Math.max(0, page) * PAGE_SIZE;
    try {
        return db
            .prepare(
                `SELECT id, title, url, added_at FROM user_youtube_playlist
                 WHERE guild_id = ? AND user_id = ?
                 ORDER BY added_at DESC
                 LIMIT ? OFFSET ?`
            )
            .all(String(guildId), String(userId), PAGE_SIZE, offset);
    } catch {
        return [];
    }
}

/**
 * @param {string} guildId
 * @param {string} userId
 * @param {number} rowId
 */
function getPlaylistRow(guildId, userId, rowId) {
    try {
        return db
            .prepare(
                `SELECT id, title, url FROM user_youtube_playlist
                 WHERE id = ? AND guild_id = ? AND user_id = ?`
            )
            .get(rowId, String(guildId), String(userId));
    } catch {
        return null;
    }
}

/**
 * @param {string} customId
 * @returns {{ kind: 'play' | 'queue' | 'goto', guildId: string, userId: string, rowId?: number, page?: number } | null}
 */
function parsePlaylistButtonId(customId) {
    if (!customId.startsWith('blzmpl:')) return null;
    const parts = customId.split(':');
    if (parts.length !== 5) return null;
    const [, kind, guildId, userId, payload] = parts;
    if (!/^\d{17,22}$/.test(guildId) || !/^\d{17,22}$/.test(userId)) return null;
    if (kind === 'g') {
        const page = parseInt(payload, 10);
        if (Number.isNaN(page) || page < 0) return null;
        return { kind: 'goto', guildId, userId, page };
    }
    if (kind === 'j' || kind === 'q') {
        const rowId = parseInt(payload, 10);
        if (Number.isNaN(rowId)) return null;
        return { kind: kind === 'j' ? 'play' : 'queue', guildId, userId, rowId };
    }
    return null;
}

function idPlay(guildId, userId, rowId) {
    return `blzmpl:j:${guildId}:${userId}:${rowId}`;
}

function idQueue(guildId, userId, rowId) {
    return `blzmpl:q:${guildId}:${userId}:${rowId}`;
}

/** @param {number} pageIndex 0-based page to show */
function idGotoPage(guildId, userId, pageIndex) {
    return `blzmpl:g:${guildId}:${userId}:${pageIndex}`;
}

module.exports = {
    PAGE_SIZE,
    recordUserPlayedTrack,
    countUserPlaylist,
    getUserPlaylistPage,
    getPlaylistRow,
    parsePlaylistButtonId,
    idPlay,
    idQueue,
    idGotoPage,
};
