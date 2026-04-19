const path = require('path');
const {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    EmbedBuilder,
} = require('discord.js');

const { BLZ_EMBED_STRIP_INT } = require(path.join(__dirname, '..', '..', '..', 'blz-embed-theme'));

const PREFIX_BTN = 'pvr';

/** Bande latérale embed identité BLZbot. Surcharge : PRIVATE_ROOM_PANEL_COLOR (hex sans #, ex. 1b1725) */
function getPanelEmbedColor() {
    const raw = String(process.env.PRIVATE_ROOM_PANEL_COLOR || '1b1725').replace(/^#/, '');
    const n = parseInt(raw, 16);
    if (!Number.isNaN(n) && n >= 0 && n <= 0xffffff) return n;
    return BLZ_EMBED_STRIP_INT;
}

/** Rôle staff autorisé sur le panneau « restreint » (salon créé). Surcharge : PRIVATE_ROOM_STAFF_ROLE_ID */
function getPrivateRoomStaffRoleId() {
    const id = String(process.env.PRIVATE_ROOM_STAFF_ROLE_ID || '1172237685763608579').trim();
    return /^\d{17,22}$/.test(id) ? id : '1172237685763608579';
}

/**
 * @param {string} customId
 * @param {string} label
 * @param {string} emoji
 * @param {import('discord.js').ButtonStyle} style
 */
function panelButton(customId, label, emoji, style = ButtonStyle.Secondary) {
    return new ButtonBuilder()
        .setCustomId(customId)
        .setStyle(style)
        .setEmoji(emoji)
        .setLabel(String(label).slice(0, 80));
}

/**
 * @param {string} voiceChannelId
 * @param {'restricted' | 'public' | 'public_ephemeral'} panelMode — `public_ephemeral` : mêmes droits que public, IDs `e:` pour panneau ouvert en privé (éphémère).
 */
function buildPrivateVoicePanelPayload(voiceChannelId, panelMode) {
    const m = panelMode === 'restricted' ? 'r' : panelMode === 'public_ephemeral' ? 'e' : 'p';
    const cid = (action) => `${PREFIX_BTN}:${m}:${voiceChannelId}:${action}`;
    const color = getPanelEmbedColor();

    const embed = new EmbedBuilder()
        .setColor(color)
        .setTitle('Panneau — salon vocal privé')
        .setDescription(
            'Cette interface peut être utilisée pour éditer votre salon vocal temporaire.\n\n' +
                'D’autres réglages sont disponibles via le salon (clic droit → **Modifier le salon**).'
        )
        .setFooter({
            text:
                panelMode === 'restricted'
                    ? 'Réservé au créateur et au staff'
                    : panelMode === 'public_ephemeral'
                      ? 'Visible uniquement par toi — pas besoin d’être en vocal'
                      : 'Panneau public — tout le monde peut utiliser les boutons',
        });

    const secondary = ButtonStyle.Secondary;
    const danger = ButtonStyle.Danger;

    const row1 = new ActionRowBuilder().addComponents(
        panelButton(cid('rename'), 'Renommer', '✏️', secondary),
        panelButton(cid('limit'), 'Limite', '👥', secondary),
        panelButton(cid('lock'), 'Verrouiller', '🛡️', secondary),
        panelButton(cid('timer'), 'Minuteur', '⏱️', secondary),
        panelButton(cid('unlock'), 'Déverr.', '🔓', secondary)
    );

    const row2 = new ActionRowBuilder().addComponents(
        panelButton(cid('invite'), 'Inviter', '➕', secondary),
        panelButton(cid('permit'), 'Autoriser', '✅', secondary),
        panelButton(cid('ring'), 'Appeler', '📞', secondary),
        panelButton(cid('disconnect_others'), 'Déco. autres', '📵', secondary),
        panelButton(cid('region'), 'Région', '🌐', secondary)
    );

    const row3 = new ActionRowBuilder().addComponents(
        panelButton(cid('kick'), 'Expulser', '🔇', secondary),
        panelButton(cid('ban_room'), 'Ban salon', '⛔', secondary),
        panelButton(cid('transfer'), 'Transférer', '👑', secondary),
        panelButton(cid('claim'), 'Récupérer', '📌', secondary),
        panelButton(cid('delete'), 'Supprimer', '🗑️', danger)
    );

    return {
        embeds: [embed],
        components: [row1, row2, row3],
    };
}

const PREFIX_OPEN = 'pvropen';

/**
 * Message court + bouton : le clic ouvre le panneau en éphémère.
 * @param {string | null | undefined} voiceChannelId — si omis, chaque membre gère **son** salon (`pvropen:self`).
 */
function buildVocPanelOpenerPayload(voiceChannelId) {
    const selfMode = !voiceChannelId;
    const embed = new EmbedBuilder()
        .setColor(getPanelEmbedColor())
        .setTitle('Panneau vocal privé')
        .setDescription(
            selfMode
                ? 'Clique sur **Ouvrir mon panneau** pour gérer **ton** salon vocal privé (nom, limite, etc.), **depuis n’importe quel salon texte**, sans être connecté au vocal.\n\n' +
                      'Si tu n’as pas encore de salon, rejoins d’abord le lobby **Crée ton vocal**.'
                : 'Clique sur **Ouvrir le panneau** pour gérer **ce** salon vocal (réservé au créateur et au staff).\n' +
                      'L’interface ne s’affichera **que pour toi**.'
        );
    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(selfMode ? `${PREFIX_OPEN}:self` : `${PREFIX_OPEN}:${voiceChannelId}`)
            .setLabel(selfMode ? 'Ouvrir mon panneau' : 'Ouvrir le panneau')
            .setStyle(ButtonStyle.Primary)
            .setEmoji('🎛️')
    );
    return { embeds: [embed], components: [row] };
}

