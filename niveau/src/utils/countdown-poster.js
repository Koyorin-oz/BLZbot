const { AttachmentBuilder } = require('discord.js');
const { buildCountdownCard } = require('./canvas-countdown');
const { formatDiscordCountdownBlock } = require('./countdown-parse');
const store = require('./countdown-store');

/**
 * @param {import('discord.js').Client} client
 * @param {{ id?: number, title: string, subtitle?: string, targetMs: number, guildId: string, channelId: string }} row
 */
async function postOrRefreshCountdown(client, row) {
    const channel = await client.channels.fetch(row.channelId).catch(() => null);
    if (!channel || typeof channel.send !== 'function' && typeof channel.edit !== 'function') {
        throw new Error('Salon introuvable ou non textuel.');
    }

    const buffer = await buildCountdownCard({
        title: row.title,
        subtitle: row.subtitle,
        targetMs: row.targetMs,
    });
    const file = new AttachmentBuilder(buffer, { name: `countdown-${row.id || 'preview'}.png` });
    const content = formatDiscordCountdownBlock(row.targetMs, row.title);

    if (row.messageId) {
        const msg = await channel.messages.fetch(row.messageId).catch(() => null);
        if (msg) {
            await msg.edit({ content, files: [file] });
            return msg;
        }
    }

    const sent = await channel.send({ content, files: [file] });
    if (row.id) {
        store.updateMessage(row.id, row.channelId, sent.id);
    }
    return sent;
}

module.exports = { postOrRefreshCountdown };
