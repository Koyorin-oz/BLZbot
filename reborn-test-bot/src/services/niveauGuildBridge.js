const path = require('path');
const db = require('../db');

/**
 * Pont entre le système de guildes **niveau** (table `guilds` / `guild_members`
 * dans `niveau/src/database/blzbot.sqlite`) et le système REBORN (table
 * `player_guilds` / `player_guild_members` dans `reborn-test-bot/data/reborn.sqlite`).
 *
 * Comportement :
 * - À chaque lecture (`getMembershipInHub`, `listGuildsOnHub`, `getGuild`), on
 *   resynchronise depuis niveau pour refléter les changements (treasury, niveau,
 *   nom, ajout/retrait de membres, dissolution).
 * - Les guildes pontées portent un ID stable `niv_<idNiveau>` côté REBORN.
 * - Les données niveau ne sont jamais modifiées par les lectures.
 */

let niveauDbGuilds = null;
let loadAttempted = false;

// Cache de coalescing : évite de re-synchroniser la même guilde / le même joueur
// plusieurs fois en quelques ms (par ex. quand `getGuild` est appelé en boucle
// pendant le rendu d'une commande). TTL court : ~3 s.
const CACHE_TTL_MS = 3000;
const guildSyncCache = new Map(); // rebornId -> ts
const memberSyncCache = new Map(); // `${userId}|${hubId}` -> ts

function _isCached(map, key) {
  const ts = map.get(key);
  if (!ts) return false;
  if (Date.now() - ts > CACHE_TTL_MS) {
    map.delete(key);
    return false;
  }
  return true;
}

function _cache(map, key) {
  map.set(key, Date.now());
}

/** Vide le cache (appelé après création / dissolution / join / leave). */
function invalidateBridgeCache() {
  guildSyncCache.clear();
  memberSyncCache.clear();
}

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

