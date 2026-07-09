/**
 * Bot owner override.
 *
 * Tout ID listé dans BOT_OWNER_IDS reçoit automatiquement, sur CHAQUE interaction
 * Discord (slash, bouton, modal, autocomplete, select menu) :
 *   - `interaction.memberPermissions` = bitfield "ALL"
 *   - `interaction.member.permissions` = bitfield "ALL"
 *
 * Conséquence : toute vérification du type
 *   `interaction.member.permissions.has(PermissionFlagsBits.X)`
 *   `interaction.memberPermissions.has(PermissionFlagsBits.X)`
 * renvoie `true` automatiquement, sans modifier chaque commande individuellement.
 *
 * Pour les checks à base de rôles spécifiques (ex. STAFF_ROLES, points de vote),
 * les modules concernés doivent appeler `isBotOwner(userId)` explicitement
 * (cf. votes.js → getUserPoints, debanFormHandler.js → handleLaunchForm).
 */
const { PermissionsBitField } = require('discord.js');

const BOT_OWNER_IDS = new Set([
    '965984018216665099', // koyorin — accès super-admin total sur tout le bot
    '1278372257483456603', // admin bot — même niveau (formulaire deban sans être banni)
]);

/** IDs additionnels via .env : DEBAN_FORM_BYPASS_USER_IDS=id1,id2 */
function collectDebanBypassIds() {
    const ids = new Set(BOT_OWNER_IDS);
    const extra = String(process.env.DEBAN_FORM_BYPASS_USER_IDS || '')
        .split(/[,;\s]+/)
        .map((s) => s.trim())
        .filter((s) => /^\d{17,22}$/.test(s));
    for (const id of extra) ids.add(id);
    return ids;
}

function isBotOwner(userId) {
    if (userId === undefined || userId === null) return false;
    return BOT_OWNER_IDS.has(String(userId));
}

/**
 * Formulaire deban : bypass vérif ban, cooldown, demande active, délai 3 mois.
 */
function canBypassDebanRequirements(userId) {
    if (userId === undefined || userId === null) return false;
    return collectDebanBypassIds().has(String(userId));
}

let _allPerms = null;
function allPermissions() {
    if (!_allPerms) _allPerms = new PermissionsBitField(PermissionsBitField.All);
    return _allPerms;
}

/**
 * Monkey-patch les permissions d'une interaction si l'utilisateur est bot-owner.
 * Idempotent et silencieux : aucune erreur ne remonte si l'objet n'est pas patchable.
 */
function applyOwnerOverride(interaction) {
    try {
        if (!interaction || !interaction.user || !isBotOwner(interaction.user.id)) return false;
        const perms = allPermissions();

        try {
            Object.defineProperty(interaction, 'memberPermissions', {
                value: perms,
                configurable: true,
                writable: true,
                enumerable: true,
            });
        } catch (_) { /* noop */ }

        if (interaction.member) {
            try {
                Object.defineProperty(interaction.member, 'permissions', {
                    value: perms,
                    configurable: true,
                    writable: true,
                    enumerable: true,
                });
            } catch (_) { /* noop */ }
        }

        return true;
    } catch (_) {
        return false;
    }
}

module.exports = {
    BOT_OWNER_IDS,
    isBotOwner,
    canBypassDebanRequirements,
    applyOwnerOverride,
    allPermissions,
};
