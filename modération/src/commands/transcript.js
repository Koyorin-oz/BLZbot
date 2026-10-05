const { SlashCommandBuilder, PermissionFlagsBits, AttachmentBuilder } = require('discord.js');
const { denyUnlessCanMod } = require('../utils/mod-access');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('transcript')
        .setDescription('Générer un transcript de messages')
        .setDefaultMemberPermissions(null)
        .addSubcommand(subcommand =>
            subcommand
                .setName('salon')
                .setDescription('Transcript d\'un salon entier')
                .addChannelOption(option =>
                    option.setName('salon')
                        .setDescription('Salon à transcrire (défaut: salon actuel)')
                        .setRequired(false))
                .addIntegerOption(option =>
                    option.setName('limite')
                        .setDescription('Nombre de messages max (défaut: 100, max: 500)')
                        .setRequired(false)
                        .setMinValue(10)
                        .setMaxValue(500)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('message')
                .setDescription('Transcript d\'un message spécifique')
                .addStringOption(option =>
                    option.setName('message_id')
                        .setDescription('ID du message à transcrire')
                        .setRequired(true))),

    async execute(interaction) {
        const denied = denyUnlessCanMod(interaction, PermissionFlagsBits.ModerateMembers);
        if (denied) {
            return interaction.reply({ ...denied, ephemeral: true });
        }

        const subcommand = interaction.options.getSubcommand();

        if (subcommand === 'salon') {
            await handleChannelTranscript(interaction);
        } else if (subcommand === 'message') {
            await handleMessageTranscript(interaction);
        }
    }
};

/**
 * Génère un transcript de tout un salon
 */
async function handleChannelTranscript(interaction) {
    const channel = interaction.options.getChannel('salon') || interaction.channel;
    const limit = interaction.options.getInteger('limite') || 100;

    // Vérifier les permissions
    if (!channel.permissionsFor(interaction.guild.members.me).has('ViewChannel')) {
        return interaction.reply({
            content: '❌ Je n\'ai pas accès à ce salon.',
            ephemeral: true
        });
    }

    await interaction.deferReply();

    try {
        // Récupérer les messages
        const messages = await fetchAllMessages(channel, limit);

        if (messages.length === 0) {
            return interaction.editReply({
                content: '❌ Aucun message trouvé dans ce salon.'
            });
        }

        // Générer le HTML
        const html = generateHtmlTranscript(channel, messages, interaction.guild);

        // Créer le fichier
        const buffer = Buffer.from(html, 'utf8');
        const attachment = new AttachmentBuilder(buffer, {
            name: `transcript-${channel.name}-${Date.now()}.html`
        });

        await interaction.editReply({
            content: `📜 Transcript de ${channel} générés avec ${messages.length} message(s)`,
            files: [attachment]
        });

    } catch (error) {
        console.error('[Transcript] Erreur:', error);
        await interaction.editReply({
            content: '❌ Une erreur est survenue lors de la génération du transcript.'
        });
    }
}

/**
 * Génère un transcript d'un message spécifique
 */
async function handleMessageTranscript(interaction) {
    const messageId = interaction.options.getString('message_id');

    await interaction.deferReply();

    try {
        // Essayer de trouver le message dans le salon actuel
        let message;
        try {
            message = await interaction.channel.messages.fetch(messageId);
        } catch {
            return interaction.editReply({
                content: '❌ Message introuvable dans ce salon.'
            });
        }

        // Générer le HTML pour un seul message
        const html = generateHtmlTranscript(interaction.channel, [message], interaction.guild);

        const buffer = Buffer.from(html, 'utf8');
        const attachment = new AttachmentBuilder(buffer, {
            name: `transcript-message-${messageId}.html`
        });

        await interaction.editReply({
            content: `📜 Transcript du message \`${messageId}\``,
            files: [attachment]
        });

    } catch (error) {
        console.error('[Transcript] Erreur:', error);
        await interaction.editReply({
            content: '❌ Une erreur est survenue lors de la génération du transcript.'
        });
    }
}

/**
 * Récupère tous les messages d'un salon (avec pagination)
 */