function niveauIdFromReborn(rebornId) {
  if (!rebornId || !String(rebornId).startsWith('niv_')) return null;
  const raw = String(rebornId).slice(4);
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function isBridged(rebornId) {
  return /^niv_\d+$/.test(String(rebornId || ''));
}

function fetchNiveauGuild(niveauId) {
  const niv = loadNiveau();
  if (!niv) return null;
  try {
    if (typeof niv.getGuildById === 'function') return niv.getGuildById(niveauId);
  } catch { /* ignore */ }
  return null;
}

function fetchNiveauMembers(niveauId) {
  const niv = loadNiveau();
  if (!niv) return [];
  try {
    if (typeof niv.getGuildMembersWithDetails === 'function') {
      return niv.getGuildMembersWithDetails(niveauId).map((m) => m.id || m.user_id).filter(Boolean);
    }
  } catch { /* ignore */ }
  return [];
}

/**
 * Importe (ou rafraîchit) la guilde niveau dans la table REBORN.
 * Crée la ligne `player_guilds` si absente, met à jour les champs miroir
 * (nom, leader, member_cap, treasury) sinon, puis synchronise la liste
 * des membres (insère les nouveaux, retire ceux qui ne sont plus là).
 */
function importNiveauGuild(hubDiscordId, niveauGuild, niveauMembers) {
  if (!niveauGuild || !niveauGuild.id) return null;
  const rebornId = rebornIdFromNiveau(niveauGuild.id);
  const now = Date.now();
  const memberCap = Math.max(5, Number(niveauGuild.member_slots) || 5);
  const treasury = String(BigInt(niveauGuild.treasury || 0));
  const existing = db.prepare('SELECT id FROM player_guilds WHERE id = ?').get(rebornId);
  if (!existing) {
    db.prepare(
      `INSERT INTO player_guilds
         (id, hub_discord_id, name, leader_id, member_cap, treasury, gxp,
          grade, anti_separation, last_focus_ms, guild_level, created_ms,
          salon_channel_id, description, icon_url)
       VALUES (?, ?, ?, ?, ?, ?, '0', '', 0, 0, ?, ?, ?, '', '')`,
    ).run(
      rebornId,
      hubDiscordId,
      niveauGuild.name || 'Guilde',
      niveauGuild.owner_id,
      memberCap,
      treasury,
      Math.max(1, Number(niveauGuild.level) || 1),
      Number(niveauGuild.created_at) || now,
      niveauGuild.channel_id || '',
    );
  } else {
    // Re-sync miroir (sans écraser les champs spécifiques REBORN : gxp, grade,
    // anti_separation, last_focus_ms, salon_channel_id (si déjà setté), description).
    // On met à jour `hub_discord_id` pour suivre le serveur courant.
    db.prepare(
      `UPDATE player_guilds
       SET name = ?,
           leader_id = ?,
           hub_discord_id = ?,
           member_cap = MAX(member_cap, ?),
           treasury = ?,
           guild_level = MAX(guild_level, ?)
       WHERE id = ?`,
    ).run(
      niveauGuild.name || 'Guilde',
      niveauGuild.owner_id,
      hubDiscordId,
      memberCap,
      treasury,
      Math.max(1, Number(niveauGuild.level) || 1),
      rebornId,
    );
  }
  // Sync des membres : on aligne le set REBORN sur le set niveau.
  if (Array.isArray(niveauMembers)) {
    const wanted = new Set(niveauMembers.filter(Boolean));
    if (niveauGuild.owner_id) wanted.add(niveauGuild.owner_id);
    const current = db.prepare('SELECT user_id FROM player_guild_members WHERE guild_id = ?').all(rebornId);
    const have = new Set(current.map((r) => r.user_id));
    const insMember = db.prepare(
      `INSERT OR IGNORE INTO player_guild_members (guild_id, user_id, joined_ms, perms_json)
       VALUES (?, ?, ?, ?)`,
    );
    const leaderPerms = '{"depot":1,"retrait":1,"kick":1,"roles":1,"focus":1}';
    const memberPerms = '{"depot":1,"retrait":0,"kick":0,"roles":0,"focus":0}';
    for (const uid of wanted) {
      if (!have.has(uid)) {
        const perms = uid === niveauGuild.owner_id ? leaderPerms : memberPerms;
        insMember.run(rebornId, uid, now, perms);
      }
    }
    const delMember = db.prepare('DELETE FROM player_guild_members WHERE guild_id = ? AND user_id = ?');
    for (const uid of have) {
      if (!wanted.has(uid)) delMember.run(rebornId, uid);
    }
  }
  return rebornId;
}

/**
 * Cherche la guilde niveau de ce joueur et l'importe / la rafraîchit dans REBORN.
 * Si l'utilisateur a quitté côté niveau, retire aussi la membership REBORN bridée.
 * Retourne `{ rebornGuildId }` si trouvé, sinon `null`.
 */
function bridgeMembership(userId, hubDiscordId) {
  const cacheKey = `${userId}|${hubDiscordId}`;
  if (_isCached(memberSyncCache, cacheKey)) {
    // Lookup direct de la membership existante en REBORN (déjà synchronisée).
    const row = db
      .prepare(
        `SELECT m.guild_id FROM player_guild_members m
         JOIN player_guilds g ON g.id = m.guild_id
         WHERE m.user_id = ? AND g.hub_discord_id = ?
           AND g.id LIKE 'niv_%' LIMIT 1`,
      )
      .get(userId, hubDiscordId);
    return row ? { rebornGuildId: row.guild_id } : null;
  }
  const niv = loadNiveau();
  if (!niv?.getGuildOfUser) {
    _cache(memberSyncCache, cacheKey);
    return null;
  }
  let g;
  try {
    g = niv.getGuildOfUser(userId);
  } catch {
    _cache(memberSyncCache, cacheKey);
    return null;
  }
  if (!g) {
    // Le joueur n'est plus dans une guilde niveau → s'il était dans une bridée, on retire.
    try {
      db.prepare(
        `DELETE FROM player_guild_members
         WHERE user_id = ?
           AND guild_id IN (SELECT id FROM player_guilds WHERE id LIKE 'niv_%' AND hub_discord_id = ?)`,
      ).run(userId, hubDiscordId);
    } catch { /* ignore */ }
    _cache(memberSyncCache, cacheKey);
    return null;
  }
  const members = fetchNiveauMembers(g.id);
  const list = members.length ? members : [g.owner_id];
  const rid = importNiveauGuild(hubDiscordId, g, list);
  _cache(memberSyncCache, cacheKey);
  if (rid) _cache(guildSyncCache, rid);
  return rid ? { rebornGuildId: rid } : null;
}

/**
 * Resync explicite d'une guilde REBORN bridée (lecture).
 * Si la guilde n'existe plus côté niveau, on supprime la copie REBORN.
 */
function refreshBridgedGuild(rebornId) {
  const nivId = niveauIdFromReborn(rebornId);
  if (!nivId) return;
  const g = fetchNiveauGuild(nivId);
  if (!g) {
    // niveau guild deleted → cleanup REBORN bridge
    try {
      const row = db.prepare('SELECT hub_discord_id FROM player_guilds WHERE id = ?').get(rebornId);
      if (row) {
        db.prepare('DELETE FROM player_guild_members WHERE guild_id = ?').run(rebornId);
        db.prepare('DELETE FROM player_guilds WHERE id = ?').run(rebornId);
      }
    } catch { /* ignore */ }
    return;
  }
  const row = db.prepare('SELECT hub_discord_id FROM player_guilds WHERE id = ?').get(rebornId);
  if (!row) return;
  const members = fetchNiveauMembers(g.id);
  const list = members.length ? members : [g.owner_id];
  importNiveauGuild(row.hub_discord_id, g, list);
}

/**
 * Importe toutes les guildes niveau présentes dans la base sur ce hub
 * + nettoie les guildes pontées REBORN qui n'existent plus côté niveau.
 * Utilisé par `listGuildsOnHub` pour offrir une vue unifiée.
 */
function importAllNiveauGuilds(hubDiscordId) {
  const niv = loadNiveau();
  if (!niv?.getAllGuilds) return 0;
  let count = 0;
  try {
    const all = niv.getAllGuilds();
    const liveNiveauIds = new Set(all.map((g) => Number(g.id)));
    for (const g of all) {
      const members = fetchNiveauMembers(g.id);
      const list = members.length ? members : [g.owner_id];
      importNiveauGuild(hubDiscordId, g, list);
      count++;
    }
    // Cleanup : guildes pontées REBORN dont la source niveau a disparu.
    const orphans = db
      .prepare("SELECT id FROM player_guilds WHERE hub_discord_id = ? AND id LIKE 'niv_%'")
      .all(hubDiscordId);
    for (const { id } of orphans) {
      const nivId = niveauIdFromReborn(id);
      if (nivId == null || !liveNiveauIds.has(Number(nivId))) {
        try {
          db.prepare('DELETE FROM player_guild_members WHERE guild_id = ?').run(id);
          db.prepare('DELETE FROM player_guilds WHERE id = ?').run(id);
        } catch { /* ignore */ }
      }
    }
  } catch (e) {
    console.warn('[niveauGuildBridge] importAll:', e?.message || e);
  }
  return count;
}

/**
 * Crée une guilde côté niveau (utilisé quand `/guilde creer` REBORN crée une
 * guilde — on la propage à niveau pour que `/profil` la voie aussi).
 * Retourne l'ID niveau créé, ou null.
 */
function createNiveauGuild(name, ownerId, emoji = '🛡️') {
  const niv = loadNiveau();
  if (!niv?.createGuild || !niv?.addMemberToGuild) return null;
  try {
    const existing = typeof niv.getGuildByName === 'function' ? niv.getGuildByName(name) : null;
    if (existing) return existing.id;
    const id = niv.createGuild(name, ownerId, emoji);
    try { niv.addMemberToGuild(ownerId, id); } catch { /* maybe already inside */ }
    return id || null;
  } catch (e) {
    console.warn('[niveauGuildBridge] createNiveauGuild:', e?.message || e);
    return null;
  }
}

/** Ajoute un membre côté niveau (best-effort). */
function addNiveauMember(niveauId, userId) {
  const niv = loadNiveau();
  if (!niv?.addMemberToGuild) return false;
  try {
    niv.addMemberToGuild(userId, niveauId);
    return true;
  } catch (e) {
    return false; // déjà membre ou autre contrainte
  }
}

/** Retire un membre côté niveau (best-effort). */
function removeNiveauMember(userId) {
  const niv = loadNiveau();
  if (!niv?.removeMemberFromGuild) return false;
  try {
    niv.removeMemberFromGuild(userId);
    return true;
  } catch {
    return false;
  }
}

/** Dissout une guilde niveau (best-effort, utilisé par `/guilde dissoudre`). */
function dissolveNiveauGuild(niveauId) {
  const niv = loadNiveau();
  if (!niv) return false;
  try {
    if (typeof niv.dissolveGuild === 'function') {
      niv.dissolveGuild(niveauId);
      return true;
    }
    if (typeof niv.deleteGuild === 'function') {
      niv.deleteGuild(niveauId);
      return true;
    }
  } catch (e) {
    console.warn('[niveauGuildBridge] dissolveNiveauGuild:', e?.message || e);
  }
  return false;
}

module.exports = {
  bridgeMembership,
  importNiveauGuild,
  importAllNiveauGuilds,
  refreshBridgedGuild,
  rebornIdFromNiveau,
  niveauIdFromReborn,
  isBridged,
  createNiveauGuild,
  addNiveauMember,
  removeNiveauMember,
  dissolveNiveauGuild,
};
