const db = require('../../database/database');
const logger = require('../logger');

// Date de la mise à jour (10 février 2026)
const UPDATE_DATE = new Date('2026-02-10T00:00:00Z').getTime();

/**
 * Nombre maximum de membres autorisés (9 + 3 jokers = 12)
 */
const MAX_MEMBERS_WITH_JOKERS = 12;

/**
 * Pénalité par membre en trop par jour
 */
const PENALTY_PER_MEMBER_PER_DAY = 1000;

/**
 * Vérifie si une guilde est en sureffectif
 */
function isGuildOverstaffed(guildId) {
    const memberCount = db.prepare('SELECT COUNT(*) as count FROM guild_members WHERE guild_id = ?')
        .get(guildId).count;
    
    return memberCount > MAX_MEMBERS_WITH_JOKERS;
}

/**
 * Calcule le nombre de jours depuis que la guilde est en sureffectif
 */
function getDaysSinceOverstaffed(guild) {
    if (!guild.overstaffed_since) return 0;
    
    const now = Date.now();
    const daysSince = Math.floor((now - guild.overstaffed_since) / (24 * 60 * 60 * 1000));
    return daysSince;
}

/**
 * Calcule la pénalité pour sureffectif
 */
function calculateOverstaffPenalty(guildId) {
    const guild = db.prepare('SELECT * FROM guilds WHERE id = ?').get(guildId);
    if (!guild) return { penalty: 0, daysOverstaffed: 0, membersOver: 0 };
    
    const memberCount = db.prepare('SELECT COUNT(*) as count FROM guild_members WHERE guild_id = ?')
        .get(guildId).count;
    
    const membersOver = Math.max(0, memberCount - MAX_MEMBERS_WITH_JOKERS);
    if (membersOver === 0) return { penalty: 0, daysOverstaffed: 0, membersOver: 0 };
    
    const daysOverstaffed = getDaysSinceOverstaffed(guild);
    // Retirée chaque jour : ne pas multiplier par les jours, sinon le total explose.
    const penalty = membersOver * PENALTY_PER_MEMBER_PER_DAY;
    
    return { penalty, daysOverstaffed, membersOver };
}

/**
 * Applique la pénalité de sureffectif à tous les membres de la guilde
 */
function applyOverstaffPenalty(client, guildId) {
    const penaltyInfo = calculateOverstaffPenalty(guildId);
    
    if (penaltyInfo.penalty === 0) return { applied: false, penalty: 0 };
    
    const members = db.prepare('SELECT user_id FROM guild_members WHERE guild_id = ?').all(guildId);
    const penaltyPerMember = penaltyInfo.penalty;
    
    const { grantResources } = require('../db-users');
    
    for (const member of members) {
        // Retirer les starss à chaque membre
        try {
            grantResources(client, member.user_id, { 
                stars: -penaltyPerMember, 
                source: 'guild_overstaffed_penalty' 
            });
        } catch (error) {
            logger.error(`Erreur application pénalité sureffectif pour ${member.user_id}:`, error);
        }
    }
    
    logger.warn(`Pénalité de sureffectif appliquée à la guilde ${guildId}: ${penaltyPerMember} starss par membre (${penaltyInfo.membersOver} membres en trop depuis ${penaltyInfo.daysOverstaffed} jours)`);
    
    return { applied: true, penalty: penaltyPerMember, membersAffected: members.length };
}

/**
 * Marque une guilde comme en sureffectif (si pas déjà marquée)
 */
function markGuildAsOverstaffed(guildId) {
    const guild = db.prepare('SELECT overstaffed_since FROM guilds WHERE id = ?').get(guildId);
    
    if (!guild) return;
    
    // Si déjà marquée, ne rien faire
    if (guild.overstaffed_since) return;
    
    // Marquer avec la date actuelle
    db.prepare('UPDATE guilds SET overstaffed_since = ? WHERE id = ?')
        .run(Date.now(), guildId);
    
    logger.warn(`Guilde ${guildId} marquée comme en sureffectif`);
}

/**
 * Retire le marquage de sureffectif (quand la guilde revient sous la limite)
 */
function unmarkGuildAsOverstaffed(guildId) {
    db.prepare('UPDATE guilds SET overstaffed_since = NULL WHERE id = ?').run(guildId);
    logger.info(`Guilde ${guildId} n'est plus en sureffectif`);
}

/**
 * Vérifie si les fonctionnalités de la guilde sont désactivées
 */
function areGuildFeaturesDisabled(guildId) {
    const guild = db.prepare('SELECT overstaffed_since FROM guilds WHERE id = ?').get(guildId);
    
    // Si overstaffed_since est défini et que c'est depuis plus de 0 jours, désactiver
    return guild && guild.overstaffed_since !== null;
}

/**
 * Vérifie et met à jour le statut de sureffectif de toutes les guildes
 * À appeler périodiquement (par exemple toutes les heures)
 */
function checkAllGuildsOverstaff(client) {
    const guilds = db.prepare('SELECT id FROM guilds').all();
    
    for (const guild of guilds) {
        const memberCount = db.prepare('SELECT COUNT(*) as count FROM guild_members WHERE guild_id = ?')
            .get(guild.id).count;
        
        if (memberCount > MAX_MEMBERS_WITH_JOKERS) {
            markGuildAsOverstaffed(guild.id);
        } else {
            unmarkGuildAsOverstaffed(guild.id);
        }
    }
    
    logger.info('Vérification du sureffectif des guildes terminée');
}

/**
 * Applique les pénalités journalières à toutes les guildes en sureffectif
 * À appeler une fois par jour (à minuit par exemple)
 */
function applyDailyOverstaffPenalties(client) {
    const guilds = db.prepare('SELECT * FROM guilds WHERE overstaffed_since IS NOT NULL').all();
    
    let totalPenalties = 0;
    
    for (const guild of guilds) {
        const result = applyOverstaffPenalty(client, guild.id);
        if (result.applied) {
            totalPenalties += result.penalty * result.membersAffected;
        }
    }
    
    logger.info(`Pénalités journalières de sureffectif appliquées. Total: ${totalPenalties} starss retirés`);
}

module.exports = {
    MAX_MEMBERS_WITH_JOKERS,
    PENALTY_PER_MEMBER_PER_DAY,
    UPDATE_DATE,
    isGuildOverstaffed,
    getDaysSinceOverstaffed,
    calculateOverstaffPenalty,
    applyOverstaffPenalty,
    markGuildAsOverstaffed,
    unmarkGuildAsOverstaffed,
    areGuildFeaturesDisabled,
    checkAllGuildsOverstaff,
    applyDailyOverstaffPenalties
};
