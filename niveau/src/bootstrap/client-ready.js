const logger = require('../utils/logger');
const {
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
} = require('discord.js');
const { getOrCreateUser, grantResources, updateUserActivityTimestamp } = require('../utils/db-users');
const { updateUserRank } = require('../utils/ranks');
const { processDecay } = require('../utils/decay-system');
const { checkQuestProgress } = require('../utils/quests');
const {
    usersInVoice,
    getValentinMessageCount,
    resetValentinMessageCount,
    valentinEvents,
} = require('../utils/global-state');
const { parseVoiceTrackingKey, runWithEconomyGuild } = require('../utils/economy-scope');
const config = require('../config');
const { getEventState, grantEventCurrency } = require('../utils/db-halloween');
const db = require('../database/database');
const { grantTiragePoints, PT_PER_VOICE_MINUTE } = require('../utils/puits-system');
const { grantRubansForVoice } = require('../utils/ruban-rewards');
const { getEventState: getNoelState } = require('../utils/db-noel');
const { getEventState: getValentinState } = require('../utils/db-valentin');
const { updateAllTopRoles } = require('../utils/top-roles');
const { distributeGiveawayRewards } = require('../utils/giveaway-rewards-distribution');

function scheduleStartupTask(label, delayMs, fn) {
    setTimeout(() => {
        Promise.resolve()
            .then(fn)
            .catch((err) => logger.error(`[startup:${label}]`, err?.message || err));
    }, delayMs);
}

/** Ms jusqu’au prochain minuit (Europe/Paris), horloge murale — évite `new Date(localeString)` qui peut donner un délai négatif. */
function msUntilNextMidnightParis() {
    try {
        const parts = new Intl.DateTimeFormat('en-GB', {
            timeZone: 'Europe/Paris',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false,
        }).formatToParts(new Date());
        const n = (t) => parseInt(parts.find((p) => p.type === t)?.value || '0', 10);
        const h = n('hour');
        const m = n('minute');
        const s = n('second');
        const elapsedMs = ((h * 60 + m) * 60 + s) * 1000;
        const approxLeft = 86400000 - elapsedMs;
        return Math.max(1000, approxLeft);
    } catch (e) {
        logger.warn('[schedule] msUntilNextMidnightParis repli 1h:', e?.message || e);
        return 3600000;
    }
}

/**
 * Tâches planifiées et logique au démarrage (extrait de index.js).
 * @param {import('discord.js').Client} client
 * @param {{ isHalloweenActive: boolean }} opts
 */
