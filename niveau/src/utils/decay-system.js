const db = require('../database/database');
const { getRankFromPoints, updateUserRank } = require('./ranks');
const { runWithEconomyGuild } = require('./economy-scope');
const logger = require('./logger');

// Seuil de points pour être éligible au decay
const DECAY_MINIMUM_POINTS = 3000;

/**
 * Détermine le seuil d'inactivité en heures pour un rang donné.
 * @param {object} rank L'objet du rang.
 * @returns {number} Le nombre d'heures d'inactivité avant decay.
 */
function getInactivityThresholdHours(rank) {
    if (rank.points >= 3000 && rank.points < 12500) {
        return 4;
    }
    return 3;
}

/**
 * Traite la perte de points pour tous les utilisateurs inactifs.
 * @param {import('discord.js').Client} client Le client Discord.
 */
function processDecay(client) {
    logger.info('Vérification de la perte de points (decay) par inactivité...');

    const now = Date.now();
    const { burnPlayerRP } = require('./ranked-shares');

    const mainDb = typeof db.getMainDb === 'function' ? db.getMainDb() : db;
    const testDb = typeof db.getTestDb === 'function' ? db.getTestDb() : null;
    const testG = String(process.env.GUILD_ID || '').trim();
    const mainG = String(process.env.BLZ_MAIN_GUILD_ID || '').trim();

    /**
     * @param {import('better-sqlite3').Database} dbInstance
     * @param {string} guildIdForContext
     */
    function runDecayOnDatabase(dbInstance, guildIdForContext) {
        if (!guildIdForContext || !/^\d{17,22}$/.test(guildIdForContext)) {
            return;
        }

        const candidates = dbInstance
            .prepare('SELECT id, points, last_activity_timestamp FROM users WHERE points >= ?')
            .all(DECAY_MINIMUM_POINTS);

        for (const user of candidates) {
            const rank = getRankFromPoints(user.points);

            if (!rank || !rank.decay) {
                continue;
            }

            const inactivityThresholdHours = getInactivityThresholdHours(rank);
            const inactivityThresholdMs = inactivityThresholdHours * 60 * 60 * 1000;

            const timeSinceLastActivity = now - (user.last_activity_timestamp || now);

            if (timeSinceLastActivity >= inactivityThresholdMs) {
                runWithEconomyGuild(guildIdForContext, () => {
                    burnPlayerRP(user.id, rank.decay);
                    logger.info(`L'utilisateur ${user.id} a perdu ${rank.decay} RP (Shares Burn) pour inactivité.`);
                    updateUserRank(client, user.id);
                });
            }
        }
    }

    if (testDb) {
        runDecayOnDatabase(mainDb, mainG);
        runDecayOnDatabase(testDb, testG);
    } else {
        runDecayOnDatabase(mainDb, testG || mainG);
    }
}

module.exports = { processDecay };
