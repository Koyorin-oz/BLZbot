/**
 * Pont tickets : serveur support (salon membre + bot uniquement) ↔ serveur principal (ticket staff).
 * Les messages du membre sur le support sont relayés sur le salon ticket du main ;
 * les réponses du staff sur le main sont relayées sur le support via le bot.
 */
const {
    EmbedBuilder,
    AttachmentBuilder,
    PermissionsBitField,
} = require('discord.js');
const CONFIG = require('../config.js');
const ticketManager = require('../modules/tickets.js');

const MAX_ATTACH = 10;
const MAX_LEN = 3800;

function memberIsTicketStaff(member, ticketConfig) {
    if (!member) return false;
    if (member.permissions.has(PermissionsBitField.Flags.Administrator)) return true;
    if (member.permissions.has(PermissionsBitField.Flags.ModerateMembers)) return true;
    if (ticketConfig.PING_ROLE_ID && member.roles.cache.has(ticketConfig.PING_ROLE_ID)) return true;
    if (ticketConfig.STAFF_ACCESS_ROLE_ID && member.roles.cache.has(ticketConfig.STAFF_ACCESS_ROLE_ID)) {
        return true;
    }
    return false;
}

function canUserPostOnSupportSide(ticket, userId) {
    if (String(ticket.owner) === String(userId)) return true;
    return (ticket.addedUsers || []).some((id) => String(id) === String(userId));
}

function buildRelayEmbed({ title, description, color, footer }) {
    return new EmbedBuilder()
        .setTitle(title)
        .setDescription(description.slice(0, MAX_LEN))
        .setColor(color || CONFIG.TICKETS?.EMBED_COLOR || '#5865F2')
        .setTimestamp()
        .setFooter(footer || { text: 'Ticket relay' });
}

function collectAttachments(message) {
    const out = [];
    for (const att of message.attachments.values()) {
        if (out.length >= MAX_ATTACH) break;
        try {
            out.push(new AttachmentBuilder(att.url, { name: att.name || 'fichier' }));
        } catch {
            /* noop */
        }
    }
    return out;
}

/**
 * @returns {Promise<boolean>} true si le message a été traité (consommé) par le pont
 */
async function handleTicketBridgeMessage(message) {
    const cfg = CONFIG.TICKETS;
    if (!cfg?.ENABLED || !cfg.BRIDGE?.ENABLED) return false;

    const ticket = ticketManager.findOpenBridgedTicketByChannelId(message.channel.id);
    if (!ticket) return false;

    const fromSupport = String(message.channel.id) === String(ticket.supportChannelId);
    const fromMain = String(message.channel.id) === String(ticket.channelId);

    if (!fromSupport && !fromMain) return false;

    if (message.author.bot) return true;

    const text = (message.content || '').trim();
    const files = collectAttachments(message);
    const hasContent = text.length > 0 || files.length > 0;
    if (!hasContent) return true;

    const client = message.client;

    if (fromSupport) {
        if (!canUserPostOnSupportSide(ticket, message.author.id)) return true;

        const mainCh = await client.channels.fetch(ticket.channelId).catch(() => null);
        if (!mainCh?.isTextBased?.()) return true;

        const desc =
            `**${message.author.tag}** (depuis le serveur support)\n\n` +
            (text || '_*(pièces jointes uniquement)*_');
        await mainCh
            .send({
                embeds: [buildRelayEmbed({ title: '💬 Message du demandeur', description: desc })],
                files,
            })
            .catch((e) => console.error('[TicketBridge] relay support→main:', e));
        return true;
    }

    if (fromMain) {
        if (!memberIsTicketStaff(message.member, cfg)) return true;

        const supportCh = await client.channels.fetch(ticket.supportChannelId).catch(() => null);
        if (!supportCh?.isTextBased?.()) return true;

        const desc =
            `**${message.member?.displayName || message.author.username}** (équipe)\n\n` +
            (text || '_*(pièces jointes uniquement)*_');
        await supportCh
            .send({
                embeds: [buildRelayEmbed({ title: '💬 Réponse du staff', description: desc, color: '#57F287' })],
                files,
            })
            .catch((e) => console.error('[TicketBridge] relay main→support:', e));
        return true;
    }

    return false;
}

/**
 * Après fermeture sur un côté : synchronise l’autre salon (message + retrait vue côté support si fermeture staff).
 */
async function syncTicketBridgeOnClose(interaction, client, ticket) {
    if (!ticket?.bridge || !ticket.supportChannelId || !ticket.channelId) return;

    const isMain = String(interaction.channel.id) === String(ticket.channelId);
    const supportCh = await client.channels.fetch(ticket.supportChannelId).catch(() => null);
    const mainCh = await client.channels.fetch(ticket.channelId).catch(() => null);
    const ownerId = ticket.owner;

    if (isMain && supportCh?.isTextBased?.()) {
        try {
            await supportCh.permissionOverwrites
                .edit(ownerId, { ViewChannel: false, SendMessages: false })
                .catch(() => null);
            await supportCh
                .send({
                    embeds: [
                        new EmbedBuilder()
                            .setTitle('🔒 Ticket fermé par le staff')
                            .setDescription(
                                'Ce ticket a été fermé côté équipe. Tu ne peux plus accéder à ce salon.\n' +
                                    'Si tu as encore besoin d’aide, ouvre un nouveau ticket.'
                            )
                            .setColor('#ED4245'),
                    ],
                })
                .catch(() => null);
        } catch (e) {
            console.warn('[TicketBridge] sync support après fermeture main:', e?.message || e);
        }
    } else if (!isMain && mainCh?.isTextBased?.()) {
        await mainCh
            .send({
                embeds: [
                    new EmbedBuilder()
                        .setTitle('🔒 Fermeture côté support')
                        .setDescription(
                            `Le demandeur <@${ownerId}> a fermé le ticket depuis le serveur support.`
                        )
                        .setColor('#FEE75C'),
                ],
            })
            .catch((e) => console.warn('[TicketBridge] sync main après fermeture support:', e?.message || e));
    }
}

/**
 * Supprime l’autre salon d’un ticket pont (celui qui n’est pas `currentChannelId`).
 */
async function deleteBridgeSibling(client, ticket, currentChannelId) {
    if (!ticket?.bridge || !ticket.supportChannelId || !ticket.channelId) return;
    const otherId =
        String(currentChannelId) === String(ticket.channelId)
            ? ticket.supportChannelId
            : ticket.channelId;
    const other = await client.channels.fetch(otherId).catch(() => null);
    if (other?.deletable) await other.delete().catch(() => null);
}

module.exports = {
    handleTicketBridgeMessage,
    syncTicketBridgeOnClose,
    deleteBridgeSibling,
    memberIsTicketStaff,
};
