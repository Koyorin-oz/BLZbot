const fs = require('node:fs');
const path = require('node:path');
const { loadInsiderEnvironment } = require('./insider-environment');

const envPath = path.join(__dirname, '..', '.insider.env');
if (!fs.existsSync(envPath)) {
    console.error('[insider] Fichier .insider.env introuvable. Copie .insider.env.example et renseigne-le.');
    process.exit(1);
}

let parsed;
try {
    parsed = loadInsiderEnvironment(envPath, path.join(__dirname, '..', '.env'));
} catch (error) {
    console.error(`[insider] Impossible de charger .insider.env : ${error.message}`);
    process.exit(1);
}

const missing = ['BOT_TOKEN', 'GUILD_ID'].filter(
    (key) => !String(parsed[key] || '').trim()
);
if (missing.length > 0) {
    console.error(`[insider] Variables obligatoires absentes de .insider.env : ${missing.join(', ')}`);
    process.exit(1);
}

console.log('[insider] Configuration active : .insider.env (.env ignoré).');
require('../niveau/src/index.js');
