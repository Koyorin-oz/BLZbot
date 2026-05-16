/**
 * PebbleHost : après le pull du loader, aligne le disque sur GitHub (branch main).
 * Workflow : push GitHub → Restart Pebble → ce script → npm start.
 * Le .env n’est pas versionné (reste intact).
 *
 * Couper : BLZ_PEBBLE_GIT_RESET=0
 */
const path = require('node:path');
const fs = require('node:fs');
const { execSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..');
const REQUIRED = [
    'niveau/src/generated/reborn-slash-bodies.json',
    'reborn-test-bot/src/rebornRuntime.js',
    'orchestrator/maintemp.js',
    'niveau/src/utils/reborn-integration.js',
];

function main() {
    const off = ['0', 'false', 'no', 'off'].includes(
        String(process.env.BLZ_PEBBLE_GIT_RESET || '').trim().toLowerCase(),
    );
    if (off) return;

    const gitDir = path.join(REPO_ROOT, '.git');
    if (!fs.existsSync(gitDir)) {
        console.error('[pebble-git] Pas de dépôt .git — configure Git Management sur Pebble.');
        process.exit(1);
    }

    const branch = (process.env.BLZ_GITHUB_BRANCH || 'main').trim() || 'main';
    const gi = path.join(REPO_ROOT, '.gitignore');
    if (fs.existsSync(gi) && fs.statSync(gi).size > 50_000) {
        console.warn('[pebble-git] .gitignore anormal (>50Ko) — suppression puis reset GitHub.');
        fs.unlinkSync(gi);
    }

    try {
        console.log(`[pebble-git] Alignement sur origin/${branch} (fetch + reset --hard)…`);
        execSync(`git fetch origin ${branch}`, { cwd: REPO_ROOT, stdio: 'inherit' });
        execSync(`git reset --hard origin/${branch}`, { cwd: REPO_ROOT, stdio: 'inherit' });
        execSync('git clean -fd -e .env -e "modération/.env" -e "reborn-test-bot/.env"', {
            cwd: REPO_ROOT,
            stdio: 'inherit',
        });
        console.log('[pebble-git] Dépôt = GitHub.');
    } catch (e) {
        console.error('[pebble-git] Échec reset :', e?.message || e);
        process.exit(1);
    }

    const missing = REQUIRED.filter((rel) => !fs.existsSync(path.join(REPO_ROOT, rel)));
    if (missing.length) {
        console.error('[pebble-git] Fichiers manquants après reset (vérifie le push sur GitHub) :');
        missing.forEach((m) => console.error(`  - ${m}`));
        process.exit(1);
    }

    const mt = fs.readFileSync(path.join(REPO_ROOT, 'orchestrator/maintemp.js'), 'utf8');
    if (!mt.includes('REBORN OK')) {
        console.error('[pebble-git] maintemp.js sur le serveur ≠ version GitHub REBORN — push main puis restart.');
        process.exit(1);
    }
    console.log('[pebble-git] REBORN présent sur disque (generated + reborn-test-bot + maintemp).');
}

main();
