const { Colors } = require('discord.js');
const logger = require('../utils/logger');
const roleConfig = require('../config/role.config.json');

// La liste complète des rangs, ordonnée par points croissants
const RANKS = roleConfig.rankRoles.ranks;

// Rangs principaux pour les rôles de catégorie (ex: rôle "Or")
const MAIN_RANKS = roleConfig.rankRoles.mainRanks;

// Rangs qui sont "verrouillés" une fois atteints - l'utilisateur garde le rôle et l'affichage même en perdant des points
const LOCKED_RANKS = roleConfig.rankRoles.lockedRanks;

let _warnedRankRoles50013 = false;

/**
 * Détermine le rang d'un utilisateur en fonction de ses points.
 * @param {number} points Le nombre de points de l'utilisateur.
 * @returns {object} L'objet du rang correspondant.
 */
function getRankFromPoints(points) {
    let currentRank = RANKS[0];
    for (const rank of RANKS) {
        if (points >= rank.points) {
            currentRank = rank;
        } else {
            break;
        }
    }
    return currentRank;
}

const db = require('../database/database');

// Prepared statements pour peak_rank
const getPeakRankStmt = db.prepare('SELECT peak_rank FROM users WHERE id = ?');
const updatePeakRankStmt = db.prepare('UPDATE users SET peak_rank = ? WHERE id = ?');

/**
 * Vérifie si un rang est verrouillé (Mythique I, II ou GOAT).
 * @param {string} rankName Le nom du rang.
 * @returns {boolean} True si le rang est verrouillé.
 */
function isRankLocked(rankName) {
    return LOCKED_RANKS.includes(rankName);
}

/**
 * Retourne le rang à afficher pour un utilisateur.
 * Si l'utilisateur a atteint un rang verrouillé (Mythique+) et a perdu des points,
 * on affiche son peak_rank au lieu de son rang actuel.
 * @param {string} userId L'ID de l'utilisateur.
 * @param {number} currentPoints Les points actuels de l'utilisateur.
 * @returns {object} L'objet du rang à afficher.
 */
function getDisplayRank(userId, currentPoints) {
    const currentRank = getRankFromPoints(currentPoints);
    const user = getPeakRankStmt.get(userId);

    if (!user?.peak_rank) return currentRank;

    const peakRankObj = RANKS.find(r => r.name === user.peak_rank);
    if (!peakRankObj) return currentRank;

    // Si le peak_rank est un rang verrouillé ET le rang actuel est inférieur, afficher le peak_rank
    if (isRankLocked(user.peak_rank) && currentRank.points < peakRankObj.points) {
        return peakRankObj;
    }

    return currentRank;
}
const { checkQuestProgress } = require('./quests');

require('dotenv').config(); // Pour accéder à process.env.LEVEL_UP_CHANNEL

const getUserPointsStmt = db.prepare('SELECT points FROM users WHERE id = ?');

/**
 * Met à jour les rôles de rang d'un utilisateur en fonction de ses points.
 * @param {import('discord.js').Client} client Le client Discord.
 * @param {string} userId L'ID de l'utilisateur.
 */