/**
 * @param {string} customId
 * @returns {{ restricted: boolean, voiceChannelId: string, action: string, mode: 'r' | 'p' | 'e' } | null}
 */
function parseVoicePanelButtonId(customId) {
    if (!customId.startsWith(`${PREFIX_BTN}:`)) return null;
    const parts = customId.split(':');
    if (parts.length !== 4) return null;
    const [, mode, voiceChannelId, action] = parts;
    if ((mode !== 'r' && mode !== 'p' && mode !== 'e') || !/^\d{17,22}$/.test(voiceChannelId)) return null;
    return { restricted: mode === 'r', voiceChannelId, action, mode };
}

/**
 * @param {string} customId
 */
function parseVoicePanelModalId(customId) {
    if (!customId.startsWith('pvrm:')) return null;
    const parts = customId.split(':');
    if (parts.length !== 4) return null;
    const [, mode, voiceChannelId, kind] = parts;
    if ((mode !== 'r' && mode !== 'p' && mode !== 'e') || !/^\d{17,22}$/.test(voiceChannelId)) return null;
    return { restricted: mode === 'r', voiceChannelId, kind, mode };
}

/**
 * @param {string} customId
 * @returns {{ kind: 'self' } | { kind: 'channel', channelId: string } | null}
 */
function parseVocPanelOpenId(customId) {
    if (!customId.startsWith(`${PREFIX_OPEN}:`)) return null;
    const rest = customId.slice(PREFIX_OPEN.length + 1);
    if (rest === 'self') return { kind: 'self' };
    if (/^\d{17,22}$/.test(rest)) return { kind: 'channel', channelId: rest };
    return null;
}

module.exports = {
    getPrivateRoomStaffRoleId,
    getPanelEmbedColor,
    buildPrivateVoicePanelPayload,
    buildVocPanelOpenerPayload,
    parseVoicePanelButtonId,
    parseVoicePanelModalId,
    parseVocPanelOpenId,
};