async function fetchAllMessages(channel, limit) {
    const messages = [];
    let lastId;

    while (messages.length < limit) {
        const options = { limit: Math.min(100, limit - messages.length) };
        if (lastId) options.before = lastId;

        const batch = await channel.messages.fetch(options);
        if (batch.size === 0) break;

        messages.push(...batch.values());
        lastId = batch.last().id;

        if (batch.size < 100) break;
    }

    // Trier par date (plus ancien en premier)
    return messages.sort((a, b) => a.createdTimestamp - b.createdTimestamp);
}

/**
 * Génère le HTML du transcript
 */
function generateHtmlTranscript(channel, messages, guild) {
    const css = `
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            background-color: #36393f;
            color: #dcddde;
            padding: 20px;
        }
        .header {
            background: linear-gradient(135deg, #5865f2, #7289da);
            padding: 20px;
            border-radius: 10px;
            margin-bottom: 20px;
            color: white;
        }
        .header h1 { font-size: 24px; margin-bottom: 10px; }
        .header p { opacity: 0.9; font-size: 14px; }
        .message {
            display: flex;
            padding: 10px 15px;
            margin: 2px 0;
            border-radius: 4px;
        }
        .message:hover { background-color: #32353b; }
        .avatar {
            width: 40px;
            height: 40px;
            border-radius: 50%;
            margin-right: 15px;
            flex-shrink: 0;
        }
        .content { flex: 1; min-width: 0; }
        .author {
            display: flex;
            align-items: baseline;
            gap: 8px;
            margin-bottom: 4px;
        }
        .author-name {
            font-weight: 600;
            color: #ffffff;
        }
        .timestamp {
            font-size: 12px;
            color: #72767d;
        }
        .text {
            line-height: 1.4;
            word-wrap: break-word;
        }
        .attachment {
            margin-top: 8px;
            padding: 10px;
            background: #1B1725;
            border-radius: 4px;
            border-left: 3px solid #5865f2;
        }
        .attachment a { color: #00aff4; }
        .embed {
            margin-top: 8px;
            padding: 12px;
            background: #1B1725;
            border-radius: 4px;
            border-left: 4px solid #5865f2;
            max-width: 520px;
            overflow: hidden;
        }
        .forwarded {
            margin-top: 8px;
            padding: 10px 12px;
            background: #2b2d31;
            border: 1px solid #3f4147;
            border-radius: 4px;
        }
        .forwarded-label {
            margin-bottom: 8px;
            color: #b5bac1;
            font-size: 12px;
            font-weight: 600;
        }
        .forwarded-author, .embed-author, .embed-footer {
            display: flex;
            align-items: center;
            gap: 6px;
            margin-bottom: 6px;
            font-size: 12px;
            color: #b5bac1;
        }
        .forwarded-author img, .embed-author img, .embed-footer img {
            width: 20px;
            height: 20px;
            border-radius: 50%;
            object-fit: cover;
        }
        .embed-author img, .embed-footer img { border-radius: 3px; }
        .embed-title a { color: #00aff4; text-decoration: none; }
        .embed-title a:hover { text-decoration: underline; }
        .embed-content { display: flow-root; }
        .embed-thumbnail {
            float: right;
            max-width: 80px;
            max-height: 80px;
            margin: 0 0 8px 12px;
            border-radius: 4px;
            object-fit: contain;
        }
        .embed-image, .attachment-image, .attachment-video {
            display: block;
            max-width: min(100%, 520px);
            max-height: 420px;
            margin-top: 8px;
            border-radius: 4px;
        }
        .attachment-video { background: #000; }
        .attachment audio { display: block; max-width: min(100%, 420px); margin-top: 8px; }
        .embed-fields { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; margin-top: 8px; }
        .embed-field.inline { min-width: 0; }
        .embed-field:not(.inline) { grid-column: 1 / -1; }
        .embed-field-name { font-weight: 600; font-size: 14px; color: #ffffff; }
        .embed-field-value { font-size: 14px; color: #b9bbbe; }
        .embed-footer { margin: 8px 0 0; }
        .embed-footer img { width: 16px; height: 16px; }
        .embed-timestamp, .attachment-size { color: #949ba4; font-size: 12px; }
        .embed-provider { color: #b5bac1; font-size: 12px; margin-bottom: 4px; }
        .sticker { display: inline-flex; flex-direction: column; margin-top: 8px; color: #b5bac1; font-size: 12px; }
        .sticker img { width: 120px; height: 120px; object-fit: contain; }
        .poll, .message-components { margin-top: 8px; padding: 10px; background: #232428; border-radius: 4px; }
        .poll-question { font-weight: 600; color: #f2f3f5; margin-bottom: 8px; }
        .poll-answer, .component-label { padding: 7px 10px; margin-top: 4px; background: #383a40; border-radius: 4px; }
        .poll-votes { color: #b5bac1; font-size: 12px; }
        .component-label { display: inline-block; margin-right: 6px; color: #dbdee1; }
        @media (max-width: 600px) {
            body { padding: 10px; }
            .embed-fields { grid-template-columns: minmax(0, 1fr); }
            .embed-field:not(.inline) { grid-column: auto; }
            .embed-field.inline { grid-column: auto; }
        }
        .embed-description {
            font-size: 14px;
            color: #dcddde;
        }
        .embed-title {
            font-weight: 600;
            color: #ffffff;
            margin-bottom: 8px;
        }
        .system-message {
            padding: 8px 15px;
            color: #72767d;
            font-style: italic;
            font-size: 14px;
        }
        .footer {
            margin-top: 20px;
            padding: 15px;
            background: #1B1725;
            border-radius: 8px;
            text-align: center;
            color: #72767d;
            font-size: 12px;
        }
    `;

    let html = `<!DOCTYPE html>
<html lang="fr">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Transcript - #${escapeHtml(channel.name)}</title>
    <style>${css}</style>
</head>
<body>
    <div class="header">
        <h1>#${escapeHtml(channel.name)}</h1>
        <p>Serveur: ${escapeHtml(guild.name)}</p>
        <p>Généré le: ${new Date().toLocaleString('fr-FR')}</p>
        <p>Messages: ${messages.length}</p>
    </div>
    <div class="messages">`;

    for (const msg of messages) {
        const avatar = msg.author.displayAvatarURL({ extension: 'png', size: 64 });
        const timestamp = new Date(msg.createdTimestamp).toLocaleString('fr-FR');

        html += `
        <div class="message">
            <img class="avatar" src="${avatar}" alt="Avatar">
            <div class="content">
                <div class="author">
                    <span class="author-name">${escapeHtml(msg.author.tag)}</span>
                    <span class="timestamp">${timestamp}</span>
                </div>`;

        if (msg.content) {
            html += `<div class="text">${formatContent(msg.content)}</div>`;
        }

        const snapshots = msg.messageSnapshots?.values?.() || [];
        for (const snapshot of snapshots) {
            html += renderForwardedSnapshot(snapshot);
        }
        html += renderAttachments(msg.attachments);
        html += renderEmbeds(msg.embeds);
        html += renderPoll(msg.poll);
        html += renderComponents(msg.components);
        html += renderStickers(msg.stickers);

        html += `
            </div>
        </div>`;
    }

    html += `
    </div>
    <div class="footer">
        Transcript généré par BLZstarss Bot
    </div>
</body>
</html>`;

    return html;
}

