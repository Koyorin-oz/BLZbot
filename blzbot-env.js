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

    const id = String(process.env.TEST_GUILD_ID || BLZ_DEFAULT_TEST_GUILD_ID).trim();
    if (!/^\d{17,22}$/.test(id)) {
        console.warn('[BLZ] Mode TEST actif mais TEST_GUILD_ID invalide — override ignoré.');
        return;
    }

    const fromEnvGuild = String(process.env.GUILD_ID || '').trim();
    const explicitMain = String(process.env.BLZ_MAIN_GUILD_ID || '').trim();
    /**
     * Si BLZ_MAIN_GUILD_ID est absent et que GUILD_ID (.env) pointait vers un autre serveur que la guilde de test,
     * c’était en pratique le principal — on le copie pour le double déploiement slash.
     * Si GUILD_ID était déjà la guilde de test, ne pas copier (sinon BLZ_MAIN = test → aucun slash sur le main).
     */
    if (!/^\d{17,22}$/.test(explicitMain) && /^\d{17,22}$/.test(fromEnvGuild) && fromEnvGuild !== id) {
        process.env.BLZ_MAIN_GUILD_ID = fromEnvGuild;
    }

    process.env.GUILD_ID = id;
    const keepPanel = ['1', 'true', 'yes', 'on'].includes(
        String(process.env.BLZ_TEST_KEEP_PANEL_GUILD || '').toLowerCase()
    );
    if (!keepPanel) {
        process.env.PANEL_GUILD_ID = id;
    }
    let mainRef = String(process.env.BLZ_MAIN_GUILD_ID || '').trim();
    if (mainRef === id) {
        delete process.env.BLZ_MAIN_GUILD_ID;
        mainRef = '';
        console.warn(
            '[BLZ] BLZ_MAIN_GUILD_ID ne peut pas être la même guilde que le test — ignoré. ' +
                'Pour enregistrer les slash sur le serveur principal, mets BLZ_MAIN_GUILD_ID=<id du main> dans le .env.'
        );
    }
    if (!mainRef && fromEnvGuild === id) {
        console.warn(
            '[BLZ] Ton GUILD_ID dans le .env est déjà la guilde de test : les slash ne partiront pas sur le main tant que tu ne définis pas ' +
                'BLZ_MAIN_GUILD_ID=<id du serveur principal> (invite le bot sur ce serveur aussi).'
        );
    }
    console.warn(
        `[BLZ] ——— Mode TEST ———  GUILD_ID=${id} (runtime + slash) · serveur principal slash aussi : BLZ_MAIN_GUILD_ID=${mainRef || '—'}`
    );
}

/**
 * Guildes sur lesquelles enregistrer les slash (niveau + modération) :
 * toujours `GUILD_ID`, et en plus `BLZ_MAIN_GUILD_ID` s’il est défini (même hors mode test),
 * pour pouvoir déployer sur le serveur principal tout en gardant GUILD_ID sur un autre serveur.
 * @returns {string[]}
 */
function getSlashDeployGuildIds() {
    const ids = new Set();
    const primary = String(process.env.GUILD_ID || '').trim();
    if (/^\d{17,22}$/.test(primary)) ids.add(primary);
    const main = String(process.env.BLZ_MAIN_GUILD_ID || '').trim();
    if (/^\d{17,22}$/.test(main)) ids.add(main);
    return [...ids];
}

/** ID du serveur de test BLZ (surcharge TEST_GUILD_ID). */
function getTestGuildId() {
    return String(process.env.TEST_GUILD_ID || BLZ_DEFAULT_TEST_GUILD_ID).trim();
}

function isBlzTestGuild(guildId) {
    if (guildId == null || guildId === '') return false;
    return String(guildId) === getTestGuildId();
}

module.exports = {
    PEBBLE_HOST_ENV_PATH,
    resolveDotenvPath,
    BLZ_DEFAULT_TEST_GUILD_ID,
    isTestBotProfile,
    applyTestGuildOverride,
    getSlashDeployGuildIds,
    getTestGuildId,
    isBlzTestGuild,
};
