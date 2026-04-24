const path = require('path');

const localEnv = path.join(__dirname, '..', '.env');
const monorepoRootEnv = path.join(__dirname, '..', '..', '.env');

require('dotenv').config({ path: localEnv });
/** Si le token n’est que dans le `.env` racine du repo (monorepo), on le charge en secours. */
if (!String(process.env.REBORN_TEST_BOT_TOKEN || '').trim()) {
  require('dotenv').config({ path: monorepoRootEnv });
}

/** Aucune limite artificielle côté bot (cooldowns, caps internes désactivés). */
const TEST_NO_LIMITS = true;

const token = (process.env.REBORN_TEST_BOT_TOKEN || '').trim();
const clientId = (process.env.REBORN_TEST_BOT_CLIENT_ID || '').trim();
const guildId = (process.env.REBORN_TEST_GUILD_ID || '').trim() || null;

const ownerIds = new Set(
  (process.env.REBORN_TEST_OWNER_IDS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
);

/** À chaque démarrage du bot : enregistrer les slash commands (sauf si =0). */
const autoDeploySlashOnReady = String(process.env.REBORN_AUTO_DEPLOY_SLASH || '1').trim() !== '0';

/** Rôle Discord requis pour `/hacker` (salon loot). Laisser vide désactive la commande côté rôle (owner bypass). */
const hackerRoleId = (process.env.REBORN_HACKER_ROLE_ID || '').trim() || null;

const HACKER_SALON_COOLDOWN_MS = 12 * 60 * 60 * 1000;

function assertToken() {
  if (!token) {
    console.error(
      '[reborn-test-bot] Renseigne REBORN_TEST_BOT_TOKEN dans reborn-test-bot/.env (voir .env.example)',
    );
    process.exit(1);
  }
}

function assertClientIdForDeploy() {
  if (!clientId) {
    console.error('[reborn-test-bot] Renseigne REBORN_TEST_BOT_CLIENT_ID pour npm run deploy');
    process.exit(1);
  }
}

module.exports = {
  TEST_NO_LIMITS,
  token,
  clientId,
  guildId,
  ownerIds,
  autoDeploySlashOnReady,
  hackerRoleId,
  HACKER_SALON_COOLDOWN_MS,
  assertToken,
  assertClientIdForDeploy,
};
