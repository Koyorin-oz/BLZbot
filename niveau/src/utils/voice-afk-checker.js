/**
 * Voice AFK Checker System
 * Système anti-AFK pour le vocal avec captcha TTS
 * RANKED V2 - Part 1
 */

const { ChannelType } = require('discord.js');
const { joinVoiceChannel, createAudioPlayer, createAudioResource, VoiceConnectionStatus, AudioPlayerStatus } = require('@discordjs/voice');
const gtts = require('gtts');
const fs = require('fs');
const path = require('path');
const logger = require('./logger');
const { penalizeUser } = require('./ranked-state');
const { runWithEconomyGuild } = require('./economy-scope');
const voiceAfkRuntime = require('./voice-afk-runtime');

function envDisablesVoiceAfk(v) {
    return ['1', 'true', 'yes', 'on'].includes(String(v ?? '').trim().toLowerCase());
}

/** Désactivé au boot si `VOICE_AFK_DISABLED=1` (ou true/yes/on), ou via `/anti-afk`. */
let globallyDisabled = envDisablesVoiceAfk(process.env.VOICE_AFK_DISABLED);

// Constantes UI captcha (non exposées dans /anti-afk)
const STATIC_CONFIG = {
    TOTAL_CAPTCHA_TIME: 90 * 1000,
    REMINDER_INTERVAL: 30 * 1000,
    CODE_LENGTH: 5,
    TTS_DIR: path.join(__dirname, '../../tts-temp')
};

let clientInstance = null;
let isEventRunning = false;
let intervalId = null;

/**
 * Génère un code aléatoire
 * @param {number} length Longueur du code
 * @returns {string} Le code généré
 */
function generateRandomCode(length) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = '';
    for (let i = 0; i < length; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}

/**
 * Sauvegarde un fichier TTS
 * @param {string} text Texte à convertir
 * @param {string} filePath Chemin du fichier
 * @returns {Promise<void>}
 */
function saveTts(text, filePath) {
    return new Promise((resolve, reject) => {
        const speech = new gtts(text, 'fr');
        speech.save(filePath, (err) => {
            if (err) return reject(err);
            resolve();
        });
    });
}

/**
 * Génère un intervalle aléatoire entre MIN et MAX
 * @returns {number} Intervalle en ms
 */
function getRandomInterval() {
    const minMs = Math.min(voiceAfkRuntime.getMinIntervalMs(), voiceAfkRuntime.getMaxIntervalMs());
    const maxMs = Math.max(voiceAfkRuntime.getMinIntervalMs(), voiceAfkRuntime.getMaxIntervalMs());
    return Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
}

/**
 * Déclenche un événement AFK sur un utilisateur spécifique
 * @param {VoiceChannel} channel Le salon vocal
 * @param {GuildMember} targetMember Le membre ciblé
 * @returns {Promise<boolean>} Succès de l'opération
 */
