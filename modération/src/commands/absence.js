const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits, ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize, MessageFlags } = require('discord.js');
const CONFIG = require('../config.js');

/**
 * Parse une durée en format humain (ex: "2j", "1s", "3h") en millisecondes
 * @param {string} duration - La durée en format humain
 * @returns {number|null} - La durée en millisecondes ou null si invalide
 */
function parseDuration(duration) {
    const regex = /^(\d+)([jshm])$/i;
    const match = duration.match(regex);
    if (!match) return null;

    const value = parseInt(match[1]);
    const unit = match[2].toLowerCase();

    const multipliers = {
        'm': 60 * 1000,           // minutes
        'h': 60 * 60 * 1000,      // heures
        'j': 24 * 60 * 60 * 1000, // jours
        's': 7 * 24 * 60 * 60 * 1000 // semaines
    };

    return value * multipliers[unit];
}

/**
 * Formate une durée en texte lisible
 * @param {number} ms - La durée en millisecondes
 * @returns {string} - La durée formatée
 */
function formatDuration(ms) {
    const days = Math.floor(ms / (24 * 60 * 60 * 1000));
    const hours = Math.floor((ms % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));

    if (days > 0 && hours > 0) {
        return `${days} jour${days > 1 ? 's' : ''} et ${hours} heure${hours > 1 ? 's' : ''}`;
    } else if (days > 0) {
        return `${days} jour${days > 1 ? 's' : ''}`;
    } else if (hours > 0) {
        return `${hours} heure${hours > 1 ? 's' : ''}`;
    } else {
        const minutes = Math.floor(ms / (60 * 1000));
        return `${minutes} minute${minutes > 1 ? 's' : ''}`;
    }
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('absence')
        .setDescription('Gérer les absences du staff')
        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
        .addSubcommand(subcommand =>
            subcommand
                .setName('définir')
                .setDescription('Déclarer une absence')
                .addStringOption(option =>
                    option.setName('durée')
                        .setDescription('Durée de l\'absence (ex: 2j, 1s, 12h)')
                        .setRequired(true))
                .addStringOption(option =>
                    option.setName('raison')
                        .setDescription('Raison de l\'absence (optionnelle)')
                        .setRequired(false)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('fin')
                .setDescription('Terminer son absence'))
        .addSubcommand(subcommand =>
            subcommand
                .setName('liste')
                .setDescription('Voir les absences actives'))
        .addSubcommand(subcommand =>
            subcommand
                .setName('supprimer')
                .setDescription('Supprimer une absence (Admin)')
                .addIntegerOption(option =>
                    option.setName('id')
                        .setDescription('ID de l\'absence à supprimer')
                        .setRequired(true))),

    async execute(interaction, { dbManager, client }) {
        const subcommand = interaction.options.getSubcommand();
        const absencesDb = dbManager.getStaffAbsencesDb();

        switch (subcommand) {
            case 'définir':
                await handleDefine(interaction, absencesDb, client);
                break;
            case 'fin':
                await handleEnd(interaction, absencesDb, client);
                break;
            case 'liste':
                await handleList(interaction, absencesDb);
                break;
            case 'supprimer':
                await handleDelete(interaction, absencesDb, client);
                break;
        }
    }
};

/**
 * Déclarer une nouvelle absence
 */
async function handleDefine(interaction, absencesDb, client) {
    const durationStr = interaction.options.getString('durée');
    const reason = interaction.options.getString('raison') || 'Non précisée';
    const userId = interaction.user.id;

    // Parser la durée
    const durationMs = parseDuration(durationStr);
    if (!durationMs) {
        return interaction.reply({
            content: '❌ Format de durée invalide. Utilisez: `2j` (jours), `1s` (semaines), `12h` (heures), `30m` (minutes)',
            ephemeral: true
        });
    }

    // Vérifier la durée max
    const maxDurationMs = (CONFIG.ABSENCES?.MAX_DURATION_DAYS || 30) * 24 * 60 * 60 * 1000;
    if (durationMs > maxDurationMs) {
        return interaction.reply({
            content: `❌ La durée maximale d'absence est de ${CONFIG.ABSENCES?.MAX_DURATION_DAYS || 30} jours.`,
            ephemeral: true
        });
    }

    // Vérifier si l'utilisateur a déjà une absence active
    const checkActive = () => new Promise((resolve, reject) => {
        absencesDb.get(
            'SELECT * FROM staff_absences WHERE userId = ? AND active = 1',
            [userId],
            (err, row) => err ? reject(err) : resolve(row)
        );
    });

    try {
        const existingAbsence = await checkActive();
        if (existingAbsence) {
            return interaction.reply({
                content: '❌ Tu as déjà une absence active. Utilise `/absence fin` pour la terminer d\'abord.',
                ephemeral: true
            });
        }

        const now = Date.now();
        const endDate = now + durationMs;

        // Insérer l'absence
        const insertAbsence = () => new Promise((resolve, reject) => {
            absencesDb.run(
                'INSERT INTO staff_absences (userId, reason, start_date, end_date, active) VALUES (?, ?, ?, ?, 1)',
                [userId, reason, now, endDate],
                function (err) {
                    err ? reject(err) : resolve(this.lastID);
                }
            );
        });

        const absenceId = await insertAbsence();

        // Créer l'embed de confirmation
        const embed = new EmbedBuilder()
            .setColor('#FFA500')
            .setTitle('🕐 Absence déclarée')
            .setDescription(`<@${userId}> sera absent(e) pendant **${formatDuration(durationMs)}**`)
            .addFields(
                { name: '📅 Début', value: `<t:${Math.floor(now / 1000)}:f>`, inline: true },
                { name: '📅 Fin prévue', value: `<t:${Math.floor(endDate / 1000)}:f>`, inline: true },
                { name: '📝 Raison', value: reason }
            )
            .setFooter({ text: `ID: ${absenceId}` })
            .setTimestamp();

        await interaction.reply({ embeds: [embed] });

        // Notifier dans le salon de logs si configuré
        if (CONFIG.ABSENCES?.LOG_CHANNEL_ID) {
            try {
                const logChannel = await client.channels.fetch(CONFIG.ABSENCES.LOG_CHANNEL_ID);
                if (logChannel) {
                    await logChannel.send({ embeds: [embed] });
                }
            } catch (error) {
                console.error('[Absence] Erreur lors de l\'envoi du log:', error);
            }
        }

    } catch (error) {
        console.error('[Absence] Erreur:', error);
        return interaction.reply({
            content: '❌ Une erreur est survenue lors de la création de l\'absence.',
            ephemeral: true
        });
    }
}

/**
 * Terminer son absence
 */
async function handleEnd(interaction, absencesDb, client) {
    const userId = interaction.user.id;

    const getActive = () => new Promise((resolve, reject) => {
        absencesDb.get(
            'SELECT * FROM staff_absences WHERE userId = ? AND active = 1',
            [userId],
            (err, row) => err ? reject(err) : resolve(row)
        );
    });

    try {
        const activeAbsence = await getActive();
        if (!activeAbsence) {
            return interaction.reply({
                content: '❌ Tu n\'as pas d\'absence active.',
                ephemeral: true
            });
        }

        // Terminer l'absence
        const endAbsence = () => new Promise((resolve, reject) => {
            absencesDb.run(
                'UPDATE staff_absences SET active = 0, end_date = ? WHERE id = ?',
                [Date.now(), activeAbsence.id],
                err => err ? reject(err) : resolve()
            );
        });

        await endAbsence();

        const embed = new EmbedBuilder()
            .setColor('#00FF00')
            .setTitle('✅ Fin d\'absence')
            .setDescription(`<@${userId}> est de retour !`)
            .addFields(
                { name: '📅 Durée effective', value: formatDuration(Date.now() - activeAbsence.start_date) }
            )
            .setTimestamp();

        await interaction.reply({ embeds: [embed] });

        // Notifier dans le salon de logs
        if (CONFIG.ABSENCES?.LOG_CHANNEL_ID) {
            try {
                const logChannel = await client.channels.fetch(CONFIG.ABSENCES.LOG_CHANNEL_ID);
                if (logChannel) {
                    await logChannel.send({ embeds: [embed] });
                }
            } catch (error) {
                console.error('[Absence] Erreur lors de l\'envoi du log:', error);
            }
        }

    } catch (error) {
        console.error('[Absence] Erreur:', error);
        return interaction.reply({
            content: '❌ Une erreur est survenue.',
            ephemeral: true
        });
    }
}

/**
 * Lister les absences actives
 */
async function handleList(interaction, absencesDb) {
    const getAll = () => new Promise((resolve, reject) => {
        absencesDb.all(
            'SELECT * FROM staff_absences WHERE active = 1 ORDER BY end_date ASC',
            [],
            (err, rows) => err ? reject(err) : resolve(rows || [])
        );
    });

    try {
        const absences = await getAll();

        if (absences.length === 0) {
            return interaction.reply({
                content: 'Aucune absence active actuellement.',
                ephemeral: true
            });
        }

        // Utiliser Components V2 avec le flag IsComponentsV2
        const container = new ContainerBuilder();

        container.addTextDisplayComponents(
            new TextDisplayBuilder().setContent('# Absences Actives')
        );

        container.addSeparatorComponents(
            new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small)
        );

        for (const absence of absences) {
            const now = Date.now();
            const remaining = absence.end_date - now;
            const status = remaining > 0 ? `Retour <t:${Math.floor(absence.end_date / 1000)}:R>` : 'Absence expirée';

            container.addTextDisplayComponents(
                new TextDisplayBuilder().setContent(
                    `### <@${absence.userId}>\n` +
                    `> **Raison:** ${absence.reason}\n` +
                    `> **Depuis:** <t:${Math.floor(absence.start_date / 1000)}:f>\n` +
                    `> ${status}\n` +
                    `> *ID: ${absence.id}*`
                )
            );

            container.addSeparatorComponents(
                new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small)
            );
        }

        container.addTextDisplayComponents(
            new TextDisplayBuilder().setContent(`*${absences.length} absence(s) active(s)*`)
        );

        // Envoyer avec le flag IsComponentsV2
        await interaction.reply({
            components: [container],
            flags: MessageFlags.IsComponentsV2,
            allowedMentions: { parse: [] }
        });

    } catch (error) {
        console.error('[Absence] Erreur:', error);
        return interaction.reply({
            content: 'Une erreur est survenue.',
            ephemeral: true
        });
    }
}