function renderForwardedSnapshot(snapshot) {
    const data = snapshot.message || snapshot;
    const author = data.author || snapshot.author;
    const authorName = author?.globalName || author?.username || author?.tag || 'Auteur original';
    const avatarUrl = typeof author?.displayAvatarURL === 'function'
        ? author.displayAvatarURL({ extension: 'png', size: 64 })
        : '';
    const timestamp = data.timestamp || data.createdAt || snapshot.timestamp;
    const dateText = timestamp ? new Date(timestamp).toLocaleString('fr-FR') : '';
    let html = '<div class="forwarded"><div class="forwarded-label">Message transféré</div>';

    if (author) {
        html += '<div class="forwarded-author">';
        if (avatarUrl) html += `<img src="${escapeHtml(avatarUrl)}" alt="">`;
        html += `<span>${escapeHtml(authorName)}</span>${dateText ? `<span class="timestamp">${escapeHtml(dateText)}</span>` : ''}</div>`;
    }
    if (data.content) html += `<div class="text">${formatContent(data.content)}</div>`;
    html += renderAttachments(data.attachments || snapshot.attachments);
    html += renderEmbeds(data.embeds || snapshot.embeds);
    html += renderPoll(data.poll || snapshot.poll);
    html += renderComponents(data.components || snapshot.components);
    html += renderStickers(data.stickers || data.stickerItems || snapshot.stickers);

    return `${html}</div>`;
}

