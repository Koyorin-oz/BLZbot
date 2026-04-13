const { AsyncLocalStorage } = require('node:async_hooks');

/** Guilde Discord courante pour les accès SQLite (économie / niveau) — mode test + double serveur. */
const economyGuildId = new AsyncLocalStorage();

/**
 * @template T
 * @param {string | null | undefined} guildId
 * @param {() => T} fn
 * @returns {T}
 */
function runWithEconomyGuild(guildId, fn) {
    return economyGuildId.run(guildId ?? null, fn);
}

/**
 * Clé pour suivre le vocal par serveur (évite qu’un même userId sur test + prod se mélangent).
 * @param {string | null | undefined} guildId
 * @param {string} userId
 */
function voiceTrackingKey(guildId, userId) {
    if (!guildId) return userId;
    return `${guildId}:${userId}`;
}

/**
 * @param {string} key
 * @returns {{ guildId: string | null, userId: string }}
 */
function parseVoiceTrackingKey(key) {
    const i = key.indexOf(':');
    if (i === -1) return { guildId: null, userId: key };
    return { guildId: key.slice(0, i), userId: key.slice(i + 1) };
}

module.exports = {
    economyGuildId,
    runWithEconomyGuild,
    voiceTrackingKey,
    parseVoiceTrackingKey,
};
