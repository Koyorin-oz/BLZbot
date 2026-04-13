const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const CONFIG = require('../config.js');
const { getModeratorTitleWithArticle } = require('../utils/helpers.js');
const { resolveModerationSanctionLogChannelId } = require('../utils/log-channel-resolve');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('warn')
        .setDescription('Avertir un utilisateur.')
        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
        .addUserOption(option =>
            option.setName('utilisateur')
                .setDescription('L\'utilisateur à avertir')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('regle')
                .setDescription('Règle du règlement (commencez à taper pour voir les règles)')
                .setRequired(true)
                .setAutocomplete(true))
        .addStringOption(option =>
            option.setName('raison')
                .setDescription('Raison personnalisée de l\'avertissement')
                .setRequired(true))
        .toJSON(),

    async autocomplete(interaction, { dbManager }) {
        const focusedOption = interaction.options.getFocused(true);

        // Autocomplete uniquement pour l'option 'regle'
        if (focusedOption.name !== 'regle') {
            return interaction.respond([]);
        }

        const focusedValue = focusedOption.value.toLowerCase();
        const dbRules = dbManager.getRulesDb();

        // Récupérer toutes les règles depuis tous les règlements
        dbRules.all('SELECT rules FROM reglements', [], (err, rows) => {
            if (err) {
                console.error('Erreur autocomplete règles:', err);
                return interaction.respond([]);
            }

            // Extraire toutes les règles de tous les règlements
            const allRules = [];
            for (const row of rows) {
                try {
                    const rules = JSON.parse(row.rules || '[]');
                    for (const rule of rules) {
                        if (!allRules.find(r => r.title === rule.title)) {
                            allRules.push(rule);
                        }
                    }
                } catch (e) {
                    console.error('Erreur parsing règles:', e);
                }
            }

            // Filtrer et répondre
            const filtered = allRules
                .filter(rule => rule.title.toLowerCase().includes(focusedValue))
                .slice(0, 25)
                .map(rule => ({
                    name: rule.title.length > 100 ? rule.title.substring(0, 97) + '...' : rule.title,
                    value: rule.title
                }));

            interaction.respond(filtered);
        });
    },

    async execute(interaction, { dbManager, client }) {
        if (!interaction.member.permissions.has(PermissionFlagsBits.ModerateMembers)) {
            return interaction.reply({
                content: '❌ Vous n\'avez pas la permission d\'utiliser cette commande.',
                ephemeral: true
            });
        }

        const user = interaction.options.getUser('utilisateur');
        const regle = interaction.options.getString('regle');
        const raison = interaction.options.getString('raison');
        const moderator = interaction.member;

        // Empêcher l'auto-warn
        if (user.id === moderator.id) {
            return interaction.reply({
                content: '❌ Vous ne pouvez pas vous avertir vous-même.',
                ephemeral: true
            });
        }

        // Vérifier la hiérarchie des rôles
        const targetMember = await interaction.guild.members.fetch(user.id).catch(() => null);
        if (!targetMember) {
            return interaction.reply({
                content: '❌ Membre introuvable sur le serveur.',
                ephemeral: true
            });
        }

        if (targetMember.roles.highest.position >= moderator.roles.highest.position) {
            return interaction.reply({
                content: '❌ Vous ne pouvez pas avertir quelqu\'un ayant un rôle égal ou supérieur au vôtre.',
                ephemeral: true
            });
        }

        // Construire la raison finale
        let finalReason = '';
        if (regle && raison) {
            finalReason = `${regle} - ${raison}`;
        } else if (regle) {
            finalReason = regle;
        } else if (raison) {
            finalReason = raison;
        } else {
            return interaction.reply({
                content: '❌ Vous devez fournir au moins une règle ou une raison.',
                ephemeral: true
            });
        }

        const dbSanctions = dbManager.getSanctionsDb();

        // Les règles viennent maintenant des règlements (pas besoin de vérifier dans la table rules)
        try {
            const expires_at = Date.now() + 60 * 24 * 60 * 60 * 1000; // 60 jours

            dbSanctions.run(
                'INSERT INTO sanctions (userId, type, reason, moderatorId, date, expires_at, rule_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
                [user.id, 'Warn', finalReason, moderator.id, Date.now(), expires_at, null],
                function (err) {
                    if (err) {
                        return interaction.reply({
                            content: '❌ Erreur lors de l\'ajout du warn.',
                            ephemeral: true
                        });
                    }
                    const sanctionId = this.lastID;

                    interaction.reply({
                        content: `✅ ${user.tag} a été averti pour la raison : ${finalReason}.`,
                        ephemeral: true
                    });

                    // Vérifier le nombre de warns (exclure les warns expirés)
                    dbSanctions.all(
                        'SELECT id FROM sanctions WHERE userId = ? AND type = \'Warn\' AND active = 1 AND (expires_at IS NULL OR expires_at > ?)',
                        [user.id, Date.now()],
                        async (err, rows) => {
                            if (err) return;

                            const warnCount = rows.length;
                            const warnText = warnCount > 1 ? 'warns' : 'warn';

                            // Obtenir le titre du modérateur avec l'article approprié
                            const moderatorTitleWithArticle = getModeratorTitleWithArticle(moderator);

                            // Envoyer un message dans le canal de logs
                            const logsChannel = interaction.guild.channels.cache.get(CONFIG.LOGS_CHANNEL_ID);
                            if (logsChannel && logsChannel.isTextBased()) {
                                const sentMessage = await logsChannel.send(`# ${user.tag} (${user.id}) a été warn pour la raison : "${finalReason}" par ${moderatorTitleWithArticle} <@${moderator.id}>\n-# Il est à ${warnCount} ${warnText}`);

                                // Mettre à jour la sanction avec l'ID du message de log
                                if (sentMessage) {
                                    dbSanctions.run(
                                        'UPDATE sanctions SET log_message_id = ?, log_channel_id = ? WHERE id = ?',
                                        [sentMessage.id, sentMessage.channel.id, sanctionId]
                                    );
                                }
                            }

                            const member = await interaction.guild.members.fetch(user.id).catch(() => null);
                            if (!member) return;

                            // Vérifier la hiérarchie pour les sanctions automatiques
                            if (member.roles.highest.position >= interaction.guild.members.me.roles.highest.position) {
                                console.warn(`Impossible de sanctionner ${user.tag} automatiquement - Position hiérarchique supérieure au bot`);
                                if (logsChannel && logsChannel.isTextBased()) {
                                    await logsChannel.send(`⚠️ ${user.tag} a atteint ${warnCount} warns mais je ne peux pas appliquer la sanction automatique car il est au-dessus de moi dans la hiérarchie.`);
                                }
                                return;
                            }

                            // Attribution du rôle Suspect à partir de 3 warns
                            if (warnCount >= 3) {
                                try {
                                    if (CONFIG.SUSPECT_ROLE_ID && CONFIG.SUSPECT_ROLE_ID !== '1437859473497653348') { // Vérifier si configuré (différent du placeholder si nécessaire, ou juste s'il existe)
                                        // Note: J'utilise l'ID tel quel, assurez-vous qu'il est bon dans config.js
                                        await member.roles.add(CONFIG.SUSPECT_ROLE_ID);
                                        if (logsChannel && logsChannel.isTextBased()) {
                                            // On ne spam pas le log si le rôle est déjà là, mais roles.add ne fait rien si déjà présent.
                                            // On peut ajouter une petite note dans le log.
                                        }
                                    }
                                } catch (err) {
                                    console.error('Erreur ajout rôle suspect:', err);
                                }
                            }

                            if (warnCount === 5) {
                                // Ban définitif automatique au 5ème warn
                                try {
                                    await member.ban({ reason: '5ème avertissement - Ban définitif.' });
                                    dbSanctions.run(
                                        'INSERT INTO sanctions (userId, type, reason, moderatorId, date) VALUES (?, ?, ?, ?, ?)',
                                        [user.id, 'Ban', '5ème avertissement - Ban définitif.', client.user.id, Date.now()]
                                    );
                                    if (logsChannel && logsChannel.isTextBased()) {
                                        await logsChannel.send(`# ⚠️ ${user.tag} a été banni définitivement car il a atteint 5 avertissements.\n-# Sanction automatique - Il était à ${warnCount} ${warnText}`);
                                    }
                                } catch (error) {
                                    console.error('Erreur lors du ban automatique:', error);
                                    if (logsChannel && logsChannel.isTextBased()) {
                                        await logsChannel.send(`❌ Erreur lors du ban automatique de ${user.tag} (5 warns)`);
                                    }
                                }
                            } else if (warnCount === 4 || warnCount === 3) {
                                // Mute automatique
                                const duration = warnCount === 4 ? 7 * 24 * 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
                                const durationText = warnCount === 4 ? '1 semaine' : '1 jour';
                                const warnLevel = warnCount === 4 ? '4ème' : '3ème';

                                try {
                                    // Retirer les rôles admin temporairement
                                    const dbTempRemovedRoles = dbManager.getTempRemovedRolesDb();
                                    const adminRoles = member.roles.cache.filter(role =>
                                        role.permissions.has(PermissionFlagsBits.Administrator)
                                    );

                                    const expires_at = Date.now() + duration;
                                    for (const role of adminRoles.values()) {
                                        await member.roles.remove(role, `Retrait temporaire pour mute automatique (${warnLevel} warn)`);
                                        dbTempRemovedRoles.run(
                                            'INSERT INTO temp_removed_roles (userId, roleId, expires_at) VALUES (?, ?, ?)',
                                            [member.id, role.id, expires_at]
                                        );
                                    }

                                    // Appliquer le timeout
                                    await member.timeout(duration, `${warnLevel} avertissement - Mute automatique ${durationText}.`);
                                    dbSanctions.run(
                                        'INSERT INTO sanctions (userId, type, reason, moderatorId, duration, date) VALUES (?, ?, ?, ?, ?, ?)',
                                        [user.id, 'Time Out', `${warnLevel} avertissement - Mute automatique ${durationText}.`, client.user.id, durationText, Date.now()]
                                    );
                                    if (logsChannel && logsChannel.isTextBased()) {
                                        await logsChannel.send(`# ⚠️ ${user.tag} a été mute pendant ${durationText} car il a atteint ${warnCount} avertissements.\n-# Sanction automatique - Il est à ${warnCount} ${warnText}`);
                                        if (warnCount === 3) {
                                            await logsChannel.send(`-# Le rôle Suspect a été attribué.`);
                                        }
                                    }
                                } catch (error) {
                                    console.error(`Erreur lors du mute automatique (${warnLevel} warn):`, error);
                                    if (logsChannel && logsChannel.isTextBased()) {
                                        await logsChannel.send(`❌ Erreur lors du mute automatique de ${user.tag} (${warnCount} warns): ${error.message}`);
                                    }
                                }
                            }
                        }
                    );
                }
            );
        } catch (error) {
            console.error('Erreur lors de l\'ajout du warn:', error);
            await interaction.reply({
                content: '❌ Une erreur est survenue lors de l\'ajout du warn.',
                ephemeral: true
            });
        }
    }
};
