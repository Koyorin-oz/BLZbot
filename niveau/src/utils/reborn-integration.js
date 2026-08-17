const path = require('node:path');
const fs = require('node:fs');
const logger = require('./logger');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const REBORN_RUNTIME_PATH = path.join(REPO_ROOT, 'reborn-test-bot', 'src', 'rebornRuntime.js');
const REBORN_SLASH_JSON_PATH = path.join(__dirname, '..', 'generated', 'reborn-slash-bodies.json');

/** Même token que modération : ne pas charger / déployer ces noms côté niveau. */
const MODERATION_RESERVED_SLASH = new Set(['mute', 'warn']);

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

/** @type {import('discord.js').Client|null} */
let _rankSyncClient = null;

function scheduleRebornLevelRoleSync(userId, level) {
  if (!userId || !_rankSyncClient) return;
  const lv = Math.max(1, Math.floor(Number(level) || 1));
  const client = _rankSyncClient;
  setTimeout(() => {
    Promise.resolve()
      .then(async () => {
        const { forEachMemberInBlzGuilds } = require('./blz-multi-guild');
        const { updateLevelRoles } = require('./level-roles');
        await forEachMemberInBlzGuilds(client, userId, async (member) => {
          await updateLevelRoles(member, lv);
        });
      })
      .catch((e) => {
        logger.warn('[reborn] scheduleRebornLevelRoleSync:', e?.message || e);
      });
  }, 0);
}

function scheduleRebornRankSync(userId) {
  if (!userId || !_rankSyncClient) return;
  const rr = getRebornRankedRoles();
  if (!rr) return;
  let hub = '';
  try {
    const { economyGuildId } = require('./economy-scope');
    hub = String(
      economyGuildId.getStore() || process.env.GUILD_ID || process.env.BLZ_MAIN_GUILD_ID || '',
    ).trim();
  } catch {
    /* ignore */
  }
  if (!/^\d{17,22}$/.test(hub)) return;
  rr.resetCacheFor(userId);
  rr.syncRankRoleForUser(_rankSyncClient, hub, userId)
    .then((r) => {
      if (r?.error) logger.warn(`[reborn] rank sync ${userId}: ${r.error}`);
    })
    .catch((e) => {
      logger.warn('[reborn] scheduleRebornRankSync:', e?.message || e);
    });
}