/**
 * Supprimer une absence (Admin uniquement)
 */
async function handleDelete(interaction, absencesDb, client) {
    // Vérifier les permissions admin
    if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
        return interaction.reply({
            content: '❌ Seuls les administrateurs peuvent supprimer des absences.',
            ephemeral: true
        });
    }

    const absenceId = interaction.options.getInteger('id');

    const getAbsence = () => new Promise((resolve, reject) => {
        absencesDb.get(
            'SELECT * FROM staff_absences WHERE id = ?',
            [absenceId],
            (err, row) => err ? reject(err) : resolve(row)
        );
    });

    try {
        const absence = await getAbsence();
        if (!absence) {
            return interaction.reply({
                content: '❌ Absence introuvable.',
                ephemeral: true
            });
        }

        // Supprimer l'absence
        const deleteAbsence = () => new Promise((resolve, reject) => {
            absencesDb.run(
                'DELETE FROM staff_absences WHERE id = ?',
                [absenceId],
                err => err ? reject(err) : resolve()
            );
        });

        await deleteAbsence();

        const embed = new EmbedBuilder()
            .setColor('#FF0000')
            .setTitle('🗑️ Absence supprimée')
            .setDescription(`L'absence de <@${absence.userId}> a été supprimée par <@${interaction.user.id}>`)
            .setTimestamp();

        await interaction.reply({ embeds: [embed] });

        // Notifier dans le salon de logs
        if (CONFIG.ABSENCES?.LOG_CHANNEL_ID) {
            try {
                const logChannel = await client.channels.fetch(CONFIG.ABSENCES.LOG_CHANNEL_ID);
                if (logChannel) {
                    await logChannel.send({ embeds: [embed] });
                }
            } catch (error) {
                console.error('[Absence] Erreur lors de l\'envoi du log:', error);
            }
        }

    } catch (error) {
        console.error('[Absence] Erreur:', error);
        return interaction.reply({
            content: '❌ Une erreur est survenue.',
            ephemeral: true
        });
    }
}
