/**
 * Accès aux commandes de modération : rôle Staff (1172237685763608579) ou permission Discord.
 */
const CONFIG = require('../config.js');
const { isBotOwner } = require('./bot-owner');

const DENIED_MOD_CMD_MSG =
    '❌ Vous n\'avez pas l\'autorisation d\'utiliser cette commande (rôle Staff requis ou permission Discord).';

function memberHasStaffRole(member) {
    if (!member?.roles?.cache) return false;
    if (member.roles.cache.has(CONFIG.STAFF_ROLE_ID)) return true;
    return (CONFIG.STAFF_ROLES || []).some((r) => member.roles.cache.has(r.id));
}

/**
 * @param {import('discord.js').GuildMember} member
 * @param {bigint|import('discord.js').PermissionResolvable} [discordPerm]
 */
function memberCanUseModCommand(member, discordPerm) {
    if (!member) return false;
    const userId = member.user?.id || member.id;
    if (isBotOwner(userId)) return true;
    if (memberHasStaffRole(member)) return true;
    if (discordPerm != null && member.permissions?.has(discordPerm)) return true;
    return false;
}

/**
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 * @param {bigint|import('discord.js').PermissionResolvable} [discordPerm]
 * @returns {{ content: string, flags: number } | null}
 */
function denyUnlessCanMod(interaction, discordPerm) {
    if (memberCanUseModCommand(interaction.member, discordPerm)) return null;
    return { content: DENIED_MOD_CMD_MSG, flags: 64 };
}

module.exports = {
    DENIED_MOD_CMD_MSG,
    memberHasStaffRole,
    memberCanUseModCommand,
    denyUnlessCanMod,
};
