const path = require('node:path');
const fs = require('node:fs');
const logger = require('./logger');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const REBORN_RUNTIME_PATH = path.join(REPO_ROOT, 'reborn-test-bot', 'src', 'rebornRuntime.js');
const REBORN_SLASH_JSON_PATH = path.join(__dirname, '..', 'generated', 'reborn-slash-bodies.json');

/** Même token que modération : ne pas charger / déployer ces noms côté niveau. */
const MODERATION_RESERVED_SLASH = new Set(['mute']);

let rebornRuntime = null;
let loadError = null;

function isEnabled() {
  const v = String(process.env.BLZ_REBORN_INTEGRATION ?? '1').trim().toLowerCase();
  return v !== '0' && v !== 'false' && v !== 'no';
}

function rebornAvailable() {
  return fs.existsSync(REBORN_RUNTIME_PATH);
}

function rebornSlashJsonAvailable() {
  return fs.existsSync(REBORN_SLASH_JSON_PATH);
}

/** @returns {'guild'|'global'|'both'} — défaut guild (global Discord limité à 100 cmd / app). */
function getRebornSlashScope() {
  const v = String(process.env.BLZ_REBORN_SLASH_SCOPE || 'guild').trim().toLowerCase();
  if (v === 'global' || v === 'both') return v;
  return 'guild';
}

function loadRebornSlashFromGeneratedJson() {
  const map = new Map();
  if (!fs.existsSync(REBORN_SLASH_JSON_PATH)) return map;
  try {
    const arr = JSON.parse(fs.readFileSync(REBORN_SLASH_JSON_PATH, 'utf8'));
    if (!Array.isArray(arr)) return map;
    for (const body of arr) {
      if (body?.name) map.set(body.name, { ...body });
    }
  } catch (e) {
    logger.warn('[reborn] Lecture reborn-slash-bodies.json:', e?.message || e);
  }
  return map;
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
  let skipped = 0;
  for (const name of MODERATION_RESERVED_SLASH) {
    if (client.commands.delete(name)) skipped++;
  }
  if (n > 0) {
    logger.info(
      `[reborn] ${n - skipped} commande(s) REBORN chargée(s) (écrasent les homonymes niveau).` +
        (skipped ? ` Réservées modération : ${[...MODERATION_RESERVED_SLASH].join(', ')}.` : ''),
    );
  }
  return Math.max(0, n - skipped);
}

/**
 * Corps slash REBORN pour le déploiement (écrase les noms existants).
 * @returns {Map<string, object>}
 */
function collectRebornSlashMap() {
  const map = new Map();
  const rt = getRuntime();
  if (rt) {
    initEnvironment();
    for (const body of rt.collectSlashBodies()) {
      if (body?.name && !MODERATION_RESERVED_SLASH.has(body.name)) map.set(body.name, body);
    }
  }
  for (const name of MODERATION_RESERVED_SLASH) {
    map.delete(name);
  }
  if (isEnabled()) {
    const cached = loadRebornSlashFromGeneratedJson();
    if (map.size === 0) {
      for (const [name, body] of cached) {
        if (!MODERATION_RESERVED_SLASH.has(name)) map.set(name, body);
      }
      if (map.size > 0) {
        logger.warn(
          `[reborn] ${map.size} slash depuis generated/reborn-slash-bodies.json` +
            (rebornAvailable() ? ' (runtime vide).' : ' (reborn-test-bot absent sur le serveur).'),
        );
      }
    } else if (cached.size > 0) {
      let filled = 0;
      for (const [name, body] of cached) {
        if (MODERATION_RESERVED_SLASH.has(name) || map.has(name)) continue;
        map.set(name, body);
        filled++;
      }
      if (filled > 0) {
        logger.warn(
          `[reborn] ${filled} slash complétée(s) depuis reborn-slash-bodies.json (absentes du runtime).`,
        );
      }
    }
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

let _rebornUsersSvc = null;
function getRebornUsersService() {
  if (_rebornUsersSvc) return _rebornUsersSvc;
  const rt = getRuntime();
  if (!rt) return null;
  try {
    initEnvironment();
    _rebornUsersSvc = require(path.join(REPO_ROOT, 'reborn-test-bot', 'src', 'services', 'users'));
    return _rebornUsersSvc;
  } catch (e) {
    logger.warn('[reborn] Service users REBORN indisponible:', e?.message || e);
    return null;
  }
}

/**
 * Solde de starss REBORN (source de vérité de l'économie : boutique, daily, gains…).
 * `null` si REBORN est inactif ou si l'utilisateur n'a pas encore de ligne REBORN
 * (dans ce cas l'appelant garde la valeur niveau, évite d'afficher 0 à tort).
 * @param {string} userId
 * @returns {number|null}
 */
function getRebornStars(userId) {
  const svc = getRebornUsersService();
  if (!svc) return null;
  try {
    const row = svc.getUser(userId);
    if (!row) return null;
    const v = svc.getStars(userId);
    const big = typeof v === 'bigint' ? v : BigInt(v || 0);
    return Number(big);
  } catch (e) {
    logger.warn('[reborn] getRebornStars:', e?.message || e);
    return null;
  }
}

/**
 * RP Ranked REBORN (source de vérité du rang : /classement, rôles ranked…).
 * `null` si REBORN est inactif ou si l'utilisateur n'a pas encore de ligne REBORN
 * (dans ce cas l'appelant garde la valeur niveau).
 * @param {string} userId
 * @returns {number|null}
 */
function getRebornRp(userId) {
  const svc = getRebornUsersService();
  if (!svc) return null;
  try {
    const row = svc.getUser(userId);
    if (!row) return null;
    const v = svc.getPoints(userId);
    const big = typeof v === 'bigint' ? v : BigInt(v || 0);
    return Number(big);
  } catch (e) {
    logger.warn('[reborn] getRebornRp:', e?.message || e);
    return null;
  }
}

/** L'économie REBORN (starss) est-elle active ? */
function rebornEconomyActive() {
  return getRebornUsersService() != null;
}

/**
 * Ajoute (ou retire si delta < 0) des starss REBORN. Crée la ligne si besoin.
 * @param {string} userId
 * @param {number|bigint} delta
 * @param {string} [username]
 * @returns {number|null} nouveau solde, ou null si REBORN inactif.
 */
function addRebornStars(userId, delta, username) {
  const svc = getRebornUsersService();
  if (!svc) return null;
  try {
    svc.getOrCreate(userId, username || 'unknown');
    const d = typeof delta === 'bigint' ? delta : BigInt(Math.trunc(Number(delta) || 0));
    const n = svc.addStars(userId, d);
    return typeof n === 'bigint' ? Number(n) : Number(n || 0);
  } catch (e) {
    logger.warn('[reborn] addRebornStars:', e?.message || e);
    return null;
  }
}

module.exports = {
  isEnabled,
  rebornAvailable,
  rebornSlashJsonAvailable,
  getRebornSlashScope,
  REBORN_SLASH_JSON_PATH,
  initEnvironment,
  loadRebornCommands,
  collectRebornSlashMap,
  loadRebornSlashFromGeneratedJson,
  bootstrap,
  handleComponentInteraction,
  getRebornStars,
  getRebornRp,
  rebornEconomyActive,
  addRebornStars,
};
