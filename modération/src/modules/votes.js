const fs = require('fs');
const path = require('path');
const { EmbedBuilder, ButtonBuilder, ActionRowBuilder, ButtonStyle, PermissionsBitField } = require('discord.js');
const CONFIG = require('../config.js');

const _V_COMPACT = process.env.BLZ_COMPACT_LOG === '1';

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

        // Données temporaires
        this.modoTestData = {};
        this.activeDebanRequests = new Set();
        this.formData = new Map();
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
