const path = require('node:path');
const fs = require('node:fs');
const logger = require('./logger');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const REBORN_RUNTIME_PATH = path.join(REPO_ROOT, 'reborn-test-bot', 'src', 'rebornRuntime.js');
const REBORN_SLASH_JSON_PATH = path.join(__dirname, '..', 'generated', 'reborn-slash-bodies.json');

let rebornRuntime = null;
let loadError = null;

function isEnabled() {
  const v = String(process.env.BLZ_REBORN_INTEGRATION ?? '1').trim().toLowerCase();
  return v !== '0' && v !== 'false' && v !== 'no';
}

function rebornAvailable() {
  return fs.existsSync(REBORN_RUNTIME_PATH);
}

function getRuntime() {
  if (!isEnabled() || !rebornAvailable()) return null;
  if (rebornRuntime) return rebornRuntime;
  if (loadError) return null;
  try {
    rebornRuntime = require(REBORN_RUNTIME_PATH);
    return rebornRuntime;
  } catch (e) {
    loadError = e;
    logger.error(
      `[reborn] Chargement rebornRuntime impossible (${REBORN_RUNTIME_PATH}):`,
      e?.message || e,
    );
    if (e?.stack) logger.error(e.stack.split('\n').slice(0, 4).join('\n'));
    return null;
  }
}

function defaultDbPath() {
  return path.join(__dirname, '..', 'database', 'reborn.sqlite');
}

function initEnvironment() {
  const rt = getRuntime();
  if (!rt) return null;
  const dbPath = (process.env.REBORN_DB_PATH || '').trim() || defaultDbPath();
  rt.initDbPath(dbPath);
  rt.applyProfilBypassEnv();
  rt.ensureDbLoaded();
  return dbPath;
}

function resolveIsOwner() {
  const { isOwner: rebornIsOwner } = require(path.join(REPO_ROOT, 'reborn-test-bot', 'src', 'lib', 'owners'));
  let botOwner;
  try {
    botOwner = require('./bot-owner');
  } catch {
    botOwner = null;
  }
  return (userId) => {
    if (botOwner?.isBotOwner?.(userId)) return true;
    return rebornIsOwner(userId);
  };
}

/**
 * @param {import('discord.js').Client} client
 * @returns {number}
 */
function loadRebornCommands(client) {
  const rt = getRuntime();
  if (!rt) return 0;
  initEnvironment();
  const n = rt.loadCommands(client, { isOwner: resolveIsOwner() });
  if (n > 0) {
    logger.info(`[reborn] ${n} commande(s) REBORN chargée(s) (écrasent les homonymes niveau).`);
  }
  return n;
}

/**
 * Corps slash REBORN pour le déploiement (écrase les noms existants).
 * @returns {Map<string, object>}
 */
function collectRebornSlashMap() {
  const rt = getRuntime();
  const map = new Map();
  if (!rt) return map;
  initEnvironment();
  for (const body of rt.collectSlashBodies()) {
    if (body?.name) map.set(body.name, body);
  }
  return map;
}

/**
 * @param {import('discord.js').Client} client
 */
function bootstrap(client) {
  const rt = getRuntime();
  if (!rt) {
    if (isEnabled() && !rebornAvailable()) {
      logger.warn('[reborn] BLZ_REBORN_INTEGRATION actif mais reborn-test-bot/src absent.');
    }
    return;
  }
  const dbPath = initEnvironment();
  logger.info(`[reborn] BDD : ${dbPath}`);
  rt.registerEarn(client);
  rt.registerReadyTasks(client);
  client.once('clientReady', async () => {
    try {
      const { refreshApplicationOwners } = require(path.join(
        REPO_ROOT,
        'reborn-test-bot',
        'src',
        'lib',
        'owners',
      ));
      await refreshApplicationOwners(client);
    } catch (e) {
      logger.warn('[reborn] refreshApplicationOwners:', e?.message || e);
    }
  });
}

/**
 * Boutons / menus REBORN (profil handoff, boutique, hacker, …).
 * @returns {Promise<boolean>}
 */
async function handleComponentInteraction(interaction) {
  const rt = getRuntime();
  if (!rt) return false;
  return rt.handleComponentInteraction(interaction, interaction.client);
}

module.exports = {
  isEnabled,
  rebornAvailable,
  initEnvironment,
  loadRebornCommands,
  collectRebornSlashMap,
  bootstrap,
  handleComponentInteraction,
};
