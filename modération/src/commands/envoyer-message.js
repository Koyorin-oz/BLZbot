const {
    SlashCommandBuilder,
    EmbedBuilder,
    PermissionFlagsBits,
    ChannelType,
    AttachmentBuilder,
} = require('discord.js');

/** Types de salons acceptés comme destination. */
const ALLOWED_DESTINATION_CHANNEL_TYPES = new Set([
    ChannelType.GuildText,
    ChannelType.GuildAnnouncement,
    ChannelType.PublicThread,
    ChannelType.PrivateThread,
    ChannelType.AnnouncementThread,
    ChannelType.GuildVoice,      // les salons vocaux Discord acceptent aussi du chat
    ChannelType.GuildStageVoice,
]);

/**
 * Parse une couleur sous forme hex (#RRGGBB, RRGGBB, 0xRRGGBB) ou nom discord.js.
 * Retourne un nombre entier (0xRRGGBB) ou null si invalide.
 */
function parseEmbedColor(input) {
    if (!input || typeof input !== 'string') return null;
    const s = input.trim();
    if (!s) return null;

    // #RRGGBB ou RRGGBB
    const hexMatch = s.match(/^#?([0-9a-fA-F]{6})$/);
    if (hexMatch) return parseInt(hexMatch[1], 16);

    // 0xRRGGBB
    const prefixMatch = s.match(/^0x([0-9a-fA-F]{6})$/i);
    if (prefixMatch) return parseInt(prefixMatch[1], 16);

    // #RGB (compact)
    const shortHex = s.match(/^#?([0-9a-fA-F]{3})$/);
    if (shortHex) {
        const [r, g, b] = shortHex[1];
        return parseInt(r + r + g + g + b + b, 16);
    }

    return null;
}

/**
 * Vérifie qu'un attachment est utilisable comme image d'embed (content type commence par image/).
 */
function isImageAttachment(att) {
    if (!att) return false;
    const ct = att.contentType || '';
    return ct.startsWith('image/');
}

/**
 * Normalise un contenu texte : convertit \n littéraux en vrais retours à la ligne et
 * coupe si ça dépasse la limite Discord.
 * @param {string|null} raw
 * @param {number} maxLength
 */
function normalizeText(raw, maxLength) {
    if (raw === null || raw === undefined) return '';
    let s = String(raw);
    // Permet à l'utilisateur d'utiliser \n dans l'option slash pour des retours à la ligne.
    s = s.replace(/\\n/g, '\n').replace(/\\t/g, '\t');
    if (s.length > maxLength) s = s.slice(0, maxLength);
    return s;
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('envoyer-message')
        .setDescription('Envoie un message via le bot (texte brut ou embed, avec fichiers joints).')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
        .setDMPermission(false)
        .addStringOption((opt) =>
            opt
                .setName('message')
                .setDescription('Contenu du message (ou description de l\'embed). Utilise \\n pour un retour à la ligne.')
                .setRequired(false)
                .setMaxLength(4000)
        )
        .addChannelOption((opt) =>
            opt
                .setName('salon')
                .setDescription('Salon de destination (par défaut : salon actuel).')
                .setRequired(false)
                .addChannelTypes(
                    ChannelType.GuildText,
                    ChannelType.GuildAnnouncement,
                    ChannelType.PublicThread,
                    ChannelType.PrivateThread,
                    ChannelType.AnnouncementThread,
                    ChannelType.GuildVoice,
                    ChannelType.GuildStageVoice,
                )
        )
        .addBooleanOption((opt) =>
            opt
                .setName('embed')
                .setDescription('Envoyer le message dans un embed plutôt qu\'en texte brut.')
                .setRequired(false)
        )
        .addStringOption((opt) =>
            opt
                .setName('titre')
                .setDescription('Titre de l\'embed (ignoré si embed=false).')
                .setRequired(false)
                .setMaxLength(256)
        )
        .addStringOption((opt) =>
            opt
                .setName('couleur')
                .setDescription('Couleur hex de l\'embed (ex: #FF5500, #FFF). Ignoré si embed=false.')
                .setRequired(false)
                .setMaxLength(9)
        )
        .addStringOption((opt) =>
            opt
                .setName('auteur')
                .setDescription('Nom d\'auteur affiché en haut de l\'embed (ignoré si embed=false).')
                .setRequired(false)
                .setMaxLength(256)
        )
        .addStringOption((opt) =>
            opt
                .setName('footer')
                .setDescription('Texte du footer de l\'embed (ignoré si embed=false).')
                .setRequired(false)
                .setMaxLength(2048)
        )
        .addStringOption((opt) =>
            opt
                .setName('url')
                .setDescription('URL cliquable sur le titre de l\'embed (ignoré si embed=false).')
                .setRequired(false)
                .setMaxLength(512)
        )
        .addBooleanOption((opt) =>
            opt
                .setName('timestamp')
                .setDescription('Afficher l\'heure actuelle dans le footer de l\'embed.')
                .setRequired(false)
        )
        .addBooleanOption((opt) =>
            opt
                .setName('pings')
                .setDescription('Autoriser les pings @everyone/@here/@role dans le message (défaut: non).')
                .setRequired(false)
        )
        .addAttachmentOption((opt) =>
            opt
                .setName('fichier1')
                .setDescription('Fichier joint n°1 (image, vidéo, audio, doc, n\'importe quel type).')
                .setRequired(false)
        )
        .addAttachmentOption((opt) =>
            opt
                .setName('fichier2')
                .setDescription('Fichier joint n°2.')
                .setRequired(false)
        )
        .addAttachmentOption((opt) =>
            opt
                .setName('fichier3')
                .setDescription('Fichier joint n°3.')
                .setRequired(false)
        )
        .addAttachmentOption((opt) =>
            opt
                .setName('fichier4')
                .setDescription('Fichier joint n°4.')
                .setRequired(false)
        )
        .addAttachmentOption((opt) =>
            opt
                .setName('image-embed')
                .setDescription('Image affichée DANS l\'embed (grande image). Ignoré si embed=false.')
                .setRequired(false)
        )
        .addAttachmentOption((opt) =>
            opt
                .setName('miniature-embed')
                .setDescription('Miniature affichée dans le coin haut-droit de l\'embed. Ignoré si embed=false.')
                .setRequired(false)
        ),

    async execute(interaction) {
        const targetChannel = interaction.options.getChannel('salon') || interaction.channel;
        const rawMessage = interaction.options.getString('message');
        const useEmbed = interaction.options.getBoolean('embed') ?? false;
        const embedTitle = interaction.options.getString('titre');
        const embedColorRaw = interaction.options.getString('couleur');
        const embedAuthor = interaction.options.getString('auteur');
        const embedFooter = interaction.options.getString('footer');
        const embedUrl = interaction.options.getString('url');
        const embedTimestamp = interaction.options.getBoolean('timestamp') ?? false;
        const allowPings = interaction.options.getBoolean('pings') ?? false;

        const attachments = [
            interaction.options.getAttachment('fichier1'),
            interaction.options.getAttachment('fichier2'),
            interaction.options.getAttachment('fichier3'),
            interaction.options.getAttachment('fichier4'),
        ].filter(Boolean);
        const embedImage = interaction.options.getAttachment('image-embed');
        const embedThumbnail = interaction.options.getAttachment('miniature-embed');

        // Le bot doit pouvoir poster dans le salon cible
        const me = targetChannel.guild?.members?.me;
        const perms = me ? targetChannel.permissionsFor(me) : null;
        if (
            perms &&
            !(
                perms.has(PermissionFlagsBits.ViewChannel) &&
                perms.has(PermissionFlagsBits.SendMessages)
            )
        ) {
            return interaction.reply({
                content: `❌ Je n'ai pas les permissions pour poster dans ${targetChannel}.`,
                ephemeral: true,
            });
        }

        // Embed : besoin de EmbedLinks si on met du contenu riche
        if (useEmbed && perms && !perms.has(PermissionFlagsBits.EmbedLinks)) {
            return interaction.reply({
                content: `❌ Je n'ai pas la permission **Intégrer des liens** dans ${targetChannel}, impossible d'envoyer un embed.`,
                ephemeral: true,
            });
        }

        // Il faut au moins UN contenu (texte, embed non vide, ou fichier).
        const hasEmbedContent =
            useEmbed && (rawMessage || embedTitle || embedAuthor || embedFooter || embedImage || embedThumbnail);
        const hasAnyContent = Boolean(rawMessage) || hasEmbedContent || attachments.length > 0;
        if (!hasAnyContent) {
            return interaction.reply({
                content:
                    '❌ Il faut au moins un contenu : un `message`, un fichier joint, ou (si `embed:true`) un `titre`/`image-embed`/`miniature-embed`.',
                ephemeral: true,
            });
        }

        const isThreadDestination = targetChannel.isThread?.();
        if (isThreadDestination && targetChannel.archived) {
            return interaction.reply({
                content: `❌ Le thread ${targetChannel} est archivé, je ne peux pas y poster.`,
                ephemeral: true,
            });
        }

        // Construction du payload
        const payload = {
            allowedMentions: allowPings
                ? { parse: ['users', 'roles', 'everyone'] }
                : { parse: [] },
        };

        // Contenu texte hors embed
        const messageText = normalizeText(rawMessage, 2000);

        if (useEmbed) {
            const embed = new EmbedBuilder();

            if (embedTitle) embed.setTitle(embedTitle.slice(0, 256));
            if (embedUrl && /^https?:\/\//i.test(embedUrl)) embed.setURL(embedUrl);

            if (messageText) {
                embed.setDescription(
                    messageText.length > 4096 ? messageText.slice(0, 4096) : messageText
                );
            }

            const parsedColor = parseEmbedColor(embedColorRaw);
            if (parsedColor !== null) embed.setColor(parsedColor);

            if (embedAuthor) embed.setAuthor({ name: embedAuthor.slice(0, 256) });
            if (embedFooter) embed.setFooter({ text: embedFooter.slice(0, 2048) });
            if (embedTimestamp) embed.setTimestamp();

            if (embedImage) {
                if (!isImageAttachment(embedImage)) {
                    return interaction.reply({
                        content: `❌ \`image-embed\` doit être une image (png/jpg/gif/webp), reçu : \`${embedImage.contentType || 'inconnu'}\`.`,
                        ephemeral: true,
                    });
                }
                embed.setImage(embedImage.url);
            }

            if (embedThumbnail) {
                if (!isImageAttachment(embedThumbnail)) {
                    return interaction.reply({
                        content: `❌ \`miniature-embed\` doit être une image (png/jpg/gif/webp), reçu : \`${embedThumbnail.contentType || 'inconnu'}\`.`,
                        ephemeral: true,
                    });
                }
                embed.setThumbnail(embedThumbnail.url);
            }

            payload.embeds = [embed];
        } else if (messageText) {
            payload.content = messageText;
        }

        // Fichiers joints (tous types). On reforge des AttachmentBuilder depuis les URLs
        // Discord pour que le bot re-host les fichiers (et ne pointe pas sur la CDN éphémère
        // du slash command).
        if (attachments.length > 0) {
            payload.files = attachments.map((a) =>
                new AttachmentBuilder(a.url, { name: a.name || 'file' })
            );
        }

        // Envoi
        try {
            await interaction.deferReply({ ephemeral: true });
            const sent = await targetChannel.send(payload);

            const messageUrl = sent?.url || `https://discord.com/channels/${targetChannel.guild.id}/${targetChannel.id}/${sent.id}`;

            await interaction.editReply({
                content:
                    `✅ Message envoyé dans ${targetChannel} ${useEmbed ? '(embed)' : '(texte brut)'}` +
                    (attachments.length > 0 ? ` avec **${attachments.length}** fichier(s) joint(s)` : '') +
                    `.\n🔗 ${messageUrl}`,
            });
        } catch (error) {
            console.error('[envoyer-message] Erreur:', error);
            const code = error?.code ? ` (code ${error.code})` : '';
            const reply = {
                content: `❌ Erreur lors de l'envoi${code} : ${error.message || 'inconnue'}`,
            };
            if (interaction.deferred) {
                await interaction.editReply(reply).catch(() => null);
            } else {
                await interaction.reply({ ...reply, ephemeral: true }).catch(() => null);
            }
        }
    },
};
