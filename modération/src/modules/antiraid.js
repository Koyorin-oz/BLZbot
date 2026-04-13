const path = require('path');
const { PermissionFlagsBits, EmbedBuilder, ContainerBuilder, SectionBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize } = require('discord.js');
const CONFIG = require('../config.js');
const { isBlzTestGuild } = require(path.join(__dirname, '..', '..', '..', 'blzbot-env.js'));
const { resolveAllLogChannelId } = require('../utils/log-channel-resolve');

/**
 * Gestionnaire Anti-Raid Intelligent
 * Système de détection basé sur un score cumulatif avec décroissance automatique
 */
class AntiRaidManager {
    constructor(client, dbManager) {
        this.client = client;
        this.dbManager = dbManager;

        // Score par serveur : { guildId: { score, lastUpdate, raidActive, currentIncidentId } }
        this.guildScores = new Map();

        // Historique des joins récents : { guildId: [{ userId, timestamp, accountAge, username }] }
        this.joinHistory = new Map();

        // Historique des messages pour détection spam : { odString : [{ content, timestamp, channelId }] }
        this.messageHistory = new Map();

        // Raiders détectés dans l'incident actuel : { guildId: Set<userId> }
        this.currentRaiders = new Map();

        // Démarrer le système de décroissance automatique
        this.startDecayInterval();

        if (process.env.BLZ_COMPACT_LOG !== '1') console.log('✓ AntiRaidManager initialisé');
    }

    /**
     * Démarre l'intervalle de décroissance du score
     */
    startDecayInterval() {
        const interval = CONFIG.RAID_DETECTION?.DECAY_INTERVAL || 60000;
        
        setInterval(() => {
            this.applyScoreDecay();
        }, interval);
    }

    /**
     * Applique la décroissance du score pour tous les serveurs
     */
    applyScoreDecay() {
        const now = Date.now();
        const decayRate = CONFIG.RAID_DETECTION?.DECAY_RATE || 1;

        for (const [guildId, data] of this.guildScores.entries()) {
            if (data.score > 0) {
                const minutesElapsed = (now - data.lastUpdate) / 60000;
                const decay = Math.floor(minutesElapsed * decayRate);
                
                data.score = Math.max(0, data.score - decay);
                data.lastUpdate = now;

                // Si le score descend sous le seuil d'action et le raid était actif
                if (data.score < CONFIG.RAID_DETECTION.ACTION_THRESHOLD && data.raidActive) {
                    this.deactivateRaidMode(guildId);
                }

                // Nettoyer si score à 0
                if (data.score === 0) {
                    this.guildScores.delete(guildId);
                }
            }
        }

        // Nettoyer les historiques anciens
        this.cleanupHistories();
    }

    /**
     * Nettoie les historiques de joins et messages trop anciens
     */
    cleanupHistories() {
        const now = Date.now();
        const joinWindow = CONFIG.RAID_DETECTION?.JOIN_WINDOW || 10000;
        const messageWindow = CONFIG.RAID_DETECTION?.SPAM_CHANNEL_WINDOW || 10000;

        // Nettoyer l'historique des joins
        for (const [guildId, joins] of this.joinHistory.entries()) {
            const filtered = joins.filter(j => (now - j.timestamp) < joinWindow * 6); // Garder 6x la fenêtre
            if (filtered.length === 0) {
                this.joinHistory.delete(guildId);
            } else {
                this.joinHistory.set(guildId, filtered);
            }
        }

        // Nettoyer l'historique des messages
        for (const [odString, messages] of this.messageHistory.entries()) {
            const filtered = messages.filter(m => (now - m.timestamp) < messageWindow * 6);
            if (filtered.length === 0) {
                this.messageHistory.delete(odString
                );
            } else {
                this.messageHistory.set(odString
                , filtered);
            }
        }
    }

    /**
     * Obtient ou crée les données de score pour un serveur
     */
    getGuildData(guildId) {
        if (!this.guildScores.has(guildId)) {
            this.guildScores.set(guildId, {
                score: 0,
                lastUpdate: Date.now(),
                raidActive: false,
                lockdownActive: false,
                currentIncidentId: null
            });
        }
        return this.guildScores.get(guildId);
    }

