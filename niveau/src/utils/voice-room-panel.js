const {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    EmbedBuilder,
} = require('discord.js');

const PREFIX_BTN = 'pvr';

/** Barre latérale embed : gris anthracite unifié (proche thème Discord sombre). Surcharge : PRIVATE_ROOM_PANEL_COLOR (hex sans #, ex. 2b2d31) */
function getPanelEmbedColor() {
    const raw = String(process.env.PRIVATE_ROOM_PANEL_COLOR || '2b2d31').replace(/^#/, '');
    const n = parseInt(raw, 16);
    if (!Number.isNaN(n) && n >= 0 && n <= 0xffffff) return n;
    return 0x2b2d31;
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
 * @param {'restricted' | 'public'} panelMode
 */
function buildPrivateVoicePanelPayload(voiceChannelId, panelMode) {
    const m = panelMode === 'restricted' ? 'r' : 'p';
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

/**
 * @param {string} customId
 * @returns {{ restricted: boolean, voiceChannelId: string, action: string } | null}
 */
function parseVoicePanelButtonId(customId) {
    if (!customId.startsWith(`${PREFIX_BTN}:`)) return null;
    const parts = customId.split(':');
    if (parts.length !== 4) return null;
    const [, mode, voiceChannelId, action] = parts;
    if ((mode !== 'r' && mode !== 'p') || !/^\d{17,22}$/.test(voiceChannelId)) return null;
    return { restricted: mode === 'r', voiceChannelId, action };
}

/**
 * @param {string} customId
 */
function parseVoicePanelModalId(customId) {
    if (!customId.startsWith('pvrm:')) return null;
    const parts = customId.split(':');
    if (parts.length !== 4) return null;
    const [, mode, voiceChannelId, kind] = parts;
    if ((mode !== 'r' && mode !== 'p') || !/^\d{17,22}$/.test(voiceChannelId)) return null;
    return { restricted: mode === 'r', voiceChannelId, kind };
}

module.exports = {
    getPrivateRoomStaffRoleId,
    getPanelEmbedColor,
    buildPrivateVoicePanelPayload,
    parseVoicePanelButtonId,
    parseVoicePanelModalId,
};
