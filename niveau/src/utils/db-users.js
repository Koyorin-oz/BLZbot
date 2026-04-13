require('dotenv').config();
const db = require('../database/database');
const { getGuildOfUser, updateGuildLevel } = require('./db-guilds');
const { resetEventUser } = require('./db-halloween');
const logger = require('../utils/logger');
const { updateLevelRoles } = require('./level-roles');
const { calculateGuildBoosts } = require('./guild/guild-boosters');
const { collectBlzGuildIds, forEachMemberInBlzGuilds } = require('./blz-multi-guild');

const BOOSTED_ROLE_IDS = ['1170361439345704962', '1323305704932507648'];

// Préparer les requêtes pour de meilleures performances
const getUserStmt = db.prepare('SELECT * FROM users WHERE id = ?');
const createUserStmt = db.prepare('INSERT INTO users (id, username) VALUES (?, ?)');
const grantResourcesStmt = db.prepare('UPDATE users SET xp = xp + ?, stars = stars + ? WHERE id = ?');
const updateMaxPointsStmt = db.prepare('UPDATE users SET max_points = ? WHERE id = ? AND ? > max_points');
const updateMaxStarsStmt = db.prepare('UPDATE users SET max_stars = ? WHERE id = ? AND ? > max_stars');
const setLevelStmt = db.prepare('UPDATE users SET level = ?, xp = ?, xp_needed = ? WHERE id = ?');
const setPointsStmt = db.prepare('UPDATE users SET points = ? WHERE id = ?');
const setStarsStmt = db.prepare('UPDATE users SET stars = ? WHERE id = ?');
const resetUserStmt = db.prepare(`
    UPDATE users
    SET xp = 0, level = 1, xp_needed = 100, points = 0, stars = 0, daily_last_claimed = 0, last_decay_timestamp = 0
    WHERE id = ?
`);
const clearUserInventoryStmt = db.prepare('DELETE FROM user_inventory WHERE user_id = ?');
const clearUserQuestsStmt = db.prepare('DELETE FROM quest_progress WHERE user_id = ?');
const updateDailyClaimStmt = db.prepare('UPDATE users SET daily_last_claimed = ? WHERE id = ?');
const updateUserActivityStmt = db.prepare('UPDATE users SET last_activity_timestamp = ? WHERE id = ?');
const updateXpBoostStmt = db.prepare('UPDATE users SET xp_boost_until = ? WHERE id = ?');
const updatePointsBoostStmt = db.prepare('UPDATE users SET points_boost_until = ? WHERE id = ?');
const logResourceStmt = db.prepare('INSERT INTO resource_history (user_id, resource_type, amount, source, timestamp) VALUES (?, ?, ?, ?, ?)');

// Variable globale pour stocker la source du gain actuel (sera settée par les appelants)
let currentResourceSource = 'unknown';

function setResourceSource(source) {
    currentResourceSource = source;
}

function logResourceGain(userId, resourceType, amount, source = null) {
    try {
        if (amount > 0) {
            logResourceStmt.run(userId, resourceType, amount, source || currentResourceSource, Date.now());
        }
    } catch (error) {
        // Silently fail pour ne pas bloquer le système principal
        logger.debug(`Failed to log resource gain: ${error.message}`);
    }
}

function getResourceHistory(userId, limit = 50) {
    const stmt = db.prepare(`
        SELECT resource_type, amount, source, timestamp 
        FROM resource_history 
        WHERE user_id = ? 
        ORDER BY timestamp DESC 
        LIMIT ?
    `);
    return stmt.all(userId, limit);
}

function getResourceSummary(userId, hoursAgo = 24) {
    const since = Date.now() - (hoursAgo * 60 * 60 * 1000);
    const stmt = db.prepare(`
        SELECT 
            resource_type,
            SUM(amount) as total,
            COUNT(*) as count,
            source
        FROM resource_history 
        WHERE user_id = ? AND timestamp > ?
        GROUP BY resource_type, source
        ORDER BY total DESC
    `);
    return stmt.all(userId, since);
}