async function triggerAfkEvent(channel, targetMember) {
    if (globallyDisabled) {
        logger.debug('[VOICE-AFK] Événement ignoré (anti-AFK désactivé).');
        return false;
    }
    if (isEventRunning) {
        logger.warn('[VOICE-AFK] Tentative de déclenchement alors qu\'un autre événement est en cours.');
        return false;
    }

    isEventRunning = true;
    logger.info(`[VOICE-AFK] Déclenchement du captcha dans "${channel.name}" pour ${targetMember.user.username}`);

    const code = generateRandomCode(CONFIG.CODE_LENGTH);
    const codeSpaced = code.split('').join(' '); // Pour le TTS

    // Assurer que le dossier TTS existe
    if (!fs.existsSync(CONFIG.TTS_DIR)) {
        fs.mkdirSync(CONFIG.TTS_DIR, { recursive: true });
    }
    const ttsFilePath = path.join(CONFIG.TTS_DIR, `afk-captcha-${Date.now()}.mp3`);

    let connection = null;
    let hasResponded = false;
    let reminderIntervalId = null;

    try {
        // Rejoindre le salon vocal
        connection = joinVoiceChannel({
            channelId: channel.id,
            guildId: channel.guild.id,
            adapterCreator: channel.guild.voiceAdapterCreator,
            selfDeaf: false,
            selfMute: false,
        });

        // Attendre la connexion
        await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error('Connection timeout')), 10000);
            connection.on(VoiceConnectionStatus.Ready, () => {
                clearTimeout(timeout);
                resolve();
            });
            connection.on(VoiceConnectionStatus.Disconnected, () => {
                clearTimeout(timeout);
                reject(new Error('Disconnected'));
            });
        });

        // Trouver un salon texte pour envoyer les messages
        // Préférer le salon textuel associé au vocal, sinon utiliser le premier salon accessible
        let textChannel = channel;
        if (!textChannel.isTextBased || !textChannel.isTextBased()) {
            textChannel = channel.guild.channels.cache.find(
                c => c.isTextBased() && c.permissionsFor(channel.guild.members.me)?.has(['SendMessages', 'ViewChannel'])
            );
        }

        // Message initial
        const initialMessage = `🎤 **Vérification AFK** - ${targetMember.user}, veuillez entrer le code \`${code}\` dans ce salon.\n⚠️ Vous avez 90 secondes. Si vous ne répondez pas, vous serez kick du vocal et vos gains RP seront réduits de 50% pendant 15 minutes.`;

        if (textChannel) {
            await textChannel.send(initialMessage);
        }

        let timeLeft = CONFIG.TOTAL_CAPTCHA_TIME;

        // Fonction pour envoyer un rappel
        const sendReminder = async () => {
            if (hasResponded) return;

            const seconds = Math.floor(timeLeft / 1000);
            const reminderTtsMessage = `${targetMember.displayName}, veuillez entrer les lettres ${codeSpaced}. Il vous reste ${seconds} secondes.`;
            const reminderTextMessage = `⏰ ${targetMember.user}, il vous reste **${seconds} secondes** pour entrer le code \`${code}\`.`;

            try {
                // TTS (optionnel — nécessite FFmpeg sur le système)
                let ttsPlayed = false;
                try {
                    await saveTts(reminderTtsMessage, ttsFilePath);
                    const player = createAudioPlayer();
                    const resource = createAudioResource(ttsFilePath, { inlineVolume: true });
                    resource.volume?.setVolume(1.0);
                    connection.subscribe(player);
                    player.play(resource);

                    // Attendre la fin du TTS
                    await new Promise(resolve => {
                        player.on(AudioPlayerStatus.Idle, resolve);
                        setTimeout(resolve, 10000); // Timeout de sécurité
                    });
                    ttsPlayed = true;
                } catch (ttsErr) {
                    if (ttsErr.message?.includes('FFmpeg')) {
                        logger.warn('[VOICE-AFK] FFmpeg non disponible, rappel TTS ignoré.');
                    } else {
                        logger.error('[VOICE-AFK] Erreur TTS:', ttsErr);
                    }
                }

                // Message texte de rappel
                if (textChannel) {
                    await textChannel.send(reminderTextMessage);
                }
            } catch (err) {
                logger.error('[VOICE-AFK] Erreur lors du rappel TTS:', err);
            }

            timeLeft -= CONFIG.REMINDER_INTERVAL;
            if (timeLeft <= 0 && reminderIntervalId) {
                clearInterval(reminderIntervalId);
            }
        };

        // Envoyer le premier rappel immédiatement
        await sendReminder();
        reminderIntervalId = setInterval(sendReminder, CONFIG.REMINDER_INTERVAL);

        // Collecter la réponse
        const result = await new Promise(resolve => {
            if (!textChannel) {
                resolve(false);
                return;
            }

            const collector = textChannel.createMessageCollector({
                filter: m => m.author.id === targetMember.id,
                time: CONFIG.TOTAL_CAPTCHA_TIME,
            });

            collector.on('collect', async msg => {
                const normalizedInput = msg.content.replace(/\s+/g, '').toUpperCase();
                const normalizedCode = code.replace(/\s+/g, '').toUpperCase();

                if (normalizedInput === normalizedCode) {
                    hasResponded = true;
                    collector.stop('success');
                    if (reminderIntervalId) clearInterval(reminderIntervalId);

                    await textChannel.send(`✅ Merci ${targetMember.user}, vérification réussie !`);
                    resolve(true);
                }
            });

            collector.on('end', async (collected, reason) => {
                if (!hasResponded) {
                    logger.warn(`[VOICE-AFK] ${targetMember.user.username} n'a pas répondu au captcha.`);

                    // Appliquer la pénalité
                    try {
                        runWithEconomyGuild(targetMember.guild.id, () =>
                            penalizeUser(targetMember.id, DEFAULT_PENALTY_DURATION, 'Échec du captcha AFK vocal')
                        );

                        if (textChannel) {
                            await textChannel.send(`❌ ${targetMember.user}, vous n'avez pas répondu à temps. Pénalité appliquée : **gains RP réduits de 50% pendant 15 minutes**.`);
                        }

                        // Kick du vocal
                        if (targetMember.voice.channel) {
                            await targetMember.voice.disconnect('Échec du captcha anti-AFK');
                        }
                    } catch (err) {
                        logger.error('[VOICE-AFK] Erreur lors de l\'application de la pénalité:', err);
                    }
                    resolve(false);
                }
            });
        });

        if (result) {
            logger.info(`[VOICE-AFK] ${targetMember.user.username} a réussi la vérification.`);
        }

        return result;

    } catch (error) {
        logger.error('[VOICE-AFK] Erreur lors de l\'événement AFK:', error);
        return false;
    } finally {
        // Nettoyage
        if (reminderIntervalId) {
            clearInterval(reminderIntervalId);
        }
        if (connection && connection.state.status !== VoiceConnectionStatus.Destroyed) {
            connection.destroy();
        }
        if (fs.existsSync(ttsFilePath)) {
            try {
                fs.unlinkSync(ttsFilePath);
            } catch (e) {
                logger.warn('[VOICE-AFK] Impossible de supprimer le fichier TTS:', e.message);
            }
        }
        isEventRunning = false;
    }
}

