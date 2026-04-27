const db = require('../db');
const users = require('./users');
const cfg = require('../config');
const { getItem } = require('../reborn/catalog');
const { NEXT_REQUIREMENTS, grpRankFromTotal, nextGrade, label, rankAtLeast } = require('../reborn/grades');

function B(s) {
  try {
    return BigInt(s || '0');
  } catch {
    return 0n;
  }
}

function genId() {
  return `${Date.now()}${Math.random().toString(36).slice(2, 10)}`;
}

function guildLevelFromTotalGxp(total) {
  let t = total;
  if (t < 1n) return 1;
  let level = 1;
  t -= 1n;
  if (t < 0n) return 1;
  const step99 = 99n;
  if (t < step99) return 1;
  t -= step99;
  level = 2;
  while (true) {
    const inc = 100n * BigInt(Math.max(1, level - 1));
    if (t < inc) break;
    t -= inc;
    level += 1;
  }
  return level;
}

function memberCapForGuildLevel(gl) {
  return 5 + Math.max(0, gl - 1);
}

/** Cap effectif (niveau de guilde + bonus arbre du chef). */
function effectiveMemberCap(g) {
  if (!g) return 0;
  const base = memberCapForGuildLevel(g.guild_level || 1);
  let bonus = 0;
  try {
    const skillTree = require('./skillTree');
    bonus = skillTree.guildMemberCapBonus(g.leader_id);
  } catch {
    /* ignore */
  }
  return base + bonus;
}

const DEFAULT_PERMS = { depot: 1, retrait: 0, kick: 0, roles: 0, focus: 0 };
const LEADER_PERMS = { depot: 1, retrait: 1, kick: 1, roles: 1, focus: 1 };

function parsePermsJson(raw) {
  try {
    const o = JSON.parse(raw || '{}');
    return { ...DEFAULT_PERMS, ...o };
  } catch {
    return { ...DEFAULT_PERMS };
  }
}

function permsJsonString(p) {
  return JSON.stringify({ ...DEFAULT_PERMS, ...p });
}

function memberRow(guildId, userId) {
  return db.prepare('SELECT * FROM player_guild_members WHERE guild_id = ? AND user_id = ?').get(guildId, userId);
}

function canDepositToTreasury(guildId, userId) {
  const g = getGuild(guildId);
  const m = memberRow(guildId, userId);
  if (!g || !m) return false;
  if (g.leader_id === userId) return true;
  const p = parsePermsJson(m.perms_json);
  return Boolean(p.depot);
}

function canWithdrawTreasury(guildId, userId) {
  const g = getGuild(guildId);
  const m = memberRow(guildId, userId);
  if (!g || !m) return false;
  if (g.leader_id === userId) return true;
  return Boolean(parsePermsJson(m.perms_json).retrait);
}

function canKickMember(guildId, actorId) {
  const g = getGuild(guildId);
  const m = memberRow(guildId, actorId);
  if (!g || !m) return false;
  if (g.leader_id === actorId) return true;
  return Boolean(parsePermsJson(m.perms_json).kick);
}

function canInviteMembers(guildId, actorId) {
  const g = getGuild(guildId);
  const m = memberRow(guildId, actorId);
  if (!g || !m) return false;
  if (g.leader_id === actorId) return true;
  return Boolean(parsePermsJson(m.perms_json).roles);
}

function canLaunchFocus(guildId, actorId) {
  const g = getGuild(guildId);
  const m = memberRow(guildId, actorId);
  if (!g || !m) return false;
  if (g.leader_id === actorId) return true;
  return Boolean(parsePermsJson(m.perms_json).focus);
}

function getGuild(guildId) {
  let id = guildId;
  if (/^\d+$/.test(String(id || ''))) id = `niv_${id}`;
  // Si guilde pontée, on rafraîchit depuis niveau avant de lire.
  if (String(id).startsWith('niv_')) {
    try {
      const bridge = require('./niveauGuildBridge');
      bridge.refreshBridgedGuild(id);
    } catch { /* optional */ }
  }
  return db.prepare('SELECT * FROM player_guilds WHERE id = ?').get(id);
}