function getOrCreateUser(userId, username) {
    let user = getUserStmt.get(userId);
    if (!user) {
        createUserStmt.run(userId, username);
        user = getUserStmt.get(userId);
        logger.info(`Nouvel utilisateur créé : ${username} (${userId})`);
    }
    return user;
}

async function grantResources(client, userId, { xp = 0, points = 0, stars = 0, source = 'unknown' }) {
    xp = xp || 0;
    points = points || 0;
    stars = stars || 0;

    // Sources d'ACTIVITÉ qui bénéficient des multiplicateurs et comptent pour le Battle Pass
    // Ces sources représentent une vraie activité du joueur (messages, vocal, réactions)
    const activitySources = ['message', 'vocal', 'reaction'];
    const isActivitySource = activitySources.includes(source);

    // Sources qui NE doivent PAS bénéficier des multiplicateurs ni compter pour le Battle Pass
    // (récompenses fixes, items, events, etc.)
    const fixedRewardSources = ['coffre', 'quest', 'giveaway', 'daily', 'streak', 'guild_treasury',
        'guild_quest', 'mega_boost', 'battlepass', 'boutique', 'marketplace', 'puits'];

    try {
        const userBeforeUpdate = getUserStmt.get(userId);

        // Appliquer les multiplicateurs UNIQUEMENT pour les sources d'activité
        if (isActivitySource && (xp > 0 || points > 0 || stars > 0)) {
            const hasMicro = checkUserInventory(userId, 'micro');
            const hasEcran = checkUserInventory(userId, 'ecran');
            const hasCouronne = checkUserInventory(userId, 'couronne');

            if (hasCouronne) xp = Math.round(xp * 1.20);
            if (hasMicro) points = Math.round(points * 1.15);
            if (hasEcran) stars = Math.round(stars * 1.20);

            const guild = getGuildOfUser(userId);
            if (guild) {
                const guildBoosts = calculateGuildBoosts(guild);
                xp = Math.round(xp * (1 + guildBoosts.xp));
                points = Math.round(points * (1 + guildBoosts.points));
                stars = Math.round(stars * (1 + guildBoosts.stars));
            }

            const mainGuild = client.guilds.cache.get(process.env.GUILD_ID);
            if (mainGuild) {
                const member = await mainGuild.members.fetch(userId).catch(() => null);
                if (member) {
                    const hasBoostedRole = BOOSTED_ROLE_IDS.some(roleId => member.roles.cache.has(roleId));
                    if (hasBoostedRole) {
                        xp = Math.round(xp * 1.3);
                        stars = Math.round(stars * 1.3);
                        points = Math.round(points * 1.2);
                    }
                }
            }

            const now = Date.now();
            // Boost XP x2
            if (userBeforeUpdate.xp_boost_until > now) {
                xp = Math.round(xp * 2);
                logger.info(`XP boost (x2) applied for user ${userId}.`);
            }
            if (userBeforeUpdate.points_boost_until > now) {
                points = Math.round(points * 2);
                logger.info(`Points boost (x2) applied for user ${userId}.`);
            }

            // --- Multiplicateurs Saint-Valentin ---
            const { getPartner, getDailyMessageCount, hasUnlocked, getEventState } = require('./db-valentin');
            if (getEventState('valentin')) {

                // 1. Bague de Mariage
                const hasRing = hasUnlocked(userId, 'bague_mariage');
                if (hasRing) {
                    const partnerId = getPartner(userId);
                    let ringMultiplier = 1.10; // Boost de base 10%

                    if (partnerId) {
                        const partnerHasRing = hasUnlocked(partnerId, 'bague_mariage');
                        if (partnerHasRing) {
                            ringMultiplier = 1.30; // Boost 30% si les deux ont la bague
                        }
                    }

                    xp = Math.round(xp * ringMultiplier);
                    points = Math.round(points * ringMultiplier);
                    stars = Math.round(stars * ringMultiplier);
                }

                // 2. Petit(e) ami(e) chiant(e)
                const hasAmiChiant = hasUnlocked(userId, 'ami_chiant');
                if (hasAmiChiant) {
                    const messageCount = getDailyMessageCount(userId);
                    if (messageCount >= 100) {
                        // Boost 20%
                        xp = Math.round(xp * 1.20);
                        stars = Math.round(stars * 1.20);
                    } else {
                        // Pénalité 20%
                        xp = Math.round(xp * 0.80);
                        stars = Math.round(stars * 0.80);
                    }
                }
            }

            // --- Multiplicateurs Noël ---
            try {
                const { getActiveMultiplier } = require('./db-noel');
                const activeMultiplier = getActiveMultiplier(userId);
                if (activeMultiplier) {
                    if (activeMultiplier.multiplier_type === 'xp_money_x2') {
                        xp = Math.round(xp * 2);
                        stars = Math.round(stars * 2);
                        logger.info(`Christmas XP/Money boost (x2) applied for user ${userId}.`);
                    } else if (activeMultiplier.multiplier_type === 'rank_points_x2') {
                        points = Math.round(points * 2);
                        logger.info(`Christmas Rank Points boost (x2) applied for user ${userId}.`);
                    } else if (activeMultiplier.multiplier_type === 'xp_x2_calendar') {
                        xp = Math.round(xp * 2);
                        logger.info(`Christmas Calendar XP boost (x2) applied for user ${userId}.`);
                    } else if (activeMultiplier.multiplier_type === 'rank_points_x2_calendar') {
                        points = Math.round(points * 2);
                        logger.info(`Christmas Calendar Rank Points boost (x2) applied for user ${userId}.`);
                    } else if (activeMultiplier.multiplier_type === 'stars_x2_calendar') {
                        stars = Math.round(stars * 2);
                        logger.info(`Christmas Calendar Stars boost (x2) applied for user ${userId}.`);
                    }
                }
            } catch (error) {
                logger.debug(`Christmas multiplier check skipped for ${userId}: ${error.message}`);
            }
        }

        if (xp > 0 || points > 0 || stars > 0) {
            // ... (logique existante conservée si besoin, mais je ne touche qu'aux statements finaux)
        }

        grantResourcesStmt.run(xp, stars, userId);

        if (points > 0) {
            const { addPlayerRP } = require('./ranked-shares');
            addPlayerRP(userId, points);
        }

        // Logger les gains pour le diagnostic
        if (xp > 0) logResourceGain(userId, 'xp', xp, source);
        if (points > 0) logResourceGain(userId, 'points', points, source);
        if (stars > 0) logResourceGain(userId, 'stars', stars, source);

        // --- Mise à jour des stats All-Time ---
        if (points > 0 || stars > 0) {
            const userCurrent = getUserStmt.get(userId); // Récupérer l'état frais
            if (userCurrent) {
                if (userCurrent.points > userCurrent.max_points) {
                    updateMaxPointsStmt.run(userCurrent.points, userId, userCurrent.points);
                }
                if (userCurrent.stars > userCurrent.max_stars) {
                    updateMaxStarsStmt.run(userCurrent.stars, userId, userCurrent.stars);
                }
            }
        }

        if (xp > 0) {

            // Le seasonal_xp (Battle Pass) ne compte que pour les sources d'activité
            if (isActivitySource) {
                const updateSeasonalXpStmt = db.prepare('UPDATE users SET seasonal_xp = seasonal_xp + ? WHERE id = ?');
                updateSeasonalXpStmt.run(xp, userId);

                // (Battle Pass supprimé - remplacé par Puits de Combat)
            }
        }


        const { checkQuestProgress } = require('./quests');
        const userAfterUpdate = getUserStmt.get(userId);
        if (userAfterUpdate) {
            checkQuestProgress(client, 'BALANCE_REACH', userAfterUpdate, { newBalance: userAfterUpdate.stars });
        }

        // Gestion des changements de niveau (montée OU descente)
        if (xp !== 0 && userAfterUpdate) {
            const originalLevel = userAfterUpdate.level;
            let currentUserData = { ...userAfterUpdate };
            let levelChanged = false;

            // Montée de niveau (XP positif)
            if (xp > 0) {
                while (currentUserData.xp >= currentUserData.xp_needed) {
                    const newXp = currentUserData.xp - currentUserData.xp_needed;
                    const newLevel = currentUserData.level + 1;
                    const newXpNeeded = 100 * (newLevel + 1);

                    currentUserData.xp = newXp;
                    currentUserData.level = newLevel;
                    currentUserData.xp_needed = newXpNeeded;
                    levelChanged = true;

                    checkQuestProgress(client, 'LEVEL_REACH', userAfterUpdate, { newLevel: newLevel });
                }
            }
            // Descente de niveau (XP négatif)
            else if (xp < 0) {
                while (currentUserData.xp < 0 && currentUserData.level > 1) {
                    const newLevel = currentUserData.level - 1;
                    const newXpNeeded = 100 * (newLevel + 1);
                    const newXp = currentUserData.xp + newXpNeeded;

                    currentUserData.xp = newXp;
                    currentUserData.level = newLevel;
                    currentUserData.xp_needed = newXpNeeded;
                    levelChanged = true;
                }

                // Si on est au niveau 1 et qu'il reste de l'XP négatif, mettre l'XP à 0
                if (currentUserData.level === 1 && currentUserData.xp < 0) {
                    currentUserData.xp = 0;
                }
            }

            // Mettre à jour la base de données si le niveau a changé
            if (levelChanged || currentUserData.xp !== userAfterUpdate.xp) {
                setLevelStmt.run(currentUserData.level, currentUserData.xp, currentUserData.xp_needed, userId);
            }

            // Mettre à jour les rôles de niveau si le niveau a changé
            if (currentUserData.level !== originalLevel) {
                const member = await client.guilds.cache.get(process.env.GUILD_ID)?.members.fetch(userId).catch(() => null);
                if (member) {
                    await updateLevelRoles(member, currentUserData.level);

                    // Annoncer uniquement les montées de niveau (pas les descentes)
                    if (currentUserData.level > originalLevel) {
                        const levelUpChannel = await client.channels.fetch(process.env.LEVEL_UP_CHANNEL).catch(() => null);
                        if (levelUpChannel) {
                            const userForNotify = getUserStmt.get(userId); // Re-fetch to be sure, or rely on currentUserData if columns are present
                            const notify = userForNotify ? userForNotify.notify_level_up : 1;
                            const shouldPing = notify !== 0;

                            levelUpChannel.send({
                                content: `🎉 Bravo à ${member} qui passe au niveau **${currentUserData.level}** !`,
                                allowedMentions: shouldPing ? undefined : { parse: [] }
                            });
                        }
                    }
                }

                // Mettre à jour le niveau de la guilde du joueur
                const userGuild = getGuildOfUser(userId);
                if (userGuild) {
                    updateGuildLevel(userGuild.id);
                }
            }
        }

        // --- Mise à jour des points de guerre ---
        // Le système de guerre est maintenant basé sur messages/vocal uniquement
        // Les incréments sont faits directement dans messageCreate.js et index.js (vocal)
        // Plus besoin de logique ici car on ne track plus XP/RP/Stars
    } catch (error) {
        logger.error(`Erreur lors de l'attribution de ressources à ${userId}`, error);
    }
}