function renderAttachments(attachments) {
    if (!attachments) return '';
    let html = '';
    const items = attachments.values?.() || attachments;

    for (const attachment of items) {
        if (!attachment?.url) continue;
        const url = safeUrl(attachment.url);
        if (!url) continue;
        const name = escapeHtml(attachment.name || 'Pièce jointe');
        const contentType = attachment.contentType || '';
        const isImage = contentType.startsWith('image/') || /\.(png|jpe?g|gif|webp|avif)(\?|$)/i.test(attachment.url);
        const isVideo = contentType.startsWith('video/') || /\.(mp4|webm|mov)(\?|$)/i.test(attachment.url);
        const isAudio = contentType.startsWith('audio/') || /\.(mp3|ogg|wav|m4a|flac)(\?|$)/i.test(attachment.url);

        html += `<div class="attachment">📎 <a href="${url}" target="_blank" rel="noopener noreferrer">${name}</a>`;
        if (attachment.size) html += ` <span class="attachment-size">(${formatFileSize(attachment.size)})</span>`;
        if (isImage) html += `<img class="attachment-image" src="${url}" alt="${name}">`;
        else if (isVideo) html += `<video class="attachment-video" src="${url}" controls preload="metadata"></video>`;
        else if (isAudio) html += `<audio src="${url}" controls preload="metadata"></audio>`;
        html += '</div>';
    }

    return html;
}

function renderEmbeds(embeds) {
    if (!embeds) return '';
    let html = '';

    for (const embed of embeds) {
        if (!embed) continue;
        const color = Number.isInteger(embed.color) ? ` style="border-left-color: #${embed.color.toString(16).padStart(6, '0')}"` : '';
        html += `<div class="embed"${color}>`;

        if (embed.provider?.name) html += `<div class="embed-provider">${escapeHtml(embed.provider.name)}</div>`;
        if (embed.author?.name) {
            html += '<div class="embed-author">';
            const authorIcon = safeUrl(embed.author.iconURL);
            if (authorIcon) html += `<img src="${authorIcon}" alt="">`;
            const authorLink = safeUrl(embed.author.url);
            html += authorLink
                ? `<a href="${authorLink}" target="_blank" rel="noopener noreferrer">${escapeHtml(embed.author.name)}</a></div>`
                : `<span>${escapeHtml(embed.author.name)}</span></div>`;
        }
        const thumbnailUrl = safeUrl(embed.thumbnail?.url);
        if (thumbnailUrl) html += `<img class="embed-thumbnail" src="${thumbnailUrl}" alt="">`;
        if (embed.title) {
            const title = escapeHtml(embed.title);
            const embedUrl = safeUrl(embed.url);
            html += `<div class="embed-title">${embedUrl ? `<a href="${embedUrl}" target="_blank" rel="noopener noreferrer">${title}</a>` : title}</div>`;
        }
        if (embed.description) html += `<div class="embed-description">${formatContent(embed.description)}</div>`;

        if (embed.fields?.length) {
            html += '<div class="embed-fields">';
            for (const field of embed.fields) {
                html += `<div class="embed-field${field.inline ? ' inline' : ''}"><div class="embed-field-name">${escapeHtml(field.name)}</div><div class="embed-field-value">${formatContent(field.value)}</div></div>`;
            }
            html += '</div>';
        }
        const imageUrl = safeUrl(embed.image?.url);
        if (imageUrl) html += `<img class="embed-image" src="${imageUrl}" alt="">`;
        const videoUrl = safeUrl(embed.video?.url);
        if (videoUrl) html += `<video class="attachment-video" src="${videoUrl}" controls preload="metadata"></video>`;
        if (embed.footer?.text || embed.timestamp) {
            html += '<div class="embed-footer">';
            const footerIcon = safeUrl(embed.footer?.iconURL);
            if (footerIcon) html += `<img src="${footerIcon}" alt="">`;
            if (embed.footer?.text) html += `<span>${escapeHtml(embed.footer.text)}</span>`;
            if (embed.timestamp) html += `<span class="embed-timestamp">${escapeHtml(new Date(embed.timestamp).toLocaleString('fr-FR'))}</span>`;
            html += '</div>';
        }
        html += '</div>';
    }

    return html;
}