    /**
     * Ajoute des points au score et applique la décroissance depuis la dernière mise à jour
     */
    addScore(guildId, points, criteria) {
        const data = this.getGuildData(guildId);
        const now = Date.now();

        // Appliquer la décroissance depuis la dernière mise à jour
        const decayRate = CONFIG.RAID_DETECTION?.DECAY_RATE || 1;
        const minutesElapsed = (now - data.lastUpdate) / 60000;
        const decay = Math.floor(minutesElapsed * decayRate);
        data.score = Math.max(0, data.score - decay);

        // Ajouter les nouveaux points
        data.score += points;
        data.lastUpdate = now;

        console.log(`[ANTI-RAID] Guild ${guildId}: +${points} points (${criteria}) | Score total: ${data.score}`);

        // Vérifier les seuils
        this.checkThresholds(guildId, data, criteria);

        return data.score;
    }

    /**
     * Vérifie les seuils et déclenche les actions appropriées
     */
    async checkThresholds(guildId, data, criteria) {
        const actionThreshold = CONFIG.RAID_DETECTION?.ACTION_THRESHOLD || 50;
        const criticalThreshold = CONFIG.RAID_DETECTION?.CRITICAL_THRESHOLD || 100;

        // Seuil critique (100) : Lockdown + DM admins
        if (data.score >= criticalThreshold && !data.lockdownActive) {
            await this.activateLockdown(guildId, criteria);
        }
        // Seuil d'action (50) : Mode raid + RAID_ROLE
        else if (data.score >= actionThreshold && !data.raidActive) {
            await this.activateRaidMode(guildId, criteria);
        }
    }

    /**
     * Active le mode raid (seuil 50)
     */
    async activateRaidMode(guildId, criteria) {
        const data = this.getGuildData(guildId);
        data.raidActive = true;

        console.log(`[ANTI-RAID] 🚨 MODE RAID ACTIVÉ pour ${guildId} | Score: ${data.score} | Critère: ${criteria}`);

        const guild = this.client.guilds.cache.get(guildId);
        if (!guild) return;

        // Créer un incident dans la base de données
        const incidentId = await this.createIncident(guildId, data.score, criteria, false);
        data.currentIncidentId = incidentId;

        // Logger l'activation
        await this.logRaidAlert(guild, 'MODE RAID ACTIVÉ', data.score, criteria, '#FFA500');

        // Appliquer le rôle RAID aux raiders détectés
        await this.applyRaidRoleToCurrentRaiders(guild);
    }

    /**
     * Active le lockdown (seuil 100)
     */
    async activateLockdown(guildId, criteria) {
        const data = this.getGuildData(guildId);
        data.lockdownActive = true;
        data.raidActive = true;

        console.log(`[ANTI-RAID] 🔒 LOCKDOWN ACTIVÉ pour ${guildId} | Score: ${data.score} | Critère: ${criteria}`);

        const guild = this.client.guilds.cache.get(guildId);
        if (!guild) return;

        // Mettre à jour ou créer l'incident
        if (data.currentIncidentId) {
            await this.updateIncidentLockdown(data.currentIncidentId, true);
        } else {
            const incidentId = await this.createIncident(guildId, data.score, criteria, true);
            data.currentIncidentId = incidentId;
        }

        // Désactiver les invitations
        await this.disableInvites(guild);

        // DM à tous les admins
        await this.alertAdmins(guild, data.score, criteria);

        // Logger le lockdown
        await this.logRaidAlert(guild, '🔒 LOCKDOWN CRITIQUE', data.score, criteria, '#FF0000');

        // Appliquer le rôle RAID aux raiders détectés
        await this.applyRaidRoleToCurrentRaiders(guild);
    }

