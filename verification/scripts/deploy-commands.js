/**
 * Déploiement manuel des commandes slash globales (/verify, /setup-verification, /unverify, /antiraid).
 * Utile si tu veux pousser les commandes sans démarrer le bot complet.
 *
 * Usage : `npm run deploy-commands` (depuis verification/)
 *      ou `npm run verification:deploy` (depuis la racine du repo)
 *
 * Voir verification/src/index.js pour l'ordre de chargement du .env et
 * la convention de nommage des variables (VERIFICATION_* en priorité).
 */
const path = require('node:path');
const fs = require('node:fs');

const candidates = [
  path.join(__dirname, '..', '.env'),
  '/home/container/.env',
  path.join(__dirname, '..', '..', '.env'),
  path.join(process.cwd(), '.env'),
];
for (const p of candidates) {
  try {
    if (p && fs.existsSync(p)) {
      require('dotenv').config({ path: p, quiet: true });
      break;
    }
  } catch { /* continue */ }
}

const { REST, Routes } = require('discord.js');
const { buildSlashCommands } = require('../src/bot');

function envWithPrefix(prefixedName, fallbackName) {
  const a = process.env[prefixedName];
  if (a && String(a).trim()) return String(a).trim();
  const b = process.env[fallbackName];
  if (b && String(b).trim()) return String(b).trim();
  return '';
}

async function main() {
  const token = envWithPrefix('VERIFICATION_BOT_TOKEN', 'BOT_TOKEN');
  if (!token) {
    console.error('Variable manquante : VERIFICATION_BOT_TOKEN (ou BOT_TOKEN).');
    process.exit(1);
  }
  const clientId = envWithPrefix('VERIFICATION_CLIENT_ID', 'DISCORD_CLIENT_ID');
  if (!clientId) {
    console.error('Variable manquante : VERIFICATION_CLIENT_ID (ou DISCORD_CLIENT_ID).');
    process.exit(1);
  }

  const rest = new REST({ version: '10' }).setToken(token);
  await rest.put(Routes.applicationCommands(clientId), { body: buildSlashCommands() });
  console.log('✅ Commandes globales enregistrées : /verify, /setup-verification, /unverify');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
