/**
 * Régénère niveau/src/generated/reborn-slash-bodies.json (versionné pour Pebble sans reborn-test-bot).
 * Usage local : node scripts/generate-reborn-slash-json.js
 */
const path = require('node:path');
const fs = require('node:fs');

const REPO_ROOT = path.join(__dirname, '..');
const { loadBlzbotEnvFiles, applyTestGuildOverride } = require(path.join(REPO_ROOT, 'blzbot-env.js'));

loadBlzbotEnvFiles(REPO_ROOT);
applyTestGuildOverride();
process.env.BLZ_REBORN_INTEGRATION = '1';

const { collectRebornSlashMap } = require(path.join(REPO_ROOT, 'niveau', 'src', 'utils', 'reborn-integration'));

const map = collectRebornSlashMap();
if (map.size === 0) {
    console.error('[generate-reborn-slash-json] 0 commande — reborn-test-bot requis en local.');
    process.exit(1);
}

const arr = [...map.values()].map((body) => {
    const { source, ...rest } = body;
    return rest;
});

const out = path.join(REPO_ROOT, 'niveau', 'src', 'generated', 'reborn-slash-bodies.json');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, `${JSON.stringify(arr, null, 2)}\n`);
console.log(`[generate-reborn-slash-json] ${arr.length} commandes → ${path.relative(REPO_ROOT, out)}`);
