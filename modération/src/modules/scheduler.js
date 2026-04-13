const { EmbedBuilder, ButtonBuilder, ActionRowBuilder, ButtonStyle } = require('discord.js');
const CONFIG = require('../config.js');

/**
 * Module de planification pour les tâches automatiques
 * - Vote automatique après 21 jours de modo test
 * - Refresh des chances tous les 6/12 mois
 */
class Scheduler {
    constructor(client, voteManager, dbManager) {
        this.client = client;
        this.voteManager = voteManager;
        this.dbManager = dbManager;
        this.checkInterval = 60 * 60 * 1000; // Vérifier toutes les heures

        this.startScheduler();
    }

    startScheduler() {
        if (process.env.BLZ_COMPACT_LOG !== '1') {
            console.log('📅 Scheduler démarré - Vérifications automatiques activées');
        }

        // Vérification initiale
        this.checkModoTestPeriods();
        this.checkChancesRefresh();
        this.checkPendingDeletions();

        // Vérifications périodiques
        setInterval(() => {
            this.checkModoTestPeriods();
            this.checkChancesRefresh();
            this.checkPendingDeletions();
        }, this.checkInterval);
    }

    /**
     * Vérifie et exécute les suppressions de sanctions programmées
     */
    async checkPendingDeletions() {
        const sanctionsDb = this.dbManager.getSanctionsDb();
        if (!sanctionsDb) return;

        const now = Date.now();

        sanctionsDb.all(
            `SELECT id, deletionReason, deletionModeratorId FROM sanctions WHERE pendingDeletion = 1 AND deletionDate <= ?`,
            [now],
            (err, rows) => {
                if (err) {
                    console.error('Erreur vérification suppressions sanctions:', err);
                    return;
                }

                if (!rows || rows.length === 0) return;

                sanctionsDb.serialize(() => {
                    sanctionsDb.run('BEGIN TRANSACTION;');
                    rows.forEach(row => {
                        sanctionsDb.run('DELETE FROM sanctions WHERE id = ?', [row.id], (delErr) => {
                            if (!delErr) {
                                console.log(`🗑️ Sanction #${row.id} supprimée automatiquement (Raison: ${row.deletionReason})`);
                            }
                        });
                    });
                    sanctionsDb.run('COMMIT;', (commitErr) => {
                        if (commitErr) console.error('Erreur commit suppression sanctions:', commitErr);
                    });
                });
            }
        );
    }

    /**
     * Vérifie les périodes de modo test terminées et crée automatiquement les votes
     */
    async checkModoTestPeriods() {
        const staffProfileDb = this.dbManager.getStaffProfileDb();
        if (!staffProfileDb) return;

        const now = Date.now();

        staffProfileDb.all(
            `SELECT * FROM modo_test_periods WHERE status = 'en_cours' AND end_date <= ?`,
            [now],
            async (err, periods) => {
                if (err) {
                    console.error('Erreur vérification modo test periods:', err);
                    return;
                }

                if (!periods || periods.length === 0) return;

                console.log(`🎓 ${periods.length} modo test(s) terminé(s) détecté(s)`);

                for (const period of periods) {
                    await this.createModoTestVote(period);
                }
            }
        );
    }

