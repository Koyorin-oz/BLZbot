const fs = require('node:fs');
const path = require('node:path');
const dotenv = require('dotenv');

const envPath = path.join(__dirname, '..', '.env.insider');
if (!fs.existsSync(envPath)) {
    console.error('[insider] Fichier .env.insider introuvable. Copie .env.insider.example et renseigne-le.');
    process.exit(1);
}

const { error, parsed = {} } = dotenv.config({ path: envPath, override: true, quiet: true });
if (error) {
    console.error(`[insider] Impossible de charger .env.insider : ${error.message}`);
    process.exit(1);
}

process.env.BLZ_INSIDER_MODE = '1';

const missing = ['BOT_TOKEN', 'GUILD_ID'].filter(
    (key) => !String(parsed[key] || '').trim()
);
if (missing.length > 0) {
    console.error(`[insider] Variables obligatoires absentes de .env.insider : ${missing.join(', ')}`);
    process.exit(1);
}

console.log('[insider] Démarrage avec la configuration .env.insider.');
require('../niveau/src/index.js');
