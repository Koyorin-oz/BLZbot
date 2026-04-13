
const schedule = require('node-schedule');
const db = require('../database/database');
const { grantResources } = require('./db-users');
const logger = require('./logger');

let _warnedStreakChannel = false;

/**
 * Calcule la récompense de streak en fonction du nombre de jours
 * @param {number} streak - Le nombre de jours de streak
 * @returns {object} - {stars: amount, item: itemId || null}
 */
function calculateStreakReward(streak) {
    if (streak < 10) return { stars: 0, item: null };
    if (streak < 20) return { stars: 5000, item: null };
    if (streak < 30) return { stars: 10000, item: null };
    if (streak < 40) return { stars: 20000, item: null };
    if (streak < 50) return { stars: 30000, item: null };
    if (streak < 60) return { stars: 40000, item: null };
    if (streak < 70) return { stars: 50000, item: null };
    if (streak < 80) return { stars: 60000, item: null };
    if (streak < 90) return { stars: 80000, item: null };
    if (streak < 100) return { stars: 100000, item: null };
    return { stars: 0, item: 'coffre_normal' };
}

/**
 * Met à jour la streak d'un utilisateur et envoie les récompenses
 * @param {Client} client - Le client Discord
 * @param {string} userId - L'ID de l'utilisateur
 * @returns {object} - {streakUpdated: boolean, newStreak: number}
 */
function updateStreak(client, userId) {
    try {
        const getUserStmt = db.prepare('SELECT streak, last_streak_timestamp FROM users WHERE id = ?');
        const user = getUserStmt.get(userId);

        if (!user) {
            logger.warn(`Utilisateur ${userId} non trouvé pour mettre à jour la streak`);
            return { streakUpdated: false, newStreak: 0 };
        }

        const now = new Date();
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const todayTimestamp = today.getTime();

        // Si le timestamp est 0, l'utilisateur n'a jamais eu de streak
        let lastStreakTimestamp = user.last_streak_timestamp || 0;
        let lastStreakDate = lastStreakTimestamp > 0 ? new Date(lastStreakTimestamp) : null;

        let newStreak = user.streak || 0;
        let streakUpdated = false;

        if (!lastStreakDate || lastStreakDate.getTime() < today.getTime()) {
            // Premier message du jour
            const yesterday = new Date(today);
            yesterday.setDate(yesterday.getDate() - 1);
            const yesterdayTimestamp = yesterday.getTime();

            if (lastStreakTimestamp === yesterdayTimestamp) {
                // La dernière mise à jour était hier : on incrémente la streak
                newStreak++;
                streakUpdated = true;
            } else if (lastStreakTimestamp < yesterdayTimestamp && lastStreakTimestamp > 0) {
                // Plus d'un jour sans message : on perd la streak
                const updateUserStmt = db.prepare('UPDATE users SET streak_lost_timestamp = ?, previous_streak = ?, streak = 0 WHERE id = ?');
                updateUserStmt.run(now.getTime(), user.streak, userId);
                newStreak = 1;
                streakUpdated = true;
                logger.info(`Streak perdue pour ${userId}: ${user.streak} → 1`);
            } else if (lastStreakTimestamp === 0) {
                // Première fois : on démarre la streak
                newStreak = 1;
                streakUpdated = true;
            }

            // Mise à jour de la date de la dernière streak
            if (streakUpdated) {
                const updateUserStmt = db.prepare('UPDATE users SET streak = ?, last_streak_timestamp = ? WHERE id = ?');
                updateUserStmt.run(newStreak, todayTimestamp, userId);
                logger.info(`Streak mise à jour pour ${userId}: ${newStreak} jours`);
            }
        }

        // Distribuer la récompense si la streak a été mise à jour
        if (streakUpdated) {
            const reward = calculateStreakReward(newStreak);

            if (reward.stars > 0) {
                grantResources(client, userId, { stars: reward.stars, source: 'streak' });
            }

            if (reward.item) {
                const { addItemToInventory } = require('./db-users');
                addItemToInventory(userId, reward.item, 1);
            }

            // Vérifier les quêtes de streak
            try {
                const { checkQuestProgress } = require('./quests');
                checkQuestProgress(client, 'STREAK_REACH', { id: userId }, newStreak);
            } catch (e) {
                // Silencieux si erreur quête
            }

            // Envoyer le message d'annonce de streak
            sendStreakAnnouncement(client, userId, newStreak, reward);
        }

        return { streakUpdated, newStreak };
    } catch (error) {
        logger.error(`Erreur lors de la mise à jour de la streak pour ${userId}:`, error);
        return { streakUpdated: false, newStreak: 0 };
    }
}