    /**
     * Désactive le mode raid
     */
    async deactivateRaidMode(guildId) {
        const data = this.guildScores.get(guildId);
        if (!data) return;

        const wasLockdown = data.lockdownActive;
        data.raidActive = false;
        data.lockdownActive = false;

        console.log(`[ANTI-RAID] ✅ Mode raid désactivé pour ${guildId}`);

        const guild = this.client.guilds.cache.get(guildId);
        if (guild) {
            // Réactiver les invitations si un lockdown était actif
            if (wasLockdown) {
                await this.enableInvites(guild);
                console.log(`[ANTI-RAID] 🔗 Invitations réactivées pour ${guild.name}`);
            }

            await this.logRaidAlert(guild, 'Mode raid désactivé', data.score, 'Score descendu sous le seuil', '#00FF00');
        }

        // Résoudre l'incident
        if (data.currentIncidentId) {
            await this.resolveIncident(data.currentIncidentId, 'AUTO');
            data.currentIncidentId = null;
        }

        // Réinitialiser les raiders actuels
        this.currentRaiders.delete(guildId);
    }

    /**
     * Désactive le lockdown manuellement
     */
    async deactivateLockdown(guildId, moderatorId = null) {
        const data = this.guildScores.get(guildId);
        if (!data) return;

        data.lockdownActive = false;

        const guild = this.client.guilds.cache.get(guildId);
        if (guild) {
            // Réactiver les invitations (optionnel, selon la config)
            // await this.enableInvites(guild);

            await this.logRaidAlert(guild, 'Lockdown désactivé', data.score, `Désactivé par ${moderatorId ? `<@${moderatorId}>` : 'système'}`, '#00FF00');
        }
    }

    /**
     * Désactive les invitations du serveur
     */
    async disableInvites(guild) {
        try {
            // Supprimer toutes les invitations actives
            const invites = await guild.invites.fetch();
            for (const invite of invites.values()) {
                await invite.delete('Anti-raid: Lockdown activé').catch(() => {});
            }

            // Désactiver la création d'invitations pour @everyone
            const everyoneRole = guild.roles.everyone;
            await everyoneRole.setPermissions(
                everyoneRole.permissions.remove(PermissionFlagsBits.CreateInstantInvite),
                'Anti-raid: Lockdown activé'
            ).catch(console.error);

            console.log(`[ANTI-RAID] Invitations désactivées pour ${guild.name}`);
        } catch (error) {
            console.error('[ANTI-RAID] Erreur lors de la désactivation des invitations:', error);
        }
    }

    /**
     * Réactive les invitations du serveur
     */
    async enableInvites(guild) {
        try {
            const everyoneRole = guild.roles.everyone;
            await everyoneRole.setPermissions(
                everyoneRole.permissions.add(PermissionFlagsBits.CreateInstantInvite),
                'Anti-raid: Lockdown désactivé'
            ).catch(console.error);

            console.log(`[ANTI-RAID] Invitations réactivées pour ${guild.name}`);
        } catch (error) {
            console.error('[ANTI-RAID] Erreur lors de la réactivation des invitations:', error);
        }
    }

    /**
     * Envoie un DM à tous les administrateurs
     */
    async alertAdmins(guild, score, criteria) {
        try {
            const members = await guild.members.fetch();
            const admins = members.filter(m => 
                m.permissions.has(PermissionFlagsBits.Administrator) && !m.user.bot
            );

            // Embed classique pour les DMs (Components V2 pas supportés en DM)
            const embed = new EmbedBuilder()
                .setTitle('🚨 ALERTE RAID CRITIQUE 🚨')
                .setDescription(`Un raid a été détecté sur **${guild.name}** !`)
                .setColor('#FF0000')
                .addFields(
                    { name: 'Score de menace', value: `${score}`, inline: true },
                    { name: 'Critère principal', value: criteria, inline: true },
                    { name: 'Action prise', value: '🔒 Lockdown activé\n❌ Invitations désactivées\n🏷️ Rôle RAID appliqué', inline: false }
                )
                .setTimestamp()
                .setFooter({ text: 'Utilisez /antiraid pour gérer la situation' });

            let alertsSent = 0;
            for (const [, admin] of admins) {
                try {
                    await admin.send({ embeds: [embed] });
                    alertsSent++;
                } catch (e) {
                    // L'admin a peut-être les DMs fermés
                }
            }

            console.log(`[ANTI-RAID] ${alertsSent} admins alertés sur ${admins.size}`);
        } catch (error) {
            console.error('[ANTI-RAID] Erreur lors de l\'alerte des admins:', error);
        }
    }

