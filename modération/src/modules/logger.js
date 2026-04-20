const { EmbedBuilder } = require('discord.js');
const { resolveAllLogChannelId } = require('../utils/log-channel-resolve');

class Logger {
    constructor(client) {
        this.client = client;
    }

    /** Bande latérale de l’embed : couleur par type d’événement (vert / rouge / etc.), comme avant. */
    async log(guild, title, description, color, fields = [], author = null, footer = null) {
        if (!guild) {
            console.log('[DEBUG] Logger: No guild provided');
            return;
        }

        const logChannelId = resolveAllLogChannelId(guild.id);
        if (!logChannelId) {
            console.log('[DEBUG] Logger: No logChannelId configured');
            return;
        }

        if (!this.client.isReady()) {
            console.log('[DEBUG] Logger: Client not ready');
            return;
        }

        const channel = await this.client.channels.fetch(logChannelId).catch(err => {
            console.error(`[DEBUG] Logger: Failed to fetch log channel ${logChannelId}:`, err);
            return null;
        });

        if (!channel) {
            console.log(`[DEBUG] Logger: Log channel ${logChannelId} not found`);
            return;
        }

        const embed = new EmbedBuilder()
            .setTitle(title)
            .setDescription(description)
            .setColor(color != null && color !== '' ? color : '#0099ff')
            .setTimestamp();

        if (fields.length > 0) {
            embed.addFields(fields);
        }

        if (author) {
            embed.setAuthor({ name: author.tag, iconURL: author.displayAvatarURL() });
        }

        if (footer) {
            embed.setFooter({ text: footer });
        }

        await channel.send({ embeds: [embed] }).catch(err => {
            console.error('[DEBUG] Logger: Failed to send log message:', err);
        });
    }
}

module.exports = Logger;
