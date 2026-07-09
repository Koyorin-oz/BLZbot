const {
    SlashCommandBuilder,
    AttachmentBuilder,
    ChannelType,
} = require('discord.js');
const { handleCommandError } = require('../../utils/error-handler');
const {
    parseMessageReference,
    extractQuoteText,
    pickQuoteImageUrl,
    renderQuoteCard,
} = require('../../utils/canvas-quote-card');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('quote')
        .setDescription('Génère une image « quote » à partir d’un message Discord.')
        .addStringOption((opt) =>
            opt
                .setName('message')
                .setDescription('ID du message ou lien Discord (clic droit → Copier le lien)')
                .setRequired(true),
        )
        .addChannelOption((opt) =>
            opt
                .setName('salon')
                .setDescription('Salon du message (si tu passes seulement l’ID, défaut : ici)')
                .addChannelTypes(
                    ChannelType.GuildText,
                    ChannelType.GuildAnnouncement,
                    ChannelType.PublicThread,
                    ChannelType.PrivateThread,
                    ChannelType.GuildForum,
                )
                .setRequired(false),
        ),

    async execute(interaction) {
        try {
            await interaction.deferReply();

            const raw = interaction.options.getString('message', true);
            const channelOpt = interaction.options.getChannel('salon');
            const fallbackChannelId = channelOpt?.id || interaction.channelId;

            const ref = parseMessageReference(raw, fallbackChannelId);
            if (!ref?.channelId || !ref.messageId) {
                return interaction.editReply({
                    content:
                        '❌ Référence invalide. Colle l’**ID** du message ou un **lien Discord** complet (`https://discord.com/channels/...`).',
                });
            }

            if (ref.guildId && ref.guildId !== interaction.guildId) {
                return interaction.editReply({
                    content: '❌ Ce message est sur un autre serveur — utilise un lien ou un salon de **ce** serveur.',
                });
            }

            const channel = await interaction.client.channels.fetch(ref.channelId).catch(() => null);
            if (!channel?.isTextBased?.()) {
                return interaction.editReply({
                    content: '❌ Salon introuvable ou inaccessible (vérifie l’ID / le salon).',
                });
            }

            const me = interaction.guild?.members?.me;
            const perms = channel.permissionsFor(me);
            if (perms && !perms.has('ViewChannel')) {
                return interaction.editReply({
                    content: '❌ Je n’ai pas accès à ce salon.',
                });
            }
            if (perms && !perms.has('ReadMessageHistory')) {
                return interaction.editReply({
                    content: '❌ Il me manque la permission **Lire l’historique** dans ce salon.',
                });
            }

            const message = await channel.messages.fetch(ref.messageId).catch(() => null);
            if (!message) {
                return interaction.editReply({
                    content: '❌ Message introuvable. Vérifie l’ID et que le message n’a pas été supprimé.',
                });
            }

            const quoteText = extractQuoteText(message);
            if (!quoteText) {
                return interaction.editReply({
                    content:
                        '❌ Ce message n’a pas de texte à citer (contenu vide). Envoie un message avec du texte, ou une image **avec** une légende.',
                });
            }

            const member = message.member;
            const displayName =
                member?.displayName ||
                message.author?.globalName ||
                message.author?.username ||
                'inconnu';
            const username = message.author?.username || 'user';
            const imageUrl = pickQuoteImageUrl(message);
            const watermark = interaction.client.user?.tag || 'BLZbot';

            let png;
            try {
                png = await renderQuoteCard({
                    quoteText,
                    displayName,
                    username,
                    imageUrl,
                    watermark,
                });
            } catch (e) {
                console.error('[quote] canvas:', e?.message || e);
                return interaction.editReply({
                    content:
                        '❌ Impossible de générer l’image (module **canvas** indisponible sur l’hébergeur).',
                });
            }

            const file = new AttachmentBuilder(png, { name: 'quote.png' });
            await interaction.editReply({
                content: `🖼️ Quote de ${message.author}`,
                files: [file],
            });
        } catch (error) {
            await handleCommandError(interaction, error);
        }
    },
};
