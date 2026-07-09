/** Rôle Discord « Hackeur » sur BLZstarss. */
const DEFAULT_HACKER_ROLE_ID = '1432469784653467701';

function resolveHackerRoleId() {
    return (process.env.REBORN_HACKER_ROLE_ID || process.env.HACKER_ROLE_ID || DEFAULT_HACKER_ROLE_ID).trim();
}

/**
 * @param {import('discord.js').Guild} guild
 */
async function guildHackerRole(guild) {
    const id = resolveHackerRoleId();
    if (!id || !guild) return null;
    return guild.roles.cache.get(id) || guild.roles.fetch(id).catch(() => null);
}

/**
 * @param {import('discord.js').GuildMember} member
 */
function memberHasHackerRole(member) {
    const id = resolveHackerRoleId();
    return Boolean(id && member?.roles?.cache?.has(id));
}

module.exports = { resolveHackerRoleId, guildHackerRole, memberHasHackerRole, DEFAULT_HACKER_ROLE_ID };
