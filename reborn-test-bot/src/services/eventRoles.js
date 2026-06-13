/**
 * Rôles Discord des events Espace / Océan (8 rôles de quête).
 *
 * IDs stockés en DB (`meta`) par hub : `event_role_<roleKey>:<hubId>`.
 * `/event-admin creer-roles` les crée, `syncEventRolesForUser` les attribue
 * en fonction des quêtes réclamées (`event_quests_claimed`).
 */

const meta = require('./meta');
const { EVENTS, allRoleEntries } = require('../reborn/eventConfig');

const ROLE_COLORS = {
  meteore: 0x9b59b6,
  galaxien: 0x5865f2,
  lumineux: 0xf1c40f,
  egocentrique: 0xe91e63,
  eau: 0x3498db,
  perdu: 0x1abc9c,
  marin: 0x16a085,
  roi: 0x0e6655,
};

function metaKey(hubId, roleKey) {
  return `event_role_${roleKey}:${hubId}`;
}

function getRoleId(hubId, roleKey) {
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
 * Crée (ou rattache par nom) les 8 rôles d'event sur la guilde.
 * @param {import('discord.js').Guild} guild
 */
async function createRoles(guild) {
  const hubId = guild.id;
  const created = [];
  const skipped = [];
  const failed = [];
  for (const ev of Object.values(EVENTS)) {
    for (const [roleKey, label] of Object.entries(ev.roles)) {
      const existing = getRoleId(hubId, roleKey);
      if (existing && guild.roles.cache.get(existing)) {
        skipped.push(`${label} → <@&${existing}>`);
        continue;
      }
      const byName = guild.roles.cache.find((r) => r.name.toLowerCase() === label.toLowerCase());
      if (byName) {
        setRoleId(hubId, roleKey, byName.id);
        skipped.push(`${label} → <@&${byName.id}>`);
        continue;
      }
      try {
        const role = await guild.roles.create({
          name: label,
          color: ROLE_COLORS[roleKey] || 0x95a5a6,
          mentionable: false,
          reason: `Rôle d'event ${ev.name}`,
        });
        setRoleId(hubId, roleKey, role.id);
        created.push(`${label} → <@&${role.id}>`);
      } catch (e) {
        failed.push(`${label} : \`${e?.message || e}\``);
      }
    }
  }
  return { created, skipped, failed };
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
