'use strict';

/**
 * Bande latérale Discord (embed `.setColor`) et accent Containers V2 (`.setAccentColor`) — identité BLZbot.
 * Modifier ici pour tout le dépôt (sauf couleurs sémantiques volontaires : erreur rouge, succès vert, etc.).
 */
const BLZ_EMBED_STRIP_HEX = '#1B1725';

/** @param {string} [hex] @returns {number} */
function stripHexToInt(hex = BLZ_EMBED_STRIP_HEX) {
    const s = String(hex || BLZ_EMBED_STRIP_HEX).replace(/^#/, '');
    const n = parseInt(s, 16);
    return Number.isNaN(n) ? 0x1b1725 : n;
}

module.exports = {
    BLZ_EMBED_STRIP_HEX,
    BLZ_EMBED_STRIP_INT: stripHexToInt(BLZ_EMBED_STRIP_HEX),
    stripHexToInt,
};