/**
 * Envoie une annonce de streak dans le canal dédié
 * @param {Client} client - Le client Discord
 * @param {string} userId - L'ID de l'utilisateur
 * @param {number} newStreak - Le nombre de jours de streak
 * @param {object} reward - {stars: amount, item: itemId}
 */
async function sendStreakAnnouncement(client, userId, newStreak, reward) {
    try {
        if (!process.env.STREAK_CHANNEL) {
            if (!_warnedStreakChannel) {
                _warnedStreakChannel = true;
                logger.warn('STREAK_CHANNEL non défini dans les variables d\'environnement');
            }
            return;
        }

        const channel = await client.channels.fetch(process.env.STREAK_CHANNEL).catch(() => null);
        if (!channel) {
            if (!_warnedStreakChannel) {
                _warnedStreakChannel = true;
                logger.warn(`Canal de streak ${process.env.STREAK_CHANNEL} introuvable`);
            }
            return;
        }

        const { getOrCreateUser } = require('./db-users');
        const user = getOrCreateUser(userId, 'Unknown');
        const shouldPing = user.notify_streak !== 0;

        // Construire le message
        let message = `Bravo <@${userId}> qui a maintenant une streak de ${newStreak} jours !`;

        // Ajouter la récompense si elle existe (streak >= 10)
        if (reward.stars > 0) {
            message += `\nTu viens de gagner **${reward.stars.toLocaleString()} ⭐**`;
        } else if (reward.item) {
            const itemName = reward.item === 'coffre_normal' ? '1 Coffre Bonus' : reward.item;
            message += `\nTu viens de gagner **${itemName}**`;
        }

        await channel.send({
            content: message,
            allowedMentions: shouldPing ? undefined : { parse: [] }
        });
        logger.info(`Annonce de streak envoyée pour ${userId} (${newStreak} jours)`);
    } catch (error) {
        logger.error(`Erreur lors de l'envoi de l'annonce de streak:`, error);
    }
}

/**
 * Programme le reset automatique des streaks à minuit
 */
function scheduleStreakReset() {
    // Exécuter tous les jours à 00:00 (Paris)
    const rule = new schedule.RecurrenceRule();
    rule.hour = 0;
    rule.minute = 0;
    // Note: On pourrait utiliser rule.tz = 'Europe/Paris' si nécessaire,
    // mais le serveur est déjà configuré à l'heure de Paris.

    schedule.scheduleJob(rule, () => {
        try {
            const now = new Date();
            // Début de la journée d'hier (00:00:00)
            const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
            const yesterdayTimestamp = yesterday.getTime();

            // Tous ceux qui n'ont pas parlé hier (donc last_streak_timestamp < yesterdayTimestamp)
            // ont perdu leur streak à minuit aujourd'hui.
            const resetStmt = db.prepare('UPDATE users SET streak = 0 WHERE last_streak_timestamp < ? AND streak > 0');
            const result = resetStmt.run(yesterdayTimestamp);

            if (result.changes > 0) {
                logger.info(`[STREAK] Reset automatique de minuit : ${result.changes} utilisateur(s) ont perdu leur streak (pas d'activité hier).`);
            }
        } catch (error) {
            logger.error('[STREAK] Erreur lors du reset automatique des streaks:', error);
        }
    });

    logger.info('[STREAK] Système de reset automatique à 00:00 initialisé.');
}

module.exports = { updateStreak, calculateStreakReward, scheduleStreakReset };