    /**
     * Crée automatiquement un vote de promotion modo_test_to_modo
     */
    async createModoTestVote(period) {
        try {
            // IMPORTANT: Marquer immédiatement la période comme "vote_en_cours" 
            // AVANT de créer le vote pour éviter les répétitions
            const staffProfileDb = this.dbManager.getStaffProfileDb();
            staffProfileDb.run(
                `UPDATE modo_test_periods SET status = 'vote_en_cours' WHERE id = ?`,
                [period.id],
                (err) => {
                    if (err) console.error('Erreur mise à jour statut modo test:', err);
                }
            );

            const guild = await this.client.guilds.fetch(CONFIG.GUILD_ID);
            const member = await guild.members.fetch(period.userId).catch(() => null);

            if (!member) {
                console.log(`Membre ${period.userId} non trouvé pour vote modo test`);
                // Marquer comme annulé si le membre n'existe plus
                staffProfileDb.run(
                    `UPDATE modo_test_periods SET status = 'annule', result = 'membre_introuvable' WHERE id = ?`,
                    [period.id]
                );
                return;
            }

            // Vérifier si le vote n'existe pas déjà
            if (this.voteManager.votes[period.userId]) {
                console.log(`Vote déjà en cours pour ${period.userId}`);
                return;
            }

            const recruitmentChannel = await this.client.channels.fetch(CONFIG.RECRUITMENT_CHANNEL_ID);
            if (!recruitmentChannel) {
                console.error('Canal de recrutement introuvable');
                return;
            }

            const embed = new EmbedBuilder()
                .setTitle(`🎓 Vote de Promotion: Modérateur Test → Modérateur`)
                .setDescription(`<@${period.userId}> a terminé sa période de modo test (21 jours).\nVotez pour sa promotion au rang de Modérateur permanent !`)
                .addFields(
                    { name: '✅ Pour', value: '0', inline: true },
                    { name: '❌ Contre', value: '0', inline: true }
                )
                .setColor('#5E81F4')
                .setTimestamp()
                .setThumbnail(member.user.displayAvatarURL());

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('vote_oui')
                    .setLabel('✅ Pour')
                    .setStyle(ButtonStyle.Success),
                new ButtonBuilder()
                    .setCustomId('vote_non')
                    .setLabel('❌ Contre')
                    .setStyle(ButtonStyle.Danger),
                new ButtonBuilder()
                    .setCustomId('fin_vote')
                    .setLabel('🏁 Terminer le vote')
                    .setStyle(ButtonStyle.Primary)
            );

            const voteMessage = await recruitmentChannel.send({
                content: `@here Fin de la période de modo test pour <@${period.userId}> !`,
                embeds: [embed],
                components: [row]
            });

            // Enregistrer le vote avec timer de 24h
            const startTime = Date.now();
            const endTime = startTime + (24 * 60 * 60 * 1000); // 24 heures

            this.voteManager.votes[period.userId] = {
                messageId: voteMessage.id,
                channelId: recruitmentChannel.id,
                oui: 0,
                non: 0,
                voters: {},
                type: 'modo_test_to_modo',
                startTime: startTime,
                endTime: endTime
            };
            this.voteManager.saveVotes();

            console.log(`✅ Vote modo_test_to_modo créé pour ${member.user.tag}`);

            // Timer fin automatique après 24h
            setTimeout(async () => {
                try {
                    const channel = await this.client.channels.fetch(recruitmentChannel.id);
                    const message = await channel.messages.fetch(voteMessage.id);

                    if (this.voteManager.votes[period.userId]) {
                        // Utiliser la fonction de terminaison de vote programmée
                        const { endVoteProgrammatically } = require('../events/buttonInteraction');
                        await endVoteProgrammatically(message, channel.guild, this.voteManager, period.userId);
                    }
                } catch (error) {
                    console.error('Erreur fin automatique vote modo test:', error);
                }
            }, 24 * 60 * 60 * 1000);

            // Rappel 2h avant la fin
            setTimeout(async () => {
                try {
                    const pingStaffRole = CONFIG.STAFF_ROLES.find(r => r.name === 'PingStaff')?.id;
                    if (pingStaffRole) {
                        await recruitmentChannel.send({
                            content: `<@&${pingStaffRole}> ⏰ **Rappel**: Il reste 2 heures pour voter sur la promotion de <@${period.userId}> (Modo Test → Modérateur) !`
                        });
                    }
                } catch (error) {
                    console.error('Erreur envoi rappel vote modo test:', error);
                }
            }, 22 * 60 * 60 * 1000);

        } catch (error) {
            console.error('Erreur création vote modo test:', error);
        }
    }

    /**
     * Vérifie et refresh les chances tous les 6/12 mois
     */
    async checkChancesRefresh() {
        const staffProfileDb = this.dbManager.getStaffProfileDb();
        if (!staffProfileDb) return;

        const now = Date.now();
        const sixMonthsInMs = 6 * 30 * 24 * 60 * 60 * 1000; // ~6 mois
        const twelveMonthsInMs = 12 * 30 * 24 * 60 * 60 * 1000; // ~12 mois

        staffProfileDb.all(
            'SELECT * FROM staff_chances',
            [],
            async (err, chances) => {
                if (err) {
                    console.error('Erreur vérification chances:', err);
                    return;
                }

                if (!chances) return;

                for (const userChances of chances) {
                    let updated = false;

                    // Refresh candidature (6 mois)
                    if (userChances.candidature_chances < 2) {
                        const lastRefresh = userChances.last_candidature_refresh || 0;
                        if (now - lastRefresh >= sixMonthsInMs) {
                            staffProfileDb.run(
                                'UPDATE staff_chances SET candidature_chances = candidature_chances + 1, last_candidature_refresh = ? WHERE userId = ?',
                                [now, userChances.userId],
                                (err) => {
                                    if (!err) {
                                        console.log(`✅ +1 chance candidature pour ${userChances.userId}`);
                                    }
                                }
                            );
                            updated = true;
                        }
                    }

                    // Refresh modo test (12 mois)
                    if (userChances.modo_test_chances < 1) {
                        const lastRefresh = userChances.last_modo_test_refresh || 0;
                        if (now - lastRefresh >= twelveMonthsInMs) {
                            staffProfileDb.run(
                                'UPDATE staff_chances SET modo_test_chances = modo_test_chances + 1, last_modo_test_refresh = ? WHERE userId = ?',
                                [now, userChances.userId],
                                (err) => {
                                    if (!err) {
                                        console.log(`✅ +1 chance modo test pour ${userChances.userId}`);
                                    }
                                }
                            );
                            updated = true;
                        }
                    }
                }
            }
        );
    }
}

module.exports = Scheduler;