function updateDailyClaim(userId) {
    try {
        updateDailyClaimStmt.run(Date.now(), userId);
    }
    catch (error) {
        console.error(`Erreur lors de la mise à jour du daily pour ${userId}`, error);
    }
}

function checkUserInventory(userId, itemId) {
    const stmt = db.prepare('SELECT quantity FROM user_inventory WHERE user_id = ? AND item_id = ?');
    const row = stmt.get(userId, itemId);
    return row ? row.quantity : 0;
}

function updateUserItemQuantity(userId, itemId, quantity) {
    const currentQuantity = checkUserInventory(userId, itemId);
    const newQuantity = currentQuantity + quantity;

    if (newQuantity > 0) {
        const stmt = db.prepare('INSERT OR REPLACE INTO user_inventory (user_id, item_id, quantity) VALUES (?, ?, ?)');
        stmt.run(userId, itemId, newQuantity);
    } else {
        const stmt = db.prepare('DELETE FROM user_inventory WHERE user_id = ? AND item_id = ?');
        stmt.run(userId, itemId);
    }
}

async function setLevel(userId, level, client = null) {
    try {
        const userBefore = getUserStmt.get(userId);
        const originalLevel = userBefore ? userBefore.level : 1;

        const newXpNeeded = 100 * (level + 1);
        setLevelStmt.run(level, 0, newXpNeeded, userId);

        // Mettre à jour les rôles de niveau si le client est fourni
        if (client && level !== originalLevel) {
            const member = await client.guilds.cache.get(process.env.GUILD_ID)?.members.fetch(userId).catch(() => null);
            if (member) {
                await updateLevelRoles(member, level);

                // Annoncer uniquement les montées de niveau
                if (level > originalLevel) {
                    const levelUpChannel = await client.channels.fetch(process.env.LEVEL_UP_CHANNEL).catch(() => null);
                    if (levelUpChannel) {
                        const user = getUserStmt.get(userId);
                        const notify = user ? user.notify_level_up : 1;
                        const shouldPing = notify !== 0;

                        levelUpChannel.send({
                            content: `🎉 Bravo à ${member} qui passe au niveau **${level}** !`,
                            allowedMentions: shouldPing ? undefined : { parse: [] }
                        });
                    }
                }
            }

            // Mettre à jour le niveau de la guilde
            const userGuild = getGuildOfUser(userId);
            if (userGuild) {
                updateGuildLevel(userGuild.id);
            }
        }
    } catch (error) {
        console.error(`Erreur lors de la définition du niveau pour ${userId}`, error);
    }
}