/**
 * Exécute l'événement aléatoire
 */
async function runRandomEvent() {
    if (globallyDisabled) return;
    if (isEventRunning) return;
    if (Math.random() > CONFIG.EVENT_CHANCE) {
        logger.debug('[VOICE-AFK] Événement ignoré (probabilité)');
        return;
    }

    if (!clientInstance) {
        logger.warn('[VOICE-AFK] Client non initialisé');
        return;
    }

    // Trouver tous les salons vocaux éligibles avec des utilisateurs
    const eligibleChannels = [];
    for (const guild of clientInstance.guilds.cache.values()) {
        const channels = guild.channels.cache.filter(
            c => c.type === ChannelType.GuildVoice &&
                c.members.size > 0 &&
                c.joinable &&
                c.members.some(m => !m.user.bot)
        );
        eligibleChannels.push(...channels.values());
    }

    if (eligibleChannels.length === 0) {
        logger.debug('[VOICE-AFK] Aucun salon vocal éligible trouvé');
        return;
    }

    // Choisir un salon aléatoire
    const channel = eligibleChannels[Math.floor(Math.random() * eligibleChannels.length)];

    // Choisir un membre éligible (non-bot, non-mute serveur, non-deaf serveur)
    const eligibleMembers = channel.members.filter(m =>
        !m.user.bot &&
        !m.voice.serverMute &&
        !m.voice.serverDeaf
    );

    if (eligibleMembers.size === 0) {
        logger.debug('[VOICE-AFK] Aucun membre éligible dans le salon');
        return;
    }

    const targetMember = eligibleMembers.random();
    if (!targetMember) return;

    await triggerAfkEvent(channel, targetMember);
}

/**
 * Démarre le système anti-AFK
 * @param {Client} client Le client Discord
 */
function start(client) {
    clientInstance = client;
    if (globallyDisabled) {
        logger.info(
            '[VOICE-AFK] Système inactif (VOICE_AFK_DISABLED dans .env ou désactivé avec /anti-afk). Aucune planification.'
        );
        return;
    }
    if (intervalId !== null) {
        return;
    }
    logger.info('[VOICE-AFK] Démarrage du système anti-AFK vocal (RANKED V2)');
    logger.info(`[VOICE-AFK] Intervalle: ${CONFIG.MIN_INTERVAL / 60000}-${CONFIG.MAX_INTERVAL / 60000} min, Chance: ${CONFIG.EVENT_CHANCE * 100}%`);

    const scheduleNextEvent = () => {
        if (globallyDisabled) return;

        const interval = getRandomInterval();
        logger.debug(`[VOICE-AFK] Prochain check dans ${Math.round(interval / 60000)} minutes`);

        intervalId = setTimeout(async () => {
            intervalId = null;
            await runRandomEvent();
            if (!globallyDisabled && clientInstance) {
                scheduleNextEvent();
            }
        }, interval);
    };

    scheduleNextEvent();
}

/**
 * Arrête le système anti-AFK
 */
function stop() {
    if (intervalId) {
        clearTimeout(intervalId);
        intervalId = null;
    }
    logger.info('[VOICE-AFK] Planification anti-AFK arrêtée (timer annulé).');
}

/**
 * Coupe ou réactive tout le système (captchas aléatoires + déclenchements manuels).
 * @param {boolean} disabled
 */
function setGloballyDisabled(disabled) {
    globallyDisabled = Boolean(disabled);
    if (globallyDisabled) {
        stop();
        logger.warn('[VOICE-AFK] Anti-AFK vocal **désactivé** jusqu’à réactivation (/anti-afk ou redémarrage sans VOICE_AFK_DISABLED).');
    } else if (clientInstance) {
        start(clientInstance);
    }
}

function isVoiceAfkGloballyDisabled() {
    return globallyDisabled;
}

/**
 * Déclenche manuellement un captcha sur un utilisateur (pour debug)
 * @param {Client} client Le client Discord
 * @param {string} userId L'ID de l'utilisateur
 * @returns {Promise<{success: boolean, message: string}>}
 */
async function triggerManualAfk(client, userId) {
    if (globallyDisabled) {
        return { success: false, message: "L'anti-AFK vocal est désactivé." };
    }
    // Trouver l'utilisateur dans un vocal
    for (const guild of client.guilds.cache.values()) {
        const member = await guild.members.fetch(userId).catch(() => null);
        if (member && member.voice.channel) {
            const result = await triggerAfkEvent(member.voice.channel, member);
            return {
                success: true,
                message: result ? 'Captcha réussi par l\'utilisateur' : 'Captcha échoué, pénalité appliquée'
            };
        }
    }

    return {
        success: false,
        message: 'L\'utilisateur n\'est pas dans un salon vocal'
    };
}

module.exports = {
    start,
    stop,
    setGloballyDisabled,
    isVoiceAfkGloballyDisabled,
    triggerAfkEvent,
    triggerManualAfk,
    CONFIG
};
