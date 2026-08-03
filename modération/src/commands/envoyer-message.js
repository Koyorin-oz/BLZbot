const {
    SlashCommandBuilder,
    EmbedBuilder,
    PermissionFlagsBits,
    ChannelType,
    AttachmentBuilder,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    ActionRowBuilder,
    LabelBuilder,
} = require('discord.js');
const CONFIG = require('../config.js');
const { denyUnlessCanMod } = require('../utils/mod-access');

const MODAL_ID = 'envoyer_message_modal';
const PENDING_TTL_MS = 15 * 60 * 1000;

/** Brouillons en attente entre le slash et le modal (clés = userId). */
const pendingByUser = new Map();

function prunePending() {
    const now = Date.now();
    for (const [uid, entry] of pendingByUser) {
        if (now - entry.createdAt > PENDING_TTL_MS) pendingByUser.delete(uid);
    }
}

/**
 * Parse une couleur sous forme hex (#RRGGBB, RRGGBB, 0xRRGGBB) ou nom discord.js.
 * Retourne un nombre entier (0xRRGGBB) ou null si invalide.
 */
function parseEmbedColor(input) {
    if (!input || typeof input !== 'string') return null;
    const s = input.trim();
    if (!s) return null;

    const hexMatch = s.match(/^#?([0-9a-fA-F]{6})$/);
    if (hexMatch) return parseInt(hexMatch[1], 16);

    const prefixMatch = s.match(/^0x([0-9a-fA-F]{6})$/i);
    if (prefixMatch) return parseInt(prefixMatch[1], 16);

    const shortHex = s.match(/^#?([0-9a-fA-F]{3})$/);
    if (shortHex) {
        const [r, g, b] = shortHex[1];
        return parseInt(r + r + g + g + b + b, 16);
    }

    return null;
}

function isImageAttachment(att) {
    if (!att) return false;
    const ct = att.contentType || '';
    return ct.startsWith('image/');
}

/**
 * Conserve les vrais retours à la ligne du modal, et convertit aussi les `\n` / `\t`
 * littéraux (au cas où l’utilisateur les tape encore à la main).
 */
function normalizeText(raw, maxLength) {
    if (raw === null || raw === undefined) return '';
    let s = String(raw);
    // Discord / clavier : parfois des \n littéraux à 1 ou 2 backslashs
    s = s
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n')
        .replace(/\\n/g, '\n')
        .replace(/\\t/g, '\t');
    if (s.length > maxLength) s = s.slice(0, maxLength);
    return s;
}

function serializeAttachment(att) {
    if (!att) return null;
    return {
        url: att.url,
        name: att.name || 'file',
        contentType: att.contentType || null,
    };
}

async function sendPreparedMessage(interaction, draft, messageText) {
    const targetChannel = await interaction.client.channels.fetch(draft.channelId).catch(() => null);
    if (!targetChannel) {
        return interaction.editReply({
            content: '❌ Salon de destination introuvable.',
        });
    }

    const me = targetChannel.guild?.members?.me;
    const perms = me ? targetChannel.permissionsFor(me) : null;
    if (
        perms &&
        !(
            perms.has(PermissionFlagsBits.ViewChannel) &&
            perms.has(PermissionFlagsBits.SendMessages)
        )
    ) {
        return interaction.editReply({
            content: `❌ Je n'ai pas les permissions pour poster dans ${targetChannel}.`,
        });
    }

    if (draft.useEmbed && perms && !perms.has(PermissionFlagsBits.EmbedLinks)) {
        return interaction.editReply({
            content: `❌ Je n'ai pas la permission **Intégrer des liens** dans ${targetChannel}.`,
        });
    }

    if (targetChannel.isThread?.() && targetChannel.archived) {
        return interaction.editReply({
            content: `❌ Le thread ${targetChannel} est archivé.`,
        });
    }

    const hasEmbedContent =
        draft.useEmbed &&
        (messageText ||
            draft.embedTitle ||
            draft.embedAuthor ||
            draft.embedFooter ||
            draft.embedImage ||
            draft.embedThumbnail);
    const hasAnyContent =
        Boolean(messageText) || hasEmbedContent || (draft.attachments?.length || 0) > 0;
    if (!hasAnyContent) {
        return interaction.editReply({
            content:
                '❌ Il faut au moins un contenu : un message, un fichier joint, ou (si embed) un titre / une image.',
        });
    }

    const payload = {
        allowedMentions: draft.allowPings
            ? { parse: ['users', 'roles', 'everyone'] }
            : { parse: [] },
    };

    if (draft.useEmbed) {
        const embed = new EmbedBuilder();

        if (draft.embedTitle) embed.setTitle(String(draft.embedTitle).slice(0, 256));
        if (draft.embedUrl && /^https?:\/\//i.test(draft.embedUrl)) {
            embed.setURL(draft.embedUrl);
        }

        if (messageText) {
            embed.setDescription(messageText.length > 4096 ? messageText.slice(0, 4096) : messageText);
        }

        const parsedColor = parseEmbedColor(draft.embedColorRaw);
        if (parsedColor !== null) embed.setColor(parsedColor);

        if (draft.embedAuthor) embed.setAuthor({ name: String(draft.embedAuthor).slice(0, 256) });
        if (draft.embedFooter) embed.setFooter({ text: String(draft.embedFooter).slice(0, 2048) });
        if (draft.embedTimestamp) embed.setTimestamp();

        if (draft.embedImage) {
            if (!isImageAttachment(draft.embedImage)) {
                return interaction.editReply({
                    content: `❌ \`image-embed\` doit être une image, reçu : \`${draft.embedImage.contentType || 'inconnu'}\`.`,
                });
            }
            embed.setImage(draft.embedImage.url);
        }

        if (draft.embedThumbnail) {
            if (!isImageAttachment(draft.embedThumbnail)) {
                return interaction.editReply({
                    content: `❌ \`miniature-embed\` doit être une image, reçu : \`${draft.embedThumbnail.contentType || 'inconnu'}\`.`,
                });
            }
            embed.setThumbnail(draft.embedThumbnail.url);
        }

        payload.embeds = [embed];
    } else if (messageText) {
        payload.content = messageText.length > 2000 ? messageText.slice(0, 2000) : messageText;
    }

    if (draft.attachments?.length > 0) {
        payload.files = draft.attachments.map(
            (a) => new AttachmentBuilder(a.url, { name: a.name || 'file' }),
        );
    }

    const sent = await targetChannel.send(payload);
    const messageUrl =
        sent?.url ||
        `https://discord.com/channels/${targetChannel.guild.id}/${targetChannel.id}/${sent.id}`;

    try {
        const modLogChannel = await interaction.guild?.channels
            ?.fetch(CONFIG.ALL_LOG_CHANNEL_ID)
            .catch(() => null);
        if (modLogChannel && modLogChannel.isTextBased?.()) {
            const channelLabel =
                typeof targetChannel.toString === 'function'
                    ? targetChannel.toString()
                    : `${targetChannel.name || targetChannel.id}`;
            await modLogChannel.send({
                content: [
                    `**Message envoyé** par <@${interaction.user.id}> (\`${interaction.user.id}\`)`,
                    `**Salon cible:** ${channelLabel} (\`${targetChannel.id}\`)`,
                    `🔗 [Voir le message](${messageUrl})`,
                ].join('\n'),
            });
        }
    } catch (logError) {
        console.error('[envoyer-message] Erreur log modérateur :', logError);
    }

    await interaction.editReply({
        content: `✅ [Message bien envoyé !](${messageUrl})`,
    });
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('envoyer-message')
        .setDescription('Envoie un message via le bot (texte brut ou embed, avec fichiers joints).')
        .setDefaultMemberPermissions(null)
        .setDMPermission(false)
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
                ),
        )
        .addBooleanOption((opt) =>
            opt
                .setName('embed')
                .setDescription('Envoyer le message dans un embed plutôt qu\'en texte brut.')
                .setRequired(false),
        )
        .addStringOption((opt) =>
            opt
                .setName('titre')
                .setDescription('Titre de l\'embed (ignoré si embed=false).')
                .setRequired(false)
                .setMaxLength(256),
        )
        .addStringOption((opt) =>
            opt
                .setName('couleur')
                .setDescription('Couleur hex de l\'embed (ex: #FF5500, #FFF). Ignoré si embed=false.')
                .setRequired(false)
                .setMaxLength(9),
        )
        .addStringOption((opt) =>
            opt
                .setName('auteur')
                .setDescription('Nom d\'auteur affiché en haut de l\'embed (ignoré si embed=false).')
                .setRequired(false)
                .setMaxLength(256),
        )
        .addStringOption((opt) =>
            opt
                .setName('footer')
                .setDescription('Texte du footer de l\'embed (ignoré si embed=false).')
                .setRequired(false)
                .setMaxLength(2048),
        )
        .addStringOption((opt) =>
            opt
                .setName('url')
                .setDescription('URL cliquable sur le titre de l\'embed (ignoré si embed=false).')
                .setRequired(false)
                .setMaxLength(512),
        )
        .addBooleanOption((opt) =>
            opt
                .setName('timestamp')
                .setDescription('Afficher l\'heure actuelle dans le footer de l\'embed.')
                .setRequired(false),
        )
        .addBooleanOption((opt) =>
            opt
                .setName('pings')
                .setDescription('Autoriser les pings @everyone/@here/@role dans le message (défaut: non).')
                .setRequired(false),
        )
        .addAttachmentOption((opt) =>
            opt
                .setName('fichier1')
                .setDescription('Fichier joint n°1 (image, vidéo, audio, doc, n\'importe quel type).')
                .setRequired(false),
        )
        .addAttachmentOption((opt) =>
            opt
                .setName('fichier2')
                .setDescription('Fichier joint n°2.')
                .setRequired(false),
        )
        .addAttachmentOption((opt) =>
            opt
                .setName('fichier3')
                .setDescription('Fichier joint n°3.')
                .setRequired(false),
        )
        .addAttachmentOption((opt) =>
            opt
                .setName('fichier4')
                .setDescription('Fichier joint n°4.')
                .setRequired(false),
        )
        .addAttachmentOption((opt) =>
            opt
                .setName('image-embed')
                .setDescription('Image affichée DANS l\'embed (grande image). Ignoré si embed=false.')
                .setRequired(false),
        )
        .addAttachmentOption((opt) =>
            opt
                .setName('miniature-embed')
                .setDescription('Miniature affichée dans le coin haut-droit de l\'embed. Ignoré si embed=false.')
                .setRequired(false),
        ),

    async execute(interaction) {
        const denied = denyUnlessCanMod(interaction, PermissionFlagsBits.ManageMessages);
        if (denied) {
            return interaction.reply({ ...denied, ephemeral: true });
        }

        const targetChannel = interaction.options.getChannel('salon') || interaction.channel;
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
        ]
            .filter(Boolean)
            .map(serializeAttachment);
        const embedImage = serializeAttachment(interaction.options.getAttachment('image-embed'));
        const embedThumbnail = serializeAttachment(
            interaction.options.getAttachment('miniature-embed'),
        );

        prunePending();
        pendingByUser.set(interaction.user.id, {
            createdAt: Date.now(),
            channelId: targetChannel.id,
            useEmbed,
            embedTitle,
            embedColorRaw,
            embedAuthor,
            embedFooter,
            embedUrl,
            embedTimestamp,
            allowPings,
            attachments,
            embedImage,
            embedThumbnail,
        });

        const messageInput = new TextInputBuilder()
            .setCustomId('message_body')
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(false)
            .setMaxLength(4000)
            .setPlaceholder('Écris ton message ici — Entrée = vrai retour à la ligne.');

        const modal = new ModalBuilder()
            .setCustomId(MODAL_ID)
            .setTitle('Message à envoyer');

        // LabelBuilder (Components V2) si dispo, sinon ActionRow classique
        try {
            modal.addLabelComponents(
                new LabelBuilder()
                    .setLabel('Contenu du message')
                    .setDescription('Les retours à la ligne (Entrée) sont conservés.')
                    .setTextInputComponent(messageInput),
            );
        } catch {
            messageInput.setLabel('Contenu du message');
            modal.addComponents(new ActionRowBuilder().addComponents(messageInput));
        }

        await interaction.showModal(modal);
    },

    async handleModalSubmit(interaction) {
        if (interaction.customId !== MODAL_ID) return false;

        prunePending();
        const draft = pendingByUser.get(interaction.user.id);
        pendingByUser.delete(interaction.user.id);

        if (!draft) {
            await interaction.reply({
                content:
                    '❌ Session expirée (tu as trop attendu). Relance `/envoyer-message`.',
                ephemeral: true,
            });
            return true;
        }

        const rawMessage = interaction.fields.getTextInputValue('message_body');
        const messageText = normalizeText(rawMessage, draft.useEmbed ? 4096 : 2000);

        try {
            await interaction.deferReply({ ephemeral: true });
<<<<<<< HEAD
            const sent = await targetChannel.send(payload);

            const messageUrl = sent?.url || `https://discord.com/channels/${targetChannel.guild.id}/${targetChannel.id}/${sent.id}`;

            try {
                const modLogChannel = await interaction.guild.channels.fetch(CONFIG.ALL_LOG_CHANNEL_ID).catch(() => null);
                if (modLogChannel && modLogChannel.isTextBased?.()) {
                    const channelLabel = typeof targetChannel.toString === 'function'
                        ? targetChannel.toString()
                        : `${targetChannel.name || targetChannel.id}`;
                    const messagePreview = normalizeText(rawMessage, 400);
                    const attachmentNames = attachments.length > 0
                        ? attachments.map((a) => a.name || a.url).join(', ')
                        : null;

                    const logLines = [
                        `**Message envoyé** par <@${interaction.user.id}> (\`${interaction.user.id}\`)`,
                        `**Salon cible:** ${channelLabel} (\`${targetChannel.id}\`)`,
                    ];

                    logLines.push(`🔗 [Voir le message](${messageUrl})`);

                    await modLogChannel.send({ content: logLines.join('\n') });
                }
            } catch (logError) {
                console.error('[envoyer-message] Erreur lors de l’envoi du log modérateur :', logError);
            }

            await interaction.editReply({
                content:
                    `✅ [Message bien envoyé !](${messageUrl})`,
            });
=======
            await sendPreparedMessage(interaction, draft, messageText);
>>>>>>> df2267bb (sync(cursor): 2026-07-18 20:04:46)
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
        return true;
    },
};
