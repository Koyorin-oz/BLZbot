/**
 * Rôle Discord « Pipelette ultime » attribué à 100 % d'index.
 * ID stocké en DB sous `index_full_role:<hubId>`.
 */

const meta = require('./meta');
const indexProgress = require('./indexProgress');

function metaKey(hubId) {
  return `index_full_role:${hubId}`;
}

function getIndexFullRoleId(hubId) {
  return meta.get(metaKey(hubId));
}

function setIndexFullRoleId(hubId, roleId) {
  meta.set(metaKey(hubId), String(roleId));
}

const lastApplied = new Map();

/**
 * Synchronise le rôle « Pipelette ultime » :
 *  - 100 % d'index → rôle attribué,
 *  - <100 %        → rôle retiré.
 *
 * @param {import('discord.js').Client} client
 * @param {string} hubDiscordId
 * @param {string} userId
 */
async function syncIndexFullRole(client, hubDiscordId, userId) {
  if (!client || !hubDiscordId || !userId) return { ok: false, error: 'arguments' };
  const roleId = getIndexFullRoleId(hubDiscordId);
  if (!roleId) return { ok: true, changed: false };
  const row = indexProgress.getRow(userId);
  const should = (row?.completion_pct || 0) >= 100;
  const cacheKey = `${hubDiscordId}:${userId}`;
  if (lastApplied.get(cacheKey) === should) return { ok: true, changed: false };
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
  try {
    if (should && !member.roles.cache.has(roleId)) {
      await member.roles.add(roleId, 'Index 100 % atteint');
    } else if (!should && member.roles.cache.has(roleId)) {
      await member.roles.remove(roleId, 'Index < 100 %').catch(() => {});
    }
    lastApplied.set(cacheKey, should);
    return { ok: true, changed: true };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
}

module.exports = { getIndexFullRoleId, setIndexFullRoleId, syncIndexFullRole };
