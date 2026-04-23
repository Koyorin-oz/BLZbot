const fs = require('fs');
const path = require('path');
const {
    EmbedBuilder,
    ButtonBuilder,
    ActionRowBuilder,
    ButtonStyle,
    PermissionsBitField,
    ChannelType,
} = require('discord.js');
const CONFIG = require('../config.js');
const { isBotOwner } = require('../utils/bot-owner');
const { createDebanPost, findTestGuildIdByForumChannelId } = require('./debanForum');

const _V_COMPACT = process.env.BLZ_COMPACT_LOG === '1';

// Délai minimum avant qu'un ban soit éligible à une demande (≈ 3 mois)
const BAN_WAIT_MS = 3 * 30 * 24 * 60 * 60 * 1000;
// Cooldown entre deux demandes après un refus (30 jours)
const DEBAN_REFUSAL_COOLDOWN_MS = 30 * 24 * 60 * 60 * 1000;
// TTL des données de formulaire en mémoire (30 min) : empêche une fuite si le user abandonne
const FORM_DATA_TTL_MS = 30 * 60 * 1000;

/**
 * Parse robuste d'une date de ban saisie dans le formulaire.
 * Accepte : JJ/MM/AAAA, JJ-MM-AAAA, JJ.MM.AAAA, AAAA-MM-JJ, AAAA/MM/JJ, timestamp ISO.
 * Retourne un objet Date ou null si la saisie est invalide / non parsable.
 */
function parseBanDate(input) {
    if (!input || typeof input !== 'string') return null;
    const s = input.trim();
    if (!s) return null;

    // Format FR : JJ/MM/AAAA ou JJ-MM-AAAA ou JJ.MM.AAAA (année 2 ou 4 chiffres)
    const frMatch = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2}|\d{4})$/);
    if (frMatch) {
        let [, d, m, y] = frMatch;
        d = parseInt(d, 10);
        m = parseInt(m, 10);
        y = parseInt(y, 10);
        if (y < 100) y += y >= 70 ? 1900 : 2000; // 22 → 2022, 99 → 1999
        if (m < 1 || m > 12 || d < 1 || d > 31) return null;
        const dt = new Date(Date.UTC(y, m - 1, d));
        if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
        return dt;
    }

    // Format ISO : AAAA-MM-JJ ou AAAA/MM/JJ
    const isoMatch = s.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})$/);
    if (isoMatch) {
        const [, y, m, d] = isoMatch.map((v, i) => i === 0 ? v : parseInt(v, 10));
        if (m < 1 || m > 12 || d < 1 || d > 31) return null;
        const dt = new Date(Date.UTC(Number(y), m - 1, d));
        if (dt.getUTCFullYear() !== Number(y) || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
        return dt;
    }

    // Dernier recours : Date.parse (accepte ISO 8601 complet, RFC 2822, etc.)
    const fallback = new Date(s);
    if (!Number.isNaN(fallback.getTime())) return fallback;
    return null;
}

/**
 * Module de gestion des votes (débannissement, promotions, candidatures, votes personnalisés)
 */
class VoteManager {
    constructor() {
        // Construire rolesPoints depuis STAFF_ROLES
        this.rolesPoints = {};
        CONFIG.STAFF_ROLES.forEach(role => {
            this.rolesPoints[role.id] = role.points;
        });

        // Données des votes
        this.votes = this.loadVotes();
        this.debanVotes = this.loadDebanVotes();
        this.candidateVotes = this.loadCandidateVotes();
        this.pendingDebanRequests = this.loadPendingDebanRequests();
        this.debanCooldowns = this.loadDebanCooldowns();

        // Données temporaires
        this.modoTestData = {};
        // Ensemble en mémoire pour traquer les submissions en cours (flow formulaire).
        // La vérité persistante passe par hasActiveDebanRequest() qui combine debanVotes + pending + cooldowns.
        this.activeDebanRequests = new Set();
        this.formData = new Map();
        this.formDataTimers = new Map();
        // Salon de destination choisi par /panel-deban, indexé par userId en cours de formulaire.
        // Vidé en fin de submission ou quand le TTL formData expire.
        this.pendingDebanChannels = new Map();
    }