function setPoints(userId, points) {
    try {
        const { getUserRP, addPlayerRP, burnPlayerRP } = require('./ranked-shares');
        const currentRP = getUserRP(userId);
        const diff = points - currentRP;
        if (diff > 0) {
            addPlayerRP(userId, diff);
        } else if (diff < 0) {
            burnPlayerRP(userId, -diff);
        }
        updateMaxPointsStmt.run(points, userId, points); // Met à jour max_points si points est supérieur
    } catch (error) {
        console.error(`Erreur lors de la définition des points pour ${userId}`, error);
    }
}

function setStars(userId, stars) {
    try {
        setStarsStmt.run(stars, userId);
        updateMaxStarsStmt.run(stars, userId, stars);
    } catch (error) {
        console.error(`Erreur lors de la définition des stars pour ${userId}`, error);
    }
}

function resetUser(userId) {
    try {
        resetUserStmt.run(userId);
        clearUserInventoryStmt.run(userId);
        clearUserQuestsStmt.run(userId);
        resetEventUser(userId);
    } catch (error) {
        logger.error(`Erreur lors de la réinitialisation de l'utilisateur ${userId}`, error);
    }
}

function getLeaderboard(type) {
    const allowedColumns = ['stars', 'points', 'level'];
    if (!allowedColumns.includes(type)) {
        throw new Error(`Invalid leaderboard column: ${type}`);
    }
    const secondarySort = type === 'level' ? ', xp DESC' : '';
    const stmt = db.prepare(`
        SELECT id, username, level, points, stars, max_points, max_stars
        FROM users
        ORDER BY ${type} DESC${secondarySort}
        LIMIT 10
    `);
    return stmt.all();
}

