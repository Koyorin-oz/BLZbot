const path = require('node:path');
const { getSlashDeployGuildIds } = require(path.join(__dirname, '..', '..', '..', 'blzbot-env.js'));

function collectBlzGuildIds() {
    return getSlashDeployGuildIds();
}

/**
 * @param {import('discord.js').Client} client
 * @param {string} userId
 * @param {(member: import('discord.js').GuildMember, guild: import('discord.js').Guild) => void | Promise<void>} fn
 */
async function forEachMemberInBlzGuilds(client, userId, fn) {
    for (const gid of collectBlzGuildIds()) {
        const guild =
            client.guilds.cache.get(gid) ?? (await client.guilds.fetch(gid).catch(() => null));
        if (!guild) continue;
        const member = await guild.members.fetch(userId).catch(() => null);
        if (member) await fn(member, guild);
    }
}

module.exports = { collectBlzGuildIds, forEachMemberInBlzGuilds };
