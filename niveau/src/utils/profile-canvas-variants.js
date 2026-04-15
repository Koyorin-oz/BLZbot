/**
 * Variantes visuelles pour les canvas /profile et profil guilde (aperçu /test-*).
 * Les clés sont stables (slash choices).
 */

const PROFILE_VARIANTS = ['origine', 'verre', 'signal'];
const GUILD_VARIANTS = ['bastion', 'meridien', 'ember'];

function normalizeProfileVariant(v) {
    const x = String(v || 'origine').toLowerCase();
    return PROFILE_VARIANTS.includes(x) ? x : 'origine';
}

function normalizeGuildVariant(v) {
    const x = String(v || 'bastion').toLowerCase();
    return GUILD_VARIANTS.includes(x) ? x : 'bastion';
}

/** Fusionne avec le THEME de base du canvas profil utilisateur */
function mergeProfileTheme(variant) {
    switch (normalizeProfileVariant(variant)) {
        case 'verre':
            return {
                overlay: 'rgba(6, 18, 32, 0.58)',
                header: 'rgba(255, 255, 255, 0.14)',
                panel: 'rgba(12, 28, 48, 0.55)',
                text: '#eef8ff',
                sub: 'rgba(160, 210, 255, 0.9)',
                accent: '#2dd4bf',
                outline: 'rgba(45, 212, 191, 0.38)',
                debtRed: '#fb7185',
                variantLabel: 'Verre',
            };
        case 'signal':
            return {
                overlay: 'rgba(28, 8, 6, 0.55)',
                header: 'rgba(255, 75, 40, 0.22)',
                panel: 'rgba(18, 6, 6, 0.68)',
                text: '#fff8f4',
                sub: 'rgba(255, 190, 170, 0.92)',
                accent: '#ff6b35',
                outline: 'rgba(255, 160, 100, 0.42)',
                debtRed: '#fca5a5',
                variantLabel: 'Signal',
            };
        default:
            return { variantLabel: 'Origine' };
    }
}

function mergeGuildTheme(variant) {
    switch (normalizeGuildVariant(variant)) {
        case 'meridien':
            return {
                overlay: 'rgba(5, 20, 40, 0.52)',
                header: 'rgba(255, 255, 255, 0.12)',
                panel: 'rgba(10, 30, 55, 0.58)',
                text: '#e8f4ff',
                sub: 'rgba(150, 200, 255, 0.88)',
                accent: '#38bdf8',
                outline: 'rgba(56, 189, 248, 0.4)',
                gold: '#fde68a',
                silver: '#cbd5e1',
                bronze: '#fdba74',
                variantLabel: 'Méridien',
            };
        case 'ember':
            return {
                overlay: 'rgba(22, 6, 4, 0.54)',
                header: 'rgba(255, 120, 60, 0.2)',
                panel: 'rgba(30, 10, 8, 0.72)',
                text: '#fff5f0',
                sub: 'rgba(255, 200, 170, 0.9)',
                accent: '#f97316',
                outline: 'rgba(251, 146, 60, 0.45)',
                gold: '#fcd34d',
                silver: '#e2e8f0',
                bronze: '#fdba74',
                variantLabel: 'Braise',
            };
        default:
            return { variantLabel: 'Bastion' };
    }
}

module.exports = {
    PROFILE_VARIANTS,
    GUILD_VARIANTS,
    normalizeProfileVariant,
    normalizeGuildVariant,
    mergeProfileTheme,
    mergeGuildTheme,
};
