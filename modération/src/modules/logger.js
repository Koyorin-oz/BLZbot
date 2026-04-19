const path = require('path');
const { EmbedBuilder } = require('discord.js');
const CONFIG = require('../config.js');
const { resolveAllLogChannelId } = require('../utils/log-channel-resolve');
const { BLZ_EMBED_STRIP_INT } = require(path.join(__dirname, '..', '..', '..', 'blz-embed-theme'));

class Logger {
    constructor(client) {
        this.client = client;
    }

    /** Le paramètre `color` est conservé pour compatibilité mais la bande latérale utilise toujours l’identité BLZbot. */
    async log(guild, title, description, _color, fields = [], author = null, footer = null) {
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
            .setColor(BLZ_EMBED_STRIP_INT)
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