    /**
     * Vérifie si un utilisateur a déjà une demande en cours (vote actif, en attente ou cooldown).
     * Source de vérité persistante (survit aux redémarrages).
     */
    hasActiveDebanRequest(userId) {
        if (this.debanVotes?.[userId]) return { active: true, reason: 'vote', data: this.debanVotes[userId] };
        if (this.pendingDebanRequests?.[userId]) return { active: true, reason: 'pending', data: this.pendingDebanRequests[userId] };
        const cd = this.debanCooldowns?.[userId];
        if (cd && Number(cd.until) > Date.now()) return { active: true, reason: 'cooldown', data: cd };
        if (this.activeDebanRequests.has(userId)) return { active: true, reason: 'in_progress', data: null };
        return { active: false, reason: null, data: null };
    }

    /**
     * Enregistre un cooldown après un refus. Empêche l'utilisateur de resoumettre pendant N ms.
     */
    addDebanRefusalCooldown(userId, ms = DEBAN_REFUSAL_COOLDOWN_MS) {
        this.debanCooldowns = this.debanCooldowns || {};
        this.debanCooldowns[userId] = {
            until: Date.now() + ms,
            createdAt: new Date().toISOString(),
        };
        this.saveDebanCooldowns();
    }

    /**
     * Supprime le cooldown d'un utilisateur (ex. admin qui rouvre la porte).
     */
    clearDebanRefusalCooldown(userId) {
        if (this.debanCooldowns?.[userId]) {
            delete this.debanCooldowns[userId];
            this.saveDebanCooldowns();
        }
    }

    /**
     * Purge les cooldowns expirés (appelé périodiquement par le scheduler).
     */
    purgeExpiredDebanCooldowns() {
        if (!this.debanCooldowns) return 0;
        const now = Date.now();
        let removed = 0;
        for (const [uid, cd] of Object.entries(this.debanCooldowns)) {
            if (!cd?.until || Number(cd.until) <= now) {
                delete this.debanCooldowns[uid];
                removed++;
            }
        }
        if (removed > 0) this.saveDebanCooldowns();
        return removed;
    }

    /**
     * Stocke les données de formulaire en mémoire avec un TTL. Après expiration, elles sont purgées
     * automatiquement (évite les fuites si le user abandonne le flow en cours de route).
     */
    setFormData(userId, data, ttlMs = FORM_DATA_TTL_MS) {
        this.formData.set(userId, data);
        if (this.formDataTimers.has(userId)) clearTimeout(this.formDataTimers.get(userId));
        const timer = setTimeout(() => {
            this.formData.delete(userId);
            this.formDataTimers.delete(userId);
            this.activeDebanRequests.delete(userId);
            this.pendingDebanChannels?.delete(userId);
        }, ttlMs);
        // Ne pas maintenir l'event-loop en vie juste pour ce timer
        if (timer.unref) timer.unref();
        this.formDataTimers.set(userId, timer);
    }

    clearFormData(userId) {
        this.formData.delete(userId);
        const t = this.formDataTimers.get(userId);
        if (t) clearTimeout(t);
        this.formDataTimers.delete(userId);
    }

    /**
     * Charge les votes depuis le fichier JSON
     */
    loadVotes() {
        const votesFilePath = path.join(__dirname, '../../votes.json');
        if (!_V_COMPACT) console.log(`[VoteManager] Chargement votes: ${votesFilePath}`);

        if (fs.existsSync(votesFilePath)) {
            try {
                const data = fs.readFileSync(votesFilePath, 'utf8');
                const votes = JSON.parse(data);
                const voteCount = Object.keys(votes).length;
                if (!_V_COMPACT) console.log(`[VoteManager] ${voteCount} vote(s) chargé(s)`);
                return votes;
            } catch (e) {
                console.error(`[VoteManager] Erreur parsing votes.json:`, e);
                return {};
            }
        }
        if (!_V_COMPACT) console.log(`[VoteManager] votes.json absent — état vide`);
        return {};
    }

