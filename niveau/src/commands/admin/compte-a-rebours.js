const {
    SlashCommandBuilder,
    PermissionFlagsBits,
    AttachmentBuilder,
    ChannelType,
} = require('discord.js');
const { isBotOwner } = require('../../utils/bot-owner');
const { parseParisDateTime, formatDiscordCountdownBlock } = require('../../utils/countdown-parse');
const { buildCountdownCard } = require('../../utils/canvas-countdown');
const store = require('../../utils/countdown-store');
const { postOrRefreshCountdown } = require('../../utils/countdown-poster');

function canManage(interaction) {
    return (
        isBotOwner(interaction.user.id) ||
        interaction.memberPermissions?.has(PermissionFlagsBits.Administrator) ||
        interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)
    );
}

function formatParis(ms) {
    return new Intl.DateTimeFormat('fr-FR', {
        timeZone: 'Europe/Paris',
        dateStyle: 'short',
        timeStyle: 'short',
    }).format(new Date(ms));
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('compte-a-rebours')
        .setDescription('Compte à rebours annonces — canvas + horaire Discord (fuseau auto).')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .addSubcommand((sc) =>
            sc
                .setName('publier')
                .setDescription('Publie un compte à rebours dans un salon (ex. Annonces).')
                .addStringOption((o) =>
                    o.setName('titre').setDescription('Titre affiché sur le canvas').setRequired(true),
                )
                .addStringOption((o) =>
                    o
                        .setName('date')
                        .setDescription('Date cible (Paris) : JJ/MM/AAAA ou AAAA-MM-JJ')
                        .setRequired(true),
                )
                .addChannelOption((o) =>
                    o
                        .setName('salon')
                        .setDescription('Salon où poster (défaut : salon actuel)')
                        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
                        .setRequired(false),
                )
                .addStringOption((o) =>
                    o.setName('heure').setDescription('Heure Paris (HH:MM, défaut 18:00)').setRequired(false),
                )
                .addStringOption((o) =>
                    o
                        .setName('sous-titre')
                        .setDescription('Sous-titre optionnel sous le titre')
                        .setRequired(false),
                ),
        )
        .addSubcommand((sc) =>
            sc
                .setName('apercu')
                .setDescription('Aperçu privé du canvas + texte Discord (sans publier).')
                .addStringOption((o) =>
                    o.setName('titre').setDescription('Titre').setRequired(true),
                )
                .addStringOption((o) =>
                    o.setName('date').setDescription('JJ/MM/AAAA ou AAAA-MM-JJ').setRequired(true),
                )
                .addStringOption((o) => o.setName('heure').setDescription('HH:MM (défaut 18:00)').setRequired(false))
                .addStringOption((o) => o.setName('sous-titre').setDescription('Sous-titre').setRequired(false)),
        )
        .addSubcommand((sc) => sc.setName('liste').setDescription('Comptes à rebours actifs sur ce serveur.'))
        .addSubcommand((sc) =>
            sc
                .setName('rafraichir')
                .setDescription('Met à jour le message (canvas + jours restants).')
                .addIntegerOption((o) =>
                    o.setName('id').setDescription('ID du compte à rebours').setRequired(true).setMinValue(1),
                ),
        )
        .addSubcommand((sc) =>
            sc
                .setName('supprimer')
                .setDescription('Désactive un compte à rebours (le message reste sur Discord).')
                .addIntegerOption((o) =>
                    o.setName('id').setDescription('ID du compte à rebours').setRequired(true).setMinValue(1),
                ),
        ),

    async execute(interaction) {
        if (!canManage(interaction)) {
            return interaction.reply({
                content: 'Réservé aux administrateurs / gestion du serveur (ou owner bot).',
                flags: 64,
            });
        }

        const sub = interaction.options.getSubcommand();

        if (sub === 'liste') {
            const rows = store.listActive(interaction.guildId);
            if (!rows.length) {
                return interaction.reply({ content: 'Aucun compte à rebours actif.', flags: 64 });
            }
            const lines = rows.map(
                (r) =>
                    `**#${r.id}** · ${r.title} · <#${r.channel_id || '0'}> · ${formatParis(r.target_ms)}` +
                    (r.message_id ? '' : ' _(pas encore publié)_'),
            );
            return interaction.reply({ content: lines.join('\n'), flags: 64 });
        }

        if (sub === 'supprimer') {
            const id = interaction.options.getInteger('id', true);
            const row = store.getById(id);
            if (!row || row.guild_id !== interaction.guildId) {
                return interaction.reply({ content: 'Compte à rebours introuvable.', flags: 64 });
            }
            store.deactivate(id);
            return interaction.reply({ content: `Compte à rebours **#${id}** désactivé.`, flags: 64 });
        }

        if (sub === 'rafraichir') {
            await interaction.deferReply({ flags: 64 });
            const id = interaction.options.getInteger('id', true);
            const row = store.getById(id);
            if (!row || row.guild_id !== interaction.guildId || !row.active) {
                return interaction.editReply('Compte à rebours introuvable ou inactif.');
            }
            if (!row.channel_id || !row.message_id) {
                return interaction.editReply('Ce compte n’a pas encore de message publié — utilise `publier`.');
            }
            try {
                await postOrRefreshCountdown(interaction.client, {
                    id: row.id,
                    title: row.title,
                    subtitle: row.subtitle,
                    targetMs: row.target_ms,
                    guildId: row.guild_id,
                    channelId: row.channel_id,
                    messageId: row.message_id,
                });
                return interaction.editReply(`Compte à rebours **#${id}** mis à jour.`);
            } catch (e) {
                return interaction.editReply(`Erreur : ${e?.message || e}`);
            }
        }

        const titre = interaction.options.getString('titre', true);
        const date = interaction.options.getString('date', true);
        const heure = interaction.options.getString('heure') || '18:00';
        const sousTitre = interaction.options.getString('sous-titre') || '';
        const parsed = parseParisDateTime(date, heure);
        if (!parsed.ok) {
            return interaction.reply({ content: `❌ ${parsed.error}`, flags: 64 });
        }
        if (parsed.ms <= Date.now()) {
            return interaction.reply({
                content: '❌ La date doit être dans le futur.',
                flags: 64,
            });
        }

        if (sub === 'apercu') {
            await interaction.deferReply({ flags: 64 });
            const buffer = await buildCountdownCard({
                targetMs: parsed.ms,
                title: titre,
                subtitle: sousTitre,
            });
            const file = new AttachmentBuilder(buffer, { name: 'apercu-countdown.png' });
            return interaction.editReply({
                content: formatDiscordCountdownBlock(parsed.ms, titre),
                files: [file],
            });
        }

        if (sub === 'publier') {
            await interaction.deferReply({ flags: 64 });
            const channel =
                interaction.options.getChannel('salon') || interaction.channel;
            if (!channel || !channel.isTextBased()) {
                return interaction.editReply('Salon texte requis.');
            }

            const id = store.createCountdown({
                guildId: interaction.guildId,
                channelId: channel.id,
                title: titre,
                subtitle: sousTitre,
                targetMs: parsed.ms,
                createdBy: interaction.user.id,
            });

            try {
                const msg = await postOrRefreshCountdown(interaction.client, {
                    id,
                    title: titre,
                    subtitle: sousTitre,
                    targetMs: parsed.ms,
                    guildId: interaction.guildId,
                    channelId: channel.id,
                });
                return interaction.editReply(
                    `Compte à rebours **#${id}** publié dans ${channel} — [message](${msg.url}).\n` +
                        'Rafraîchissement auto toutes les 6 h (jours restants sur le canvas).',
                );
            } catch (e) {
                store.deactivate(id);
                return interaction.editReply(`Erreur publication : ${e?.message || e}`);
            }
        }
    },
};
