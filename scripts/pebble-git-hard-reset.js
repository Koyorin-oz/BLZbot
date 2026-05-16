/**
 * Pebble : après le pull du loader, force le disque = exactement GitHub main.
 * (.env reste : ignoré par git)
 *
 * Couper : BLZ_PEBBLE_GIT_RESET=0 dans .env
 */
const path = require('node:path');
const fs = require('node:fs');
const { execSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..');

function main() {
    const off = ['0', 'false', 'no', 'off'].includes(
        String(process.env.BLZ_PEBBLE_GIT_RESET || '').trim().toLowerCase(),
    );
    if (off) return;

    const gitDir = path.join(REPO_ROOT, '.git');
    if (!fs.existsSync(gitDir)) {
        console.warn('[pebble-git] Pas de .git — skip reset.');
        return;
    }

    const branch = (process.env.BLZ_GITHUB_BRANCH || 'main').trim() || 'main';
    try {
        console.log(`[pebble-git] git fetch + reset --hard origin/${branch}…`);
        execSync(`git fetch origin ${branch}`, {
            cwd: REPO_ROOT,
            stdio: 'pipe',
            encoding: 'utf8',
        });
        execSync(`git reset --hard origin/${branch}`, {
            cwd: REPO_ROOT,
            stdio: 'pipe',
            encoding: 'utf8',
        });
        console.log('[pebble-git] Dépôt aligné sur GitHub.');
    } catch (e) {
        console.warn('[pebble-git] Reset impossible (le pull Pebble + pebble-sync-github compensent) :', e?.message || e);
    }
}

main();