    /**
     * Sauvegarde les votes dans le fichier JSON
     */
    saveVotes() {
        const votesFilePath = path.join(__dirname, '../../votes.json');
        fs.writeFileSync(votesFilePath, JSON.stringify(this.votes, null, 2), 'utf8');
    }

    /**
     * Charge les votes de débannissement
     */
    loadDebanVotes() {
        const debanVotesPath = path.join(__dirname, '../../deban_votes.json');
        if (fs.existsSync(debanVotesPath)) {
            try {
                return JSON.parse(fs.readFileSync(debanVotesPath, 'utf8'));
            } catch (e) {
                console.error("Erreur lors du chargement des votes de débannissement:", e);
                return {};
            }
        }
        return {};
    }

    /**
     * Sauvegarde les votes de débannissement
     */
    saveDebanVotes() {
        const debanVotesPath = path.join(__dirname, '../../deban_votes.json');
        fs.writeFileSync(debanVotesPath, JSON.stringify(this.debanVotes, null, 2), 'utf8');
    }

    /**
     * Charge les votes de candidature
     */
    loadCandidateVotes() {
        const candidateVotesPath = path.join(__dirname, '../../candidate_votes.json');
        if (fs.existsSync(candidateVotesPath)) {
            try {
                return JSON.parse(fs.readFileSync(candidateVotesPath, 'utf8'));
            } catch (e) {
                console.error("Erreur lors du chargement des votes de candidature:", e);
                return {};
            }
        }
        return {};
    }

    /**
     * Sauvegarde les votes de candidature
     */
    saveCandidateVotes() {
        const candidateVotesPath = path.join(__dirname, '../../candidate_votes.json');
        fs.writeFileSync(candidateVotesPath, JSON.stringify(this.candidateVotes, null, 2), 'utf8');
    }

    /**
     * Charge les demandes de débannissement en attente
     */
    loadPendingDebanRequests() {
        const pendingPath = path.join(__dirname, '../../pending_deban_requests.json');
        if (fs.existsSync(pendingPath)) {
            try {
                return JSON.parse(fs.readFileSync(pendingPath, 'utf8'));
            } catch (e) {
                console.error("Erreur lors du chargement des demandes en attente:", e);
                return {};
            }
        }
        return {};
    }

    /**
     * Sauvegarde les demandes de débannissement en attente
     */
    savePendingDebanRequests() {
        const pendingPath = path.join(__dirname, '../../pending_deban_requests.json');
        fs.writeFileSync(pendingPath, JSON.stringify(this.pendingDebanRequests, null, 2), 'utf8');
    }

    /**
     * Charge les cooldowns post-refus.
     */
    loadDebanCooldowns() {
        const p = path.join(__dirname, '../../deban_cooldowns.json');
        if (fs.existsSync(p)) {
            try {
                return JSON.parse(fs.readFileSync(p, 'utf8'));
            } catch (e) {
                console.error('[VoteManager] Erreur parsing deban_cooldowns.json:', e);
                return {};
            }
        }
        return {};
    }

    saveDebanCooldowns() {
        const p = path.join(__dirname, '../../deban_cooldowns.json');
        fs.writeFileSync(p, JSON.stringify(this.debanCooldowns || {}, null, 2), 'utf8');
    }

    /**
     * Démarre un vote standard
     */
    async startVote(user, reason, channel, voteType = 'standard') {
        const embed = new EmbedBuilder()
            .setTitle(`${reason} ${user.username}`)
            .setDescription(`Votez pour <@${user.id}> !`)
            .addFields(
                { name: 'Oui', value: '0', inline: true },
                { name: 'Non', value: '0', inline: true }
            )
            .setColor('#00FF00');

        const row = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('vote_oui')
                    .setLabel('Oui')
                    .setStyle(ButtonStyle.Success),
                new ButtonBuilder()
                    .setCustomId('vote_non')
                    .setLabel('Non')
                    .setStyle(ButtonStyle.Danger),
                new ButtonBuilder()
                    .setCustomId('fin_vote')
                    .setLabel('Fin du Vote')
                    .setStyle(ButtonStyle.Secondary)
                    .setDisabled(!channel.permissionsFor(channel.guild.members.me).has(PermissionsBitField.Flags.Administrator))
            );