function getUserRank(userId, type) {
    const allowedColumns = ['stars', 'points', 'level'];
    if (!allowedColumns.includes(type)) {
        throw new Error(`Invalid leaderboard column: ${type}`);
    }
    const secondarySort = type === 'level' ? ', xp DESC' : '';
    const stmt = db.prepare(`
        SELECT rank FROM (
            SELECT id, RANK() OVER (ORDER BY ${type} DESC${secondarySort}) as rank
            FROM users
        ) WHERE id = ?
    `);
    const result = stmt.get(userId);
    return result ? result.rank : 'Non classé';
}

function updateUserActivityTimestamp(userId) {
    try {
        updateUserActivityStmt.run(Date.now(), userId);
    } catch (error) {
        if (!error.message.includes('no such column')) {
            logger.error(`Erreur lors de la mise à jour de l'activité pour ${userId}`, error);
        }
    }
}

function updateUserBoost(userId, boostType, endTime) {
    try {
        if (boostType === 'xp') {
            updateXpBoostStmt.run(endTime, userId);
        } else if (boostType === 'points') {
            updatePointsBoostStmt.run(endTime, userId);
        }
    } catch (error) {
        logger.error(`Erreur lors de la mise à jour du boost ${boostType} pour ${userId}`, error);
    }
}