function getMembershipInHub(userId, hubDiscordId) {
  // On synchronise toujours depuis niveau avant de lire (best-effort).
  try {
    const bridge = require('./niveauGuildBridge');
    bridge.bridgeMembership(userId, hubDiscordId);
  } catch { /* optional */ }
  return db
    .prepare(
      `SELECT m.*, g.* FROM player_guild_members m
       JOIN player_guilds g ON g.id = m.guild_id
       WHERE m.user_id = ? AND g.hub_discord_id = ?`,
    )
    .get(userId, hubDiscordId) || null;
}

function memberCount(guildId) {
  return db.prepare('SELECT COUNT(*) AS c FROM player_guild_members WHERE guild_id = ?').get(guildId).c;
}

/**
 * @param {object} [options]
 * @param {boolean} [options.bypassLevel] — staff : ignore l’exigence nv 15 (ex. `/admin-creer-guilde`).
 */
function createGuild(hubDiscordId, leaderId, leaderName, name, options = {}) {
  const bypassLevel = options.bypassLevel === true;
  const u = users.getOrCreate(leaderId, leaderName);
  const canCreate = bypassLevel || cfg.TEST_NO_LIMITS || (u.level || 1) >= 15;
  if (!canCreate) {
    return { ok: false, error: 'Niveau 15 minimum pour créer une guilde.' };
  }
  if (getMembershipInHub(leaderId, hubDiscordId)) {
    return { ok: false, error: 'Tu es déjà dans une guilde sur ce serveur.' };
  }
  const id = genId();
  const now = Date.now();
  db.prepare(
    `INSERT INTO player_guilds (id, hub_discord_id, name, leader_id, created_ms, member_cap, gxp, guild_level, grade, treasury, anti_separation, last_focus_ms)
     VALUES (?, ?, ?, ?, ?, ?, '0', 1, '', '0', 0, 0)`,
  ).run(id, hubDiscordId, name.slice(0, 80), leaderId, now, 5);
  db.prepare(
    'INSERT INTO player_guild_members (guild_id, user_id, joined_ms, perms_json) VALUES (?, ?, ?, ?)',
  ).run(id, leaderId, now, permsJsonString(LEADER_PERMS));
  return { ok: true, guildId: id };
}

function joinGuild(hubDiscordId, userId, username, guildId) {
  const g = getGuild(guildId);
  if (!g || g.hub_discord_id !== hubDiscordId) return { ok: false, error: 'Guilde introuvable sur ce serveur.' };
  if (getMembershipInHub(userId, hubDiscordId)) return { ok: false, error: 'Tu es déjà dans une guilde.' };
  const n = memberCount(guildId);
  const cap = effectiveMemberCap(g);
  if (n >= cap) return { ok: false, error: 'Guilde pleine.' };
  users.getOrCreate(userId, username);
  db.prepare('INSERT INTO player_guild_members (guild_id, user_id, joined_ms, perms_json) VALUES (?, ?, ?, ?)').run(
    guildId,
    userId,
    Date.now(),
    permsJsonString(DEFAULT_PERMS),
  );
  return { ok: true };
}

function leaveGuild(hubDiscordId, userId) {
  const row = getMembershipInHub(userId, hubDiscordId);
  if (!row) return { ok: false, error: 'Pas dans une guilde.' };
  if (row.leader_id === userId) {
    return { ok: false, error: 'Chef : utilise `/guilde transferer_chef` puis `/guilde quitter`, ou `/guilde dissoudre`.' };
  }
  db.prepare('DELETE FROM player_guild_members WHERE guild_id = ? AND user_id = ?').run(row.guild_id, userId);
  return { ok: true };
}

function addGuildGxp(guildId, delta) {
  const g = getGuild(guildId);
  if (!g) return;
  const next = B(g.gxp) + delta;
  const gl = guildLevelFromTotalGxp(next);
  const cap = effectiveMemberCap({ ...g, guild_level: gl });
  db.prepare('UPDATE player_guilds SET gxp = ?, guild_level = ?, member_cap = ? WHERE id = ?').run(
    next.toString(),
    gl,
    cap,
    guildId,
  );
}