        const sent = await channel.send({ embeds: [embed], components: [row] });

        this.votes[user.id] = {
            oui: 0,
            non: 0,
            voters: {},
            type: voteType,
            createdAt: new Date().toISOString(),
            endsAt: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
            channelId: channel.id,
            messageId: sent.id,
        };

        this.saveVotes();
    }

    /**
     * Démarre un vote de promotion
     */
    async startRankupVote(user, promotionType, interaction) {
        const channel = interaction.channel;
        const embed = new EmbedBuilder()
            .setTitle(`Vote de promotion pour ${user.username}`)
            .setDescription(`Promotion : **${promotionType}**\nVotez pour <@${user.id}> !`)
            .addFields(
                { name: 'Oui', value: '0', inline: true },
                { name: 'Non', value: '0', inline: true }
            )
            .setColor('#00BFFF');

        const row = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('vote_oui')
                    .setLabel('Oui')
                    .setStyle(ButtonStyle.Success),
                new ButtonBuilder()
                    .setCustomId('vote_non')
                    .setLabel('Non')
                    .setStyle(ButtonStyle.Danger),
                new ButtonBuilder()
                    .setCustomId('fin_rankup_vote')
                    .setLabel('Fin du Vote')
                    .setStyle(ButtonStyle.Secondary)
                    .setDisabled(!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator))
            );

        const sent = await channel.send({ embeds: [embed], components: [row] });

        this.votes[user.id] = {
            oui: 0,
            non: 0,
            voters: {},
            type: promotionType,
            createdAt: new Date().toISOString(),
            endsAt: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
            channelId: channel.id,
            messageId: sent.id,
        };

        this.saveVotes();

        await interaction.reply({
            content: `Le vote de promotion pour <@${user.id}> a commencé !`,
            ephemeral: true,
        });
    }

    /**
     * Démarre un vote personnalisé
     */
    async startCustomVote(interaction, sujet) {
        const channel = interaction.channel;

        const embed = new EmbedBuilder()
            .setTitle(`Vote : ${sujet}`)
            .setDescription(`Votez pour le sujet : **${sujet}**`)
            .addFields(
                { name: 'Oui', value: '0', inline: true },
                { name: 'Non', value: '0', inline: true }
            )
            .setColor('#FFA500');

        const row = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('vote_oui')
                    .setLabel('Oui')
                    .setStyle(ButtonStyle.Success),
                new ButtonBuilder()
                    .setCustomId('vote_non')
                    .setLabel('Non')
                    .setStyle(ButtonStyle.Danger),
                new ButtonBuilder()
                    .setCustomId('fin_bvote')
                    .setLabel('Fin du Vote')
                    .setStyle(ButtonStyle.Secondary)
                    .setDisabled(!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator))
            );

        const sent = await channel.send({ embeds: [embed], components: [row] });

        this.votes[sujet] = {
            oui: 0,
            non: 0,
            voters: {},
            type: 'custom',
            createdAt: new Date().toISOString(),
            endsAt: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
            channelId: channel.id,
            messageId: sent.id,
        };

        this.saveVotes();

        await interaction.reply({
            content: `Le vote pour "${sujet}" a commencé !`,
            ephemeral: true,
        });
    }

    /**
     * Calcule les points d'un membre en fonction de ses rôles.
     * Bot owner (koyorin) → max possible parmi STAFF_ROLES (= rang Owner par défaut)
     * pour qu'il puisse voter sur n'importe quoi avec le poids maximal.
     */
    getUserPoints(member) {
        if (member && member.id && isBotOwner(member.id)) {
            let max = 0;
            for (const v of Object.values(this.rolesPoints)) {
                if (typeof v === 'number' && v > max) max = v;
            }
            return Math.max(max, 1);
        }

        let points = 0;
        member.roles.cache.forEach(role => {
            const rolePoints = this.rolesPoints[role.id];
            if (rolePoints !== undefined && rolePoints > points) {
                points = rolePoints;
            }
        });
        return points;
    }

    /**
     * Vérifie si un ban date de moins de 3 mois.
     * @param {string} banDateString Date saisie par l'utilisateur (format FR ou ISO)
     * @returns {{ ok: boolean, banDate: Date|null, tooRecent: boolean }}
     *   - ok: true si la date a pu être parsée
     *   - tooRecent: true si le ban date de moins de 3 mois
     */
    parseAndCheckBanDate(banDateString) {
        const banDate = parseBanDate(banDateString);
        if (!banDate) return { ok: false, banDate: null, tooRecent: false };
        const timeSinceBan = Date.now() - banDate.getTime();
        return { ok: true, banDate, tooRecent: timeSinceBan < BAN_WAIT_MS };
    }

    /**
     * @deprecated Utiliser parseAndCheckBanDate qui renvoie la date parsée ET l'info d'erreur.
     */
    isBanLessThan3Months(banDateString) {
        const { ok, tooRecent } = this.parseAndCheckBanDate(banDateString);
        if (!ok) return false; // compat legacy : date invalide → pas "trop récent"
        return tooRecent;
    }

    /**
     * Construit les composants (embed + row) d'un vote de débannissement.
     * Factorisé pour être réutilisé par startDebanVote et processPendingDebanRequests.
     */
    _buildDebanVoteComponents(userData, reportContent, targetChannel, extraField = null) {
        const embed = new EmbedBuilder()
            .setTitle(`Demande de débannissement pour ${userData.discordUsername}`)
            .setDescription(reportContent)
            .addFields(
                { name: 'Oui', value: '0', inline: true },
                { name: 'Non', value: '0', inline: true }
            )
            .setColor('#FFD700');
        if (extraField) embed.addFields(extraField);

        const botMember = targetChannel.guild?.members?.me;
        const canEnd = botMember
            ? targetChannel.permissionsFor(botMember)?.has(PermissionsBitField.Flags.Administrator)
            : false;

        const row = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId(`deban_vote_oui_${userData.discordId}`)
                    .setLabel('Oui')
                    .setStyle(ButtonStyle.Success),
                new ButtonBuilder()
                    .setCustomId(`deban_vote_non_${userData.discordId}`)
                    .setLabel('Non')
                    .setStyle(ButtonStyle.Danger),
                new ButtonBuilder()
                    .setCustomId(`fin_deban_vote_${userData.discordId}`)
                    .setLabel('Fin du Vote')
                    .setStyle(ButtonStyle.Secondary)
                    .setDisabled(!canEnd)
            );

        return { embed, row };
    }

    /**
     * Démarre un vote de débannissement ou le met en attente
     */
    async startDebanVote(client, interaction, userData, reportContent, channelId, mentionRoleId) {
        const targetChannel = await client.channels.fetch(channelId).catch(() => null);
        const isForumChannel = targetChannel?.type === ChannelType.GuildForum;
        if (!targetChannel || (!isForumChannel && !targetChannel.isTextBased?.())) {
            console.error(`[Deban] Salon de vote introuvable ou type non supporté (${channelId}).`);
            await interaction.followUp({
                content: '❌ Votre demande a été reçue, mais le vote n\'a pas pu être lancé (salon de vote introuvable). Contactez un administrateur.',
                ephemeral: true
            });
            return { success: false, pending: false };
        }

        const whenBanned = reportContent.match(/- \*\*Date :\*\* (.+)\n/)?.[1] || userData.whenBanned;
        const banCheck = this.parseAndCheckBanDate(whenBanned);

        if (!banCheck.ok) {
            // Date non parsable : on refuse proprement côté formulaire plutôt que d'ignorer silencieusement.
            await interaction.followUp({
                content: `❌ La date de ban fournie (\`${whenBanned}\`) est invalide. Formats acceptés : **JJ/MM/AAAA** (ex : 15/08/2022) ou **AAAA-MM-JJ**. Relancez le formulaire.`,
                ephemeral: true
            });
            return { success: false, pending: false };
        }

        if (banCheck.tooRecent) {
            const eligibilityDate = new Date(banCheck.banDate.getTime() + BAN_WAIT_MS);

            this.pendingDebanRequests[userData.discordId] = {
                userData,
                reportContent,
                banDate: banCheck.banDate.toISOString(),
                banDateRaw: whenBanned,
                submittedAt: new Date().toISOString(),
                eligibilityDate: eligibilityDate.toISOString(),
                channelId,
                mentionRoleId,
                forumMode: isForumChannel,
                status: 'pending'
            };
            this.savePendingDebanRequests();

            const ts = Math.floor(eligibilityDate.getTime() / 1000);
            await interaction.followUp({
                content: `⏳ Votre demande de débannissement a été **mise en attente** car votre ban date de moins de 3 mois.\n\n📅 Elle sera automatiquement soumise au vote : <t:${ts}:F> (<t:${ts}:R>)\n\nVous n'avez rien à faire, vous serez averti automatiquement.`,
                ephemeral: true
            });
            this.activeDebanRequests.add(userData.discordId);
            return { success: true, pending: true, eligibilityDate };
        }

        this.debanVotes[userData.discordId] = {
            oui: 0,
            non: 0,
            voters: {},
            messageId: null,
            channelId: channelId,
            originalUserId: userData.discordId,
            createdAt: new Date().toISOString(),
            forumMode: Boolean(isForumChannel),
            threadId: null,
        };
        this.saveDebanVotes();

        let sentMessage;
        if (isForumChannel) {
            const testGuildId = findTestGuildIdByForumChannelId(targetChannel.id);
            if (!testGuildId) {
                delete this.debanVotes[userData.discordId];
                this.saveDebanVotes();
                await interaction.followUp({
                    content:
                        '❌ Ce salon forum n\'est pas enregistré pour les votes deban. Un admin doit créer le forum avec `/panel-deban-test` sur le **serveur principal** (ou test), puis cibler ce forum dans `/panel-deban`.',
                    ephemeral: true,
                });
                return { success: false, pending: false };
            }
            try {
                const { thread, starterMessage } = await createDebanPost(
                    client,
                    testGuildId,
                    userData,
                    reportContent,
                    mentionRoleId
                );
                sentMessage = starterMessage || (await thread.fetchStarterMessage().catch(() => null));
                if (!sentMessage) {
                    throw new Error('Starter message introuvable après création du post forum.');
                }
                this.debanVotes[userData.discordId].messageId = sentMessage.id;
                this.debanVotes[userData.discordId].threadId = thread.id;
                this.saveDebanVotes();
            } catch (forumErr) {
                console.error('[Deban] Erreur création post forum:', forumErr);
                delete this.debanVotes[userData.discordId];
                this.saveDebanVotes();
                await interaction.followUp({
                    content: `❌ Impossible de créer le post forum : ${forumErr?.message || forumErr}`,
                    ephemeral: true,
                });
                return { success: false, pending: false };
            }
        } else {
            const { embed, row } = this._buildDebanVoteComponents(userData, reportContent, targetChannel);
            sentMessage = await targetChannel.send({
                content: `<@&${mentionRoleId}> Nouvelle demande de débannissement !`,
                embeds: [embed],
                components: [row],
            });
            this.debanVotes[userData.discordId].messageId = sentMessage.id;
            this.saveDebanVotes();
        }

        this.activeDebanRequests.add(userData.discordId);

        await interaction.followUp({
            content: '✅ Votre demande de débannissement a été envoyée et un vote a été lancé. Vous serez averti en privé dès que le résultat tombera.',
            ephemeral: true
        });
        return { success: true, pending: false, messageId: sentMessage.id };
    }

    /**
     * Traite les demandes de débannissement en attente dont la date d'éligibilité est atteinte.
     * Appelé périodiquement par le scheduler (cron).
     * @param {import('discord.js').Client} client
     * @returns {Promise<number>} Nombre de demandes traitées
     */
    async processPendingDebanRequests(client) {
        if (!client) return 0;
        const now = Date.now();
        const eligibleIds = Object.keys(this.pendingDebanRequests || {}).filter(uid => {
            const req = this.pendingDebanRequests[uid];
            const eligibleAt = new Date(req?.eligibilityDate || 0).getTime();
            return Number.isFinite(eligibleAt) && eligibleAt <= now;
        });

        if (eligibleIds.length === 0) return 0;

        let processed = 0;
        for (const uid of eligibleIds) {
            const req = this.pendingDebanRequests[uid];
            try {
                const channelId = req.channelId || CONFIG.DEBAN_CHANNEL_ID;
                const mentionRoleId = req.mentionRoleId
                    || (CONFIG.STAFF_ROLES.find(r => r.name === 'Staff')?.id || '1172237685763608579');

                const targetChannel = await client.channels.fetch(channelId).catch(() => null);
                const isForumChannel = targetChannel?.type === ChannelType.GuildForum;
                if (!targetChannel || (!isForumChannel && !targetChannel.isTextBased?.())) {
                    console.error(`[Deban] processPending : salon ${channelId} introuvable ou type non supporté, on conserve la demande.`);
                    continue;
                }

                // Si un vote existe déjà pour ce user (bug / relance), on skip.
                if (this.debanVotes[uid]) {
                    console.warn(`[Deban] processPending : un vote existe déjà pour ${uid}, suppression de la pending.`);
                    delete this.pendingDebanRequests[uid];
                    this.savePendingDebanRequests();
                    continue;
                }

                this.debanVotes[uid] = {
                    oui: 0,
                    non: 0,
                    voters: {},
                    messageId: null,
                    channelId,
                    originalUserId: uid,
                    createdAt: new Date().toISOString(),
                    fromPending: true,
                    forumMode: Boolean(isForumChannel || req.forumMode),
                    threadId: null,
                };
                this.saveDebanVotes();

                let sent;
                if (isForumChannel || req.forumMode) {
                    const testGuildId = findTestGuildIdByForumChannelId(channelId);
                    if (!testGuildId) {
                        delete this.debanVotes[uid];
                        this.saveDebanVotes();
                        console.error(`[Deban] processPending : forum ${channelId} sans config test, skip ${uid}.`);
                        continue;
                    }
                    const reportWithPending = `${req.reportContent}\n\n**⏳ Statut**\nMise en attente expirée — vote automatique lancé.`;
                    try {
                        const { thread, starterMessage } = await createDebanPost(
                            client,
                            testGuildId,
                            req.userData,
                            reportWithPending,
                            mentionRoleId
                        );
                        sent = starterMessage || (await thread.fetchStarterMessage().catch(() => null));
                        if (!sent) {
                            throw new Error('Starter message forum introuvable');
                        }
                        this.debanVotes[uid].messageId = sent.id;
                        this.debanVotes[uid].threadId = thread.id;
                        this.saveDebanVotes();
                    } catch (e) {
                        delete this.debanVotes[uid];
                        this.saveDebanVotes();
                        console.error(`[Deban] processPending : échec forum pour ${uid}:`, e?.message || e);
                        continue;
                    }
                } else {
                    const { embed, row } = this._buildDebanVoteComponents(
                        req.userData,
                        req.reportContent,
                        targetChannel,
                        { name: '⏳ Statut', value: 'Mise en attente expirée — vote automatique lancé.', inline: false }
                    );
                    sent = await targetChannel.send({
                        content: `<@&${mentionRoleId}> Demande de débannissement — délai d'attente écoulé, vote automatique !`,
                        embeds: [embed],
                        components: [row],
                    });
                    this.debanVotes[uid].messageId = sent.id;
                    this.saveDebanVotes();
                }

                delete this.pendingDebanRequests[uid];
                this.savePendingDebanRequests();
                this.activeDebanRequests.add(uid);

                // Notifier le user en DM
                try {
                    const user = await client.users.fetch(uid);
                    await user.send(
                        `🗳️ Votre demande de débannissement mise en attente est maintenant **soumise au vote du staff**. Vous serez averti du résultat.`
                    ).catch(() => null);
                } catch { /* user introuvable ou DM fermés */ }

                processed++;
            } catch (err) {
                console.error(`[Deban] processPending : erreur sur ${uid}:`, err?.message || err);
            }
        }

        return processed;
    }
}

module.exports = VoteManager;