/** @param {import('discord.js').Client} client */
function registerEarnGateway(client) {
  const rt = getRuntime();
  if (!rt) return false;
  initEnvironment();
  _rankSyncClient = client;
  rt.registerEarn(client);
  return true;
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
  _rankSyncClient = client;
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

function toNumberBig(v) {
  const big = typeof v === 'bigint' ? v : BigInt(v || 0);
  return Number(big);
}

/**
 * Snapshot économie joueur REBORN (source unique : profil, classement, rôles).
 * @param {string} userId
 * @param {string} [username]
 * @returns {null | { stars: number, points: number, level: number, xp: number, xp_needed: number, xp_total: number }}
 */
function getRebornEconomySnapshot(userId, username) {
  const svc = getRebornUsersService();
  if (!svc) return null;
  try {
    svc.getOrCreate(userId, username || 'unknown');
    const { totalToLevelState, T_START, MAX_LEVEL } = require(path.join(
      REPO_ROOT,
      'reborn-test-bot',
      'src',
      'reborn',
      'xpCurve',
    ));
    const row = svc.getUser(userId);
    const st = totalToLevelState(row?.xp_total ?? 0);
    const xp_needed =
      st.level < MAX_LEVEL ? T_START[st.level + 1] - T_START[st.level] : 1;
    return {
      stars: toNumberBig(svc.getStars(userId)),
      points: toNumberBig(svc.getPoints(userId)),
      level: st.level,
      xp: st.xpInto,
      xp_needed,
      xp_total: st.xpTotal,
    };
  } catch (e) {
    logger.warn('[reborn] getRebornEconomySnapshot:', e?.message || e);
    return null;
  }
}

/**
 * Solde starss REBORN. `null` seulement si REBORN inactif ; sinon 0 minimum (jamais de repli blzbot).
 */
function getRebornStars(userId, username) {
  const snap = getRebornEconomySnapshot(userId, username);
  return snap ? snap.stars : null;
}

/** RP ranked REBORN. `null` seulement si REBORN inactif. */
function getRebornRp(userId, username) {
  const snap = getRebornEconomySnapshot(userId, username);
  return snap ? snap.points : null;
}

/** L'économie REBORN est-elle active ? */
function rebornEconomyActive() {
  return getRebornUsersService() != null;
}

function getRebornLevelState(userId, username) {
  const snap = getRebornEconomySnapshot(userId, username);
  if (!snap) return null;
  return {
    level: snap.level,
    xp: snap.xp,
    xp_needed: snap.xp_needed,
    xp_total: snap.xp_total,
  };
}

/**
 * Aligne un objet user (profil niveau) sur l'économie REBORN — sans repli sur blzbot.sqlite.
 */
function applyRebornProfileEconomy(user, userId, username) {
  const snap = getRebornEconomySnapshot(userId, username);
  if (!snap) return user;
  user.stars = snap.stars;
  user.points = snap.points;
  user.level = snap.level;
  user.xp = snap.xp;
  user.xp_needed = snap.xp_needed;
  return user;
}

/** Trésorerie REBORN d'une guilde niveau (id numérique). */
function getRebornTreasuryForNiveauGuild(niveauGuildId) {
  if (!rebornEconomyActive() || !niveauGuildId) return null;
  try {
    initEnvironment();
    const pg = require(path.join(REPO_ROOT, 'reborn-test-bot', 'src', 'services', 'playerGuilds'));
    const g = pg.getGuild(String(niveauGuildId));
    if (!g || g.treasury == null) return null;
    const n = Number(g.treasury);
    return Number.isFinite(n) ? n : null;
  } catch (e) {
    logger.warn('[reborn] getRebornTreasuryForNiveauGuild:', e?.message || e);
    return null;
  }
}

function setRebornRp(userId, amount, username) {
  const svc = getRebornUsersService();
  if (!svc) return null;
  try {
    svc.getOrCreate(userId, username || 'unknown');
    const v = typeof amount === 'bigint' ? amount : BigInt(Math.max(0, Math.trunc(Number(amount) || 0)));
    svc.setPoints(userId, v);
    scheduleRebornRankSync(userId);
    return toNumberBig(svc.getPoints(userId));
  } catch (e) {
    logger.warn('[reborn] setRebornRp:', e?.message || e);
    return null;
  }
}

function setRebornStars(userId, amount, username) {
  const svc = getRebornUsersService();
  if (!svc) return null;
  try {
    svc.getOrCreate(userId, username || 'unknown');
    const v = typeof amount === 'bigint' ? amount : BigInt(Math.max(0, Math.trunc(Number(amount) || 0)));
    svc.setStars(userId, v);
    return toNumberBig(svc.getStars(userId));
  } catch (e) {
    logger.warn('[reborn] setRebornStars:', e?.message || e);
    return null;
  }
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

function getRebornRankedRoles() {
  if (!getRebornUsersService()) return null;
  try {
    initEnvironment();
    return require(path.join(REPO_ROOT, 'reborn-test-bot', 'src', 'services', 'rankedRoles'));
  } catch (e) {
    logger.warn('[reborn] rankedRoles:', e?.message || e);
    return null;
  }
}

/** Map IDs items puits (niveau) → inventaire REBORN. */
const PUITS_ITEM_TO_REBORN = {
  coffre_normal: 'coffre_classique',
  coffre_mega: 'coffre_catm',
  coffre_legendaire: 'coffre_catl',
};

/**
 * Rang affiché selon l'échelle REBORN (même logique que /classement).
 * @param {number} rp
 * @returns {{ name: string, points: number, key: string }|null}
 */
function getRebornRankDisplay(rp) {
  const rr = getRebornRankedRoles();
  if (!rr) return null;
  const r = rr.rankForRp(rp);
  return { name: r.label, points: Number(r.threshold), key: r.key };
}

/**
 * Rang + suivant pour /profil (cohérent avec /classement quand REBORN actif).
 * @param {string} userId
 * @param {number} rpFallback RP niveau si pas de ligne REBORN
 */
function resolveRankDisplay(userId, _rpFallback) {
  const { getDisplayRank, RANKS } = require('./ranks');
  if (rebornEconomyActive()) {
    const rr = getRebornRankedRoles();
    if (rr) {
      const effectiveRp = getRebornRp(userId) ?? 0;
      const rank = rr.rankForRp(effectiveRp);
      const next = rr.nextRank(effectiveRp);
      return {
        rank: { name: rank.label, points: Number(rank.threshold), key: rank.key },
        nextRank: next ? { name: next.label, points: Number(next.threshold) } : null,
        rankIndex: Math.max(0, rr.rankIndex(rank.key)),
      };
    }
  }
  const rank = getDisplayRank(userId, _rpFallback);
  const rankIndex = RANKS.findIndex((r) => r.name === rank.name);
  return {
    rank,
    nextRank: rankIndex >= 0 && rankIndex < RANKS.length - 1 ? RANKS[rankIndex + 1] : null,
    rankIndex: rankIndex >= 0 ? rankIndex : 0,
  };
}

function addRebornXp(userId, delta, username) {
  const svc = getRebornUsersService();
  if (!svc) return null;
  try {
    svc.getOrCreate(userId, username || 'unknown');
    const before = getRebornLevelState(userId, username);
    const result = svc.addXp(userId, delta);
    const newLevel = result?.level ?? getRebornLevelState(userId, username)?.level;
    if (newLevel && before && newLevel !== before.level) {
      scheduleRebornLevelRoleSync(userId, newLevel);
    }
    return result;
  } catch (e) {
    logger.warn('[reborn] addRebornXp:', e?.message || e);
    return null;
  }
}

/** Définit le niveau REBORN (source /profil, /classement). */
function setRebornLevel(userId, level, username) {
  const svc = getRebornUsersService();
  if (!svc) return null;
  try {
    svc.getOrCreate(userId, username || 'unknown');
    return svc.setPlayerLevel(userId, level);
  } catch (e) {
    logger.warn('[reborn] setRebornLevel:', e?.message || e);
    return null;
  }
}

function addRebornPoints(userId, delta, username) {
  const svc = getRebornUsersService();
  if (!svc) return null;
  try {
    svc.getOrCreate(userId, username || 'unknown');
    const d = typeof delta === 'bigint' ? delta : BigInt(Math.trunc(Number(delta) || 0));
    svc.addPoints(userId, d);
    scheduleRebornRankSync(userId);
    const v = svc.getPoints(userId);
    return typeof v === 'bigint' ? Number(v) : Number(v || 0);
  } catch (e) {
    logger.warn('[reborn] addRebornPoints:', e?.message || e);
    return null;
  }
}

function addRebornInventory(userId, itemId, qty = 1) {
  const svc = getRebornUsersService();
  if (!svc) return false;
  try {
    svc.getOrCreate(userId, 'unknown');
    const mapped = PUITS_ITEM_TO_REBORN[itemId] || itemId;
    svc.addInventory(userId, mapped, qty);
    return true;
  } catch (e) {
    logger.warn('[reborn] addRebornInventory:', e?.message || e);
    return false;
  }
}

function removeRebornInventory(userId, itemId, qty = 1) {
  const svc = getRebornUsersService();
  if (!svc?.takeInventory) return false;
  try {
    const mapped = PUITS_ITEM_TO_REBORN[itemId] || itemId;
    return Boolean(svc.takeInventory(userId, mapped, qty));
  } catch (e) {
    logger.warn('[reborn] removeRebornInventory:', e?.message || e);
    return false;
  }
}

function getRebornInventoryQty(userId, itemId) {
  const svc = getRebornUsersService();
  if (!svc?.getInventory) return null;
  try {
    const mapped = PUITS_ITEM_TO_REBORN[itemId] || itemId;
    const rows = svc.getInventory(userId);
    const hit = rows.find((r) => r.item_id === mapped);
    return hit ? Number(hit.qty) || 0 : 0;
  } catch (e) {
    logger.warn('[reborn] getRebornInventoryQty:', e?.message || e);
    return null;
  }
}

/** Inventaire REBORN au format niveau `{ item_id, quantity }[]`. */
function getRebornInventoryRows(userId) {
  const svc = getRebornUsersService();
  if (!svc?.getInventory) return null;
  try {
    return svc.getInventory(userId).map((r) => ({
      item_id: r.item_id,
      quantity: Number(r.qty) || 0,
    }));
  } catch (e) {
    logger.warn('[reborn] getRebornInventoryRows:', e?.message || e);
    return null;
  }
}

function getRebornCatalogItem(itemId) {
  if (!rebornEconomyActive()) return null;
  try {
    initEnvironment();
    const { getItem, priceFor } = require(path.join(
      REPO_ROOT,
      'reborn-test-bot',
      'src',
      'reborn',
      'catalog',
    ));
    const it = getItem(itemId);
    if (!it) return null;
    let price = 0;
    try {
      price = Number(priceFor(it));
    } catch {
      price = 0;
    }
    return {
      id: it.id,
      name: it.name,
      rarity: it.rarity,
      type: it.kind === 'boost' ? 'boost' : 'item',
      kind: it.kind || 'consumable',
      price: Number.isFinite(price) ? price : 0,
      _reborn: true,
    };
  } catch (e) {
    logger.warn('[reborn] getRebornCatalogItem:', e?.message || e);
    return null;
  }
}

function getRebornCatalogItems() {
  if (!rebornEconomyActive()) return [];
  try {
    initEnvironment();
    const { ITEMS: cat } = require(path.join(
      REPO_ROOT,
      'reborn-test-bot',
      'src',
      'reborn',
      'catalog',
    ));
    return (cat || [])
      .map((it) => getRebornCatalogItem(it.id))
      .filter(Boolean);
  } catch (e) {
    logger.warn('[reborn] getRebornCatalogItems:', e?.message || e);
    return [];
  }
}

/**
 * IDs des top joueurs depuis la BDD REBORN (starss / niveau XP).
 * @param {'stars'|'level'} field
 * @param {number} [limit]
 * @returns {{ id: string }[]|null}
 */
function getRebornTopUserIds(field, limit = 10) {
  if (!rebornEconomyActive()) return null;
  try {
    initEnvironment();
    const db = require(path.join(REPO_ROOT, 'reborn-test-bot', 'src', 'db'));
    if (field === 'stars') {
      return db
        .prepare('SELECT id FROM users ORDER BY CAST(stars AS INTEGER) DESC LIMIT ?')
        .all(limit);
    }
    if (field === 'level') {
      return db.prepare('SELECT id FROM users ORDER BY COALESCE(xp_total, 0) DESC LIMIT ?').all(limit);
    }
    return null;
  } catch (e) {
    logger.warn('[reborn] getRebornTopUserIds:', e?.message || e);
    return null;
  }
}

async function syncRebornRankRole(client, userId, hubId) {
  const rr = getRebornRankedRoles();
  if (!rr || !client || !hubId) return null;
  try {
    return await rr.syncRankRoleForUser(client, hubId, userId);
  } catch (e) {
    logger.warn('[reborn] syncRebornRankRole:', e?.message || e);
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
  registerEarnGateway,
  handleComponentInteraction,
  scheduleRebornLevelRoleSync,
  getRebornEconomySnapshot,
  getRebornStars,
  getRebornRp,
  getRebornLevelState,
  applyRebornProfileEconomy,
  getRebornTreasuryForNiveauGuild,
  setRebornRp,
  setRebornStars,
  addRebornXp,
  setRebornLevel,
  rebornEconomyActive,
  addRebornStars,
  addRebornPoints,
  getRebornRankedRoles,
  getRebornRankDisplay,
  resolveRankDisplay,
  addRebornInventory,
  removeRebornInventory,
  getRebornInventoryQty,
  getRebornInventoryRows,
  getRebornCatalogItem,
  getRebornCatalogItems,
  PUITS_ITEM_TO_REBORN,
  getRebornTopUserIds,
  syncRebornRankRole,
};