    /**
     * Applique le rôle RAID aux raiders détectés
     */
    async applyRaidRoleToCurrentRaiders(guild) {
        const raidRoleId = CONFIG.RAID_ROLE_ID;
        if (!raidRoleId || raidRoleId === 'VOTRE_RAID_ROLE_ID') {
            console.log('[ANTI-RAID] RAID_ROLE_ID non configuré');
            return;
        }

        const raiders = this.currentRaiders.get(guild.id);
        if (!raiders || raiders.size === 0) return;

        const raidRole = guild.roles.cache.get(raidRoleId);
        if (!raidRole) {
            console.error('[ANTI-RAID] Rôle RAID introuvable');
            return;
        }

        let applied = 0;
        for (const odString of raiders) {
            try {
                const member = await guild.members.fetch(odString).catch(() => null);
                if (member && !this.isProtected(member)) {
                    await member.roles.add(raidRole, 'Anti-raid: Membre suspect');
                    applied++;

                    // Enregistrer l'action dans la base de données
                    await this.recordRaiderAction(member, 'RAID_ROLE_APPLIED');
                }
            } catch (e) {
                console.error(`[ANTI-RAID] Erreur application rôle RAID à ${odString}:`, e);
            }
        }

        console.log(`[ANTI-RAID] Rôle RAID appliqué à ${applied}/${raiders.size} raiders`);
    }

    /**
     * Vérifie si un membre est protégé
     */
    isProtected(member) {
        const protectedRoles = CONFIG.RAID_DETECTION?.PROTECTED_ROLES || [];
        return member.roles.cache.some(role => protectedRoles.includes(role.id));
    }

    /**
     * Log une alerte raid dans le salon de logs avec Components V2
     */
    async logRaidAlert(guild, title, score, criteria, color) {
        let logChannelId;
        if (isBlzTestGuild(guild.id)) {
            const tr = String(process.env.TEST_RAID_LOG_CHANNEL_ID || '').trim();
            logChannelId = /^\d{17,22}$/.test(tr) ? tr : resolveAllLogChannelId(guild.id);
        } else {
            logChannelId = CONFIG.RAID_LOG_CHANNEL_ID || CONFIG.ALL_LOG_CHANNEL_ID;
        }
        const logChannel = guild.channels.cache.get(logChannelId);

        if (!logChannel || !logChannel.isTextBased()) return;

        const raiders = this.currentRaiders.get(guild.id);
        const raiderCount = raiders ? raiders.size : 0;

        // Convertir la couleur hex en nombre
        const colorNumber = parseInt(color.replace('#', ''), 16);

        try {
            // Utiliser Components V2 (Container)
            const container = new ContainerBuilder()
                .setAccentColor(colorNumber);

            // Titre
            container.addTextDisplayComponents(
                new TextDisplayBuilder().setContent(`# 🛡️ Anti-Raid : ${title}`)
            );

            // Séparateur
            container.addSeparatorComponents(
                new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small)
            );

            // Informations principales
            container.addTextDisplayComponents(
                new TextDisplayBuilder().setContent(
                    `**Score actuel:** ${score}\n` +
                    `**Critère:** ${criteria}\n` +
                    `**Raiders détectés:** ${raiderCount}`
                )
            );

            // Séparateur
            container.addSeparatorComponents(
                new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small)
            );

            // Timestamp
            container.addTextDisplayComponents(
                new TextDisplayBuilder().setContent(`-# <t:${Math.floor(Date.now() / 1000)}:f>`)
            );

