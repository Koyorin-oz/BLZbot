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
 * Bouton du panneau : lettre + libellé court + emoji (repère lisible sur mobile).
 * @param {string} customId
 * @param {string} letter
 * @param {string} shortLabel
 * @param {string} emoji
 * @param {import('discord.js').ButtonStyle} style
 */
function panelButton(customId, letter, shortLabel, emoji, style = ButtonStyle.Secondary) {
    const label = `${letter} · ${shortLabel}`.slice(0, 80);
    return new ButtonBuilder().setCustomId(customId).setStyle(style).setEmoji(emoji).setLabel(label);
}

/**
 * @param {string} voiceChannelId
 * @param {'restricted' | 'public'} panelMode
 */
function buildPrivateVoicePanelPayload(voiceChannelId, panelMode) {
    const m = panelMode === 'restricted' ? 'r' : 'p';
    const cid = (action) => `${PREFIX_BTN}:${m}:${voiceChannelId}:${action}`;
    const color = getPanelEmbedColor();

    const legend =
        '**Ligne 1** — **A** Renommer · **B** Limite de places · **C** Verrouiller (invités seulement) · **D** Minuteur auto · **E** Déverrouiller\n' +
        '**Ligne 2** — **F** Lien d’invitation · **G** Autoriser un membre · **H** Sonner / appeler · **I** Déconnecter les autres · **J** Région vocale\n' +
        '**Ligne 3** — **K** Expulser du salon · **L** Bannir du salon · **M** Transférer la propriété · **N** Récupérer le salon · **O** Supprimer le salon';

    const embed = new EmbedBuilder()
        .setColor(color)
        .setTitle('Panneau — salon vocal privé')
        .setDescription(
            `${legend}\n\nLes boutons reprennent la **lettre** et l’action. Réglages Discord supplémentaires : clic droit sur le salon → **Modifier le salon**.`
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
        panelButton(cid('rename'), 'A', 'Renommer', '✏️', secondary),
        panelButton(cid('limit'), 'B', 'Limite', '👥', secondary),
        panelButton(cid('lock'), 'C', 'Verrouiller', '🛡️', secondary),
        panelButton(cid('timer'), 'D', 'Minuteur', '⏱️', secondary),
        panelButton(cid('unlock'), 'E', 'Déverr.', '🔓', secondary)
    );

    const row2 = new ActionRowBuilder().addComponents(
        panelButton(cid('invite'), 'F', 'Inviter', '➕', secondary),
        panelButton(cid('permit'), 'G', 'Autoriser', '✅', secondary),
        panelButton(cid('ring'), 'H', 'Appeler', '📞', secondary),
        panelButton(cid('disconnect_others'), 'I', 'Déco. autres', '📵', secondary),
        panelButton(cid('region'), 'J', 'Région', '🌐', secondary)
    );

    const row3 = new ActionRowBuilder().addComponents(
        panelButton(cid('kick'), 'K', 'Expulser', '🔇', secondary),
        panelButton(cid('ban_room'), 'L', 'Ban salon', '⛔', secondary),
        panelButton(cid('transfer'), 'M', 'Transférer', '👑', secondary),
        panelButton(cid('claim'), 'N', 'Récupérer', '📌', secondary),
        panelButton(cid('delete'), 'O', 'Supprimer', '🗑️', danger)
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