function getUserInventory(userId) {
    const stmt = db.prepare('SELECT * FROM user_inventory WHERE user_id = ?');
    return stmt.all(userId);
}

// Fonction pour mettre à jour les ressources directement SANS multiplicateurs (pour les admin et les transferts)
function updateUserBalance(userId, { xp = 0, points = 0, stars = 0 }) {
    try {
        if (xp !== 0) {
            const stmt = db.prepare('UPDATE users SET xp = xp + ? WHERE id = ?');
            stmt.run(xp, userId);
        }
        if (points !== 0) {
            const { addPlayerRP, burnPlayerRP } = require('./ranked-shares');
            if (points > 0) {
                addPlayerRP(userId, points);
            } else {
                burnPlayerRP(userId, -points);
            }
        }
        if (stars !== 0) {
            const stmt = db.prepare('UPDATE users SET stars = stars + ? WHERE id = ?');
            stmt.run(stars, userId);
        }

        // Mise à jour des stats All-Time pour les modifs manuelles
        const userCurrent = getUserStmt.get(userId);
        if (userCurrent) {
            if (userCurrent.points > userCurrent.max_points) {
                updateMaxPointsStmt.run(userCurrent.points, userId, userCurrent.points);
            }
            if (userCurrent.stars > userCurrent.max_stars) {
                updateMaxStarsStmt.run(userCurrent.stars, userId, userCurrent.stars);
            }
        }
    } catch (error) {
        logger.error(`Erreur lors de la mise à jour du solde pour ${userId}`, error);
    }
}

function addItemToInventory(userId, itemId, quantity = 1) {
    updateUserItemQuantity(userId, itemId, quantity);
}

function removeUserItem(userId, itemId, quantity = 1) {
    updateUserItemQuantity(userId, itemId, -quantity);
}

