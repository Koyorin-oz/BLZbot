const { PermissionFlagsBits } = require('discord.js');
const logger = require('./logger');

/**
 * Rôle non géré (non « integration ») créé pour le bot : permissions + hiérarchie au-dessus des rôles auto (TOP, niveau, etc.).
 * Désactiver : BOT_AUTO_SERVICE_ROLE=0 dans le .env
 * Nom : BOT_SERVICE_ROLE_NAME (défaut : nom du bot + « · Bot »)
 * Forcer Administrateur sur ce rôle : BOT_SERVICE_ROLE_ADMINISTRATOR=1
 */

function buildServicePermissions() {
    const list = [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.SendMessagesInThreads,
        PermissionFlagsBits.CreatePublicThreads,
        PermissionFlagsBits.CreatePrivateThreads,
        PermissionFlagsBits.EmbedLinks,
        PermissionFlagsBits.AttachFiles,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.AddReactions,
        PermissionFlagsBits.UseExternalEmojis,
        PermissionFlagsBits.UseExternalStickers,
        PermissionFlagsBits.ManageRoles,
        PermissionFlagsBits.ManageChannels,
        PermissionFlagsBits.ManageMessages,
        PermissionFlagsBits.ManageNicknames,
        PermissionFlagsBits.ModerateMembers,
        PermissionFlagsBits.MoveMembers,
        PermissionFlagsBits.MuteMembers,
        PermissionFlagsBits.DeafenMembers,
        PermissionFlagsBits.Connect,
        PermissionFlagsBits.Speak,
        PermissionFlagsBits.PrioritySpeaker,
    ];
    if (String(process.env.BOT_SERVICE_ROLE_ADMINISTRATOR || '').trim() === '1') {
        list.push(PermissionFlagsBits.Administrator);
    }
    return list;
}

/**
 * @param {import('discord.js').Client} client
 */
async function ensureBotServiceRole(client) {
    if (String(process.env.BOT_AUTO_SERVICE_ROLE || '').trim() === '0') {
        return;
    }

    const guildId = String(process.env.GUILD_ID || '').trim();
    if (!/^\d{17,22}$/.test(guildId)) {
        return;
    }

    const guild = await client.guilds.fetch(guildId).catch(() => null);
    if (!guild) {
        logger.warn('[BOT_ROLE] Guilde GUILD_ID introuvable.');
        return;
    }

    await guild.roles.fetch().catch(() => null);

    const me = await guild.members.fetch(client.user.id).catch(() => null);
    if (!me) {
        logger.warn('[BOT_ROLE] Membre bot introuvable sur la guilde.');
        return;
    }

    const roleName = String(process.env.BOT_SERVICE_ROLE_NAME || `${client.user.username} · Bot`).trim().slice(0, 100);
    const perms = buildServicePermissions();

    let role = guild.roles.cache.find((r) => r.name === roleName && !r.managed);

    if (!role) {
        if (!me.permissions.has(PermissionFlagsBits.ManageRoles)) {
            logger.warn(
                '[BOT_ROLE] Impossible de créer le rôle service : le bot n’a pas « Gérer les rôles ». Réinvite avec ce scope ou accorde-la au rôle d’application.'
            );
            return;
        }
        try {
            role = await guild.roles.create({
                name: roleName,
                permissions: perms,
                mentionable: false,
                reason: 'BLZbot — rôle service automatique (permissions + hiérarchie)',
            });
            if (process.env.BLZ_COMPACT_LOG !== '1') {
                logger.info(`[BOT_ROLE] Rôle créé : « ${roleName} »`);
            }
        } catch (e) {
            logger.error(`[BOT_ROLE] Création impossible : ${e.message || e}`);
            return;
        }
    } else {
        try {
            await role.setPermissions(perms, 'BLZbot — sync permissions rôle service');
        } catch (e) {
            logger.warn(`[BOT_ROLE] Mise à jour des permissions : ${e.message || e}`);
        }
    }

    if (!me.roles.cache.has(role.id)) {
        try {
            await me.roles.add(role, 'BLZbot — attacher le rôle service');
        } catch (e) {
            logger.error(`[BOT_ROLE] Impossible d’attribuer le rôle au bot : ${e.message || e}`);
            return;
        }
    }

    const rawPos = String(process.env.BOT_SERVICE_ROLE_POSITION || '').trim();
    let targetPos = null;
    if (/^\d+$/.test(rawPos)) {
        targetPos = parseInt(rawPos, 10);
    }

    if (targetPos !== null) {
        try {
            await role.setPosition(targetPos, { reason: 'BLZbot — position (BOT_SERVICE_ROLE_POSITION)' });
            if (process.env.BLZ_COMPACT_LOG !== '1') {
                logger.info(`[BOT_ROLE] Position fixée à ${targetPos} (BOT_SERVICE_ROLE_POSITION).`);
            }
        } catch (e) {
            logger.warn(`[BOT_ROLE] Position manuelle refusée : ${e.message || e}`);
        }
        return;
    }

    if (!me.permissions.has(PermissionFlagsBits.Administrator)) {
        logger.warn(
            '[BOT_ROLE] Rôle service prêt. Pour le placer **au-dessus** des rôles TOP / niveaux / rangs : soit donne **Administrateur** au bot une fois, soit définis **BOT_SERVICE_ROLE_POSITION** (nombre Discord, ex. 85), soit glisse le rôle manuellement en haut.'
        );
        return;
    }

    try {
        const sorted = [...guild.roles.cache.values()]
            .filter((r) => r.id !== guild.id)
            .sort((a, b) => b.position - a.position);
        const topOther = sorted.find((r) => r.id !== role.id);
        if (!topOther) return;
        const newPos = Math.max(1, topOther.position - 1);
        await role.setPosition(newPos, { reason: 'BLZbot — rôle service juste sous le sommet de la hiérarchie' });
        if (process.env.BLZ_COMPACT_LOG !== '1') {
            logger.info(`[BOT_ROLE] Rôle « ${roleName} » positionné (admin) sous le sommet de la hiérarchie.`);
        }
    } catch (e) {
        logger.warn(`[BOT_ROLE] Repositionnement impossible : ${e.message || e}`);
    }
}

module.exports = { ensureBotServiceRole, buildServicePermissions };