function registerClientReady(client, { isHalloweenActive }) {
    client.once('clientReady', () => {
    const { checkOverdueLoans } = require('../utils/loan-system');

    // Vérifier les dettes en retard une première fois au démarrage
    logger.info('🏦 Vérification initiale des dettes en retard...');
    checkOverdueLoans(client).catch(err => logger.error('Erreur lors de la vérification des dettes:', err));

    setInterval(() => {
        logger.info('Checking for overdue loans...');
        checkOverdueLoans(client).catch(err => logger.error('Erreur lors de la vérification des dettes:', err));
    }, 3600000); // Every hour

    const _deferRaw = parseInt(process.env.BLZ_DEFER_STARTUP_MS || '1500', 10);
    const startupBase = Number.isFinite(_deferRaw) && _deferRaw >= 0 ? _deferRaw : 1500;
    logger.info(`Connecté en tant que ${client.user.tag} !`);

    const prvMod = require('../utils/private-voice-rooms');
    const prvGuildId = process.env.GUILD_ID;
    const prvGuild = prvGuildId ? client.guilds.cache.get(prvGuildId) : client.guilds.cache.first();
    if (!prvGuild) {
        logger.warn('[PRIVATE_ROOM] Aucune guilde au démarrage — vérifie GUILD_ID et l’invitation du bot sur le serveur.');
    } else {
        prvMod
            .resolvePrivateRoomConfig(client, prvGuild)
            .then((prv) => {
                if (!prv.enabled) {
                    const prvMsg =
                        prv.error === 'lobby_not_found'
                            ? `[PRIVATE_ROOM] Lobby introuvable sur la guilde (ID ${prv.lobbyChannelId}). Vérifie GUILD_ID / invite du bot.`
                            : prv.error === 'missing_category'
                              ? '[PRIVATE_ROOM] Inactif : catégorie vocale invalide (vérifie PRIVATE_ROOM_CATEGORY_ID).'
                              : '[PRIVATE_ROOM] Inactif (PRIVATE_ROOM_ENABLED=0 ou configuration invalide).';
                    if (process.env.BLZ_COMPACT_LOG === '1') logger.debug(prvMsg);
                    else logger.warn(prvMsg);
                } else {
                    const panelHint = prv.panelTextChannelId ? ` → panneau <#${prv.panelTextChannelId}>` : '';
                    logger.info(
                        `[PRIVATE_ROOM] Actif — lobby <#${prv.lobbyChannelId}> → catégorie \`${prv.voiceCategoryId}\`${panelHint}`
                    );
                }
            })
            .catch((e) => logger.error('[PRIVATE_ROOM] Résolution config:', e?.message || e));
    }

    scheduleStartupTask('bot-service-role', startupBase + 800, async () => {
        const { ensureBotServiceRole } = require('../utils/bot-service-role');
        await ensureBotServiceRole(client);
    });

    // --- Synchronisation boosters / salons guildes / comptage : différé pour alléger le pic API au ready ---
    scheduleStartupTask('boosters', startupBase, async () => {
        try {
            logger.info('🚀 Synchronisation des rôles de booster...');
            const BOOSTER_ROLE_ID = '1170361439345704962';

            for (const guild of client.guilds.cache.values()) {
                try {
                    const members = await guild.members.fetch();
                    let syncCount = 0;

                    for (const member of members.values()) {
                        const isBoosting = member.premiumSince !== null;
                        const hasRole = member.roles.cache.has(BOOSTER_ROLE_ID);

                        if (isBoosting && !hasRole) {
                            await member.roles.add(BOOSTER_ROLE_ID);
                            logger.info(`✅ Rôle booster ajouté à ${member.user.tag}`);
                            syncCount++;
                        }

                        if (!isBoosting && hasRole) {
                            await member.roles.remove(BOOSTER_ROLE_ID);
                            logger.info(`❌ Rôle booster retiré de ${member.user.tag}`);
                            syncCount++;
                        }
                    }

                    logger.info(`🚀 Synchronisation terminée pour ${guild.name}: ${syncCount} membre(s) mis à jour`);
                } catch (error) {
                    logger.error(`Erreur lors de la synchronisation des boosters pour ${guild.name}:`, error);
                }
            }
        } catch (error) {
            logger.error('Erreur lors de la synchronisation des rôles de booster:', error);
        }
    });

    scheduleStartupTask('guild-channels', startupBase + 2500, async () => {
        try {
            logger.info('🏰 Vérification des salons de guildes...');
            const dbGuild = require('../database/database');
            const { createGuildPrivateChannel } = require('../utils/guild/guild-upgrades');

            const guilds = dbGuild.prepare("SELECT * FROM guilds WHERE upgrade_level >= 5 AND (channel_id IS NULL OR channel_id = '')").all();

            if (guilds.length > 0) {
                logger.info(`📋 ${guilds.length} guilde(s) sans salon détectée(s). Création en cours...`);

                if (!process.env.GUILD_CATEGORY) {
                    logger.warn('⚠️ Variable GUILD_CATEGORY non définie dans .env. Les salons de guildes ne seront pas créés.');
                } else {
                    for (const guild of guilds) {
                        try {
                            await createGuildPrivateChannel(client, guild);
                            logger.info(`✅ Salon créé pour la guilde "${guild.name}"`);
                        } catch (error) {
                            logger.error(`❌ Erreur lors de la création du salon pour "${guild.name}":`, error.message);
                        }
                    }
                }
            } else {
                logger.info('✅ Tous les salons de guildes sont en place.');
            }
        } catch (error) {
            logger.error('❌ Erreur lors de la vérification des salons de guildes:', error);
        }
    });

    scheduleStartupTask('counting', startupBase + 5000, async () => {
        try {
            const comptageChannelId = process.env.COMPTAGE;
            if (comptageChannelId) {
                logger.info('[COUNTING] Initialisation du système de comptage...');
                const comptageChannel = await client.channels.fetch(comptageChannelId).catch(() => null);
                if (comptageChannel && comptageChannel.isTextBased()) {
                    const { getLastValidSequence, removeCountingPoints } = require('../utils/counting-system');
                    const validationResult = await getLastValidSequence(comptageChannel);
                    const { lastNumber, invalidMessages, usersToRemovePC } = validationResult;

                    if (invalidMessages.length > 0) {
                        logger.info(`[COUNTING] Suppression de ${invalidMessages.length} message(s) faux...`);

                        try {
                            const messages = await comptageChannel.messages.fetch({ limit: 100 });
                            const messagesArray = Array.from(messages.values());

                            for (const invalidMsg of invalidMessages) {
                                const messageToDelete = messagesArray[messagesArray.length - 1 - invalidMsg.index];
                                if (messageToDelete) {
                                    try {
                                        await messageToDelete.delete();
                                        logger.info(`[COUNTING] Message faux supprimé (numéro: ${invalidMsg.number})`);
                                    } catch (error) {
                                        logger.warn(`[COUNTING] Impossible de supprimer le message: ${error.message}`);
                                    }
                                }
                            }
                        } catch (error) {
                            logger.error('[COUNTING] Erreur lors de la suppression des messages:', error);
                        }

                        logger.info(`[COUNTING] Application des pénalités PC aux ${Object.keys(usersToRemovePC).length} utilisateur(s)...`);
                        for (const [userId, invalidCount] of Object.entries(usersToRemovePC)) {
                            removeCountingPoints(userId, invalidCount);
                        }
                    }

                    const messageCreateEvent = require('../events/messageCreate');
                    messageCreateEvent.setLastCountingNumber(lastNumber);

                    logger.info(`[COUNTING] Système initialisé. Dernier nombre valide: ${lastNumber || 0}, utilisateurs pénalisés: ${Object.keys(usersToRemovePC).length}`);
                } else {
                    logger.debug('[COUNTING] Canal de comptage non trouvé ou non valide (vérifie COMPTAGE dans .env).');
                }
            } else {
                logger.info('[COUNTING] Variable COMPTAGE non définie dans .env');
            }
        } catch (error) {
            logger.error('[COUNTING] Erreur lors de l\'initialisation du système:', error);
        }
    });

    // --- Planification du revenu de trésorerie à minuit (heure de Paris, UTC+1/+2) ---
    const { applyDailyIncome } = require('../utils/guild/guild-treasury');

    function scheduleMidnightTreasuryIncome() {
        const msUntilMidnight = msUntilNextMidnightParis();
        const hoursRemaining = Math.floor(msUntilMidnight / 1000 / 60 / 60);
        const minutesRemaining = Math.floor((msUntilMidnight / 1000 / 60) % 60);

        logger.info(`⏰ Revenu de trésorerie planifié dans ${hoursRemaining}h${minutesRemaining}min (à minuit heure de Paris)`);

        setTimeout(() => {
            logger.info('🏰 Minuit (Paris) ! Application du revenu de trésorerie des guildes...');
            applyDailyIncome();

            // Replanifier pour le prochain jour
            setInterval(() => {
                logger.info('🏰 Minuit (Paris) ! Application du revenu de trésorerie des guildes...');
                applyDailyIncome();
            }, 86400000); // Toutes les 24 heures après le premier minuit
        }, msUntilMidnight);
    }
    scheduleMidnightTreasuryIncome();

    // Note: La vérification des guerres terminées est gérée par guild-wars.js (checkAndEndWars) toutes les 60s
    // war-system.js n'est plus utilisé ici pour éviter les doublons

    const { scheduleSeasonalReset } = require('../utils/puits-system');
    scheduleSeasonalReset();

    const { scheduleStreakReset } = require('../utils/streak-system');
    scheduleStreakReset();

    // MAJ Mars 2026: Tâches planifiées Marketplace & Valeur
    const { cleanupExpiredListings } = require('../utils/marketplace-system');
    const { recalculateAllValues } = require('../utils/trophy-value-system');

    // Nettoyer les annonces marketplace expirées toutes les heures
    setInterval(() => {
        cleanupExpiredListings();
    }, 3600000); // Every hour

    // Recalculer les valeurs de tous les joueurs/guildes toutes les 2 heures
    setInterval(() => {
        recalculateAllValues();
    }, 7200000); // Every 2 hours

    // Recalcul initial au démarrage (écarté du pic boosters/comptage)
    setTimeout(() => {
        recalculateAllValues();
        logger.info('[MAJ-MARS] Valeurs initiales recalculées au démarrage.');
    }, 45000);


    // Mettre à jour les rôles TOP et vérifier les quêtes associées toutes les heures
    setInterval(async () => {
        logger.info('Mise à jour des rôles TOP...');
        await updateAllTopRoles(client);
    }, 3600000); // Every hour

    // Exécuter immédiatement au démarrage
    setTimeout(async () => {
        logger.info('Première vérification des rôles TOP...');
        await updateAllTopRoles(client);
    }, 10000); // 10 seconds after startup

    // Mettre à jour les usernames "unknown" dans la base Halloween
    if (isHalloweenActive) {
        const { updateAllUnknownUsernames } = require('../utils/db-halloween');
        updateAllUnknownUsernames();
    }

    // RANKED V2: Démarrer le système anti-AFK vocal
    const { start: startVoiceAfkChecker } = require('../utils/voice-afk-checker');
    startVoiceAfkChecker(client);

    // Tâche périodique pour les récompenses vocales
    setInterval(async () => {
        if (usersInVoice.size === 0) return;

        const voiceKeys = Array.from(usersInVoice);

        // Traiter par lots de 10 pour ne pas surcharger le CPU ou l'API d'un coup
        const batchSize = 10;
        for (let i = 0; i < voiceKeys.length; i += batchSize) {
            const batch = voiceKeys.slice(i, i + batchSize);

            await Promise.all(batch.map(async (vKey) => {
                try {
                    const { guildId, userId } = parseVoiceTrackingKey(vKey);
                    if (!guildId) {
                        return;
                    }

                    const guild = await client.guilds.fetch(guildId).catch(() => null);
                    if (!guild) {
                        return;
                    }

                    const member = await guild.members.fetch(userId).catch(() => null);
                    // Ignorer si le membre n'est plus là ou plus en vocal
                    if (!member || !member.voice.channel) {
                        return;
                    }

                    // Vérifier qu'il y a au moins une autre personne (non-bot) dans le salon
                    const humanMembersCount = member.voice.channel.members.filter(m => !m.user.bot).size;

                    logger.debug(`Voice check: ${member.user.username} | membres humains: ${humanMembersCount}`);

                    if (humanMembersCount >= 2) {
                        await runWithEconomyGuild(guildId, async () => {
                        const user = member.user;
                        getOrCreateUser(userId, user.username);
                        updateUserActivityTimestamp(userId);

                        const { updateStreak } = require('../utils/streak-system');
                        updateStreak(client, userId);

                        const today = new Date().setHours(0, 0, 0, 0);
                        // Fetch fresh user data including daily_voice_points and daily_voice_xp
                        const dbUser = db.prepare('SELECT daily_voice_xp, daily_voice_points, daily_voice_last_reset FROM users WHERE id = ?').get(userId);
                        let dailyVoiceXP = dbUser?.daily_voice_xp || 0;
                        let dailyVoicePoints = dbUser?.daily_voice_points || 0;

                        if ((dbUser?.daily_voice_last_reset || 0) < today) {
                            dailyVoiceXP = 0;
                            dailyVoicePoints = 0;
                            // Reset both
                            db.prepare('UPDATE users SET daily_voice_xp = 0, daily_voice_points = 0, daily_voice_last_reset = ? WHERE id = ?').run(today, userId);
                        }

                        // Limites journalières
                        // XP: Soft Cap 10,000 -> Hard Cap +5,000 = 15,000
                        // RP: Soft Cap 5,000 -> Hard Cap +2,000 = 7,000
                        const XP_HARD_CAP = 15000;
                        const RP_HARD_CAP = 7000;

                        // Si une des limites dures est atteinte, arrêt TOTAL des gains
                        if (dailyVoiceXP >= XP_HARD_CAP || dailyVoicePoints >= RP_HARD_CAP) {
                            // logger.info(`Voice hard cap reached for ${user.username}. No gains.`);
                            return;
                        }

                        // RANKED V2: XP reste à 30/min, RP passe à 10/min
                        const baseXpAmount = 30;
                        const baseRpAmount = 10; // RANKED V2: 10 RP par minute (au lieu de 30)
                        let xpGain = baseXpAmount;
                        let pointsGain = baseRpAmount;

                        // XP Soft Cap: 10,000 -> divisé par 5
                        if (dailyVoiceXP >= 10000) {
                            xpGain = Math.floor(baseXpAmount / 5);
                        }

                        // RP Soft Cap: 5,000 -> divisé par 5
                        if (dailyVoicePoints >= 5000) {
                            pointsGain = Math.floor(baseRpAmount / 5);
                        }

                        // RANKED V2: pénalité AFK (réglable via /anti-afk → sanctions)
                        const {
                            getRPMultiplier,
                            getXpPenaltyMultiplier,
                            getStarsPenaltyMultiplier,
                        } = require('../utils/ranked-state');
                        const rpM = getRPMultiplier(userId);
                        const xpM = getXpPenaltyMultiplier(userId);
                        const stM = getStarsPenaltyMultiplier(userId);
                        xpGain = Math.floor(xpGain * xpM);
                        pointsGain = Math.floor(pointsGain * rpM);

                        // Stars vocal (souvent 0 ; multiplicateur suit quand même la config anti-AFK)
                        let starsGain = 0;
                        starsGain = Math.floor(starsGain * stM);

                        // Multiplicateur global pour les événements (si un soft cap est atteint, on réduit aussi les gains d'event)
                        let globalEventMultiplier = 1;
                        if (dailyVoiceXP >= 10000 || dailyVoicePoints >= 5000) {
                            globalEventMultiplier = 0.2; // 1/5
                        }

                        const nerfedRewards = { xp: xpGain, points: pointsGain, stars: starsGain, source: 'vocal' };

                        // Update Database UPDATE daily counters
                        db.prepare('UPDATE users SET daily_voice_xp = daily_voice_xp + ?, daily_voice_points = daily_voice_points + ? WHERE id = ?').run(xpGain, pointsGain, userId);

                        grantResources(client, userId, nerfedRewards);
                        updateUserRank(client, userId);

                        // MAJ Mars 2026: Accorder des PT pour le Puits de Combat (20 PT/min vocal)
                        grantTiragePoints(userId, PT_PER_VOICE_MINUTE);

                        const penalizedVoice = rpM < 1 || xpM < 1 || stM < 1;
                        logger.info(
                            `Récompense vocale pour ${user.username}: +${xpGain} XP, +${pointsGain} RP${penalizedVoice ? ' (PÉNALISÉ)' : ''} +${PT_PER_VOICE_MINUTE} PT (Daily XP tot: ${dailyVoiceXP + xpGain}, Daily RP tot: ${dailyVoicePoints + pointsGain})`
                        );

                        const questUser = { ...user, ...dbUser }; // Merge pour avoir les infos nécessaires
                        checkQuestProgress(client, 'VOICE_MINUTE', questUser);

                        if (getEventState('halloween')) {
                            const bonbonsGain = Math.floor(15 * globalEventMultiplier);
                            if (bonbonsGain > 0) grantEventCurrency(userId, { bonbons: bonbonsGain });
                        }

                        if (getNoelState('noël')) {
                            const effectiveDuration = Math.floor(60000 * globalEventMultiplier);
                            if (effectiveDuration > 0) grantRubansForVoice(userId, effectiveDuration);
                        }

                        // Saint-Valentin rewards
                        if (getValentinState('valentin')) {
                            const { grantEventCurrency: grantValentinCurrency } = require('../utils/db-valentin');
                            const coeursGain = Math.floor(config.valentin.rewards.voicePerMinute * globalEventMultiplier);
                            if (coeursGain > 0) {
                                grantValentinCurrency(userId, { coeurs: coeursGain });
                            }
                        }


                        // Incrémenter compteur de guerre pour minutes vocales
                        try {
                            const { incrementWarVoiceMinutes } = require('../utils/guild/guild-wars');
                            incrementWarVoiceMinutes(userId);
                        } catch (err) {
                            logger.debug(`War voice increment skipped for ${userId}: ${err.message}`);
                        }
                        });
                    }
                } catch (error) {
                    logger.error(`Erreur lors de la récompense vocale pour ${vKey}:`, error);
                }
            }));
        }
    }, 60000); // Toutes les 60 secondes

    setInterval(() => {
        logger.info('Vérification de la perte de points (decay)...');
        processDecay(client);
    }, 3600000); // Toutes les heures

    // Tâche périodique pour vérifier les giveaways expirés
    setInterval(async () => {
        const { getExpiredGiveaways, endGiveaway, createGiveaway, updateGiveawayMessageId } = require('../utils/db-giveaway');
        const { buildGiveawayEmbed } = require('../commands/giveaway/ui');
        const { ButtonBuilder, ButtonStyle, ActionRowBuilder } = require('discord.js');

        const expiredGiveaways = getExpiredGiveaways();

        for (const giveaway of expiredGiveaways) {
            try {
                const result = endGiveaway(giveaway.id);
                if (result) {
                    const channel = await client.channels.fetch(giveaway.channel_id).catch(() => null);
                    if (channel) {
                        // Mettre à jour le message original du giveaway pour montrer qu'il est terminé
                        if (giveaway.message_id) {
                            try {
                                const originalMessage = await channel.messages.fetch(giveaway.message_id).catch(() => null);
                                if (originalMessage) {
                                    const endedEmbed = buildGiveawayEmbed(giveaway, true);
                                    endedEmbed.setFooter({ text: `Giveaway #${giveaway.id} - Terminé` });
                                    await originalMessage.edit({ embeds: [endedEmbed], components: [] });
                                }
                            } catch (error) {
                                logger.error(`Impossible de mettre à jour le message du giveaway ${giveaway.id}:`, error);
                            }
                        }

                        // Créer le texte des récompenses
                        const rewardsText = result.rewards.map(r => {
                            switch (r.type) {
                                case 'xp': return `💫 ${parseInt(r.value).toLocaleString('fr-FR')} XP`;
                                case 'stars': return `⭐ ${parseInt(r.value).toLocaleString('fr-FR')} Starss`;
                                case 'bonbons': return `🍬 ${parseInt(r.value).toLocaleString('fr-FR')} Bonbons`;
                                case 'citrouilles': return `🎃 ${parseInt(r.value).toLocaleString('fr-FR')} Citrouilles`;
                                case 'bonbons_surprise': return `🍭 ${parseInt(r.value).toLocaleString('fr-FR')} Bonbons Surprise`;
                                case 'rubans': return `🎀 ${parseInt(r.value).toLocaleString('fr-FR')} Rubans`;
                                case 'cadeaux_surprise': return `🎁 ${parseInt(r.value).toLocaleString('fr-FR')} Cadeaux Surprise`;
                                case 'role': return `👤 Rôle <@&${r.value}>`;
                                default: return '';
                            }
                        }).filter(t => t).join('\n');

                        // Envoyer un message avec les résultats
                        const embed = new EmbedBuilder()
                            .setTitle('🎉 Giveaway Terminé !')
                            .setDescription(`Le giveaway **${giveaway.title}** est terminé !`)
                            .setColor(0x00ff00);

                        if (result.winners.length > 0) {
                            const winnerMentions = result.winners.map(id => `<@${id}>`).join(' ');

                            embed.addFields({
                                name: '🏆 Gagnant(s)',
                                value: result.winners.map(id => `<@${id}>`).join('\n'),
                                inline: false
                            });

                            if (rewardsText) {
                                embed.addFields({
                                    name: '🎁 Récompenses',
                                    value: rewardsText,
                                    inline: false
                                });
                            }

                            // Distribuer les récompenses
                            await distributeGiveawayRewards(client, result.winners, result.rewards);

                            // Envoyer avec mention des gagnants
                            await channel.send({
                                content: `🎊 Félicitations ${winnerMentions} ! Vous avez gagné le giveaway !`,
                                embeds: [embed]
                            });
                        } else {
                            embed.addFields({
                                name: '😔 Aucun participant',
                                value: 'Personne n\'a participé à ce giveaway.',
                                inline: false
                            });

                            await channel.send({ embeds: [embed] });
                        }

                        // Si le giveaway doit se répéter, créer un nouveau giveaway
                        if (giveaway.repeat_interval && giveaway.repeat_interval > 0) {
                            logger.info(`Recréation du giveaway répétitif #${giveaway.id}...`);
                            const newGiveawayId = createGiveaway(
                                giveaway.guild_id,
                                giveaway.channel_id,
                                giveaway.title,
                                giveaway.description,
                                giveaway.winner_count,
                                giveaway.duration,
                                giveaway.creator_id,
                                giveaway.rewards, // Utiliser les mêmes récompenses
                                giveaway.conditions, // Utiliser les mêmes conditions
                                giveaway.repeat_interval
                            );

                            const newGiveawayEmbed = buildGiveawayEmbed({
                                title: giveaway.title,
                                description: giveaway.description,
                                winnerCount: giveaway.winner_count,
                                duration: giveaway.duration,
                                rewards: giveaway.rewards,
                                conditions: giveaway.conditions,
                                participants: []
                            });
                            newGiveawayEmbed.setFooter({ text: `Giveaway #${newGiveawayId} (Répétition)` });

                            const participateButton = new ActionRowBuilder().addComponents(
                                new ButtonBuilder()
                                    .setCustomId(`giveaway_join_${newGiveawayId}`)
                                    .setLabel('Participer')
                                    .setStyle(ButtonStyle.Primary)
                                    .setEmoji('🎉')
                            );

                            const newMessage = await channel.send({ embeds: [newGiveawayEmbed], components: [participateButton] });
                            updateGiveawayMessageId(newGiveawayId, newMessage.id);
                        }
                    }
                }
            } catch (error) {
                logger.error(`Erreur lors de la fin du giveaway ${giveaway.id}:`, error);
            }
        }
    }, 30000); // Toutes les 30 secondes

    // Note: Le revenu de trésorerie est planifié à minuit via scheduleMidnightTreasuryIncome()

    // Tâche périodique pour vérifier la fin des guerres de guildes
    setInterval(async () => {
        logger.info('Vérification des guerres de guildes en cours...');
        const { checkAndEndWars } = require('../utils/guild/guild-wars');

        try {
            await checkAndEndWars(client);
        } catch (error) {
            logger.error('Erreur lors de la vérification des guerres:', error);
        }
    }, 60000); // Toutes les minutes

    // --- Vérification du sureffectif des guildes (toutes les heures) ---
    const { checkAllGuildsOverstaff, applyDailyOverstaffPenalties } = require('../utils/guild/guild-overstaffing');

    setInterval(() => {
        logger.info('Vérification du sureffectif des guildes...');
        checkAllGuildsOverstaff(client);
    }, 3600000); // Toutes les heures (3600000 ms)

    // Vérification initiale au démarrage
    setTimeout(() => {
        logger.info('Vérification initiale du sureffectif des guildes...');
        checkAllGuildsOverstaff(client);
    }, 30000); // 30 secondes après le démarrage

    // --- Application des pénalités de sureffectif (tous les jours à minuit Paris) ---
    function scheduleOverstaffPenalties() {
        const msUntilMidnight = msUntilNextMidnightParis();

        setTimeout(() => {
            logger.info('⚠️ Minuit (Paris) ! Application des pénalités de sureffectif...');
            applyDailyOverstaffPenalties(client);

            // Replanifier pour le prochain minuit
            scheduleOverstaffPenalties();
        }, msUntilMidnight);

        logger.info(`⚠️ Pénalités de sureffectif planifiées dans ${Math.floor(msUntilMidnight / (60 * 60 * 1000))}h${Math.floor((msUntilMidnight / (60 * 1000)) % 60)}min`);
    }

    scheduleOverstaffPenalties();

    // --- Tâche périodique pour mettre à jour les noms d'utilisateur (pour le classement) ---
    setInterval(async () => {
        logger.info('🔄 Vérification et mise à jour des noms d\'utilisateur...');

        try {
            const db = require('../database/database');
            const guild = await client.guilds.fetch(process.env.GUILD_ID).catch(() => null);

            if (!guild) {
                logger.warn('Impossible de fetch le serveur principal pour la mise à jour des usernames.');
                return;
            }

            // Récupérer tous les utilisateurs de la base de données
            const users = db.prepare('SELECT id, username FROM users').all();
            let updatedCount = 0;
            let errorCount = 0;

            // Traiter par lots de 10 pour ne pas surcharger l'API Discord
            const batchSize = 10;
            for (let i = 0; i < users.length; i += batchSize) {
                const batch = users.slice(i, i + batchSize);

                await Promise.all(batch.map(async (user) => {
                    try {
                        const member = await guild.members.fetch(user.id).catch(() => null);

                        if (member) {
                            const currentUsername = member.user.username;

                            // Si le nom a changé, mettre à jour
                            if (user.username !== currentUsername) {
                                db.prepare('UPDATE users SET username = ? WHERE id = ?').run(currentUsername, user.id);
                                logger.info(`📝 Username mis à jour: ${user.username} -> ${currentUsername}`);
                                updatedCount++;
                            }
                        }
                    } catch (error) {
                        errorCount++;
                        // On log uniquement en debug pour ne pas spam les logs
                    }
                }));

                // Petite pause entre les batches pour respecter le rate limit
                if (i + batchSize < users.length) {
                    await new Promise(resolve => setTimeout(resolve, 1000));
                }
            }

            if (updatedCount > 0 || errorCount > 0) {
                logger.info(`✅ Mise à jour des usernames terminée: ${updatedCount} mis à jour, ${errorCount} erreur(s)`);
            } else {
                logger.info('✅ Tous les usernames sont à jour.');
            }
        } catch (error) {
            logger.error('❌ Erreur lors de la mise à jour des noms d\'utilisateur:', error);
        }
    }, 3600000); // Toutes les heures (3600000 ms)

    // --- Événement Périodique Saint-Valentin (Toutes les 5 minutes) ---
    setInterval(async () => {
        try {
            if (!getValentinState('valentin')) return;

            const { minMessages } = config.valentin.periodicEvent;
            const currentMessages = getValentinMessageCount();

            // Réinitialiser le compteur pour les prochaines 5 minutes
            resetValentinMessageCount();

            if (currentMessages < minMessages) {
                logger.info(`[VALENTIN] Événement ignoré: Activité insuffisante (${currentMessages}/${minMessages} messages).`);
                return;
            }

            const { channelId, minHearts, maxHearts, maxClaims, expiryTime } = config.valentin.periodicEvent;
            const channel = await client.channels.fetch(channelId).catch(() => null);
            if (!channel || !channel.isTextBased()) return;

            const amount = Math.floor(Math.random() * (maxHearts - minHearts + 1)) + minHearts;
            const eventId = Date.now().toString();

            valentinEvents.set(eventId, {
                amount: amount,
                claimedBy: [],
                maxClaims: maxClaims
            });

            const embed = new EmbedBuilder()
                .setTitle('💖 Événement Saint-Valentin !')
                .setDescription(`Le bot distribue **${amount} cœurs** ! Soyez parmi les 3 premiers à cliquer pour les récupérer !`)
                .setColor('#FF69B4')
                .setThumbnail('https://cdn-icons-png.flaticon.com/512/2589/2589175.png')
                .setFooter({ text: 'Événement Saint-Valentin' })
                .setTimestamp();

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId(`valentin_claim_${eventId}`)
                    .setLabel('Récupérer !')
                    .setStyle(ButtonStyle.Primary)
                    .setEmoji('💖')
            );

            await channel.send({ embeds: [embed], components: [row] });
            logger.info(`[VALENTIN] Événement lancé: ${amount} cœurs, ID: ${eventId}`);

            // Nettoyer l'événement de la mémoire après 10 minutes pour éviter les fuites
            setTimeout(() => {
                if (valentinEvents.has(eventId)) {
                    valentinEvents.delete(eventId);
                }
            }, expiryTime);

        } catch (error) {
            logger.error('Erreur lors du lancement de l\'événement Saint-Valentin:', error);
        }
    }, config.valentin.periodicEvent.interval); // Configuré dans config.js

    });
}

module.exports = { registerClientReady };
