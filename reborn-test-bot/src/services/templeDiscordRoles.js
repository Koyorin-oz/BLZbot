/**
 * Rôles Discord « Roi du Temple » / « Légende du Temple » (suivi interne repo :
 * `GDOC-STATUT-REBORN.md` — aligné sur les seuils exportés par `temple.js`).
 *
 * IDs stockés en `meta` par hub : `temple_role_roi:<hubId>`, `temple_role_legende:<hubId>`.
 * Si aucun ID configuré → no-op (pas d’appel API Discord).
 */

const meta = require('./meta');
const users = require('./users');
const temple = require('./temple');

const pending = new Set(); // `${hubId}:${userId}`

function roiMetaKey(hubId) {
  return `temple_role_roi:${hubId}`;
}
function legendeMetaKey(hubId) {
  return `temple_role_legende:${hubId}`;
}

function getRoiRoleId(hubId) {
  return meta.get(roiMetaKey(hubId));
}
function setRoiRoleId(hubId, roleId) {
  meta.set(roiMetaKey(hubId), String(roleId));
}
function getLegendeRoleId(hubId) {
  return meta.get(legendeMetaKey(hubId));
}
function setLegendeRoleId(hubId, roleId) {
  meta.set(legendeMetaKey(hubId), String(roleId));
}

/** @type {Map<string, string>} hubId:userId -> 'roi'|'legende'|'none' */
const lastSig = new Map();

function bandForPoints(pts) {
  const p = Number(pts) || 0;
  if (p >= temple.CLASSEMENT_ROI_MIN_KEYS) return 'roi';
  if (p >= temple.CLASSEMENT_LEGENDE_MIN_KEYS && p <= temple.CLASSEMENT_LEGENDE_MAX_KEYS) return 'legende';
  return 'none';
}

/**
 * Recalcule les points Temple puis synchronise les rôles Discord optionnels.
 * @param {import('discord.js').Client} client
 * @param {string} hubId
 * @param {string} userId
 */
async function syncTempleRolesForUser(client, hubId, userId) {
  if (!client || !hubId || !userId) return { ok: false, error: 'args' };
  const roiId = getRoiRoleId(hubId);
  const legId = getLegendeRoleId(hubId);
  if (!roiId && !legId) return { ok: true, skipped: true };

  temple.sync(userId, hubId);
  const u = users.getUser(userId);
  const pts = u?.temple_points || 0;
  const band = bandForPoints(pts);
  const cacheKey = `${hubId}:${userId}`;
  if (lastSig.get(cacheKey) === band) return { ok: true, band, changed: false };

  let guild;
  try {
    guild = client.guilds.cache.get(hubId) || (await client.guilds.fetch(hubId));
  } catch {
    return { ok: false, error: 'guild' };
  }
  let member;
  try {
    member = guild.members.cache.get(userId) || (await guild.members.fetch(userId));
  } catch {
    return { ok: false, error: 'member' };
  }

  const addIf = async (rid, reason) => {
    if (rid && !member.roles.cache.has(rid)) await member.roles.add(rid, reason);
  };
  const remIf = async (rid, reason) => {
    if (rid && member.roles.cache.has(rid)) await member.roles.remove(rid, reason).catch(() => {});
  };

  try {
    if (band === 'roi') {
      await addIf(roiId, 'Temple — Roi du Temple (≥ clés seuil doc)');
      await remIf(legId, 'Temple — passage Roi');
    } else if (band === 'legende') {
      await remIf(roiId, 'Temple — sous seuil Roi');
      await addIf(legId, 'Temple — Légende (plage clés doc)');
    } else {
      await remIf(roiId, 'Temple — sous seuils');
      await remIf(legId, 'Temple — sous seuils');
    }
    lastSig.set(cacheKey, band);
    return { ok: true, band, changed: true };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
}

function queueTempleRoleSync(hubId, userId) {
  if (hubId && userId) pending.add(`${hubId}:${userId}`);
}

async function flushTempleRoleSyncQueue(client) {
  if (!client || pending.size === 0) return;
  const keys = [...pending];
  pending.clear();
  for (const k of keys) {
    const i = k.indexOf(':');
    if (i <= 0) continue;
    const hub = k.slice(0, i);
    const uid = k.slice(i + 1);
    await syncTempleRolesForUser(client, hub, uid).catch(() => {});
  }
}

function resetCacheForUser(userId) {
  for (const key of [...lastSig.keys()]) {
    if (key.endsWith(`:${userId}`)) lastSig.delete(key);
  }
}

module.exports = {
  getRoiRoleId,
  setRoiRoleId,
  getLegendeRoleId,
  setLegendeRoleId,
  syncTempleRolesForUser,
  queueTempleRoleSync,
  flushTempleRoleSyncQueue,
  resetCacheForUser,
};
