const { PermissionsBitField } = require('discord.js');

/** @typedef {'admin'|'moderation'} TicketTier */

/**
 * Rôles autorisés sur le salon staff (serveur principal) selon le type de ticket.
 * @param {object} config — CONFIG.TICKETS
 * @param {TicketTier} tier
 * @returns {string[]}
 */
function getStaffRoleIdsForTier(config, tier) {
    const admins = [...(config.ADMIN_ROLE_IDS || [])];
    const mods = [...(config.MODERATOR_ROLE_IDS || [])];
    if (tier === 'admin') {
        return [...new Set(admins)];
    }
    return [...new Set([...admins, ...mods])];
}

/**
 * @param {import('discord.js').Guild} guild
 * @param {object} config
 * @param {TicketTier} tier
 * @returns {import('discord.js').OverwriteResolvable[]}
 */
function buildMainStaffOverwrites(guild, config, tier) {
    const roleIds = getStaffRoleIdsForTier(config, tier);
    const overwrites = [{ id: guild.roles.everyone, deny: [PermissionsBitField.Flags.ViewChannel] }];

    for (const roleId of roleIds) {
        const role = guild.roles.cache.get(roleId);
        if (!role) {
            console.warn(`[Tickets] Rôle ${roleId} (${tier}) absent sur ${guild.name}.`);
            continue;
        }
        overwrites.push({
            id: role,
            allow: [
                PermissionsBitField.Flags.ViewChannel,
                PermissionsBitField.Flags.SendMessages,
                PermissionsBitField.Flags.ReadMessageHistory,
                PermissionsBitField.Flags.AttachFiles,
            ],
        });
    }
    return overwrites;
}

function tierLabel(tier) {
    return tier === 'admin' ? 'Admin' : 'Modération';
}

function tierPrefix(tier) {
    return tier === 'admin' ? 'admin' : 'mod';
}

module.exports = {
    getStaffRoleIdsForTier,
    buildMainStaffOverwrites,
    tierLabel,
    tierPrefix,
};
