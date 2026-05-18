const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const { parseDuration, msToReadableTime, getModeratorTitleWithArticle } = require('../utils/helpers');
const { deferEphemeral } = require('../utils/interaction-ack');
const CONFIG = require('../config.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('mute')
        .setDescription('Rendre un membre muet avec une durée et une raison spécifiques.')
        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
        .addUserOption(option =>
            option.setName('utilisateur')
                .setDescription('Le membre à rendre muet')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('temps')
                .setDescription('Durée du mute (ex: 10m, 2h, 1j, 3w)')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('raison')
                .setDescription('Raison personnalisée du mute')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('regle')
                .setDescription('Règle enfreinte (commencez à taper pour voir les règles)')
                .setRequired(true)
                .setAutocomplete(true))
        .addBooleanOption(option =>
            option.setName('warn')
                .setDescription('Donner également un avertissement à l\'utilisateur')
                .setRequired(true))
        .addAttachmentOption(option =>
            option.setName('preuve')
                .setDescription('Preuve (uniquement des captures d\'écran)')
                .setRequired(false))
        .addBooleanOption(option =>
            option.setName('spoiler')
                .setDescription('Mettre la preuve en spoiler (pour contenu sensible)')
                .setRequired(false))
        .toJSON(),

    async autocomplete(interaction, { dbManager }) {
        const focusedValue = interaction.options.getFocused().toLowerCase();
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

    async execute(interaction, { dbManager, config }) {
        if (!interaction.member.permissions.has(PermissionFlagsBits.ModerateMembers)) {
            if (!interaction.deferred && !interaction.replied) {
                return interaction.reply({
                    content: '❌ Vous n\'avez pas l\'autorisation d\'utiliser cette commande.',
                    flags: 64,
                });
            }
            return interaction.editReply({
                content: '❌ Vous n\'avez pas l\'autorisation d\'utiliser cette commande.',
            });
        }

        if (!(await deferEphemeral(interaction))) return;

        const utilisateur = interaction.options.getUser('utilisateur');
        const temps = interaction.options.getString('temps');
        const raison = interaction.options.getString('raison');
        const regle = interaction.options.getString('regle');
        const shouldWarn = interaction.options.getBoolean('warn');
        const preuve = interaction.options.getAttachment('preuve');
        const spoiler = interaction.options.getBoolean('spoiler') || false;
        const modérateur = interaction.member;

        const duréeMs = parseDuration(temps);
        if (!duréeMs) {
            return interaction.editReply({
                content: '❌ Le format du temps est invalide. Utilisez par exemple 10m, 2h, 1j, 3w.'
            });
        }

        const maxDurationMs = 28 * 24 * 60 * 60 * 1000;
        if (duréeMs > maxDurationMs) {
            return interaction.editReply({
                content: '❌ La durée maximale pour un time out est de 28 jours.'
            });
        }

        const membreCible = await interaction.guild.members.fetch(utilisateur.id).catch(() => null);
        if (!membreCible) {
            return interaction.editReply({ content: '❌ Membre introuvable.' });
        }

        if (membreCible.roles.highest.position >= modérateur.roles.highest.position) {
            return interaction.editReply({
                content: '❌ Vous ne pouvez pas rendre muet ce membre car il est au même niveau ou au-dessus de vous.'
            });
        }

        if (membreCible.roles.highest.position >= interaction.guild.members.me.roles.highest.position) {
            return interaction.editReply({
                content: '❌ Je ne peux pas rendre muet ce membre car il est au-dessus de moi.'
            });
        }

        const dbSanctions = dbManager.getSanctionsDb();
        const dbTempRemovedRoles = dbManager.getTempRemovedRolesDb();

        // Les règles viennent maintenant des règlements (pas besoin de vérifier dans la table rules)
        try {
            // Retirer les rôles administrateurs temporairement
            const adminRoles = membreCible.roles.cache.filter(role =>
                role.permissions.has(PermissionFlagsBits.Administrator)
            );

            if (adminRoles.size > 0) {
                if (!interaction.guild.members.me.permissions.has(PermissionFlagsBits.ManageRoles)) {
                    return interaction.editReply({
                        content: '❌ Je n\'ai pas la permission de gérer les rôles.'
                    });
                }

                const expires_at = Date.now() + duréeMs;
                for (const role of adminRoles.values()) {
                    await membreCible.roles.remove(role, 'Retrait temporaire pour mute');
                    dbTempRemovedRoles.run(
                        'INSERT INTO temp_removed_roles (userId, roleId, expires_at) VALUES (?, ?, ?)',
                        [membreCible.id, role.id, expires_at]
                    );
                }
            }

            // Calculer la durée finale - Le warn peut ajouter du temps seulement à partir du 3ème warn
            let finalDurationMs = duréeMs;
            let addedTime = '';

            if (shouldWarn) {
                // Compter les warns actifs existants pour déterminer si on doit ajouter du temps
                const warnCountPromise = new Promise((resolve) => {
                    dbSanctions.all(
                        'SELECT id FROM sanctions WHERE userId = ? AND type = \'Warn\' AND active = 1 AND (expires_at IS NULL OR expires_at > ?)',
                        [membreCible.id, Date.now()],
                        (err, rows) => {
                            if (err) {
                                resolve(0);
                            } else {
                                resolve(rows ? rows.length : 0);
                            }
                        }
                    );
                });

                const currentWarnCount = await warnCountPromise;
                const newWarnCount = currentWarnCount + 1; // Le warn qu'on va ajouter

                // Système de warns :
                // 1-2 warns : pas de temps supplémentaire
                // 3 warns : +1 jour
                // 4 warns : +1 semaine
                // 5 warns : ban (géré ailleurs)
                if (newWarnCount >= 4) {
                    const oneWeekMs = 7 * 24 * 60 * 60 * 1000;
                    finalDurationMs += oneWeekMs;
                    addedTime = ' (+1 semaine pour 4ème warn)';
                } else if (newWarnCount === 3) {
                    const oneDayMs = 24 * 60 * 60 * 1000;
                    finalDurationMs += oneDayMs;
                    addedTime = ' (+1 jour pour 3ème warn)';
                }
                // Pour 1er et 2ème warn, pas de temps supplémentaire
            }

            await membreCible.timeout(finalDurationMs, raison);

            const finalReason = `${regle} - ${raison}`;
            const duréeTexte = msToReadableTime(finalDurationMs);

            // Insérer la sanction et récupérer son ID via un callback
            dbSanctions.run(
                `INSERT INTO sanctions (userId, type, reason, moderatorId, duration, date, rule_id) VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [membreCible.id, 'Time Out', finalReason, modérateur.id, duréeTexte, Date.now(), null],
                async function (err) {
                    if (err) {
                        console.error('Erreur insertion sanction mute:', err);
                        return;
                    }
                    const sanctionId = this.lastID;

                    if (shouldWarn) {
                        const expires_at = Date.now() + 60 * 24 * 60 * 60 * 1000;
                        dbSanctions.run(
                            'INSERT INTO sanctions (userId, type, reason, moderatorId, date, expires_at, rule_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
                            [membreCible.id, 'Warn', regle, modérateur.id, Date.now(), expires_at, null]
                        );
                    }

                    // Log dans le salon
                    const canalLog = interaction.guild.channels.cache.get(CONFIG.STAFF_WARN_CHANNEL_ID);
                    if (canalLog && canalLog.isTextBased()) {
                        // Obtenir le titre du modérateur avec l'article approprié
                        const moderatorTitleWithArticle = getModeratorTitleWithArticle(modérateur);

                        const action = shouldWarn ? 'a été mute et warn' : 'a été mute';
                        let messageLog = `# ${membreCible.user.tag} (${membreCible.id}) ${action} pendant ${duréeTexte}${addedTime} pour la raison "${finalReason}" par ${moderatorTitleWithArticle} <@${modérateur.id}>`;

                        // Si warn activé, compter le nombre total de warns
                        if (shouldWarn) {
                            dbSanctions.all(
                                'SELECT id FROM sanctions WHERE userId = ? AND type = \'Warn\' AND active = 1 AND (expires_at IS NULL OR expires_at > ?)',
                                [membreCible.id, Date.now()],
                                async (err, rows) => {
                                    if (!err && rows) {
                                        const warnCount = rows.length;
                                        const warnText = warnCount > 1 ? 'warns' : 'warn';
                                        messageLog += `\n-# Il est à ${warnCount} ${warnText}`;
                                    }

                                    // Envoyer le message et sauvegarder son ID
                                    let sentMessage;
                                    if (preuve && preuve.contentType && preuve.contentType.startsWith('image/')) {
                                        const fileName = spoiler ? `SPOILER_${preuve.name}` : preuve.name;
                                        sentMessage = await canalLog.send({
                                            content: messageLog,
                                            files: [{ attachment: preuve.url, name: fileName }]
                                        });
                                    } else {
                                        if (preuve) {
                                            messageLog += '\n⚠️ Preuve non acceptée (seules les captures d\'écran sont autorisées).';
                                        }
                                        sentMessage = await canalLog.send({ content: messageLog });
                                    }

                                    // Mettre à jour la sanction avec l'ID du message de log
                                    if (sentMessage) {
                                        dbSanctions.run(
                                            'UPDATE sanctions SET log_message_id = ?, log_channel_id = ? WHERE id = ?',
                                            [sentMessage.id, sentMessage.channel.id, sanctionId]
                                        );
                                    }
                                }
                            );
                        } else {
                            // Pas de warn, envoyer directement et sauvegarder l'ID
                            let sentMessage;
                            if (preuve && preuve.contentType && preuve.contentType.startsWith('image/')) {
                                const fileName = spoiler ? `SPOILER_${preuve.name}` : preuve.name;
                                sentMessage = await canalLog.send({
                                    content: messageLog,
                                    files: [{ attachment: preuve.url, name: fileName }]
                                });
                            } else {
                                if (preuve) {
                                    messageLog += '\n⚠️ Preuve non acceptée (seules les captures d\'écran sont autorisées).';
                                }
                                sentMessage = await canalLog.send({ content: messageLog });
                            }

                            // Mettre à jour la sanction avec l'ID du message de log
                            if (sentMessage) {
                                dbSanctions.run(
                                    'UPDATE sanctions SET log_message_id = ?, log_channel_id = ? WHERE id = ?',
                                    [sentMessage.id, sentMessage.channel.id, sanctionId]
                                );
                            }
                        }
                    }
                }
            );

            const endsAt = new Date(Date.now() + finalDurationMs);
            const postEmbed = buildPostSanctionDmEmbed({
                guildName: interaction.guild.name,
                type: 'MUTE',
                reason: finalReason,
                byLabel: moderatorLabelForDm(interaction),
                endsAt,
            });
            const dmOk = await trySendSanctionDm(membreCible.user, postEmbed);
            const fallback = dmOk
                ? { ok: false }
                : await sendSanctionChannelFallback({
                    guild: interaction.guild,
                    user: membreCible.user,
                    embed: postEmbed,
                });
            const dmStatus = formatDmStatusForModReply({ dmOk, fallback });

            await interaction.editReply({
                content: `✅ Le mute a été appliqué avec succès à ${membreCible.user.tag}.\n${dmStatus}`,
            });
        } catch (erreur) {
            console.error('Erreur lors de l\'application du mute :', erreur);
            await interaction.editReply({
                content: '❌ Une erreur est survenue lors de l\'application du mute.'
            });
        }
    }
};
