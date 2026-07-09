const db = require('../database/database');

function dbForGuild(guildId) {
    const mainDb = typeof db.getMainDb === 'function' ? db.getMainDb() : db;
    const testDb = typeof db.getTestDb === 'function' ? db.getTestDb() : null;
    const testG = String(process.env.GUILD_ID || '').trim();
    if (testDb && guildId && String(guildId) === testG) return testDb;
    return mainDb;
}

function sanitizePrivateRoomChannelName(raw) {
    return String(raw || '')
        .replace(/[\r\n\t]/g, ' ')
        .trim()
        .slice(0, 100);
}

/**
 * @param {string} guildId
 * @param {string} userId
 * @returns {string|null}
 */
function getSavedPrivateRoomName(guildId, userId) {
    if (!guildId || !userId) return null;
    const row = dbForGuild(guildId)
        .prepare('SELECT channel_name FROM private_voice_room_prefs WHERE guild_id = ? AND user_id = ?')
        .get(String(guildId), String(userId));
    const name = sanitizePrivateRoomChannelName(row?.channel_name);
    return name || null;
}

/**
 * @param {string} guildId
 * @param {string} userId
 * @param {string} channelName
 */
function savePrivateRoomName(guildId, userId, channelName) {
    const name = sanitizePrivateRoomChannelName(channelName);
    if (!guildId || !userId || !name) return false;
    dbForGuild(guildId)
        .prepare(
            `INSERT INTO private_voice_room_prefs (guild_id, user_id, channel_name, updated_ms)
             VALUES (?, ?, ?, ?)
             ON CONFLICT(guild_id, user_id) DO UPDATE SET
               channel_name = excluded.channel_name,
               updated_ms = excluded.updated_ms`
        )
        .run(String(guildId), String(userId), name, Date.now());
    return true;
}

/**
 * @param {string} guildId
 * @param {import('discord.js').GuildMember} member
 */
function resolvePrivateRoomChannelName(guildId, member) {
    const saved = getSavedPrivateRoomName(guildId, member.id);
    if (saved) return saved;

    const prefix = 'Salon de ';
    const raw =
        String(member.displayName || member.user?.username || 'membre')
            .replace(/[\r\n\t]/g, ' ')
            .trim() || 'membre';
    const maxRest = Math.max(0, 100 - prefix.length);
    return (prefix + raw.slice(0, maxRest)).slice(0, 100);
}

module.exports = {
    sanitizePrivateRoomChannelName,
    getSavedPrivateRoomName,
    savePrivateRoomName,
    resolvePrivateRoomChannelName,
};
