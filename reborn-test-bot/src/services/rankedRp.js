const db = require('../db');
const users = require('./users');
const skillTree = require('./skillTree');
const rankedRoles = require('./rankedRoles');

const POOL_CAP = 300_000n;
const BAND_LOW = 50_000n;
const BAND_HIGH = 100_000n;
const DAY_MS = 24 * 60 * 60 * 1000;

/** RP / message et / min voc selon tranche de RP total (doc ranked). */
function ratesForPoints(rp) {
  const p = rp < 0n ? 0n : rp;
  if (p < 50_000n) return { msg: 10n, vocMin: 30n };
  if (p < 60_000n) return { msg: 8n, vocMin: 20n };
  if (p < 70_000n) return { msg: 6n, vocMin: 15n };
  if (p < 80_000n) return { msg: 5n, vocMin: 10n };
  if (p < 90_000n) return { msg: 4n, vocMin: 7n };
  if (p < 100_000n) return { msg: 3n, vocMin: 4n };
  return { msg: 2n, vocMin: 2n };
}

function bandExcess(rp) {
  if (rp <= BAND_LOW) return 0n;
  if (rp >= BAND_HIGH) return BAND_HIGH - BAND_LOW;
  return rp - BAND_LOW;
}

function sumBandExcess() {
  const rows = db.prepare('SELECT points FROM users').all();
  let s = 0n;
  for (const r of rows) {
    s += bandExcess(users.B(r.points));
  }
  return s;
}

function stealRpFromBracket(exceptUserId, amount) {
  let left = amount;
  if (left <= 0n) return 0n;
  const rows = db
    .prepare(
      `SELECT id, points FROM users
       WHERE id != ? AND CAST(COALESCE(points,'0') AS INTEGER) > ? AND CAST(COALESCE(points,'0') AS INTEGER) < ?
       ORDER BY CAST(COALESCE(points,'0') AS INTEGER) DESC`,
    )
    .all(exceptUserId, Number(BAND_LOW), Number(BAND_HIGH));
  for (const r of rows) {
    if (left <= 0n) break;
    let p = users.B(r.points);
    const ex = bandExcess(p);
    if (ex <= 0n) continue;
    const take = left > ex ? ex : left;
    p -= take;
    if (p < BAND_LOW) p = BAND_LOW;
    users.setPoints(r.id, p);
    left -= take;
  }
  return amount - left;
}

function clampGainForPool(userId, p, gain) {
  let g = gain;
  while (g > 0n) {
    const e1 = bandExcess(p);
    const e2 = bandExcess(p + g);
    const E = sumBandExcess();
    const newSum = E - e1 + e2;
    if (newSum <= POOL_CAP) return g;
    g -= 1n;
  }
  return 0n;
}

/**
 * @param {string} userId
 * @param {'msg'|'voc'} kind
 * @param {bigint} [units] minutes voc
 */
function grantFromActivity(userId, kind, units = 1n) {
  users.getOrCreate(userId, '');
  const p = users.getPoints(userId);
  const r = ratesForPoints(p);
  const rb = skillTree.rankedRpBonuses(userId);
  let gain =
    kind === 'msg'
      ? ((r.msg + rb.flatMsg) * BigInt(rb.pctBp)) / 10000n
      : ((r.vocMin + rb.flatVoc) * units * BigInt(rb.pctBp)) / 10000n;
  if (gain <= 0n) return;

  const capped = clampGainForPool(userId, p, gain);
  if (capped <= 0n) return;

  const e1 = bandExcess(p);
  const e2 = bandExcess(p + capped);
  const E = sumBandExcess();
  const newSum = E - e1 + e2;
  if (newSum > POOL_CAP) {
    stealRpFromBracket(userId, newSum - POOL_CAP);
  }
  const tierBefore = rankedRoles.tierForRp(p);
  users.addPoints(userId, capped);
  db.prepare('UPDATE users SET rp_last_activity_ms = ? WHERE id = ?').run(Date.now(), userId);
  // Quête « atteindre Master+ » : on signale le franchissement.
  const tierAfter = rankedRoles.tierForRp(p + capped);
  if (tierAfter !== tierBefore) {
    try {
      const quests = require('./quests');
      const rankedMilestones = require('./rankedMilestones');
      quests.trackRankReached(userId, tierAfter);
      rankedMilestones.checkAndClaim(userId);
    } catch { /* deps optionnelles */ }
  }
}

function decayForUserIfIdle(userId) {
  const u = users.getUser(userId);
  if (!u) return 0n;
  const last = u.rp_last_activity_ms || 0;
  if (!last || Date.now() - last < DAY_MS) return 0n;
  const p = users.getPoints(userId);
  let loss = 0n;
  if (p < 50_000n) loss = 0n;
  else if (p < 60_000n) loss = 500n;
  else if (p < 70_000n) loss = 1000n;
  else if (p < 80_000n) loss = 2000n;
  else if (p < 90_000n) loss = 3000n;
  else if (p < 100_000n) loss = 4000n;
  else loss = 5000n;
  if (loss <= 0n) {
    db.prepare('UPDATE users SET rp_last_activity_ms = ? WHERE id = ?').run(Date.now(), userId);
    return 0n;
  }
  const np = p > loss ? p - loss : 0n;
  users.setPoints(userId, np);
  db.prepare('UPDATE users SET rp_last_activity_ms = ? WHERE id = ?').run(Date.now(), userId);
  return loss;
}

module.exports = {
  ratesForPoints,
  grantFromActivity,
  decayForUserIfIdle,
  sumBandExcess,
  POOL_CAP,
  BAND_LOW,
  BAND_HIGH,
};
