const db = require('../db');
const users = require('./users');
const indexProgress = require('./indexProgress');
const quests = require('./quests');

/** @typedef {{ id: string, name: string, desc: string, check: (ctx: any) => boolean }} TrophyDef */

/** @type {TrophyDef[]} */
const DEFS = [
  {
    id: 'premier_pas',
    name: 'Premier pas',
    desc: 'Envoyer au moins 1 message sur un serveur.',
    check: (ctx) => ctx.msgs_lifetime >= 1,
  },
  {
    id: 'bavard',
    name: 'Bavard',
    desc: '10 messages dans la même journée (quête).',
    check: (ctx) => ctx.msgs_today >= 10,
  },
  {
    id: 'fortune',
    name: 'Fortune',
    desc: 'Posséder 100 000 starss.',
    check: (ctx) => ctx.stars >= 100_000n,
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

function buildContext(userId) {
  users.getOrCreate(userId, '');
  const u = users.getUser(userId);
  const q = quests.summary(userId);
  const ir = indexProgress.getRow(userId);
  return {
    msgs_lifetime: 0,
    msgs_today: q.msgs_today,
    stars: users.getStars(userId),
    level: u?.level || 1,
    index_pct: ir?.completion_pct || 0,
  };
}

/** Évalue les trophées ; retourne la liste des nouveaux ids débloqués. */
function evaluate(userId) {
  const ctx = buildContext(userId);
  const st = quests.getState ? null : null;
  void st;
  const row = require('../db').prepare('SELECT SUM(msgs_today) AS s FROM user_quest_state WHERE user_id = ?').get(userId);
  void row;
  ctx.msgs_lifetime = ctx.msgs_today > 0 ? 1 : 0;
  const r2 = require('../db').prepare('SELECT msgs_today FROM user_quest_state WHERE user_id = ?').get(userId);
  if (r2 && (r2.msgs_today || 0) >= 1) ctx.msgs_lifetime = 1;

  const newly = [];
  for (const t of DEFS) {
    if (isUnlocked(userId, t.id)) continue;
    if (t.check(ctx) && unlock(userId, t.id)) newly.push(t.id);
  }
  return newly;
}

function getState(userId) {
  return require('../db').prepare('SELECT msgs_today FROM user_quest_state WHERE user_id = ?').get(userId);
}

module.exports = { DEFS, evaluate, isUnlocked, listUnlocked, buildContext };

function listUnlocked(userId) {
  return db
    .prepare('SELECT trophy_id, unlocked_ms FROM trophies_unlocked WHERE user_id = ? ORDER BY unlocked_ms')
    .all(userId);
}
