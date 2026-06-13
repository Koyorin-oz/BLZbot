/**
 * Rôles Discord des events Espace / Océan (8 rôles de quête).
 *
 * IDs stockés en DB (`meta`) par hub : `event_role_<roleKey>:<hubId>`.
 * `/event-admin creer-roles` les crée, `syncEventRolesForUser` les attribue
 * en fonction des quêtes réclamées (`event_quests_claimed`).
 */

const meta = require('./meta');
const { allRoleEntries } = require('../reborn/eventConfig');

/**
 * IDs de rôles Discord fournis manuellement (le bot ne crée plus de rôle).
 * Colle ici l'ID du rôle Discord que TU as créé pour chaque quête d'event.
 * Prioritaire sur la config en base.
 * @type {Record<string, string>}
 */
const EVENT_ROLE_IDS = {
  meteore: '',
  galaxien: '',
  lumineux: '',
  egocentrique: '',
  eau: '',
  perdu: '',
  marin: '',
  roi: '',
};

function metaKey(hubId, roleKey) {
  return `event_role_${roleKey}:${hubId}`;
}

function getRoleId(hubId, roleKey) {
  const hard = EVENT_ROLE_IDS[roleKey];
  if (hard) return hard;
  return meta.get(metaKey(hubId, roleKey));
}

function setRoleId(hubId, roleKey, roleId) {
  meta.set(metaKey(hubId, roleKey), String(roleId));
}

/** Liste des rôles configurés (avec id ou null). */
function listConfigured(hubId) {
  return allRoleEntries().map((e) => ({ ...e, roleId: getRoleId(hubId, e.roleKey) || null }));
}

/**
 * Création automatique désactivée : le bot ne crée plus de rôle.
 * Configure les IDs en dur dans `EVENT_ROLE_IDS` (ou en base).
 * @param {import('discord.js').Guild} guild
 */
async function createRoles(guild) {
  void guild;
  return { created: [], skipped: [], failed: [], disabled: true };
}

const lastApplied = new Map(); // `${hubId}:${userId}` -> "set of role keys" signature

/**
 * Attribue à un membre les rôles d'event correspondant à ses quêtes réclamées.
 * Ne retire jamais un rôle déjà gagné (achievements permanents).
 *
 * @param {import('discord.js').Client} client
 * @param {string} hubDiscordId
 * @param {string} userId
 * @param {string[]} claimedRoleKeys — roleKeys des quêtes réclamées
 */
async function syncEventRolesForUser(client, hubDiscordId, userId, claimedRoleKeys) {
  if (!client || !hubDiscordId || !userId) return { ok: false, error: 'arguments' };
  const wanted = [...new Set(claimedRoleKeys || [])]
    .map((rk) => ({ rk, roleId: getRoleId(hubDiscordId, rk) }))
    .filter((x) => x.roleId);
  if (!wanted.length) return { ok: true, changed: false };
  const sig = wanted.map((w) => w.rk).sort().join(',');
  const cacheKey = `${hubDiscordId}:${userId}`;
  if (lastApplied.get(cacheKey) === sig) return { ok: true, changed: false };
  let guild;
  try {
    guild = client.guilds.cache.get(hubDiscordId) || (await client.guilds.fetch(hubDiscordId));
  } catch {
    return { ok: false, error: 'guild' };
  }
  let member;
  try {
    member = guild.members.cache.get(userId) || (await guild.members.fetch(userId));
  } catch {
    return { ok: false, error: 'member' };
  }
  let changed = false;
  try {
    for (const w of wanted) {
      if (!member.roles.cache.has(w.roleId)) {
        await member.roles.add(w.roleId, 'Quête event réclamée').catch(() => {});
        changed = true;
      }
    }
    lastApplied.set(cacheKey, sig);
    return { ok: true, changed };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
}

function resetCacheFor(userId) {
  for (const k of [...lastApplied.keys()]) {
    if (k.endsWith(`:${userId}`)) lastApplied.delete(k);
  }
}

module.exports = {
  getRoleId,
  setRoleId,
  listConfigured,
  createRoles,
  syncEventRolesForUser,
  resetCacheFor,
};