            await logChannel.send({ components: [container], flags: [4096] }).catch(async (err) => {
                // Fallback vers embed classique si Components V2 échoue
                console.log('[ANTI-RAID] Fallback vers embed classique:', err.message);
                const embed = new EmbedBuilder()
                    .setTitle(`🛡️ Anti-Raid : ${title}`)
                    .setDescription(`Système de protection anti-raid`)
                    .setColor(color)
                    .addFields(
                        { name: 'Score actuel', value: `${score}`, inline: true },
                        { name: 'Critère', value: criteria, inline: true },
                        { name: 'Raiders détectés', value: `${raiderCount}`, inline: true }
                    )
                    .setTimestamp();
                await logChannel.send({ embeds: [embed] });
            });
        } catch (error) {
            console.error('[ANTI-RAID] Erreur lors du log:', error);
        }
    }

    // ==================== DÉTECTION DES JOINS ====================

    /**
     * Track un nouveau membre qui rejoint
     */
    async trackJoin(member) {
        const guildId = member.guild.id;
        const now = Date.now();
        
        // Calculer l'âge du compte en jours
        const accountAge = Math.floor((now - member.user.createdTimestamp) / (1000 * 60 * 60 * 24));

        // Ajouter à l'historique
        if (!this.joinHistory.has(guildId)) {
            this.joinHistory.set(guildId, []);
        }
        
        const history = this.joinHistory.get(guildId);
        history.push({
            odString: member.id,
            timestamp: now,
            accountAge: accountAge,
            username: member.user.username
        });

        // Analyser les patterns
        let totalScore = 0;
        const triggeredCriteria = [];

        // 1. Détection rafale de joins
        const joinScore = this.detectJoinBurst(guildId, now);
        if (joinScore > 0) {
            totalScore += joinScore;
            triggeredCriteria.push(`Rafale de joins (+${joinScore})`);
        }

        // 2. Détection compte récent
        const newAccountDays = CONFIG.RAID_DETECTION?.NEW_ACCOUNT_DAYS || 7;
        const newAccountScore = CONFIG.RAID_DETECTION?.NEW_ACCOUNT_SCORE || 10;
        
        if (accountAge < newAccountDays) {
            totalScore += newAccountScore;
            triggeredCriteria.push(`Compte récent: ${accountAge}j (+${newAccountScore})`);
            
            // Marquer comme raider potentiel
            this.markAsRaider(guildId, member.id);
        }

        // 3. Détection noms similaires
        const similarScore = this.detectSimilarNames(guildId, member.user.username, now);
        if (similarScore > 0) {
            totalScore += similarScore;
            triggeredCriteria.push(`Noms similaires (+${similarScore})`);
        }

        // Ajouter le score si des critères sont déclenchés
        if (totalScore > 0) {
            this.addScore(guildId, totalScore, triggeredCriteria.join(', '));
        }

        // Si le mode raid est actif, appliquer le rôle RAID immédiatement
        const data = this.guildScores.get(guildId);
        if (data?.raidActive) {
            this.markAsRaider(guildId, member.id);
            await this.applyRaidRole(member);
        }

        return totalScore;
    }

    /**
     * Détecte une rafale de joins
     */
    detectJoinBurst(guildId, now) {
        const history = this.joinHistory.get(guildId);
        if (!history) return 0;

        const window = CONFIG.RAID_DETECTION?.JOIN_WINDOW || 10000;
        const threshold = CONFIG.RAID_DETECTION?.JOIN_THRESHOLD || 10;
        const multiplier = CONFIG.RAID_DETECTION?.JOIN_SCORE_MULTIPLIER || 25;

        // Compter les joins dans la fenêtre
        const recentJoins = history.filter(j => (now - j.timestamp) < window);
        
        if (recentJoins.length >= threshold) {
            // Marquer tous les joins récents comme raiders potentiels
            for (const join of recentJoins) {
                this.markAsRaider(guildId, join.odString);
            }
            
            // Score proportionnel au nombre de joins
            const score = Math.floor((recentJoins.length / threshold) * multiplier);
            return score;
        }

        return 0;
    }

    /**
     * Détecte des noms d'utilisateur similaires (pattern de bot)
     */
    detectSimilarNames(guildId, username, now) {
        const history = this.joinHistory.get(guildId);
        if (!history) return 0;

        const threshold = CONFIG.RAID_DETECTION?.SIMILAR_NAME_THRESHOLD || 3;
        const scorePerName = CONFIG.RAID_DETECTION?.SIMILAR_NAME_SCORE || 20;
        const window = CONFIG.RAID_DETECTION?.JOIN_WINDOW || 10000;

        // Filtrer les joins récents
        const recentJoins = history.filter(j => (now - j.timestamp) < window * 3);
        
        // Extraire le pattern de base du nom (enlever les chiffres à la fin)
        const basePattern = username.replace(/\d+$/, '').toLowerCase();
        
        if (basePattern.length < 3) return 0; // Nom trop court pour être significatif

        // Compter les noms similaires
        const similarNames = recentJoins.filter(j => {
            const otherBase = j.username.replace(/\d+$/, '').toLowerCase();
            return otherBase === basePattern || 
                   this.levenshteinDistance(basePattern, otherBase) <= 2;
        });

        if (similarNames.length >= threshold) {
            // Marquer tous les noms similaires comme raiders
            for (const join of similarNames) {
                this.markAsRaider(guildId, join.odString);
            }
            
            return (similarNames.length - threshold + 1) * scorePerName;
        }

        return 0;
    }

    /**
     * Calcule la distance de Levenshtein entre deux chaînes
     */
    levenshteinDistance(str1, str2) {
        const m = str1.length;
        const n = str2.length;
        const dp = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));

        for (let i = 0; i <= m; i++) dp[i][0] = i;
        for (let j = 0; j <= n; j++) dp[0][j] = j;

        for (let i = 1; i <= m; i++) {
            for (let j = 1; j <= n; j++) {
                if (str1[i - 1] === str2[j - 1]) {
                    dp[i][j] = dp[i - 1][j - 1];
                } else {
                    dp[i][j] = 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
                }
            }
        }

        return dp[m][n];
    }

    // ==================== DÉTECTION DES MESSAGES ====================

    /**
     * Track un message pour détecter le spam
     */
    async trackMessage(message) {
        if (message.author.bot) return 0;

        const odString = message.author.id;
        const guildId = message.guild?.id;
        if (!guildId) return 0;

        const now = Date.now();
        const content = message.content.toLowerCase().trim();

        if (content.length < 5) return 0; // Message trop court pour être du spam

        // Ajouter à l'historique
        if (!this.messageHistory.has(odString)) {
            this.messageHistory.set(odString, []);
        }

        const history = this.messageHistory.get(odString);
        history.push({
            content: content,
            timestamp: now,
            channelId: message.channel.id,
            guildId: guildId
        });

        // Analyser les patterns
        let totalScore = 0;
        const triggeredCriteria = [];

        // 1. Détection spam multi-salon
        const spamScore = this.detectMultiChannelSpam(odString, content, now, guildId);
        if (spamScore > 0) {
            totalScore += spamScore;
            triggeredCriteria.push(`Spam multi-salon (+${spamScore})`);
        }

        // 2. Détection messages répétés
        const repeatScore = this.detectRepeatedMessages(odString, content, now, guildId);
        if (repeatScore > 0) {
            totalScore += repeatScore;
            triggeredCriteria.push(`Messages répétés (+${repeatScore})`);
        }

        // Ajouter le score si des critères sont déclenchés
        if (totalScore > 0) {
            this.markAsRaider(guildId, odString);
            this.addScore(guildId, totalScore, triggeredCriteria.join(', '));

            // Supprimer les messages de spam
            await this.deleteSpamMessages(odString, guildId, content);
        }

        return totalScore;
    }

    /**
     * Détecte le spam multi-salon (même message dans plusieurs salons)
     */
    detectMultiChannelSpam(odString, content, now, guildId) {
        const history = this.messageHistory.get(odString);
        if (!history) return 0;

        const window = CONFIG.RAID_DETECTION?.SPAM_CHANNEL_WINDOW || 10000;
        const threshold = CONFIG.RAID_DETECTION?.SPAM_CHANNEL_THRESHOLD || 3;
        const score = CONFIG.RAID_DETECTION?.SPAM_CHANNEL_SCORE || 50;

        // Messages identiques récents dans différents salons
        const recentSameMessages = history.filter(m => 
            m.content === content && 
            m.guildId === guildId &&
            (now - m.timestamp) < window
        );

        // Compter les salons uniques
        const uniqueChannels = new Set(recentSameMessages.map(m => m.channelId));

        if (uniqueChannels.size >= threshold) {
            return score;
        }

        return 0;
    }

    /**
     * Détecte les messages répétés consécutifs
     */
    detectRepeatedMessages(odString, content, now, guildId) {
        const history = this.messageHistory.get(odString);
        if (!history) return 0;

        const threshold = CONFIG.RAID_DETECTION?.REPEAT_MESSAGE_THRESHOLD || 5;
        const score = CONFIG.RAID_DETECTION?.REPEAT_MESSAGE_SCORE || 30;
        const window = CONFIG.RAID_DETECTION?.SPAM_CHANNEL_WINDOW || 10000;

        // Messages identiques récents
        const recentSameMessages = history.filter(m => 
            m.content === content && 
            m.guildId === guildId &&
            (now - m.timestamp) < window * 3
        );

        if (recentSameMessages.length >= threshold) {
            return score;
        }

        return 0;
    }

    /**
     * Supprime les messages de spam d'un utilisateur
     */
    async deleteSpamMessages(odString, guildId, content) {
        const guild = this.client.guilds.cache.get(guildId);
        if (!guild) return;

        const history = this.messageHistory.get(odString);
        if (!history) return;

        const now = Date.now();
        const window = CONFIG.RAID_DETECTION?.SPAM_CHANNEL_WINDOW || 10000;

        // Trouver les salons où supprimer
        const channelsToCheck = new Set(
            history
                .filter(m => m.content === content && m.guildId === guildId && (now - m.timestamp) < window * 2)
                .map(m => m.channelId)
        );

        for (const channelId of channelsToCheck) {
            try {
                const channel = guild.channels.cache.get(channelId);
                if (!channel || !channel.isTextBased()) continue;

                const messages = await channel.messages.fetch({ limit: 20 });
                const toDelete = messages.filter(m => 
                    m.author.id === odString && 
                    m.content.toLowerCase().trim() === content
                );

                for (const [, msg] of toDelete) {
                    await msg.delete().catch(() => {});
                }
            } catch (e) {
                // Ignorer les erreurs de permission
            }
        }
    }

    // ==================== GESTION DES RAIDERS ====================

    /**
     * Marque un utilisateur comme raider potentiel
     */
    markAsRaider(guildId, odString) {
        if (!this.currentRaiders.has(guildId)) {
            this.currentRaiders.set(guildId, new Set());
        }
        this.currentRaiders.get(guildId).add(odString);
    }

    /**
     * Applique le rôle RAID à un membre
     */
    async applyRaidRole(member) {
        const raidRoleId = CONFIG.RAID_ROLE_ID;
        if (!raidRoleId || raidRoleId === 'VOTRE_RAID_ROLE_ID') return false;

        try {
            if (this.isProtected(member)) return false;

            const raidRole = member.guild.roles.cache.get(raidRoleId);
            if (!raidRole) return false;

            await member.roles.add(raidRole, 'Anti-raid: Membre suspect');
            await this.recordRaiderAction(member, 'RAID_ROLE_APPLIED');
            
            return true;
        } catch (error) {
            console.error(`[ANTI-RAID] Erreur application rôle RAID:`, error);
            return false;
        }
    }

    /**
     * Retire le rôle RAID de tous les membres
     */
    async clearAllRaidRoles(guild, moderatorId = null) {
        const raidRoleId = CONFIG.RAID_ROLE_ID;
        if (!raidRoleId || raidRoleId === 'VOTRE_RAID_ROLE_ID') return 0;

        const raidRole = guild.roles.cache.get(raidRoleId);
        if (!raidRole) return 0;

        let cleared = 0;
        for (const [, member] of raidRole.members) {
            try {
                await member.roles.remove(raidRole, `Anti-raid: Nettoyage par ${moderatorId || 'système'}`);
                cleared++;
            } catch (e) {
                // Ignorer les erreurs
            }
        }

        // Réinitialiser les données
        this.currentRaiders.delete(guild.id);
        this.guildScores.delete(guild.id);

        return cleared;
    }

    // ==================== BASE DE DONNÉES ====================

    /**
     * Crée un incident de raid dans la base de données
     */
    async createIncident(guildId, score, criteria, lockdown) {
        return new Promise((resolve, reject) => {
            const db = this.dbManager.getRaidIncidentsDb();
            if (!db) {
                resolve(null);
                return;
            }

            const now = Date.now();
            const raiders = this.currentRaiders.get(guildId);
            const raiderCount = raiders ? raiders.size : 0;

            db.run(
                `INSERT INTO raid_incidents (guildId, detected_at, peak_score, raider_count, criteria_triggered, action_taken, lockdown_activated)
                 VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [guildId, now, score, raiderCount, criteria, 'RAID_MODE_ACTIVATED', lockdown ? 1 : 0],
                function(err) {
                    if (err) {
                        console.error('[ANTI-RAID] Erreur création incident:', err);
                        resolve(null);
                    } else {
                        resolve(this.lastID);
                    }
                }
            );
        });
    }

    /**
     * Met à jour un incident pour le lockdown
     */
    async updateIncidentLockdown(incidentId, lockdown) {
        return new Promise((resolve) => {
            const db = this.dbManager.getRaidIncidentsDb();
            if (!db || !incidentId) {
                resolve();
                return;
            }

            db.run(
                `UPDATE raid_incidents SET lockdown_activated = ?, action_taken = ? WHERE id = ?`,
                [lockdown ? 1 : 0, 'LOCKDOWN_ACTIVATED', incidentId],
                (err) => {
                    if (err) console.error('[ANTI-RAID] Erreur mise à jour incident:', err);
                    resolve();
                }
            );
        });
    }

    /**
     * Résout un incident
     */
    async resolveIncident(incidentId, resolvedBy) {
        return new Promise((resolve) => {
            const db = this.dbManager.getRaidIncidentsDb();
            if (!db || !incidentId) {
                resolve();
                return;
            }

            db.run(
                `UPDATE raid_incidents SET resolved_at = ?, resolved_by = ? WHERE id = ?`,
                [Date.now(), resolvedBy, incidentId],
                (err) => {
                    if (err) console.error('[ANTI-RAID] Erreur résolution incident:', err);
                    resolve();
                }
            );
        });
    }

    /**
     * Enregistre une action sur un raider
     */
    async recordRaiderAction(member, action) {
        const db = this.dbManager.getRaidIncidentsDb();
        if (!db) return;

        const data = this.guildScores.get(member.guild.id);
        const incidentId = data?.currentIncidentId;
        if (!incidentId) return;

        const accountAge = Math.floor((Date.now() - member.user.createdTimestamp) / (1000 * 60 * 60 * 24));

        db.run(
            `INSERT INTO detected_raiders (incident_id, odString, username, account_age_days, join_timestamp, action_applied)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [incidentId, member.id, member.user.username, accountAge, Date.now(), action],
            (err) => {
                if (err) console.error('[ANTI-RAID] Erreur enregistrement raider:', err);
            }
        );
    }

    /**
     * Récupère l'historique des incidents
     */
    async getIncidentHistory(guildId, limit = 10) {
        return new Promise((resolve) => {
            const db = this.dbManager.getRaidIncidentsDb();
            if (!db) {
                resolve([]);
                return;
            }

            db.all(
                `SELECT * FROM raid_incidents WHERE guildId = ? ORDER BY detected_at DESC LIMIT ?`,
                [guildId, limit],
                (err, rows) => {
                    if (err) {
                        console.error('[ANTI-RAID] Erreur récupération historique:', err);
                        resolve([]);
                    } else {
                        resolve(rows || []);
                    }
                }
            );
        });
    }

    // ==================== GETTERS POUR LA COMMANDE ====================

    /**
     * Obtient le statut actuel pour un serveur
     */
    getStatus(guildId) {
        const data = this.guildScores.get(guildId);
        const raiders = this.currentRaiders.get(guildId);

        return {
            score: data?.score || 0,
            raidActive: data?.raidActive || false,
            lockdownActive: data?.lockdownActive || false,
            raiderCount: raiders?.size || 0,
            lastUpdate: data?.lastUpdate || null
        };
    }
}

module.exports = AntiRaidManager;
