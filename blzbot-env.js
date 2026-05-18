/**
 * Résolution du fichier `.env` pour BLZbot.
 *
 * Sur PebbleHost, le File Manager place en général le `.env` à la racine du conteneur :
 *   /home/container/.env
 * (démarrage depuis la racine du dépôt cloné dans ce dossier.)
 */
const fs = require('node:fs');
const path = require('node:path');
const { applyGlobalLogPolicy, isCompact, logTestModeBanner, blzWarn } = require('./blz-log');

applyGlobalLogPolicy();

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

/**
 * Charge tous les `.env` présents (racine repo, Pebble, modération).
 * Le `.env` n’est **pas** sur GitHub : après un `git pull`, il faut toujours le recréer sur l’hébergeur.
 * @param {string} [repoRoot] Racine du dépôt (parent de orchestrator/)
 * @returns {{ loadedPaths: string[] }}
 */
function loadBlzbotEnvFiles(repoRoot) {
    const root = repoRoot || path.join(__dirname);
    const candidates = [
        process.env.DOTENV_CONFIG_PATH,
        path.join(root, '.env'),
        PEBBLE_HOST_ENV_PATH,
        path.join(process.cwd(), '.env'),
        path.join(root, 'modération', '.env'),
    ];
    const loadedPaths = [];
    const seen = new Set();
    for (const p of candidates) {
        if (!p || typeof p !== 'string') continue;
        const resolved = path.resolve(p);
        if (seen.has(resolved) || !fs.existsSync(resolved)) continue;
        seen.add(resolved);
        require('dotenv').config({ path: resolved, quiet: true });
        loadedPaths.push(resolved);
    }
    for (const [key, val] of Object.entries(process.env)) {
        const trimmed = key.trim();
        if (trimmed !== key && val != null && !String(process.env[trimmed] || '').trim()) {
            process.env[trimmed] = val;
        }
    }
    return { loadedPaths };
}

/**
 * @param {string[]} keys
 * @returns {{ ok: boolean, missing: string[] }}
 */
function validateRequiredEnv(keys) {
    const missing = keys.filter((k) => !String(process.env[k] || '').trim());
    return { ok: missing.length === 0, missing };
}

/** Guilde dédiée aux tests (slash + fetch quand le mode TEST est actif). */
const BLZ_DEFAULT_TEST_GUILD_ID = '1493276404643532810';

function isTestBotProfile() {
    const profile = String(process.env.BLZ_BOT_PROFILE || '').toLowerCase();
    if (profile === 'test') return true;
    return ['1', 'true', 'yes', 'on'].includes(String(process.env.BLZ_TEST_MODE || '').toLowerCase());
}

/**
 * Prod : beaucoup de `.env` n’ont que `BLZ_MAIN_GUILD_ID` sans `GUILD_ID`.
 * L’orchestrateur et modération exigent `GUILD_ID` → repli automatique.
 */
function applyProductionGuildDefaults() {
    if (isTestBotProfile()) return;
    const guild = String(process.env.GUILD_ID || '').trim();
    const main = String(process.env.BLZ_MAIN_GUILD_ID || '').trim();
    if (!/^\d{17,22}$/.test(guild) && /^\d{17,22}$/.test(main)) {
        process.env.GUILD_ID = main;
        if (!isCompact()) {
            blzWarn('BLZ', 'GUILD_ID absent — repli depuis BLZ_MAIN_GUILD_ID pour le démarrage.');
        }
    }
    if (!String(process.env.PANEL_GUILD_ID || '').trim() && /^\d{17,22}$/.test(process.env.GUILD_ID || '')) {
        process.env.PANEL_GUILD_ID = process.env.GUILD_ID;
    }
}

/**
 * Après chargement du `.env` : si mode test, force `GUILD_ID` (et par défaut `PANEL_GUILD_ID`)
 * pour que déploiement slash, modération, niveau, orchestrateur ciblent le serveur de test.
 *
 * Surcharge la guilde : `TEST_GUILD_ID` dans l’env. Sinon = {@link BLZ_DEFAULT_TEST_GUILD_ID}.
 * Garder un panel déploié ailleurs : `BLZ_TEST_KEEP_PANEL_GUILD=1` (ne pas écraser PANEL_GUILD_ID).
 */
function applyTestGuildOverride() {
    if (!isTestBotProfile()) {
        applyProductionGuildDefaults();
        return;
    }

    const id = String(process.env.TEST_GUILD_ID || BLZ_DEFAULT_TEST_GUILD_ID).trim();
    if (!/^\d{17,22}$/.test(id)) {
        blzWarn('BLZ', 'Mode TEST actif mais TEST_GUILD_ID invalide — override ignoré.');
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
        if (!isCompact()) {
            blzWarn(
                'BLZ',
                'BLZ_MAIN_GUILD_ID = guilde de test — ignoré. Pour le main : BLZ_MAIN_GUILD_ID=<id serveur principal>.',
            );
        }
    }
    if (!isCompact() && !mainRef && fromEnvGuild === id) {
        blzWarn(
            'BLZ',
            'GUILD_ID = guilde de test : slash main absents tant que BLZ_MAIN_GUILD_ID n’est pas défini.',
        );
    }
    logTestModeBanner(id, mainRef || '');
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

/** L’orchestrateur lance `run-deploy-all.js` (évite 3 deploys concurrents qui font disparaître les slash). */
function isOrchestratorSlashDeployEnabled() {
    const raw = process.env.BLZ_AUTO_DEPLOY_SLASH;
    return !['0', 'false', 'no', 'off'].includes(String(raw ?? '1').toLowerCase());
}

module.exports = {
    PEBBLE_HOST_ENV_PATH,
    resolveDotenvPath,
    loadBlzbotEnvFiles,
    validateRequiredEnv,
    applyProductionGuildDefaults,
    BLZ_DEFAULT_TEST_GUILD_ID,
    isTestBotProfile,
    applyTestGuildOverride,
    getSlashDeployGuildIds,
    getTestGuildId,
    isBlzTestGuild,
};
