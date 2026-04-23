const fs = require('fs');
const path = require('path');
const { EmbedBuilder, ButtonBuilder, ActionRowBuilder, ButtonStyle, PermissionsBitField } = require('discord.js');
const CONFIG = require('../config.js');

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
     * Calcule les points d'un membre en fonction de ses rôles
     */
    getUserPoints(member) {
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
     * Vérifie si un ban date de moins de 3 mois
     */
    isBanLessThan3Months(banDateString) {
        const banDate = new Date(banDateString);
        const now = new Date();
        const threeMonthsInMs = 3 * 30 * 24 * 60 * 60 * 1000;

        if (isNaN(banDate.getTime())) {
            console.warn(`Date de ban invalide pour: ${banDateString}`);
            return false;
        }

        const timeSinceBan = now - banDate;
        return timeSinceBan < threeMonthsInMs;
    }

    /**
     * Démarre un vote de débannissement ou le met en attente
     */
    async startDebanVote(client, interaction, userData, reportContent, channelId, mentionRoleId) {
        const targetChannel = await client.channels.fetch(channelId);
        if (!targetChannel) {
            console.error(`Le salon de débannissement avec l'ID ${channelId} est introuvable.`);
            await interaction.followUp({
                content: 'Votre demande a été soumise, mais le vote n\'a pas pu être lancé (salon introuvable).',
                ephemeral: true
            });
            return;
        }

        const whenBanned = reportContent.match(/- \*\*Date :\*\* (.+)\n/)?.[1] || userData.whenBanned;

        if (this.isBanLessThan3Months(whenBanned)) {
            const threeMonthsInMs = 3 * 30 * 24 * 60 * 60 * 1000;
            const banDate = new Date(whenBanned);
            const eligibilityDate = new Date(banDate.getTime() + threeMonthsInMs);

            this.pendingDebanRequests[userData.discordId] = {
                userData,
                reportContent,
                banDate: whenBanned,
                submittedAt: new Date().toISOString(),
                eligibilityDate: eligibilityDate.toISOString(),
                status: 'pending'
            };
            this.savePendingDebanRequests();

            await interaction.followUp({
                content: `⏳ Votre demande de débannissement a été mise en attente car votre ban date de moins de 3 mois.\n\nVotre demande sera automatiquement soumise au vote le : **${eligibilityDate.toLocaleDateString('fr-FR')}**\n\nVeuillez patienter jusqu'à cette date.`,
                ephemeral: true
            });
            this.activeDebanRequests.add(userData.discordId);
            return;
        }

        const embed = new EmbedBuilder()
            .setTitle(`Demande de débannissement pour ${userData.discordUsername}`)
            .setDescription(reportContent)
            .addFields(
                { name: 'Oui', value: '0', inline: true },
                { name: 'Non', value: '0', inline: true }
            )
            .setColor('#FFD700');

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
                    .setDisabled(!targetChannel.permissionsFor(targetChannel.guild.members.me).has(PermissionsBitField.Flags.Administrator))
            );

        this.debanVotes[userData.discordId] = {
            oui: 0,
            non: 0,
            voters: {},
            messageId: null,
            channelId: channelId,
            originalUserId: userData.discordId,
        };
        this.saveDebanVotes();

        const sentMessage = await targetChannel.send({
            content: `<@&${mentionRoleId}> Nouvelle demande de débannissement !`,
            embeds: [embed],
            components: [row]
        });

        this.debanVotes[userData.discordId].messageId = sentMessage.id;
        this.saveDebanVotes();
        this.activeDebanRequests.add(userData.discordId);

        await interaction.followUp({
            content: 'Votre demande de débannissement a été envoyée avec succès et un vote a été lancé !',
            ephemeral: true
        });
    }
}

module.exports = VoteManager;
