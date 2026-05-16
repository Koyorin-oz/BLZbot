/**
 * PebbleHost : si le git pull ne met pas à jour le disque, ce script retélécharge
 * les fichiers critiques REBORN depuis GitHub (branche main) avant npm start.
 *
 * Désactiver : BLZ_PEBBLE_GITHUB_SYNC=0 dans .env
 */
const fs = require('node:fs');
const path = require('node:path');
const https = require('node:https');

const REPO_ROOT = path.join(__dirname, '..');
const BASE =
    (process.env.BLZ_GITHUB_RAW_BASE || '').trim() ||
    'https://raw.githubusercontent.com/okoyorin-cell/BLZbot/main/';

const FILES = [
    'blz-log.js',
    'blzbot-env.js',
    'orchestrator/maintemp.js',
    'scripts/reborn-slash-preflight.js',
    'scripts/run-deploy-all.js',
    'niveau/src/utils/reborn-integration.js',
    'niveau/src/utils/deploy-commands.js',
    'niveau/src/generated/reborn-slash-bodies.json',
    'niveau/src/commands/admin/deploy-slash.js',
    'niveau/src/utils/command-loader.js',
    'scripts/pebble-sync-github.js',
    'scripts/pebble-git-hard-reset.js',
];

function fetchUrl(url) {
    return new Promise((resolve, reject) => {
        https
            .get(url, { headers: { 'User-Agent': 'BLZbot-pebble-sync' } }, (res) => {
                if (res.statusCode === 301 || res.statusCode === 302) {
                    const loc = res.headers.location;
                    if (!loc) return reject(new Error(`Redirect sans Location: ${url}`));
                    return fetchUrl(loc).then(resolve, reject);
                }
                if (res.statusCode !== 200) {
                    res.resume();
                    return reject(new Error(`HTTP ${res.statusCode} pour ${url}`));
                }
                const chunks = [];
                res.on('data', (c) => chunks.push(c));
                res.on('end', () => resolve(Buffer.concat(chunks)));
            })
            .on('error', reject);
    });
}

async function syncOne(relPath) {
    const dest = path.join(REPO_ROOT, relPath);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const url = `${BASE.replace(/\/?$/, '/')}${relPath.replace(/\\/g, '/')}`;
    const buf = await fetchUrl(url);
    if (buf.length < 20) throw new Error(`fichier trop petit (${buf.length} o)`);
    fs.writeFileSync(dest, buf);
    return buf.length;
}

async function main() {
    const off = ['0', 'false', 'no', 'off'].includes(
        String(process.env.BLZ_PEBBLE_GITHUB_SYNC || '').trim().toLowerCase(),
    );
    if (off) return;

    console.log('[pebble-sync] Sync fichiers critiques depuis GitHub (main)…');
    let ok = 0;
    for (const rel of FILES) {
        try {
            const n = await syncOne(rel);
            console.log(`[pebble-sync] OK ${rel} (${n} o)`);
            ok++;
        } catch (e) {
            console.error(`[pebble-sync] ÉCHEC ${rel}: ${e?.message || e}`);
        }
    }
    console.log(`[pebble-sync] Terminé : ${ok}/${FILES.length} fichiers.`);
    if (!fs.existsSync(marker)) {
        console.error('[pebble-sync] reborn-slash-bodies.json toujours absent — vérifie le repo GitHub.');
        process.exit(1);
    }
}

main().catch((e) => {
    console.error('[pebble-sync]', e?.message || e);
    process.exit(1);
});