function transferUserData(sourceId, targetId) {
    const sourceUser = getOrCreateUser(sourceId, 'Unknown');
    const targetUser = getOrCreateUser(targetId, 'Unknown');

    const transferTransaction = db.transaction(() => {
        // 1. Supprimer les données auxiliaires de la cible
        db.prepare('DELETE FROM user_inventory WHERE user_id = ?').run(targetId);
        db.prepare('DELETE FROM quest_progress WHERE user_id = ?').run(targetId);
        db.prepare('DELETE FROM battle_pass WHERE user_id = ?').run(targetId);
        db.prepare('DELETE FROM guild_members WHERE user_id = ?').run(targetId);

        // 2. Copier les données principales de l'utilisateur
        db.prepare(`
            UPDATE users 
            SET xp = ?, level = ?, xp_needed = ?, points = ?, stars = ?, seasonal_xp = ?, 
                daily_last_claimed = ?, last_decay_timestamp = ?, xp_boost_until = ?, points_boost_until = ?
            WHERE id = ?
        `).run(
            sourceUser.xp, sourceUser.level, sourceUser.xp_needed, sourceUser.points, sourceUser.stars, sourceUser.seasonal_xp,
            sourceUser.daily_last_claimed, sourceUser.last_decay_timestamp, sourceUser.xp_boost_until, sourceUser.points_boost_until,
            targetId
        );

        // 3. Transférer l'inventaire
        const sourceInventory = db.prepare('SELECT * FROM user_inventory WHERE user_id = ?').all(sourceId);
        for (const item of sourceInventory) {
            db.prepare('INSERT INTO user_inventory (user_id, item_id, quantity) VALUES (?, ?, ?)').run(targetId, item.item_id, item.quantity);
        }

        // 4. Transférer les quêtes
        const sourceQuests = db.prepare('SELECT * FROM quest_progress WHERE user_id = ?').all(sourceId);
        for (const quest of sourceQuests) {
            db.prepare('INSERT INTO quest_progress (user_id, quest_id, progress, completed, completed_at) VALUES (?, ?, ?, ?, ?)').run(targetId, quest.quest_id, quest.progress, quest.completed, quest.completed_at);
        }

        // 5. Transférer le battle pass
        const sourceBP = db.prepare('SELECT * FROM battle_pass WHERE user_id = ?').all(sourceId);
        for (const bp of sourceBP) {
            db.prepare('INSERT INTO battle_pass (user_id, tier, claimed_free, claimed_vip) VALUES (?, ?, ?, ?)').run(targetId, bp.tier, bp.claimed_free, bp.claimed_vip);
        }

        // 6. Gérer les Guildes
        // Si la source est dans une guilde, ajouter la cible
        const sourceGuildMember = db.prepare('SELECT * FROM guild_members WHERE user_id = ?').get(sourceId);
        if (sourceGuildMember) {
            db.prepare('INSERT INTO guild_members (user_id, guild_id) VALUES (?, ?)').run(targetId, sourceGuildMember.guild_id);
        }

        // Si la source est chef de guilde, transférer la propriété
        const sourceOwnedGuild = db.prepare('SELECT * FROM guilds WHERE owner_id = ?').get(sourceId);
        if (sourceOwnedGuild) {
            db.prepare('UPDATE guilds SET owner_id = ? WHERE id = ?').run(targetId, sourceOwnedGuild.id);
        }

        // 7. Réinitialiser la Source
        resetUserStmt.run(sourceId);
        db.prepare('DELETE FROM user_inventory WHERE user_id = ?').run(sourceId);
        db.prepare('DELETE FROM quest_progress WHERE user_id = ?').run(sourceId);
        db.prepare('DELETE FROM battle_pass WHERE user_id = ?').run(sourceId);
        db.prepare('DELETE FROM guild_members WHERE user_id = ?').run(sourceId);
        // Note: Si la source était chef, la propriété a déjà été transférée, donc pas besoin de reset guilds.owner_id
    });

    transferTransaction();
}

function toggleUserSetting(userId, settingName) {
    const allowedSettings = [
        'notify_rank_up',
        'notify_level_up',
        'notify_streak',
        'notify_guild_invite',
        'notify_quest_complete',
        'notify_trade',
        'notify_minigame_invite',
        'notify_debt_reminder'
    ];

    if (!allowedSettings.includes(settingName)) {
        throw new Error(`Setting invalide : ${settingName}`);
    }

    const user = getOrCreateUser(userId, 'Unknown');
    const currentValue = user[settingName];
    const newValue = currentValue === 1 ? 0 : 1;

    try {
        db.prepare(`UPDATE users SET ${settingName} = ? WHERE id = ?`).run(newValue, userId);
        return newValue;
    } catch (error) {
        logger.error(`Erreur lors du changement du paramètre ${settingName} pour ${userId}`, error);
        return currentValue;
    }
}

module.exports = { getOrCreateUser, grantResources, updateDailyClaim, checkUserInventory, updateUserItemQuantity, setLevel, setPoints, setStars, resetUser, getLeaderboard, getUserRank, updateUserActivityTimestamp, updateUserBoost, getUserInventory, updateUserBalance, addItemToInventory, removeUserItem, transferUserData, toggleUserSetting, setResourceSource, getResourceHistory, getResourceSummary };