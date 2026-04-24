const db = require('../db');
const users = require('./users');
const indexProgress = require('./indexProgress');
const quests = require('./quests');
const gm = require('./guildMember');
const { grpRankFromTotal } = require('../reborn/grades');
const pg = require('./playerGuilds');

/** @typedef {{ id: string, name: string, desc: string, check: (ctx: Record<string, unknown>) => boolean }} TrophyDef */

/** @type {TrophyDef[]} */
const DEFS = [
  {
    id: 'premier_pas',
    name: 'Premier pas',
    desc: 'Envoyer au moins 1 message sur un serveur.',
    check: (ctx) => ctx.lifetime_msgs >= 1,
  },
  {
    id: 'bavard',
    name: 'Bavard',
    desc: '10 messages dans la même journée (compteur quête).',
    check: (ctx) => ctx.msgs_today >= 10,
  },
  {
    id: 'fortune',
    name: 'Fortune',
    desc: 'Posséder 100 000 starss.',
    check: (ctx) => ctx.stars >= 100_000n,
  },
  {
    id: 'millionnaire',
    name: 'Millionnaire',
    desc: 'Posséder 1 000 000 starss.',
    check: (ctx) => ctx.stars >= 1_000_000n,
  },
  {
    id: 'veteran',
    name: 'Vétéran',
    desc: 'Atteindre le niveau 15.',
    check: (ctx) => ctx.level >= 15,
  },
  {
    id: 'collectionneur',
    name: 'Collectionneur',
    desc: 'Index items ≥ 25 %.',
    check: (ctx) => ctx.index_pct >= 25,
  },
  {
    id: 'guilde_soldat',
    name: 'En guilde',
    desc: 'Être membre d’une guilde joueur sur ce serveur.',
    check: (ctx) => Boolean(ctx.in_player_guild),
  },
  {
    id: 'grp_argent',
    name: 'GRP Argent',
    desc: 'Atteindre le rang GRP Argent (5 000+) sur un serveur.',
    check: (ctx) => ctx.grp_rank_at_least === 'argent',
  },
];

function isUnlocked(userId, trophyId) {
  return !!db.prepare('SELECT 1 FROM trophies_unlocked WHERE user_id = ? AND trophy_id = ?').get(userId, trophyId);
}

function unlock(userId, trophyId) {
  if (isUnlocked(userId, trophyId)) return false;
  db.prepare('INSERT INTO trophies_unlocked (user_id, trophy_id, unlocked_ms) VALUES (?, ?, ?)').run(
    userId,
    trophyId,
    Date.now(),
  );
  return true;
}

function buildContext(userId, hubDiscordId) {
  users.getOrCreate(userId, '');
  const u = users.getUser(userId);
  const qsum = quests.summary(userId);
  const row = db.prepare('SELECT lifetime_msgs FROM user_quest_state WHERE user_id = ?').get(userId);
  const ir = indexProgress.getRow(userId);
  let grp_rank_at_least = '';
  let in_player_guild = false;
  if (hubDiscordId) {
    const m = pg.getMembershipInHub(userId, hubDiscordId);
    in_player_guild = Boolean(m);
    const { grp } = gm.getMemberRow(hubDiscordId, userId);
    const rk = grpRankFromTotal(grp);
    const order = ['', 'bronze', 'argent', 'or', 'platine', 'diamant', 'goat', 'star'];
    const idx = order.indexOf(rk);
    if (idx >= order.indexOf('argent')) grp_rank_at_least = 'argent';
    else if (idx >= order.indexOf('bronze')) grp_rank_at_least = 'bronze';
  }
  return {
    lifetime_msgs: row?.lifetime_msgs || 0,
    msgs_today: qsum.msgs_today,
    stars: users.getStars(userId),
    level: u?.level || 1,
    index_pct: ir?.completion_pct || 0,
    in_player_guild,
    grp_rank_at_least,
  };
}

/** @param {string | null} [hubDiscordId] */
function evaluate(userId, hubDiscordId = null) {
  const ctx = buildContext(userId, hubDiscordId);
  const newly = [];
  for (const t of DEFS) {
    if (isUnlocked(userId, t.id)) continue;
    if (t.check(ctx) && unlock(userId, t.id)) newly.push(t.id);
  }
  return newly;
}

function listUnlocked(userId) {
  return db
    .prepare('SELECT trophy_id, unlocked_ms FROM trophies_unlocked WHERE user_id = ? ORDER BY unlocked_ms')
    .all(userId);
}

module.exports = { DEFS, evaluate, isUnlocked, unlock, listUnlocked, buildContext };
