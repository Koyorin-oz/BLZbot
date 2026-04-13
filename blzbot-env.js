/**
 * Résolution du fichier `.env` pour BLZbot.
 *
 * Sur PebbleHost, le File Manager place en général le `.env` à la racine du conteneur :
 *   /home/container/.env
 * (démarrage depuis la racine du dépôt cloné dans ce dossier.)
 */
const fs = require('node:fs');
const path = require('node:path');

const PEBBLE_HOST_ENV_PATH = '/home/container/.env';

/**
 * @param {...string} candidates Chemins à tester dans l’ordre (premier fichier existant gagne).
 * @returns {string}
 */
function resolveDotenvPath(...candidates) {
    const fromOverride = process.env.DOTENV_CONFIG_PATH;
    if (fromOverride && typeof fromOverride === 'string' && fs.existsSync(fromOverride)) {
        return fromOverride;
    }
    for (const p of candidates) {
        if (p && fs.existsSync(p)) {
            return p;
        }
    }
    const first = candidates.find(Boolean);
    if (first) return first;
    return PEBBLE_HOST_ENV_PATH;
}

/** Guilde dédiée aux tests (slash + fetch quand le mode TEST est actif). */
const BLZ_DEFAULT_TEST_GUILD_ID = '1493276404643532810';

function isTestBotProfile() {
    const profile = String(process.env.BLZ_BOT_PROFILE || '').toLowerCase();
    if (profile === 'test') return true;
    return ['1', 'true', 'yes', 'on'].includes(String(process.env.BLZ_TEST_MODE || '').toLowerCase());
}

/**
 * Après chargement du `.env` : si mode test, force `GUILD_ID` (et par défaut `PANEL_GUILD_ID`)
 * pour que déploiement slash, modération, niveau, orchestrateur ciblent le serveur de test.
 *
 * Surcharge la guilde : `TEST_GUILD_ID` dans l’env. Sinon = {@link BLZ_DEFAULT_TEST_GUILD_ID}.
 * Garder un panel déploié ailleurs : `BLZ_TEST_KEEP_PANEL_GUILD=1` (ne pas écraser PANEL_GUILD_ID).
 */
function applyTestGuildOverride() {
    if (!isTestBotProfile()) return;

    const fromEnvGuild = String(process.env.GUILD_ID || '').trim();
    const explicitMain = String(process.env.BLZ_MAIN_GUILD_ID || '').trim();
    /** Sert au déploiement double slash + lookups membre sur le serveur principal. */
    if (!/^\d{17,22}$/.test(explicitMain) && /^\d{17,22}$/.test(fromEnvGuild)) {
        process.env.BLZ_MAIN_GUILD_ID = fromEnvGuild;
    }

    const id = String(process.env.TEST_GUILD_ID || BLZ_DEFAULT_TEST_GUILD_ID).trim();
    if (!/^\d{17,22}$/.test(id)) {
        console.warn('[BLZ] Mode TEST actif mais TEST_GUILD_ID invalide — override ignoré.');
        return;
    }
    process.env.GUILD_ID = id;
    const keepPanel = ['1', 'true', 'yes', 'on'].includes(
        String(process.env.BLZ_TEST_KEEP_PANEL_GUILD || '').toLowerCase()
    );
    if (!keepPanel) {
        process.env.PANEL_GUILD_ID = id;
    }
    const mainRef = String(process.env.BLZ_MAIN_GUILD_ID || '').trim();
    console.warn(
        `[BLZ] ——— Mode TEST ———  GUILD_ID=${id} (runtime + slash) · serveur principal slash aussi : BLZ_MAIN_GUILD_ID=${mainRef || '—'}`
    );
}

/**
 * Guildes sur lesquelles enregistrer les slash (niveau + modération) : GUILD_ID courant,
 * et en mode TEST aussi BLZ_MAIN_GUILD_ID (prod) si différent.
 * @returns {string[]}
 */
function getSlashDeployGuildIds() {
    const ids = new Set();
    const primary = String(process.env.GUILD_ID || '').trim();
    if (/^\d{17,22}$/.test(primary)) ids.add(primary);
    if (isTestBotProfile()) {
        const main = String(process.env.BLZ_MAIN_GUILD_ID || '').trim();
        if (/^\d{17,22}$/.test(main)) ids.add(main);
    }
    return [...ids];
}

module.exports = {
    PEBBLE_HOST_ENV_PATH,
    resolveDotenvPath,
    BLZ_DEFAULT_TEST_GUILD_ID,
    isTestBotProfile,
    applyTestGuildOverride,
    getSlashDeployGuildIds,
};
