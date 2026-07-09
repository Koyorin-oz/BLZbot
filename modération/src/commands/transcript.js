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
        }
        .embed-title {
            font-weight: 600;
            color: #ffffff;
            margin-bottom: 8px;
        }
        .embed-description {
            font-size: 14px;
            color: #dcddde;
        }
        .embed-field {
            margin-top: 8px;
        }
        .embed-field-name {
            font-weight: 600;
            font-size: 14px;
            color: #ffffff;
        }
        .embed-field-value {
            font-size: 14px;
            color: #b9bbbe;
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
    <title>Transcript - #${channel.name}</title>
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

        // Pièces jointes
        if (msg.attachments.size > 0) {
            for (const attachment of msg.attachments.values()) {
                html += `
                <div class="attachment">
                    📎 <a href="${attachment.url}" target="_blank">${escapeHtml(attachment.name)}</a>
                    ${attachment.contentType?.startsWith('image/') ? `<br><img src="${attachment.url}" style="max-width: 400px; max-height: 300px; margin-top: 8px; border-radius: 4px;">` : ''}
                </div>`;
            }
        }

        // Embeds
        for (const embed of msg.embeds) {
            html += `<div class="embed"`;
            if (embed.color) {
                html += ` style="border-left-color: #${embed.color.toString(16).padStart(6, '0')}"`;
            }
            html += `>`;

            if (embed.title) {
                html += `<div class="embed-title">${escapeHtml(embed.title)}</div>`;
            }
            if (embed.description) {
                html += `<div class="embed-description">${formatContent(embed.description)}</div>`;
            }
            for (const field of embed.fields || []) {
                html += `
                <div class="embed-field">
                    <div class="embed-field-name">${escapeHtml(field.name)}</div>
                    <div class="embed-field-value">${formatContent(field.value)}</div>
                </div>`;
            }

            html += `</div>`;
        }

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
    formatted = formatted.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank">$1</a>');

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
