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
 * Bouton discret (style TempVoice) : emoji seul, pas de label.
 * @param {string} customId
 * @param {string} emoji
 * @param {import('discord.js').ButtonStyle} style
 */
function iconButton(customId, emoji, style = ButtonStyle.Secondary) {
    return new ButtonBuilder().setCustomId(customId).setStyle(style).setEmoji(emoji);
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
        .setTitle('Salon vocal')
        .setDescription(
            'Cette **interface** sert à modifier ton salon vocal temporaire. Les réglages avancés restent accessibles via le salon (clic droit → modifier).'
        )
        .setFooter({
            text:
                panelMode === 'restricted'
                    ? 'Réservé au créateur et au staff — actions ci-dessous'
                    : 'Panneau public — tout le monde peut utiliser les boutons',
        });

    const secondary = ButtonStyle.Secondary;
    const danger = ButtonStyle.Danger;

    const row1 = new ActionRowBuilder().addComponents(
        iconButton(cid('rename'), '✏️', secondary),
        iconButton(cid('limit'), '👥', secondary),
        iconButton(cid('lock'), '🛡️', secondary),
        iconButton(cid('timer'), '⏱️', secondary),
        iconButton(cid('unlock'), '🔓', secondary)
    );

    const row2 = new ActionRowBuilder().addComponents(
        iconButton(cid('invite'), '➕', secondary),
        iconButton(cid('permit'), '✅', secondary),
        iconButton(cid('ring'), '📞', secondary),
        iconButton(cid('disconnect_others'), '📵', secondary),
        iconButton(cid('region'), '🌐', secondary)
    );

    const row3 = new ActionRowBuilder().addComponents(
        iconButton(cid('kick'), '🔇', secondary),
        iconButton(cid('ban_room'), '⛔', secondary),
        iconButton(cid('transfer'), '👑', secondary),
        iconButton(cid('claim'), '📌', secondary),
        iconButton(cid('delete'), '🗑️', danger)
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
