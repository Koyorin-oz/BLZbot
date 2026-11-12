const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.join(__dirname, '..');
const DEFAULT_INSIDER_DATABASE_DIR = path.join(
    REPO_ROOT,
    'niveau',
    'src',
    'database',
    'insider'
);

function isInsiderMode() {
    return ['1', 'true', 'yes', 'on'].includes(
        String(process.env.BLZ_INSIDER_MODE || '').toLowerCase()
    );
}

function resolveDatabasePath(defaultPath) {
    if (!isInsiderMode()) return defaultPath;

    const configuredDir = String(process.env.BLZ_INSIDER_DATABASE_DIR || '').trim();
    const databaseDir = configuredDir
        ? path.resolve(REPO_ROOT, configuredDir)
        : DEFAULT_INSIDER_DATABASE_DIR;
    fs.mkdirSync(databaseDir, { recursive: true });

    return path.join(databaseDir, path.basename(defaultPath));
}

module.exports = { resolveDatabasePath };