function addGxpFromMemberActivity(hubDiscordId, userId, delta) {
  const m = getMembershipInHub(userId, hubDiscordId);
  if (!m) return;
  addGuildGxp(m.guild_id, delta);
}

function treasuryView(guildId) {
  const g = getGuild(guildId);
  return g ? B(g.treasury) : 0n;
}

function treasuryDeposit(guildId, userId, amount) {
  if (amount <= 0n) return { ok: false, error: 'Montant invalide.' };
  if (!canDepositToTreasury(guildId, userId)) return { ok: false, error: 'Pas autorisé à déposer (permission « dépôt »).' };
  const m = db.prepare('SELECT * FROM player_guild_members WHERE guild_id = ? AND user_id = ?').get(guildId, userId);
  if (!m) return { ok: false, error: 'Pas membre.' };
  if (users.getStars(userId) < amount) return { ok: false, error: 'Pas assez de starss.' };
  users.addStars(userId, -amount);
  const g = getGuild(guildId);
  const t = B(g.treasury) + amount;
  db.prepare('UPDATE player_guilds SET treasury = ? WHERE id = ?').run(t.toString(), guildId);
  return { ok: true };
}

function treasuryWithdraw(guildId, userId, amount) {
  const g = getGuild(guildId);
  if (!g) return { ok: false, error: 'Guilde introuvable.' };
  if (!canWithdrawTreasury(guildId, userId)) return { ok: false, error: 'Pas autorisé à retirer (chef ou permission « retrait »).' };
  if (amount <= 0n) return { ok: false, error: 'Montant invalide.' };
  const t = B(g.treasury);
  if (t < amount) return { ok: false, error: 'Trésorerie insuffisante.' };
  db.prepare('UPDATE player_guilds SET treasury = ? WHERE id = ?').run((t - amount).toString(), guildId);
  users.addStars(userId, amount);
  return { ok: true };
}

function countRarity(userId, rarity) {
  const rows = users.getInventory(userId);
  let n = 0;
  for (const r of rows) {
    const it = getItem(r.item_id);
    if (it && it.rarity === rarity) n += r.qty;
  }
  return n;
}

function tryBuyNextGrade(hubDiscordId, userId) {
  const row = getMembershipInHub(userId, hubDiscordId);
  if (!row) return { ok: false, error: 'Pas dans une guilde.' };
  if (row.leader_id !== userId) return { ok: false, error: 'Seul le chef peut acheter un grade.' };
  const g = getGuild(row.guild_id);
  const cur = g.grade || '';
  const nxt = nextGrade(cur);
  if (!nxt) return { ok: false, error: 'Grade max atteint (Star).' };
  const req = NEXT_REQUIREMENTS[nxt];
  if (!req) return { ok: false, error: 'Grade inconnu.' };
  const gm = require('./guildMember');
  const grpTotal = gm.getMemberRow(hubDiscordId, userId).grp;
  const peakRank = grpRankFromTotal(grpTotal);
  if (!rankAtLeast(peakRank, req.minGrpRank)) {
    return {
      ok: false,
      error: `Rang GR insuffisant : besoin **${req.minGrpRank}**, actuel **${peakRank || 'aucun'}**.`,
    };
  }
  if (users.getStars(userId) < req.stars) {
    return { ok: false, error: `Il manque des starss (besoin **${req.stars.toLocaleString('fr-FR')}**).` };
  }
  if (countRarity(userId, 'Mythique') < req.mythic) {
    return { ok: false, error: `Items mythiques insuffisants (${req.mythic} requis).` };
  }
  if (countRarity(userId, 'Goatesque') < req.crystal) {
    return { ok: false, error: `Crystals / items goatesques insuffisants (${req.crystal} requis).` };
  }
  if (req.needDiamond) {
    const h = require('./meta').diamondHolder();
    const hasDiamItem = countRarity(userId, 'Staresque') >= 1 || users.getInventory(userId).some((r) => r.item_id === 'diamant' && r.qty > 0);
    if (h !== userId && !hasDiamItem) {
      return { ok: false, error: 'Il faut être détenteur du **Diamant** ou avoir l’item en inventaire / un item staresque.' };
    }
  }
  users.addStars(userId, -req.stars);
  const anti = nxt === 'star' ? 1 : g.anti_separation || 0;
  db.prepare('UPDATE player_guilds SET grade = ?, anti_separation = ? WHERE id = ?').run(nxt, anti, g.id);
  return { ok: true, grade: nxt, label: label(nxt) };
}

