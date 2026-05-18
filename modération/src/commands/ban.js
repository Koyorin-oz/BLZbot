const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const CONFIG = require('../config.js');
const { getModeratorTitleWithArticle, parseDuration, msToReadableTime } = require('../utils/helpers.js');
const {
    buildPreBanDmEmbed,
    moderatorLabelForDm,
    trySendSanctionDm,
    sendDebanInviteDm,
    sendSanctionChannelFallback,
    formatDmStatusForModReply,
} = require('../utils/sanction-dm.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('ban')
        .setDescription('Bannir un membre avec une raison spécifique.')
        .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
        .addUserOption(option =>
            option.setName('utilisateur')
                .setDescription('Le membre à bannir')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('raison')
                .setDescription('Raison du bannissement')
                .setRequired(false))
        .addStringOption(option =>
            option.setName('regle')
                .setDescription('Règle du règlement (optionnel)')
                .setRequired(false)
                .setAutocomplete(true))
        .addStringOption(option =>
            option.setName('duree')
                .setDescription('Durée du bannissement (ex: 3mo, 1y). Min 3 mois, Max 2 ans.')
                .setRequired(false))
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

        dbRules.all('SELECT rules FROM reglements', [], (err, rows) => {
            if (err) {
                console.error('Erreur autocomplete règles:', err);
                return interaction.respond([]);
            }

            const allRules = [];
            rows.forEach(row => {
                try {
                    const rules = JSON.parse(row.rules);
                    rules.forEach(rule => {
                        allRules.push({
                            name: `${rule.number}. ${rule.title}`,
                            value: `${rule.number}. ${rule.title}`
                        });
                    });
                } catch (e) {
                    console.error('Erreur parse rules:', e);
                }
            });

            const filtered = allRules.filter(rule =>
                rule.name.toLowerCase().includes(focusedValue)
            ).slice(0, 25);

            interaction.respond(filtered);
        });
    },

    async execute(interaction, { dbManager, config }) {
        if (!interaction.member.permissions.has(PermissionFlagsBits.BanMembers)) {
            return interaction.reply({
                content: '❌ Vous n\'avez pas la permission de bannir des membres.',
                ephemeral: true
            });
        }

        const utilisateur = interaction.options.getUser('utilisateur');
        const raison = interaction.options.getString('raison');
        const regle = interaction.options.getString('regle');
        const dureeStr = interaction.options.getString('duree');
        const preuve = interaction.options.getAttachment('preuve');
        const spoiler = interaction.options.getBoolean('spoiler') || false;
        const modérateur = interaction.member;

        // Validation de la durée si fournie
        let dureeMs = null;
        let dureeTexte = null;
        if (dureeStr) {
            dureeMs = parseDuration(dureeStr);
            if (!dureeMs) {
                return interaction.reply({ content: '❌ Format de durée invalide. Utilisez par exemple 3mo (3 mois), 1y (1 an).', ephemeral: true });
            }

            const minDuration = 90 * 24 * 60 * 60 * 1000; // ~3 mois
            const maxDuration = 730 * 24 * 60 * 60 * 1000; // ~2 ans

            if (dureeMs < minDuration || dureeMs > maxDuration) {
                return interaction.reply({ content: '❌ La durée du bannissement temporaire doit être comprise entre 3 mois et 2 ans.', ephemeral: true });
            }
            dureeTexte = msToReadableTime(dureeMs);
        }

        // DM + ban API peuvent dépasser 3 s — Discord invalide l'interaction sans ack immédiat (10062).
        await interaction.deferReply({ ephemeral: true });

        // Construire la raison finale
        let finalReason = '';
        if (regle && raison) {
            finalReason = `${regle} - ${raison}`;
        } else if (regle) {
            finalReason = regle;
        } else if (raison) {
            finalReason = raison;
        } else {
            finalReason = 'Aucune raison spécifiée';
        }

        if (dureeTexte) {
            finalReason += ` (Durée: ${dureeTexte})`;
        }

        let membreCible = null;
        try {
            membreCible = await interaction.guild.members.fetch(utilisateur.id);
        } catch (error) {
            console.log(`L'utilisateur ${utilisateur.tag} n'est pas sur le serveur. Procéder au bannissement.`);
        }

        if (membreCible) {
            if (membreCible.roles.highest.position >= interaction.guild.members.me.roles.highest.position) {
                return interaction.editReply({
                    content: '❌ Je ne peux pas bannir ce membre car il est au-dessus de moi.',
                });
            }

            if (membreCible.roles.highest.position >= modérateur.roles.highest.position) {
                return interaction.editReply({
                    content: '❌ Vous ne pouvez pas bannir ce membre car il est au même niveau ou au-dessus de vous.',
                });
            }

            try {
                let dmMessage = `Vous avez été BANNI définitivement du serveur pour la raison : "${finalReason}".\n` +
                    `Si vous souhaitez vous faire debannir, vous pouvez rejoindre le serveur support : https://discord.gg/UJNZxzmmPV`;

                if (dureeTexte) {
                    dmMessage = `Vous avez été BANNI temporairement du serveur pour une durée de ${dureeTexte}. Raison : "${finalReason}".\n` +
                        `Vous serez automatiquement débanni à la fin de cette période.`;
                }

                await utilisateur.send(dmMessage);
            } catch {
                console.warn('Impossible d\'envoyer un message privé avant le bannissement.');
            }
        }

        try {
            await interaction.guild.members.ban(utilisateur.id, { reason: finalReason });

            const dbSanctions = dbManager.getDatabase('sanctions');
            const expiresAt = dureeMs ? Date.now() + dureeMs : null;

            dbSanctions.run(
                `INSERT INTO sanctions (userId, type, reason, moderatorId, date, duration, expires_at, active) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                [utilisateur.id, 'Ban', finalReason, modérateur.id, Date.now(), dureeTexte, expiresAt, expiresAt ? 1 : 0],
                async function (err) {
                    if (err) {
                        console.error('Erreur insertion sanction ban:', err);
                        return;
                    }
                    const sanctionId = this.lastID;

                    // Log
                    const canalLog = interaction.guild.channels.cache.get(CONFIG.STAFF_WARN_CHANNEL_ID);
                    if (canalLog && canalLog.isTextBased()) {
                        // Obtenir le titre du modérateur avec l'article approprié
                        const moderatorTitleWithArticle = getModeratorTitleWithArticle(modérateur);

                        let messageLog = `# ${utilisateur.tag} (${utilisateur.id}) a été banni ${dureeTexte ? 'temporairement (' + dureeTexte + ')' : 'définitivement'} pour la raison : "${finalReason}" par ${moderatorTitleWithArticle} <@${modérateur.id}>`;
                        let sentMessage;

                        if (preuve && preuve.contentType && preuve.contentType.startsWith('image/')) {
                            // Ajouter SPOILER_ au nom du fichier si spoiler activé
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
            );

            await interaction.editReply({
                content: `✅ ${utilisateur.tag} a été banni ${dureeTexte ? 'temporairement (' + dureeTexte + ')' : 'définitivement'}.`,
            });
        } catch (erreur) {
            console.error('Erreur lors du bannissement :', erreur);
            if (interaction.deferred) {
                await interaction.editReply({
                    content: '❌ Une erreur est survenue lors du bannissement.',
                }).catch(() => {});
            } else {
                await interaction.reply({
                    content: '❌ Une erreur est survenue lors du bannissement.',
                    ephemeral: true,
                }).catch(() => {});
            }
        }
    }
};
