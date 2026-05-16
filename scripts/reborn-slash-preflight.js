/**
 * Vérifie que les slash REBORN sont chargeables avant un deploy (bot principal 1487192923350237244).
 * Usage : node scripts/reborn-slash-preflight.js
 */
const path = require('node:path');
const fs = require('node:fs');

const REPO_ROOT = path.join(__dirname, '..');
const RUNTIME_PATH = path.join(REPO_ROOT, 'reborn-test-bot', 'src', 'rebornRuntime.js');
const REQUIRED_NAMES = ['salon-hacker', 'admin-roles', 'itemindex', 'daily', 'boutique', 'arbre', 'quetes'];

/**
 * @param {{ exitOnFail?: boolean }} [opts]
 * @returns {{ ok: boolean, skipped?: boolean, count: number, missing?: string[], message?: string }}
 */
function assertRebornSlashReady(opts = {}) {
    const { exitOnFail = false } = opts;
    const fail = (message) => {
        if (exitOnFail) {
            console.error(message);
            process.exit(1);
        }
        return { ok: false, count: 0, message };
    };

    let integration;
    try {
        integration = require(path.join(REPO_ROOT, 'niveau', 'src', 'utils', 'reborn-integration'));
    } catch (e) {
        return fail(`[REBORN] Module reborn-integration introuvable : ${e?.message || e}`);
    }

    if (!integration.isEnabled()) {
        return { ok: true, skipped: true, count: 0 };
    }

    if (!fs.existsSync(RUNTIME_PATH)) {
        return fail(
            `[REBORN] Dossier reborn-test-bot absent sur ce serveur.\n` +
                `  Attendu : ${RUNTIME_PATH}\n` +
                `  → mets à jour le dépôt sur Pebble (git / upload) puis redémarre le serveur`,
        );
    }

    let map;
    try {
        map = integration.collectRebornSlashMap();
    } catch (e) {
        return fail(`[REBORN] Chargement des commandes impossible : ${e?.message || e}`);
    }

    if (!map || map.size === 0) {
        return fail(
            `[REBORN] 0 commande slash chargée (erreur SQLite ou require).\n` +
                `  → redémarre le serveur Pebble (install auto) · BLZ_REBORN_INTEGRATION=1 dans le .env`,
        );
    }

    const missing = REQUIRED_NAMES.filter((n) => !map.has(n));
    if (missing.length) {
        return fail(`[REBORN] Commandes critiques absentes du paquet : ${missing.join(', ')}`);
    }

    return { ok: true, count: map.size };
}

if (require.main === module) {
    const { applyProductionGuildDefaults, applyTestGuildOverride, loadBlzbotEnvFiles } = require(path.join(
        REPO_ROOT,
        'blzbot-env.js',
    ));
    loadBlzbotEnvFiles(REPO_ROOT);
    applyTestGuildOverride();
    const r = assertRebornSlashReady({ exitOnFail: true });
    console.log(`[REBORN] OK — ${r.count} commandes prêtes pour le deploy (dont /salon-hacker).`);
}

module.exports = { assertRebornSlashReady, REQUIRED_NAMES, RUNTIME_PATH };