function listGuildsOnHub(hubDiscordId) {
  // Pont : importer toutes les guildes niveau encore non bridées avant de lister.
  try {
    const bridge = require('./niveauGuildBridge');
    const path = require('path');
    let nivAll;
    try {
      const niv = require(path.join(__dirname, '..', '..', '..', 'niveau', 'src', 'utils', 'db-guilds'));
      nivAll = typeof niv.getAllGuilds === 'function' ? niv.getAllGuilds() : [];
    } catch {
      nivAll = [];
    }
    for (const g of nivAll) {
      let members = [];
      try {
        const niv = require(path.join(__dirname, '..', '..', '..', 'niveau', 'src', 'utils', 'db-guilds'));
        if (typeof niv.getGuildMembersWithDetails === 'function') {
          members = niv.getGuildMembersWithDetails(g.id).map((m) => m.id || m.user_id).filter(Boolean);
        }
      } catch { /* ignore */ }
      if (!members.length) members = [g.owner_id];
      bridge.importNiveauGuild(hubDiscordId, g, members);
    }
  } catch { /* niveau bridge optional */ }
  return db.prepare('SELECT id, name, leader_id, member_cap, guild_level, grade, treasury FROM player_guilds WHERE hub_discord_id = ? ORDER BY created_ms DESC').all(hubDiscordId);
}

function useFocus(hubDiscordId, attackerGuildId, targetGuildId, mode, actorUserId) {
  const now = Date.now();
  const CD = 168 * 60 * 60 * 1000;
  const COST = 500_000n;
  const att = getGuild(attackerGuildId);
  const tgt = getGuild(targetGuildId);
  if (!actorUserId || !canLaunchFocus(attackerGuildId, actorUserId)) {
    return { ok: false, error: 'Pas autorisé à lancer un focus (chef ou permission « focus »).' };
  }
  if (!att || !tgt || att.hub_discord_id !== hubDiscordId || tgt.hub_discord_id !== hubDiscordId) {
    return { ok: false, error: 'Guildes invalides.' };
  }
  if (now - (att.last_focus_ms || 0) < CD) return { ok: false, error: 'Focus en cooldown (7 j).' };
  if (B(att.treasury) < COST) return { ok: false, error: '500 000 starss requis en trésorerie de guilde.' };
  db.prepare('UPDATE player_guilds SET treasury = ?, last_focus_ms = ? WHERE id = ?').run(
    (B(att.treasury) - COST).toString(),
    now,
    attackerGuildId,
  );
  const gm = require('./guildMember');
  const members = db.prepare('SELECT user_id FROM player_guild_members WHERE guild_id = ?').all(targetGuildId);
  if (mode === '1') {
    for (const { user_id } of members) {
      gm.addGrp(hubDiscordId, user_id, -500n);
    }
  } else if (mode === '2') {
    const share = -3000n / BigInt(Math.max(1, members.length));
    for (const { user_id } of members) {
      gm.addGrp(hubDiscordId, user_id, share);
    }
  } else if (mode === '3') {
    require('./meta').set(`grp_half_${targetGuildId}`, String(now + 2 * 3600000));
  }
  return { ok: true };
}

function kickMember(hubDiscordId, guildId, actorId, targetId) {
  const g = getGuild(guildId);
  if (!g || g.hub_discord_id !== hubDiscordId) return { ok: false, error: 'Guilde invalide.' };
  if (g.leader_id === targetId) return { ok: false, error: 'Impossible d’expulser le chef.' };
  if (!memberRow(guildId, targetId)) return { ok: false, error: 'Cible pas dans cette guilde.' };
  if (!canKickMember(guildId, actorId)) return { ok: false, error: 'Pas autorisé à expulser (chef ou permission « kick »).' };
  db.prepare('DELETE FROM player_guild_members WHERE guild_id = ? AND user_id = ?').run(guildId, targetId);
  return { ok: true };
}

