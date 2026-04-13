const roleConfig = require('../config/role.config.json');
const logger = require('./logger');

let _warnedLevelRoles50013 = false;

function logRoleApiError(context, member, err) {
    const code = err && err.code;
    const msg = err && (err.message || String(err));
    if (code === 50013) {
        if (!_warnedLevelRoles50013) {
            _warnedLevelRoles50013 = true;
            logger.warn(
                'Rôles de niveau — Missing Permissions (50013) : rôle du bot au-dessus des rôles de niveau + « Gérer les rôles ».'
            );
        }
        return;
    }
    logger.error(`${context} (${member?.user?.tag || member?.id}):`, msg);
}

const LEVEL_ROLES = roleConfig.levelRoles.thresholds;

// Seuils triés pour éviter les problèmes d'ordre JavaScript
const SORTED_THRESHOLDS = Object.keys(LEVEL_ROLES).map(Number).sort((a, b) => a - b);

// Anciens rôles à retirer lors de la mise à jour
const LEGACY_ROLES = roleConfig.levelRoles.legacy;

/**
 * Détermine le nom du rôle approprié pour un niveau donné.
 * @param {number} level Le niveau de l'utilisateur.
 * @returns {string|null} Le nom du rôle ou null.
 */
function getRoleNameForLevel(level) {
    let roleName = null;
    // Parcourir les seuils dans l'ordre croissant
    for (const threshold of SORTED_THRESHOLDS) {
        if (level >= threshold) {
            roleName = LEVEL_ROLES[threshold];
        } else {
            break;
        }
    }
    return roleName;
}

/**
 * Met à jour les rôles de niveau d'un membre en fonction de son nouveau niveau.
 * @param {import('discord.js').GuildMember} member Le membre à mettre à jour.
 * @param {number} newLevel Le nouveau niveau du membre.
 */
async function updateLevelRoles(member, newLevel) {
    if (!member) return;

    const correctRoleName = getRoleNameForLevel(newLevel);
    if (!correctRoleName) return; // Pas de rôle défini pour ce palier.

    const normalize = (str) => str.normalize("NFD").replace(/[\u0300-\u036f]/g, "");

    const allLevelRoleNames = Object.values(LEVEL_ROLES);
    // Filtrage insensible aux accents
    const rolesToRemove = member.roles.cache.filter(role => {
        const normRoleName = normalize(role.name);

        // Est-ce un nouveau rôle qui n'est PAS le bon ?
        const isIncorrectNewRole = allLevelRoleNames.some(name => normalize(name) === normRoleName) && normRoleName !== normalize(correctRoleName);

        // Est-ce un ancien rôle obsolète ?
        const isLegacyRole = LEGACY_ROLES.some(name => normalize(name) === normRoleName);

        return isIncorrectNewRole || isLegacyRole;
    });

    // Retirer les anciens rôles de niveau si nécessaire
    if (rolesToRemove.size > 0) {
        try {
            await member.roles.remove(rolesToRemove);
        } catch (e) {
            logRoleApiError('Rôles de niveau — retrait', member, e);
        }
    }

    // Si le membre a déjà le bon rôle (vérification normalisée), on ne fait rien.
    if (member.roles.cache.some(role => normalize(role.name) === normalize(correctRoleName))) {
        return;
    }

    // Chercher le rôle sur le serveur (Exact OU Normalisé)
    let roleToAssign = member.guild.roles.cache.find(r => r.name === correctRoleName);
    if (!roleToAssign) {
        roleToAssign = member.guild.roles.cache.find(r => normalize(r.name) === normalize(correctRoleName));
    }

    // Si le rôle n'existe pas, le créer.
    if (!roleToAssign) {
        try {
            console.log(`Création du rôle de niveau : "${correctRoleName}"`);
            roleToAssign = await member.guild.roles.create({
                name: correctRoleName,
                reason: `Rôle de niveau automatique pour le niveau ${newLevel}`,
                // La position et la couleur peuvent être définies ici si nécessaire.
            });
        } catch (e) {
            logRoleApiError(`Création rôle niveau "${correctRoleName}"`, member, e);
            return;
        }
    }

    // Assigner le nouveau rôle.
    try {
        await member.roles.add(roleToAssign);
    } catch (e) {
        logRoleApiError("Rôles de niveau — ajout", member, e);
    }
}

module.exports = { updateLevelRoles };
