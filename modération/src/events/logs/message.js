const { Events, AuditLogEvent } = require('discord.js');
const CONFIG = require('../../config.js');
const { findAuditLogEntry } = require('./utils');
const { isProtectedLogChannel, resolveAllLogChannelId } = require('../../utils/log-channel-resolve');

// Stockage pour la sécurité des logs
const logDeletionHistory = [];

module.exports = (client, logger) => {

    // 1. Suppression de message
    client.on(Events.MessageDelete, async (message) => {
        try {
            console.log(`[DEBUG] MessageDelete event triggered for message ${message.id}`);

            if (!message.guild) return;

            // 1. SÉCURITÉ : Suppression dans le salon de logs (prod ou test)
            if (isProtectedLogChannel(message.channel.id, message.guild.id)) {
                await handleLogChannelSecurity(client, logger, message);
                return;
            }

            // Ignorer les autres messages de bots
            if (message.author && message.author.bot) return;

            // Gestion des messages partiels (non cachés)
            if (message.partial) {
                console.log(`[DEBUG] Message is partial. Logging with limited info.`);
                if (message.guild) {
                    await logger.log(
                        message.guild,
                        '🗑️ Message : Supprimé (Ancien)',
                        `Un ancien message (non caché) a été supprimé dans ${message.channel}.`,
                        '#95a5a6',
                        [{ name: 'Info', value: 'Le contenu est inconnu car le message date d\'avant le démarrage du bot.' }]
                    );
                }
                return;
            }

            console.log(`[DEBUG] Processing message deletion for ${message.author.tag}`);

            // 2. LOG NORMAL : Suppression message
            const executor = await findAuditLogEntry(message.guild, AuditLogEvent.MessageDelete, message.author.id);

            const description = executor
                ? `Message de <@${message.author.id}> supprimé par <@${executor.id}> dans ${message.channel}.`
                : `Message de <@${message.author.id}> supprimé dans ${message.channel}.\n*(Probablement supprimé par l'auteur lui-même)*`;

            await logger.log(
                message.guild,
                '🗑️ Message : Supprimé',
                description,
                '#e74c3c',
                [{ name: 'Contenu', value: message.content.substring(0, 1024) || '[Pas de contenu textuel]' }],
                message.author
            );
        } catch (err) {
            console.error('[ERROR] Error in MessageDelete log:', err);
        }
    });

    // 2. Modification de message
    client.on(Events.MessageUpdate, async (oldMessage, newMessage) => {
        try {
            // Si le nouveau message est partiel, on essaie de le fetch
            if (newMessage.partial) {
                try {
                    newMessage = await newMessage.fetch();
                } catch (e) {
                    console.log('[DEBUG] Failed to fetch new message in update');
                    return;
                }
            }

            if (newMessage.author.bot) return;

            // Si l'ancien message est partiel, on ne connaît pas l'ancien contenu
            const oldContent = oldMessage.partial ? '[Contenu inconnu (message ancien)]' : (oldMessage.content || '[Vide]');
            const newContent = newMessage.content || '[Vide]';

            // Éviter les logs inutiles (ex: embed update) si le contenu textuel n'a pas changé
            if (!oldMessage.partial && oldContent === newContent) return;

            console.log(`[DEBUG] Message updated by ${newMessage.author.tag}`);

            await logger.log(
                newMessage.guild,
                '✏️ Message : Modifié',
                `Message de <@${newMessage.author.id}> modifié dans ${newMessage.channel}.`,
                '#f1c40f',
                [
                    { name: 'Avant', value: oldContent.substring(0, 1024) },
                    { name: 'Après', value: newContent.substring(0, 1024) }
                ],
                newMessage.author
            );
        } catch (err) {
            console.error('[ERROR] Error in MessageUpdate log:', err);
        }
    });
};

async function handleLogChannelSecurity(client, logger, message) {
    const now = Date.now();

    if (!client.user) {
        console.error('[ERROR] client.user is null in handleLogChannelSecurity');
        return;
    }



    // Gestion des messages partiels (auteur inconnu)
    const authorId = message.author ? message.author.id : null;
    const authorTag = message.author ? message.author.tag : 'Inconnu (Message Partiel)';

    // Chercher qui a supprimé
    let executor = await findAuditLogEntry(message.guild, AuditLogEvent.MessageDelete, authorId);

    const isOwnMessage = client.user && authorId === client.user.id;
    const executorName = executor ? executor.tag : (isOwnMessage ? "Inconnu (suppression externe suspecte)" : "Inconnu");
    const executorId = executor ? executor.id : "Inconnu";

    console.log(`[SECURITY] Log supprimé par: ${executorName} (${executorId})`);

    // Ajouter à l'historique
    logDeletionHistory.push({
        timestamp: now,
        executor: executorName,
        executorId: executorId,
        messageAuthor: authorTag,
        wasLogMessage: isOwnMessage
    });

    // Nettoyer l'historique (> 2 min)
    const twoMinutesAgo = now - 120000;
    while (logDeletionHistory.length > 0 && logDeletionHistory[0].timestamp < twoMinutesAgo) {
        logDeletionHistory.shift();
    }

    // Alerte si >= 2 suppressions OU si c'est un message de log supprimé par quelqu'un d'autre que le bot
    const shouldAlert = logDeletionHistory.length >= 2 ||
        (isOwnMessage && executor && executor.id !== client.user.id);

    if (shouldAlert) {
        console.log(`[SECURITY] ALERTE! ${logDeletionHistory.length} suppressions détectées`);
        const specialUser = await client.users.fetch(CONFIG.SPECIAL_USER_ID).catch(() => null);
        if (specialUser) {
            const details = logDeletionHistory.map(entry =>
                `- Par **${entry.executor}** (${entry.executorId}) à <t:${Math.floor(entry.timestamp / 1000)}:T>${entry.wasLogMessage ? ' 🔴 (log du bot)' : ''}`
            ).join('\n');

            const alertEmbed = {
                title: '🚨 ALERTE SÉCURITÉ - SUPPRESSION DE LOGS 🚨',
                description: `Des messages ont été supprimés dans le salon de logs <#${resolveAllLogChannelId(message.guild.id)}> !`,
                color: 0xFF0000,
                fields: [
                    { name: 'Détails des suppressions récentes', value: details || 'Aucun détail disponible' }
                ],
                timestamp: new Date().toISOString()
            };

            await specialUser.send({ embeds: [alertEmbed] }).catch(console.error);
            // Reset pour éviter spam
            logDeletionHistory.length = 0;
        }
    }

    // Relogger la suppression du log (seulement si c'était un message de log)
    if (isOwnMessage) {
        await logger.log(
            message.guild,
            '🚨 SÉCURITÉ : Log Supprimé',
            `Un message de log a été supprimé !`,
            '#FF0000',
            [
                { name: 'Supprimé par', value: executorName },
                { name: 'ID de l\'exécuteur', value: executorId },
                { name: 'Contenu (partiel)', value: (message.embeds[0]?.title || message.content || '[Embed sans titre]').substring(0, 200) }
            ]
        );
    }
}
