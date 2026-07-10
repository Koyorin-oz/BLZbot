const path = require('node:path');
const { isBlzTestGuild } = require(path.join(__dirname, '..', '..', '..', 'blzbot-env.js'));

/** Salon tutoriel / bienvenue sur le serveur de test BLZ (fallback si pas d’env). */
const BLZ_TEST_TUTORIAL_CHANNEL_DEFAULT = '1493276591529263185';

/**
 * Salon tutoriel (thread privé) : prod = TUTORIAL_CHANNEL ; test = TEST_TUTORIAL_CHANNEL ou ID par défaut.
 * @param {string | null | undefined} guildId
 * @returns {string | null}
 */
function resolveTutorialChannelId(guildId) {
    if (isBlzTestGuild(guildId)) {
        const t = String(process.env.TEST_TUTORIAL_CHANNEL_ID || '').trim();
        if (/^\d{17,22}$/.test(t)) return t;
        return BLZ_TEST_TUTORIAL_CHANNEL_DEFAULT;
    }
    const p = String(process.env.TUTORIAL_CHANNEL || '').trim();
    return /^\d{17,22}$/.test(p) ? p : null;
}

/**
 * @param {string | null | undefined} guildId
 * @param {string} prodEnvName — ex. LEVEL_UP_CHANNEL
 * @param {string} [testEnvName] — ex. TEST_LEVEL_UP_CHANNEL
 * @returns {string | null}
 */
function resolveChannelIdForGuild(guildId, prodEnvName, testEnvName) {
    if (isBlzTestGuild(guildId)) {
        const t = String((testEnvName && process.env[testEnvName]) || '').trim();
        if (/^\d{17,22}$/.test(t)) return t;
        return null;
    }
    const p = String(process.env[prodEnvName] || '').trim();
    return /^\d{17,22}$/.test(p) ? p : null;
}

function resolveLevelUpChannelId(guildId) {
    return resolveChannelIdForGuild(guildId, 'LEVEL_UP_CHANNEL', 'TEST_LEVEL_UP_CHANNEL');
}

function resolveRankUpChannelId(guildId) {
    return resolveChannelIdForGuild(guildId, 'RANK_UP_CHANNEL', 'TEST_RANK_UP_CHANNEL');
}

function resolveStreakChannelId(guildId) {
    return resolveChannelIdForGuild(guildId, 'STREAK_CHANNEL', 'TEST_STREAK_CHANNEL');
}

function resolveHackerChannelId(guildId) {
    const fromGuild = resolveChannelIdForGuild(guildId, 'HACKER_CHANNEL', 'TEST_HACKER_CHANNEL');
    if (fromGuild) return fromGuild;
    if (!isBlzTestGuild(guildId)) {
        const reborn = String(process.env.REBORN_HACKER_CHANNEL_ID || '').trim();
        if (/^\d{17,22}$/.test(reborn)) return reborn;
    }
    return null;
}

function resolveHackerRoleIdForGuild(guildId) {
    if (isBlzTestGuild(guildId)) {
        const t = String(process.env.TEST_HACKER_ROLE_ID || '').trim();
        if (/^\d{17,22}$/.test(t)) return t;
        return null;
    }
    const p = String(process.env.REBORN_HACKER_ROLE_ID || process.env.HACKER_ROLE_ID || '').trim();
    return /^\d{17,22}$/.test(p) ? p : null;
}

module.exports = {
    resolveTutorialChannelId,
    resolveLevelUpChannelId,
    resolveRankUpChannelId,
    resolveStreakChannelId,
    resolveHackerChannelId,
    resolveHackerRoleIdForGuild,
    resolveChannelIdForGuild,
    BLZ_TEST_TUTORIAL_CHANNEL_DEFAULT,
};
