const db = require('../db');
const users = require('./users');
const indexProgress = require('./indexProgress');
const pg = require('./playerGuilds');
const gm = require('./guildMember');
const skillTree = require('./skillTree');
const meta = require('./meta');

const STAR_RP = 100_000n;
const STAR_GRP = 200_000n;

function parseSources(json) {
  try {
    const a = JSON.parse(json || '[]');
    return Array.isArray(a) ? a.map(String) : [];
  } catch {
    return [];
  }
}

/**
 * Recalcule les points « temple » (doc : 11 max + bonus index event — bonus simplifié).
 * @param {string} userId
 * @param {string | null} hubDiscordId
 */
function sync(userId, hubDiscordId) {
  users.getOrCreate(userId, '');
  const satisfied = new Set();

  const tree = skillTree.getTree(userId);
  let allClass = true;
  for (const b of skillTree.BRANCHES) {
    if ((tree[b] || 0) < 5) allClass = false;
  }
  if (allClass) satisfied.add('classes');

  if (users.getPoints(userId) >= STAR_RP) satisfied.add('max_rp');

  if (meta.diamondHolder() === userId || users.getInventory(userId).some((r) => r.item_id === 'diamant' && r.qty > 0)) {
    satisfied.add('diamond');
  }

  const ir = indexProgress.getRow(userId);
  if ((ir.completion_pct || 0) >= 100) satisfied.add('index_full');

  if (hubDiscordId) {
    const m = pg.getMembershipInHub(userId, hubDiscordId);
    if (m) {
      const g = pg.getGuild(m.guild_id);
      if (g && (g.grade || '') === 'star') satisfied.add('guild_grade_star');
      const { grp } = gm.getMemberRow(hubDiscordId, userId);
      if (grp >= STAR_GRP) satisfied.add('grp_star');
    }
  }

  const prev = parseSources(users.getUser(userId).temple_sources_json);
  const merged = new Set([...prev, ...satisfied]);
  const pts = merged.size;
  db.prepare('UPDATE users SET temple_points = ?, temple_sources_json = ? WHERE id = ?').run(
    pts,
    JSON.stringify([...merged].sort()),
    userId,
  );
  skillTree.syncTempleUnlock(userId);
  return { points: pts, keys: [...merged] };
}

module.exports = { sync, parseSources, STAR_RP, STAR_GRP };
