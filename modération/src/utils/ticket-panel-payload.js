/**
 * Payload du panneau « Créer un ticket » (support / pont).
 * Partagé par /setup-ticket et par le post automatique au boot.
 */
const path = require('path');
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const CONFIG = require('../config.js');
const { BLZ_EMBED_STRIP_HEX } = require(path.join(__dirname, '..', '..', '..', 'blz-embed-theme'));

function buildTicketPanelPayload() {
    const embed = new EmbedBuilder()
        .setTitle('📩 Support - Ouvrir un ticket')
        .setDescription(
            '**Besoin d\'aide ?**\n\n' +
                'Clique sur le bouton ci-dessous pour créer un ticket et contacter l\'équipe.\n\n' +
                '> ⚠️ **Merci de ne pas ouvrir de ticket pour rien**\n' +
                '> Les abus seront sanctionnés.'
        )
        .setColor(CONFIG.TICKETS?.EMBED_COLOR || BLZ_EMBED_STRIP_HEX)
        .setFooter({ text: 'BLZstarss - Système de tickets' });

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('ticket_create')
            .setLabel('🎟️ Créer un ticket')
            .setStyle(ButtonStyle.Primary)
    );

    return { embeds: [embed], components: [row] };
}

/**
 * Si le salon `TICKETS.PANEL_CHANNEL_ID` n’a pas encore de message du bot avec le bouton
 * `ticket_create`, envoie le panneau (une seule fois au boot).
 *
 * Désactiver : `BLZ_SKIP_TICKET_PANEL_BOOT=1` dans l’environnement.
 *
 * @param {import('discord.js').Client} client
 */
async function ensureTicketPanelIfMissing(client) {
    if (['1', 'true', 'yes', 'on'].includes(String(process.env.BLZ_SKIP_TICKET_PANEL_BOOT || '').toLowerCase())) {
        return;
    }
    if (!CONFIG.TICKETS?.ENABLED) return;

    const channelId = String(CONFIG.TICKETS.PANEL_CHANNEL_ID || '').trim();
    if (!/^\d{17,22}$/.test(channelId)) {
        console.warn('[Tickets] PANEL_CHANNEL_ID invalide — pas de panneau auto.');
        return;
    }

    try {
        const channel = await client.channels.fetch(channelId).catch(() => null);
        if (!channel?.isTextBased?.()) {
            console.warn(`[Tickets] Salon panneau ${channelId} introuvable ou non textuel.`);
            return;
        }

        const me = channel.guild?.members?.me;
        if (me && !channel.permissionsFor(me).has(['ViewChannel', 'SendMessages', 'EmbedLinks'])) {
            console.warn(`[Tickets] Permissions insuffisantes pour poster le panneau dans ${channelId}.`);
            return;
        }

        const recent = await channel.messages.fetch({ limit: 30 }).catch(() => null);
        if (recent) {
            for (const msg of recent.values()) {
                if (msg.author?.id !== client.user?.id) continue;
                const rows = msg.components || [];
                for (const row of rows) {
                    for (const comp of row.components || []) {
                        if (comp.data?.custom_id === 'ticket_create' || comp.customId === 'ticket_create') {
                            if (process.env.BLZ_COMPACT_LOG !== '1') {
                                console.log(`[Tickets] Panneau déjà présent dans #${channel.name} (${channel.id}), rien à envoyer.`);
                            }
                            return;
                        }
                    }
                }
            }
        }

        await channel.send(buildTicketPanelPayload());
        console.log(`[Tickets] Panneau ticket auto-posté dans #${channel.name} (${channel.id}).`);
    } catch (err) {
        console.error('[Tickets] ensureTicketPanelIfMissing:', err?.message || err);
    }
}

module.exports = { buildTicketPanelPayload, ensureTicketPanelIfMissing };
