const { Events } = require('discord.js');
const { getOrCreateUser, grantResources, updateUserActivityTimestamp } = require('../utils/db-users');
const { incrementValentinMessageCount } = require('../utils/global-state');
const { updateUserRank, MAIN_RANKS } = require('../utils/ranks');
const { checkQuestProgress } = require('../utils/quests');
const { grantTiragePoints, PT_PER_MESSAGE } = require('../utils/puits-system');
const { getEventState, getOrCreateEventUser, grantEventCurrency } = require('../utils/db-halloween');
const { checkAndGrantHalloweenRewards } = require('../utils/halloween-rewards');
const { updateLevelRoles } = require('../utils/level-roles');
const { grantRubanForAction } = require('../utils/ruban-rewards');
const { isValidCountingNumber, isCorrectSequence, grantCountingPoints, getLastValidNumber } = require('../utils/counting-system');
const { getGuildOfUser, getGuildById } = require('../utils/db-guilds');
const { getEventState: getValentinState, grantEventCurrency: grantValentinCurrency, incrementDailyMessageCount } = require('../utils/db-valentin');

// const { calculateGuildBoosts } = require('../utils/guild/guild-boosters'); // Déplacé dans db-users.js
const { getTutorialProgress } = require('../utils/tutorial-handler');
const config = require('../config');
const roleConfig = require('../config/role.config.json');
const logger = require('../utils/logger');

// Cooldown anti-spam (en mémoire)
const messageCooldown = new Set();

// Cooldown pour le couscous easter egg (2 minutes)
const couscousCooldown = new Map();

// Stockage du dernier nombre valide du comptage
let lastCountingNumber = null;

