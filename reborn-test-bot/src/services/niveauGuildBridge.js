const path = require('path');
const db = require('../db');

/**
 * Pont entre le système de guildes **niveau** (table `guilds` / `guild_members`
 * dans `niveau/src/database/blzbot.sqlite`) et le système REBORN (table
 * `player_guilds` / `player_guild_members` dans `reborn-test-bot/data/reborn.sqlite`).
 *
 * Lorsqu'un joueur a une guilde côté niveau mais pas côté REBORN, on l'importe
 * automatiquement à la première lecture pour que toutes les features REBORN
 * (focus, séparation, salon privé, GXP, etc.) puissent fonctionner.
 *
 * L'import est non-destructif : les données niveau ne sont jamais modifiées.
 */

let niveauDbGuilds = null;
let loadAttempted = false;

function loadNiveau() {
  if (loadAttempted) return niveauDbGuilds;
  loadAttempted = true;
  try {
    niveauDbGuilds = require(path.join(__dirname, '..', '..', '..', 'niveau', 'src', 'utils', 'db-guilds'));
  } catch (e) {
    console.warn('[niveauGuildBridge] niveau db-guilds indisponible :', e?.message || e);
    niveauDbGuilds = null;
  }
  return niveauDbGuilds;
}

function rebornIdFromNiveau(niveauId) {
  return `niv_${niveauId}`;
}

function bridgedGuildExists(rebornId) {
  return db.prepare('SELECT 1 FROM player_guilds WHERE id = ?').get(rebornId) != null;
}

/**
 * Importe (ou met à jour) la guilde niveau dans la table REBORN.
 * Retourne l'ID REBORN si l'import a réussi, sinon null.
 */
function importNiveauGuild(hubDiscordId, niveauGuild, niveauMembers) {
  if (!niveauGuild || !niveauGuild.id) return null;
  const rebornId = rebornIdFromNiveau(niveauGuild.id);
  const now = Date.now();
  const memberCap = Math.max(5, Number(niveauGuild.member_slots) || 5);
  const treasury = String(BigInt(niveauGuild.treasury || 0));
  if (!bridgedGuildExists(rebornId)) {
    db.prepare(
      `INSERT INTO player_guilds
         (id, hub_discord_id, name, leader_id, member_cap, treasury, gxp,
          grade, anti_separation, last_focus_ms, guild_level, created_ms,
          salon_channel_id, description, icon_url)
       VALUES (?, ?, ?, ?, ?, ?, '0', '', 0, 0, ?, ?, ?, ?, ?)`,
    ).run(
      rebornId,
      hubDiscordId,
      niveauGuild.name || 'Guilde',
      niveauGuild.owner_id,
      memberCap,
      treasury,
      Number(niveauGuild.level) || 1,
      Number(niveauGuild.created_at) || now,
      niveauGuild.channel_id || null,
      null,
      null,
    );
  } else {
    db.prepare(
      `UPDATE player_guilds
       SET name = COALESCE(?, name),
           leader_id = COALESCE(?, leader_id),
           member_cap = MAX(member_cap, ?),
           salon_channel_id = COALESCE(salon_channel_id, ?)
       WHERE id = ?`,
    ).run(
      niveauGuild.name || null,
      niveauGuild.owner_id || null,
      memberCap,
      niveauGuild.channel_id || null,
      rebornId,
    );
  }
  if (Array.isArray(niveauMembers)) {
    const insMember = db.prepare(
      `INSERT OR IGNORE INTO player_guild_members (guild_id, user_id, joined_ms, perms_json)
       VALUES (?, ?, ?, ?)`,
    );
    const leaderPerms = '{"depot":1,"retrait":1,"kick":1,"roles":1,"focus":1}';
    const memberPerms = '{"depot":1,"retrait":0,"kick":0,"roles":0,"focus":0}';
    for (const uid of niveauMembers) {
      const perms = uid === niveauGuild.owner_id ? leaderPerms : memberPerms;
      insMember.run(rebornId, uid, now, perms);
    }
  }
  return rebornId;
}

/**
 * Cherche une guilde niveau pour ce joueur et l'importe dans REBORN si nécessaire.
 * Retourne `{ rebornGuildId }` si trouvé, sinon `null`.
 */
function bridgeMembership(userId, hubDiscordId) {
  const niv = loadNiveau();
  if (!niv?.getGuildOfUser) return null;
  let g;
  try {
    g = niv.getGuildOfUser(userId);
  } catch {
    return null;
  }
  if (!g) return null;
  let members = [];
  try {
    if (typeof niv.getGuildMembersWithDetails === 'function') {
      members = niv.getGuildMembersWithDetails(g.id).map((m) => m.id || m.user_id).filter(Boolean);
    }
  } catch { /* ignore */ }
  if (!members.length) members = [g.owner_id];
  const rid = importNiveauGuild(hubDiscordId, g, members);
  return rid ? { rebornGuildId: rid } : null;
}

module.exports = { bridgeMembership, importNiveauGuild, rebornIdFromNiveau };