function renderPoll(poll) {
    if (!poll) return '';
    const question = poll.question?.text || poll.question || 'Sondage';
    let html = `<div class="poll"><div class="poll-question">${formatContent(String(question))}</div>`;
    const answers = poll.answers?.values?.() || poll.answers || [];

    for (const answer of answers) {
        const emoji = answer.emoji?.name || '';
        const votes = Number.isFinite(answer.voteCount) ? `<span class="poll-votes">${answer.voteCount} vote(s)</span>` : '';
        html += `<div class="poll-answer">${emoji ? `${escapeHtml(emoji)} ` : ''}${formatContent(answer.text || '')} ${votes}</div>`;
    }

    return `${html}</div>`;
}

function renderComponents(rows) {
    if (!rows?.length) return '';
    const labels = [];

    for (const row of rows) {
        for (const component of row.components || []) {
            if (component.label) labels.push(component.label);
            else if (component.placeholder) labels.push(component.placeholder);
        }
    }

    if (!labels.length) return '';
    return `<div class="message-components">${labels.map(label => `<span class="component-label">${escapeHtml(label)}</span>`).join('')}</div>`;
}

function renderStickers(stickers) {
    if (!stickers) return '';
    let html = '';
    for (const sticker of stickers.values?.() || stickers) {
        const stickerUrl = safeUrl(sticker.url || sticker.imageURL?.());
        const name = escapeHtml(sticker.name || 'Autocollant');
        html += `<div class="sticker">${stickerUrl ? `<img src="${stickerUrl}" alt="${name}">` : ''}<span>${name}</span></div>`;
    }
    return html;
}

function safeUrl(value) {
    if (!value) return '';
    try {
        const url = new URL(String(value).replace(/&amp;/g, '&'));
        return ['http:', 'https:'].includes(url.protocol) ? escapeHtml(url.href) : '';
    } catch {
        return '';
    }
}

function formatFileSize(bytes) {
    if (bytes < 1024) return `${bytes} o`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} Ko`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
}

/**
 * Échappe les caractères HTML
 */
function escapeHtml(text) {
    if (!text) return '';
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

/**
 * Formate le contenu avec le markdown Discord basique
 */
function formatContent(text) {
    if (!text) return '';

    let formatted = escapeHtml(text);

    // Liens
    formatted = formatted.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_match, label, target) => {
        const href = safeUrl(target);
        return href ? `<a href="${href}" target="_blank" rel="noopener noreferrer">${label}</a>` : label;
    });

    // Gras
    formatted = formatted.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

    // Italique
    formatted = formatted.replace(/\*([^*]+)\*/g, '<em>$1</em>');

    // Code inline
    formatted = formatted.replace(/`([^`]+)`/g, '<code style="background: #1B1725; padding: 2px 6px; border-radius: 3px;">$1</code>');

    // Mentions utilisateur
    formatted = formatted.replace(/&lt;@!?(\d+)&gt;/g, '<span style="color: #7289da; background: rgba(114, 137, 218, 0.1); padding: 0 2px; border-radius: 3px;">@User</span>');

    // Mentions salon
    formatted = formatted.replace(/&lt;#(\d+)&gt;/g, '<span style="color: #7289da; background: rgba(114, 137, 218, 0.1); padding: 0 2px; border-radius: 3px;">#channel</span>');

    // Sauts de ligne
    formatted = formatted.replace(/\n/g, '<br>');

    return formatted;
}
