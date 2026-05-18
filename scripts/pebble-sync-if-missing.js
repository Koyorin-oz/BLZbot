/**
 * Pebble : si le loader git n’a pas mis à jour le disque, fetch + reset sur FETCH_HEAD
 * (évite l’erreur « origin/main unknown » quand la branche de suivi n’existe pas).
 * Ne fait rien si REBORN est déjà présent. Couper : BLZ_PEBBLE_SYNC=0
 */
const fs = require('node:fs');
const path = require('node:path');
const { execSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..');
const MARKER = path.join(REPO_ROOT, 'niveau', 'src', 'generated', 'reborn-slash-bodies.json');

function main() {
    const off = ['0', 'false', 'no', 'off'].includes(
        String(process.env.BLZ_PEBBLE_SYNC || '').trim().toLowerCase(),
    );
    if (off || fs.existsSync(MARKER)) return;

    const gitDir = path.join(REPO_ROOT, '.git');
    if (!fs.existsSync(gitDir)) {
        console.warn('[pebble-sync] Pas de .git — configure Git sur Pebble ou upload le fichier generated/.');
        return;
    }

    const branch = (process.env.BLZ_GITHUB_BRANCH || 'main').trim() || 'main';
    try {
        console.log(`[pebble-sync] REBORN absent — git fetch origin ${branch} + reset FETCH_HEAD…`);
        execSync(`git fetch origin ${branch}`, { cwd: REPO_ROOT, stdio: 'inherit' });
        execSync('git reset --hard FETCH_HEAD', { cwd: REPO_ROOT, stdio: 'inherit' });
        try {
            execSync('git clean -fd', { cwd: REPO_ROOT, stdio: 'inherit' });
        } catch {
            /* ignore */
        }
        if (fs.existsSync(MARKER)) {
            console.log('[pebble-sync] OK — fichiers REBORN sur disque. Redémarre le serveur une fois.');
        } else {
            console.error('[pebble-sync] Toujours pas de reborn-slash-bodies.json — réinstalle le repo Git sur Pebble.');
        }
    } catch (e) {
        console.error('[pebble-sync] Échec :', e?.message || e);
    }
}

main();
