/**
 * Aligne le disque Pebble sur origin/main (fetch + reset --hard).
 * Utilisé par postinstall, npm start, et maintemp (bootstrap sans console).
 */
const path = require('node:path');
const fs = require('node:fs');
const { execSync } = require('node:child_process');

const DEFAULT_GITIGNORE = `node_modules/
.env
.env.*
!.env.example
credentials.json
token.json
*.db
*.sqlite
*.sqlite-shm
*.sqlite-wal
*.log
.DS_Store
`;

const REQUIRED = [
    'niveau/src/generated/reborn-slash-bodies.json',
    'reborn-test-bot/src/rebornRuntime.js',
    'orchestrator/maintemp.js',
    'niveau/src/utils/reborn-integration.js',
];

function isResetDisabled() {
    return ['0', 'false', 'no', 'off'].includes(
        String(process.env.BLZ_PEBBLE_GIT_RESET || '').trim().toLowerCase(),
    );
}

function needsSync(repoRoot) {
    const marker = path.join(repoRoot, 'niveau/src/generated/reborn-slash-bodies.json');
    if (!fs.existsSync(marker)) return true;
    const pkg = path.join(repoRoot, 'package.json');
    if (!fs.existsSync(pkg)) return true;
    const text = fs.readFileSync(pkg, 'utf8');
    return !text.includes('pebble-git-hard-reset');
}

function ensureGitignore(repoRoot) {
    const gi = path.join(repoRoot, '.gitignore');
    if (!fs.existsSync(gi)) {
        console.warn('[pebble-git] .gitignore absent — création minimale.');
        fs.writeFileSync(gi, DEFAULT_GITIGNORE, 'utf8');
    } else if (fs.statSync(gi).size > 50_000) {
        console.warn('[pebble-git] .gitignore anormal (>50Ko) — suppression.');
        fs.unlinkSync(gi);
    }
}

/**
 * @param {object} [opts]
 * @param {string} [opts.repoRoot]
 * @param {boolean} [opts.exitOnFail]
 * @param {boolean} [opts.exitAfterSync] Redémarre le process après un reset réussi (bootstrap maintemp).
 * @param {boolean} [opts.force] Ignore le test needsSync
 * @returns {boolean} true si sync OK ou déjà à jour
 */
function runPebbleGitSync(opts = {}) {
    const repoRoot = opts.repoRoot || path.join(__dirname, '..');
    if (isResetDisabled()) return true;
    if (!opts.force && !needsSync(repoRoot)) return true;

    const gitDir = path.join(repoRoot, '.git');
    if (!fs.existsSync(gitDir)) {
        const msg = '[pebble-git] Pas de .git — Git Management Pebble ou déploiement SFTP GitHub Actions.';
        if (opts.exitOnFail) {
            console.error(msg);
            process.exit(1);
        }
        console.error(msg);
        return false;
    }

    ensureGitignore(repoRoot);
    const branch = (process.env.BLZ_GITHUB_BRANCH || 'main').trim() || 'main';

    try {
        console.log(`[pebble-git] Alignement sur origin/${branch} (fetch + reset --hard)…`);
        execSync(`git fetch origin ${branch}`, { cwd: repoRoot, stdio: 'inherit' });
        execSync(`git reset --hard origin/${branch}`, { cwd: repoRoot, stdio: 'inherit' });
        execSync('git clean -fd', { cwd: repoRoot, stdio: 'inherit' });
        console.log('[pebble-git] Dépôt = GitHub.');
    } catch (e) {
        const msg = `[pebble-git] Échec reset : ${e?.message || e}`;
        if (opts.exitOnFail) {
            console.error(msg);
            process.exit(1);
        }
        console.error(msg);
        return false;
    }

    const missing = REQUIRED.filter((rel) => !fs.existsSync(path.join(repoRoot, rel)));
    if (missing.length) {
        console.error('[pebble-git] Fichiers manquants après reset :');
        missing.forEach((m) => console.error(`  - ${m}`));
        if (opts.exitOnFail) process.exit(1);
        return false;
    }

    const mt = fs.readFileSync(path.join(repoRoot, 'orchestrator/maintemp.js'), 'utf8');
    if (!mt.includes('REBORN OK') && !mt.includes('pebble-bootstrap')) {
        console.error('[pebble-git] maintemp.js ≠ version GitHub — push main puis restart.');
        if (opts.exitOnFail) process.exit(1);
        return false;
    }

    console.log('[pebble-git] REBORN présent sur disque.');

    if (opts.exitAfterSync) {
        console.log('[pebble-git] Redémarrage pour charger le nouveau code…');
        process.exit(0);
    }
    return true;
}

module.exports = { runPebbleGitSync, needsSync, isResetDisabled };
