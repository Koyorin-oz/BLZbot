/**
 * Accès aux commandes de modération : rôle Staff (1172237685763608579) ou permission Discord.
 */
const CONFIG = require('../config.js');
const { PermissionsBitField } = require('discord.js');
const { isBotOwner } = require('./bot-owner');

const DENIED_MOD_CMD_MSG =
    '❌ Vous n\'avez pas l\'autorisation d\'utiliser cette commande (rôle Staff requis ou permission Discord).';

function memberHasStaffRole(member) {
    const roleCache = member?.roles?.cache;
    if (roleCache?.has) {
        if (roleCache.has(CONFIG.STAFF_ROLE_ID)) return true;
        return (CONFIG.STAFF_ROLES || []).some((role) => roleCache.has(role.id));
    }

    const roleIds = Array.isArray(member?.roles) ? member.roles : [];
    return roleIds.includes(CONFIG.STAFF_ROLE_ID)
        || (CONFIG.STAFF_ROLES || []).some((role) => roleIds.includes(role.id));
}

function hasDiscordPermission(permissions, discordPerm) {
    if (permissions == null || discordPerm == null) return false;
    if (typeof permissions.has === 'function') return permissions.has(discordPerm);

    try {
        return new PermissionsBitField(permissions).has(discordPerm);
    } catch {
        return false;
    }
}

/**
 * @param {import('discord.js').GuildMember} member
 * @param {bigint|import('discord.js').PermissionResolvable} [discordPerm]
 */
function memberCanUseModCommand(member, discordPerm, memberPermissions) {
    if (!member) return false;
    const userId = member.user?.id || member.id;
    if (isBotOwner(userId)) return true;
    if (memberHasStaffRole(member)) return true;
    return hasDiscordPermission(memberPermissions, discordPerm)
        || hasDiscordPermission(member.permissions, discordPerm);
}

/**
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 * @param {bigint|import('discord.js').PermissionResolvable} [discordPerm]
 * @returns {{ content: string, flags: number } | null}
 */
function denyUnlessCanMod(interaction, discordPerm) {
    if (memberCanUseModCommand(interaction.member, discordPerm, interaction.memberPermissions)) return null;
    return { content: DENIED_MOD_CMD_MSG, flags: 64 };
}

module.exports = {
    DENIED_MOD_CMD_MSG,
    memberHasStaffRole,
    memberCanUseModCommand,
    denyUnlessCanMod,
};