async function updateUserRank(client, userId) {
    try {
        const { economyGuildId } = require('./economy-scope');
        const { resolveRankUpChannelId } = require('./blz-guild-channels');
        const targetGuildId = String(economyGuildId.getStore() || process.env.GUILD_ID || '').trim();
        if (!/^\d{17,22}$/.test(targetGuildId)) return;
        const guild = await client.guilds.fetch(targetGuildId).catch(() => null);
        if (!guild) return;

        const member = await guild.members.fetch(userId).catch(() => null);
        if (!member) return; // L'utilisateur n'est plus dans le serveur

        const user = getUserPointsStmt.get(userId);
        if (!user) return;

        const newRank = getRankFromPoints(user.points);
        const newMainRankName = newRank.name.split(' ')[0];

        // --- Récupérer le peak_rank de l'utilisateur ---
        const peakRankData = getPeakRankStmt.get(userId);
        const currentPeakRank = peakRankData?.peak_rank || null;
        const currentPeakRankObj = currentPeakRank ? RANKS.find(r => r.name === currentPeakRank) : null;

        // --- Mettre à jour le peak_rank si le nouveau rang est plus élevé ---
        if (!currentPeakRankObj || newRank.points > currentPeakRankObj.points) {
            updatePeakRankStmt.run(newRank.name, userId);
            logger.info(`Peak rank mis à jour pour ${member.user.username}: ${newRank.name}`);
        }

        // --- Déterminer l'ancien rang pour la notification ---
        const allRankNames = RANKS.map(r => r.name);
        const userRankRoles = member.roles.cache.filter(role => allRankNames.includes(role.name));
        let oldRank = null;
        if (userRankRoles.size > 0) {
            const userRanks = RANKS.filter(r => userRankRoles.some(role => role.name === r.name));
            if (userRanks.length > 0) {
                // Trouver le rang le plus élevé que l'utilisateur possède actuellement
                oldRank = userRanks.reduce((max, r) => r.points > max.points ? r : max, userRanks[0]);
            }
        }

        // --- Logique de verrouillage des rangs Mythique+ ---
        // Si l'ancien rang (rôle actuel) est verrouillé et qu'on essaie de descendre, on bloque
        if (oldRank && isRankLocked(oldRank.name) && newRank.points < oldRank.points) {
            logger.info(`Derank bloqué pour ${member.user.username}: le rang ${oldRank.name} est verrouillé.`);
            return; // On garde les rôles actuels
        }

        // Si le rang n'a pas changé, on ne fait rien pour les rôles, mais on vérifie les quêtes
        if (oldRank?.name === newRank.name) {
            checkQuestProgress(client, 'RANK_UP', member.user, { newRankName: newMainRankName });
            return;
        }

        // --- Logique spéciale pour le rôle GOAT ---
        const oldRankName = oldRank ? oldRank.name : null;
        const newRankName = newRank.name;

        // On ne peut devenir GOAT qu'en venant de Mythique II
        if (newRankName === 'GOAT' && oldRankName !== 'Mythique II') {
            logger.info(`Mise à jour de rôle bloquée pour ${member.user.username}: tentative de passage à GOAT sans être Mythique II.`);
            return;
        }

        // Si on quitte le rang GOAT, ce ne peut être que pour Mythique II
        if (oldRankName === 'GOAT' && newRankName !== 'Mythique II') {
            logger.info(`Mise à jour de rôle bloquée pour ${member.user.username}: tentative de quitter GOAT pour un autre rang que Mythique II.`);
            return;
        }

        // --- Gestion des rôles ---
        // --- Gestion des rôles ---
        const rolesToAdd = [newRank.name, newMainRankName];
        const rolesToRemove = [];
        const allPossibleRankRoleNames = allRankNames.concat(MAIN_RANKS);

        // Helper pour normaliser les noms (enlever les accents)
        const normalize = (str) => str.normalize("NFD").replace(/[\u0300-\u036f]/g, "");

        const allPossibleNormalized = new Set(allPossibleRankRoleNames.map(normalize));
        const rolesToAddNormalized = new Set(rolesToAdd.map(normalize));

        member.roles.cache.forEach(role => {
            const normalizedRoleName = normalize(role.name);
            // Si c'est un rôle de rang (connu) et qu'il n'est pas dans ceux qu'on veut garder/ajouter
            if (allPossibleNormalized.has(normalizedRoleName) && !rolesToAddNormalized.has(normalizedRoleName)) {
                rolesToRemove.push(role.id);
            }
        });

        const rolesToAddObjects = [];
        for (const roleName of rolesToAdd) {
            // Chercher le rôle Exact OU Normalisé
            let role = guild.roles.cache.find(r => r.name === roleName);
            if (!role) {
                const normalizedTarget = normalize(roleName);
                role = guild.roles.cache.find(r => normalize(r.name) === normalizedTarget);
            }

            if (role && !member.roles.cache.has(role.id)) {
                rolesToAddObjects.push(role.id);
            }
        }

        // Si aucun changement de rôle n'est nécessaire, on arrête
        if (rolesToRemove.length === 0 && rolesToAddObjects.length === 0) {
            return;
        }

        logger.info(`Mise à jour de rang pour ${member.user.username}: Ajout de [${rolesToAddObjects.map(r => guild.roles.cache.get(r)?.name).join(', ')}], Suppression de [${rolesToRemove.map(r => guild.roles.cache.get(r)?.name).join(', ')}]`);

        try {
            if (rolesToRemove.length > 0) await member.roles.remove(rolesToRemove);
            if (rolesToAddObjects.length > 0) await member.roles.add(rolesToAddObjects);
        } catch (roleErr) {
            if (roleErr.code === 50013) {
                if (!_warnedRankRoles50013) {
                    _warnedRankRoles50013 = true;
                    logger.warn(
                        'Rangs — Missing Permissions (50013) : rôle du bot au-dessus des rôles de rang + « Gérer les rôles ».'
                    );
                }
                return;
            }
            throw roleErr;
        }

        // --- Envoyer la notification de montée de rang ---
        const hasRankedUp = !oldRank || newRank.points > oldRank.points;

        logger.info(`Vérification de notification pour ${member.user.username}: ` +
            `Ancien rang: ${oldRank?.name || 'Aucun'}, ` +
            `Nouveau rang: ${newRank.name}, ` +
            `Montée de rang: ${hasRankedUp}`);

        if (oldRank?.name !== newRank.name && hasRankedUp) {
            const rankUpChannelId = resolveRankUpChannelId(targetGuildId);
            logger.info(`Envoi de la notification de montée de rang pour ${member.user.username} vers le salon ${rankUpChannelId}.`);

            if (!rankUpChannelId) {
                logger.warn('RANK_UP_CHANNEL (ou TEST_RANK_UP_CHANNEL sur le serveur test) non défini. Notification annulée.');
            } else {
                const rankUpChannel = await client.channels.fetch(rankUpChannelId).catch((e) => {
                    logger.error(`Impossible de trouver le salon de montée de rang (ID: ${rankUpChannelId}). Erreur: ${e.message}`);
                    return null;
                });

                if (rankUpChannel) {
                    try {
                        const { getOrCreateUser } = require('./db-users');
                        const userData = getOrCreateUser(userId, member.user.username);
                        const shouldPing = userData.notify_rank_up !== 0;

                        await rankUpChannel.send({
                            content: `👑 Félicitations à ${member} qui vient de passer au rang **${newRank.name}** !`,
                            allowedMentions: shouldPing ? undefined : { parse: [] }
                        });
                        logger.info(`Notification envoyée avec succès pour ${member.user.username}.`);
                    } catch (e) {
                        logger.error(`Impossible d'envoyer un message dans le salon de montée de rang (ID: ${rankUpChannelId}). Vérifiez les permissions du bot. Erreur: ${e.message}`);
                    }
                }
            }
        }

        // Vérifier les quêtes de montée de rang
        if (rolesToAddObjects.length > 0) {
            checkQuestProgress(client, 'RANK_UP', member.user, { newRankName: newMainRankName });
        }

    } catch (error) {
        if (error.code === 50013) {
            if (!_warnedRankRoles50013) {
                _warnedRankRoles50013 = true;
                logger.warn(
                    'Rangs — Missing Permissions (50013) : rôle du bot au-dessus des rôles de rang + « Gérer les rôles ».'
                );
            }
            return;
        }
        logger.error(`Erreur lors de la mise à jour du rang pour ${userId}:`, error.message || error);
    }
}

module.exports = { RANKS, MAIN_RANKS, LOCKED_RANKS, getRankFromPoints, getDisplayRank, isRankLocked, updateUserRank };