module.exports = {
    name: Events.MessageCreate,
    async execute(message, client) { // client est maintenant disponible ici
        if (message.author.bot || !message.guild) {
            return;
        }

        const { runWithEconomyGuild } = require('../utils/economy-scope');
        return runWithEconomyGuild(message.guild.id, async () => {
        try {
            // Ignorer les messages dans les fils de tutoriel pour éviter les crashes
            if (message.channel.isThread()) {
                try {
                    const tutorialProgress = getTutorialProgress(message.author.id);
                    if (tutorialProgress && tutorialProgress.thread_id === message.channel.id) {
                        logger.debug(`[MESSAGE_CREATE] Message dans le fil de tutoriel ignoré: ${message.author.username}`);
                        return; // Ignorer les messages dans les fils de tutoriel
                    }
                } catch (tutorialError) {
                    logger.error('[MESSAGE_CREATE] Erreur lors de la vérification du tutoriel:', tutorialError);
                    // Continuer même si la vérification échoue
                }
            }

            const author = message.author;
            const newUser = getOrCreateUser(author.id, author.username);
            updateUserActivityTimestamp(author.id);

            // --- Easter egg: !couscous ---
            if (message.content.toLowerCase() === '!couscous') {
                const now = Date.now();
                const lastUsed = couscousCooldown.get(author.id) || 0;

                // 2 minutes de cooldown (120000 ms) - ignore silencieusement si spam
                if (now - lastUsed >= 120000) {
                    const { addItemToInventory } = require('../utils/db-users');
                    addItemToInventory(author.id, 'couscous', 1);
                    couscousCooldown.set(author.id, now);
                    message.reply('🥘 Tu viens de recevoir un **Couscous** ! Utilise `/use item:couscous` pour le manger.').catch(() => { });
                }
                // Si spam, ne rien faire (ignorer silencieusement)
                return;
            }

            // --- Tracking d'activité Saint-Valentin ---
            if (getValentinState('valentin')) {
                incrementDailyMessageCount(author.id);
                incrementValentinMessageCount();
            }

            // --- Gestion du salon de comptage ---
            const comptageChannelId = process.env.COMPTAGE;
            if (comptageChannelId && message.channel.id === comptageChannelId) {
                // Initialiser lastCountingNumber si nécessaire en lisant l'historique (au reboot du bot)
                if (lastCountingNumber === null) {
                    try {
                        // Chercher le dernier nombre valide AVANT ce message
                        const messages = await message.channel.messages.fetch({ limit: 20 });
                        // Exclure le message actuel et les bots
                        const previousMessages = Array.from(messages.values()).filter(m => m.id !== message.id && !m.author.bot);
                        lastCountingNumber = getLastValidNumber(previousMessages) || 0;
                        logger.info(`[COUNTING] État restauré à ${lastCountingNumber} après redémarrage.`);
                    } catch (err) {
                        logger.error('[COUNTING] Erreur initialisation état:', err);
                        lastCountingNumber = 0;
                    }
                }

                // Valider le message de comptage
                if (!isValidCountingNumber(message.content)) {
                    // Message invalide : contient \n ou des caractères non numériques
                    try {
                        await message.delete();
                        logger.info(`[COUNTING] Message invalide supprimé de ${author.username}: "${message.content}"`);
                    } catch (error) {
                        logger.error(`[COUNTING] Erreur lors de la suppression du message invalide:`, error);
                    }
                    return;
                }

                const newNumber = parseInt(message.content.trim());
                if (isNaN(newNumber)) {
                    // Nombre invalide
                    try {
                        await message.delete();
                        logger.info(`[COUNTING] Message avec nombre invalide supprimé de ${author.username}`);
                    } catch (error) {
                        logger.error(`[COUNTING] Erreur lors de la suppression du message:`, error);
                    }
                    return;
                }

                // Vérifier si le nombre suit la séquence correcte
                if (!isCorrectSequence(newNumber, lastCountingNumber)) {
                    // Nombre incorrect dans la séquence
                    try {
                        await message.delete();
                        logger.info(`[COUNTING] Nombre incorrect supprimé de ${author.username}: attendu ${(lastCountingNumber || 0) + 1}, reçu ${newNumber}`);
                    } catch (error) {
                        logger.error(`[COUNTING] Erreur lors de la suppression du message incorrect:`, error);
                    }
                    return;
                }

                // Le nombre est correct ! Accorder les PC
                lastCountingNumber = newNumber;
                grantCountingPoints(author.id, 1);
                logger.info(`[COUNTING] ${author.username} a envoyé le nombre correct ${newNumber} et a reçu 1 PC`);


                // Incrémenter compteur de guerre pour messages de comptage
                try {
                    const { incrementWarCountingMessages } = require('../utils/guild/guild-wars');
                    incrementWarCountingMessages(author.id);
                } catch (err) {
                    logger.debug('War counting increment skipped:', err.message);
                }

                return; // Ne pas accorder xp/points/stars dans le salon de comptage
            }

            // Assigner le rôle de niveau initial si c'est un nouvel utilisateur
            if (newUser && message.member) {
                const userLevel = newUser.level || 1;
                await updateLevelRoles(message.member, userLevel).catch(err =>
                    logger.error(`Erreur lors de l'assignation du rôle de niveau initial à ${author.id}:`, err)
                );
            }

            // --- Logique de l'événement Halloween ---
            if (getEventState('halloween')) {
                const updatedEventUser = grantEventCurrency(author.id, { citrouilles: 10, bonbons: 3 });
                await checkAndGrantHalloweenRewards(client, updatedEventUser);
            }

            // --- Logique de l'événement Noël ---
            const grantRubanAction = (type) => {
                const result = grantRubanForAction(author.id, type);
                if (result) {
                    logger.debug(`${author.username} a reçu des rubans pour ${type}`);
                }
            };

            // Quête de discussion privée avec BLZbot
            if (message.channel.isThread() && message.channel.parentId === '1414668466413375629') {
                checkQuestProgress(client, 'PRIVATE_THREAD_MESSAGE', author, { parentChannelId: message.channel.parentId });
            }

            // --- Quêtes et Récompenses --- 
            if (!messageCooldown.has(author.id)) {

                const { updateStreak } = require('../utils/streak-system');
                updateStreak(message.client, author.id);

                // RANKED V2: Si l'utilisateur est en vocal, pas de RP (points) par message
                // XP et Stars restent inchangés
                const { usersInVoice } = require('../utils/global-state');
                const isUserInVoice = usersInVoice.has(author.id);

                // Appliquer les récompenses (les boosts sont gérés dans grantResources)
                const baseXp = 10, basePoints = 10;
                let baseStars = 10;

                grantResources(client, author.id, {
                    xp: baseXp,
                    points: isUserInVoice ? 0 : basePoints, // RANKED V2: Pas de RP si en vocal
                    stars: baseStars,
                    source: 'message'
                });
                updateUserRank(client, author.id);

                // MAJ Mars 2026: Accorder des PT (Points de Tirage) pour le Puits de Combat
                grantTiragePoints(author.id, PT_PER_MESSAGE);


                // Ruban Noël - Message
                grantRubanAction('message');

                // Saint-Valentin - Message
                if (getValentinState('valentin')) {
                    grantValentinCurrency(author.id, { coeurs: config.valentin.rewards.message });
                }

                // Quête d'envoi de message
                checkQuestProgress(client, 'MESSAGE_SEND', author);

                // Incrémenter compteur de guerre pour messages normaux
                try {
                    const { incrementWarMessages } = require('../utils/guild/guild-wars');
                    incrementWarMessages(author.id);
                } catch (err) {
                    logger.debug('War message increment skipped:', err.message);
                }

                // Quête d'envoi d'image
                if (message.attachments.size > 0) {
                    // Ruban Noël - Image
                    grantRubanAction('image');
                    checkQuestProgress(client, 'MESSAGE_ATTACHMENT', author);
                }

                // Quête de contenu de message ("Salut")
                if (message.content.toLowerCase().includes('salut')) {
                    checkQuestProgress(client, 'MESSAGE_CONTENT', author, { content: message.content });
                }

                messageCooldown.add(author.id);
                setTimeout(() => {
                    messageCooldown.delete(author.id);
                }, 5000);
            }

            // --- Quête de réponse à un rang ou à un rôle ---
            if (message.reference && message.reference.messageId) {
                const repliedToMessage = await message.channel.messages.fetch(message.reference.messageId).catch(() => null);
                if (repliedToMessage && !repliedToMessage.author.bot) {
                    const repliedToMember = await message.guild.members.fetch(repliedToMessage.author.id).catch(() => null);
                    if (repliedToMember) {
                        // Quête: Répondre à un rang
                        const repliedToRank = repliedToMember.roles.cache.find(r => MAIN_RANKS.includes(r.name));
                        if (repliedToRank) {
                            checkQuestProgress(client, 'REPLY_TO_RANK', author, { repliedToRank: repliedToRank.name });
                        }

                        // Quête Halloween: Répondre à un rôle spécifique
                        const bonbonLegendaireRole = roleConfig.eventRoles.halloween.bonbonRewards.bonbonLegendaire.name;
                        const repliedToRole = repliedToMember.roles.cache.find(r => r.name === bonbonLegendaireRole);
                        if (repliedToRole) {
                            checkQuestProgress(client, 'REPLY_TO_ROLE_NAME', author, { repliedToRoleName: repliedToRole.name });
                        }
                    }
                }
            }

        } catch (error) {
            logger.error('Erreur lors du traitement du message pour les récompenses:', error);
            logger.error('Stack trace complète:', error.stack);
            logger.error('Message qui a causé l\'erreur:', {
                author: message.author.tag,
                content: message.content.substring(0, 100),
                channel: message.channel.id,
                isThread: message.channel.isThread()
            });
        }
    },
};

// Exporter la variable lastCountingNumber pour qu'elle soit accessible depuis index.js
module.exports.setLastCountingNumber = (number) => {
    lastCountingNumber = number;
};