function transferLeadership(hubDiscordId, guildId, leaderId, newLeaderId) {
  const g = getGuild(guildId);
  if (!g || g.hub_discord_id !== hubDiscordId) return { ok: false, error: 'Guilde invalide.' };
  if (g.leader_id !== leaderId) return { ok: false, error: 'Seul le chef peut transférer.' };
  if (newLeaderId === leaderId) return { ok: false, error: 'Cible invalide.' };
  if (!memberRow(guildId, newLeaderId)) return { ok: false, error: 'Le nouveau chef doit être membre de la guilde.' };
  db.prepare('UPDATE player_guilds SET leader_id = ? WHERE id = ?').run(newLeaderId, guildId);
  db.prepare('UPDATE player_guild_members SET perms_json = ? WHERE guild_id = ? AND user_id = ?').run(
    permsJsonString(LEADER_PERMS),
    guildId,
    newLeaderId,
  );
  db.prepare('UPDATE player_guild_members SET perms_json = ? WHERE guild_id = ? AND user_id = ?').run(
    permsJsonString(DEFAULT_PERMS),
    guildId,
    leaderId,
  );
  return { ok: true };
}

function dissolveGuild(hubDiscordId, guildId, leaderId) {
  const g = getGuild(guildId);
  if (!g || g.hub_discord_id !== hubDiscordId) return { ok: false, error: 'Guilde invalide.' };
  if (g.leader_id !== leaderId) return { ok: false, error: 'Seul le chef peut dissoudre.' };
  db.prepare('DELETE FROM player_guild_members WHERE guild_id = ?').run(guildId);
  db.prepare('DELETE FROM player_guilds WHERE id = ?').run(guildId);
  // Si guilde pontée niveau, on dissout aussi côté niveau pour cohérence.
  try {
    const bridge = require('./niveauGuildBridge');
    const nivId = bridge.niveauIdFromReborn(guildId);
    if (nivId) bridge.dissolveNiveauGuild(nivId);
  } catch { /* optional */ }
  return { ok: true };
}

function getMemberPerms(guildId, userId) {
  const g = getGuild(guildId);
  const m = memberRow(guildId, userId);
  if (!g || !m) return null;
  if (g.leader_id === userId) return { ...LEADER_PERMS };
  return parsePermsJson(m.perms_json);
}

function setMemberPerm(guildId, leaderId, targetUserId, key, value) {
  const g = getGuild(guildId);
  if (!g || g.leader_id !== leaderId) return { ok: false, error: 'Chef uniquement.' };
  if (targetUserId === leaderId) return { ok: false, error: 'Le chef a déjà toutes les permissions.' };
  const m = memberRow(guildId, targetUserId);
  if (!m) return { ok: false, error: 'Membre introuvable.' };
  const allowed = new Set(['depot', 'retrait', 'kick', 'roles', 'focus']);
  if (!allowed.has(key)) return { ok: false, error: 'Clé inconnue.' };
  const v = value ? 1 : 0;
  const cur = parsePermsJson(m.perms_json);
  cur[key] = v;
  db.prepare('UPDATE player_guild_members SET perms_json = ? WHERE guild_id = ? AND user_id = ?').run(
    permsJsonString(cur),
    guildId,
    targetUserId,
  );
  return { ok: true, perms: cur };
}

module.exports = {
  getGuild,
  getMembershipInHub,
  memberCount,
  createGuild,
  joinGuild,
  leaveGuild,
  addGxpFromMemberActivity,
  treasuryView,
  treasuryDeposit,
  treasuryWithdraw,
  tryBuyNextGrade,
  listGuildsOnHub,
  useFocus,
  guildLevelFromTotalGxp,
  memberCapForGuildLevel,
  effectiveMemberCap,
  B,
  getMemberPerms,
  setMemberPerm,
  canDepositToTreasury,
  canWithdrawTreasury,
  canKickMember,
  canInviteMembers,
  canLaunchFocus,
  kickMember,
  transferLeadership,
  dissolveGuild,
  memberRow,
};
