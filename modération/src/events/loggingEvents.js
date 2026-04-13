const { Events, AuditLogEvent } = require('discord.js');
const Logger = require('../modules/logger');
const CONFIG = require('../config.js');
const { isProtectedLogChannel, resolveAllLogChannelId } = require('../utils/log-channel-resolve');

// Stockage pour la sécurité des logs
const logDeletionHistory = [];

module.exports = {
    name: 'loggingEvents',
    logger: null,
    antiRaidManager: null,

    init(client, antiRaidManager = null) {
        this.logger = new Logger(client);
        this.antiRaidManager = antiRaidManager;

        // Vocal
        client.on(Events.VoiceStateUpdate, (oldState, newState) => this.handleVoiceStateUpdate(oldState, newState));

        // Membres
        client.on(Events.GuildMemberUpdate, (oldMember, newMember) => this.handleGuildMemberUpdate(oldMember, newMember));
        client.on(Events.GuildMemberAdd, (member) => this.handleGuildMemberAdd(member));
        client.on(Events.GuildMemberRemove, (member) => this.handleGuildMemberRemove(member));

        // Messages
        client.on(Events.MessageDelete, (message) => this.handleMessageDelete(client, message));
        client.on(Events.MessageUpdate, (oldMessage, newMessage) => this.handleMessageUpdate(oldMessage, newMessage));
        client.on(Events.MessageCreate, (message) => this.handleMessageCreate(message));

        // Salons
        client.on(Events.ChannelCreate, (channel) => this.handleChannelCreate(channel));
        client.on(Events.ChannelDelete, (channel) => this.handleChannelDelete(channel));

        // Rôles
        client.on(Events.GuildRoleCreate, (role) => this.handleGuildRoleCreate(role));
        client.on(Events.GuildRoleDelete, (role) => this.handleGuildRoleDelete(role));

        // Bans
        client.on(Events.GuildBanAdd, (ban) => this.handleGuildBanAdd(ban));
        client.on(Events.GuildBanRemove, (ban) => this.handleGuildBanRemove(ban));

        if (antiRaidManager && process.env.BLZ_COMPACT_LOG !== '1') {
            console.log('✓ AntiRaidManager connecté à loggingEvents');
        }
    },

    // ==================== HELPERS ====================
    async findAuditLogEntry(guild, type, targetId, timeWindow = 15000) {
        try {
            // Attendre un peu pour que l'audit log soit propagé
            await new Promise(resolve => setTimeout(resolve, 1000));

            const fetchedLogs = await guild.fetchAuditLogs({
                limit: 5,
                type: type,
            });

            const now = Date.now();
            for (const entry of fetchedLogs.entries.values()) {
                // Vérifier la cible et le timing
                const isTarget = entry.target && entry.target.id === targetId;
                const isRecent = (now - entry.createdTimestamp) < timeWindow;

                if (isTarget && isRecent) {
                    return entry.executor;
                }
            }
        } catch (e) {
            console.error(`Erreur fetchAuditLogs (${type}):`, e);
        }
        return null;
    },

    // ==================== VOCAL ====================
    async handleVoiceStateUpdate(oldState, newState) {
        const member = newState.member || oldState.member;
        if (!member) return;

        // Rejoindre
        if (!oldState.channelId && newState.channelId) {
            await this.logger.log(
                member.guild,
                '🔊 Vocal : Connexion',
                `<@${member.id}> a rejoint le salon **${newState.channel.name}**`,
                '#00FF00',
                [],
                member.user
            );
        }
        // Quitter
        else if (oldState.channelId && !newState.channelId) {
            await this.logger.log(
                member.guild,
                '🔇 Vocal : Déconnexion',
                `<@${member.id}> a quitté le salon **${oldState.channel.name}**`,
                '#FF0000',
                [],
                member.user
            );
        }
        // Changer de salon
        else if (oldState.channelId && newState.channelId && oldState.channelId !== newState.channelId) {
            await this.logger.log(
                member.guild,
                '🔄 Vocal : Déplacement',
                `<@${member.id}> a changé de salon :\n**Avant :** ${oldState.channel.name}\n**Après :** ${newState.channel.name}`,
                '#FFFF00',
                [],
                member.user
            );
        }
    },

    // ==================== MEMBRES ====================
    async handleGuildMemberUpdate(oldMember, newMember) {
        // Changement de pseudo
        if (oldMember.nickname !== newMember.nickname) {
            await this.logger.log(
                newMember.guild,
                '📝 Membre : Changement de pseudo',
                `<@${newMember.id}> a changé de pseudo.`,
                '#3498db',
                [
                    { name: 'Avant', value: oldMember.nickname || oldMember.user.username, inline: true },
                    { name: 'Après', value: newMember.nickname || newMember.user.username, inline: true }
                ],
                newMember.user
            );
        }

        // Rôles
        const addedRoles = newMember.roles.cache.filter(role => !oldMember.roles.cache.has(role.id));
        const removedRoles = oldMember.roles.cache.filter(role => !newMember.roles.cache.has(role.id));

        if (addedRoles.size > 0) {
            await this.logger.log(
                newMember.guild,
                '➕ Membre : Rôle ajouté',
                `<@${newMember.id}> a reçu des rôles.`,
                '#2ecc71',
                [{ name: 'Rôles ajoutés', value: addedRoles.map(r => r.name).join(', ') }],
                newMember.user
            );
        }

        if (removedRoles.size > 0) {
            await this.logger.log(
                newMember.guild,
                '➖ Membre : Rôle retiré',
                `<@${newMember.id}> a perdu des rôles.`,
                '#e74c3c',
                [{ name: 'Rôles retirés', value: removedRoles.map(r => r.name).join(', ') }],
                newMember.user
            );
        }
    },

    async handleGuildMemberAdd(member) {
        // Anti-raid : Analyser le nouveau membre AVANT le logging
        if (this.antiRaidManager) {
            try {
                await this.antiRaidManager.trackJoin(member);
            } catch (error) {
                console.error('[ANTI-RAID] Erreur lors du tracking du membre:', error);
            }
        }

        await this.logger.log(
            member.guild,
            '📥 Membre : Arrivée',
            `<@${member.id}> a rejoint le serveur.`,
            '#00FF00',
            [
                { name: 'Compte créé le', value: `<t:${Math.floor(member.user.createdTimestamp / 1000)}:R>`, inline: true },
                { name: 'Membres', value: `${member.guild.memberCount}`, inline: true }
            ],
            member.user
        );
    },

    async handleGuildMemberRemove(member) {
        await this.logger.log(
            member.guild,
            '📤 Membre : Départ',
            `<@${member.id}> a quitté le serveur.`,
            '#FF0000',
            [{ name: 'Membres', value: `${member.guild.memberCount}`, inline: true }],
            member.user
        );
    },

    // ==================== MESSAGES ====================
    
    /**
     * Handler pour les nouveaux messages - Détection anti-raid spam
     */
    async handleMessageCreate(message) {
        // Ignorer les bots et messages sans guild
        if (message.author.bot || !message.guild) return;

        // Anti-raid : Analyser le message pour détecter le spam
        if (this.antiRaidManager) {
            try {
                await this.antiRaidManager.trackMessage(message);
            } catch (error) {
                console.error('[ANTI-RAID] Erreur lors du tracking du message:', error);
            }
        }
    },

    async handleMessageDelete(client, message) {
        if (message.partial) return;

        // 1. SÉCURITÉ : Suppression dans le salon de logs
        if (message.channel.id === CONFIG.ALL_LOG_CHANNEL_ID) {
            await this.handleLogChannelSecurity(client, message);
            return;
        }

        // Ignorer les autres messages de bots
        if (message.author.bot) return;

        // 2. LOG NORMAL : Suppression message
        const executor = await this.findAuditLogEntry(message.guild, AuditLogEvent.MessageDelete, message.author.id);

        const description = executor
            ? `Message de <@${message.author.id}> supprimé par <@${executor.id}> dans ${message.channel}.`
            : `Message de <@${message.author.id}> supprimé dans ${message.channel}.`;

        await this.logger.log(
            message.guild,
            '🗑️ Message : Supprimé',
            description,
            '#e74c3c',
            [{ name: 'Contenu', value: message.content.substring(0, 1024) || '[Pas de contenu textuel]' }],
            message.author
        );
    },

    async handleLogChannelSecurity(client, message) {
        const now = Date.now();

        // Chercher qui a supprimé
        // Note: Pour les suppressions de messages du bot par d'autres, l'audit log cible le bot (message.author.id)
        let executor = await this.findAuditLogEntry(message.guild, AuditLogEvent.MessageDelete, message.author.id);

        const isOwnMessage = message.author.id === client.user.id;
        const executorName = executor ? executor.tag : (isOwnMessage ? "Inconnu (suppression externe suspecte)" : "Inconnu");
        const executorId = executor ? executor.id : "Inconnu";

        console.log(`[SECURITY] Log supprimé par: ${executorName} (${executorId})`);

        // Ajouter à l'historique
        logDeletionHistory.push({
            timestamp: now,
            executor: executorName,
            executorId: executorId,
            messageAuthor: message.author.tag,
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
                    description: `Des messages ont été supprimés dans le salon de logs <#${CONFIG.ALL_LOG_CHANNEL_ID}> !`,
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
            await this.logger.log(
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
    },

    async handleMessageUpdate(oldMessage, newMessage) {
        if (oldMessage.partial || newMessage.partial) return;
        if (oldMessage.author.bot) return;
        if (oldMessage.content === newMessage.content) return;

        await this.logger.log(
            newMessage.guild,
            '✏️ Message : Modifié',
            `Message de <@${newMessage.author.id}> modifié dans ${newMessage.channel}.`,
            '#f1c40f',
            [
                { name: 'Avant', value: oldMessage.content.substring(0, 1024) || '[Vide]' },
                { name: 'Après', value: newMessage.content.substring(0, 1024) || '[Vide]' }
            ],
            newMessage.author
        );
    },

    // ==================== SALONS ====================
    async handleChannelCreate(channel) {
        if (!channel.guild) return;

        const executor = await this.findAuditLogEntry(channel.guild, AuditLogEvent.ChannelCreate, channel.id);

        const description = executor
            ? `Le salon **${channel.name}** a été créé par <@${executor.id}>.`
            : `Le salon **${channel.name}** a été créé.`;

        await this.logger.log(
            channel.guild,
            '🏠 Salon : Créé',
            description,
            '#2ecc71',
            [{ name: 'Type', value: `${channel.type}` }]
        );
    },

    async handleChannelDelete(channel) {
        if (!channel.guild) return;

        const executor = await this.findAuditLogEntry(channel.guild, AuditLogEvent.ChannelDelete, channel.id);

        const description = executor
            ? `Le salon **${channel.name}** a été supprimé par <@${executor.id}>.`
            : `Le salon **${channel.name}** a été supprimé.`;

        await this.logger.log(
            channel.guild,
            '🏠 Salon : Supprimé',
            description,
            '#e74c3c'
        );
    },

    // ==================== RÔLES ====================
    async handleGuildRoleCreate(role) {
        await this.logger.log(
            role.guild,
            '🛡️ Rôle : Créé',
            `Le rôle **${role.name}** a été créé.`,
            '#2ecc71'
        );
    },

    async handleGuildRoleDelete(role) {
        await this.logger.log(
            role.guild,
            '🛡️ Rôle : Supprimé',
            `Le rôle **${role.name}** a été supprimé.`,
            '#e74c3c'
        );
    },

    // ==================== BANS ====================
    async handleGuildBanAdd(ban) {
        await this.logger.log(
            ban.guild,
            '🔨 Ban : Ajouté',
            `<@${ban.user.id}> a été banni.`,
            '#FF0000',
            [],
            ban.user
        );
    },

    async handleGuildBanRemove(ban) {
        await this.logger.log(
            ban.guild,
            '🔓 Ban : Révoqué',
            `<@${ban.user.id}> a été débanni.`,
            '#00FF00',
            [],
            ban.user
        );
    }
};
