/**
 * Bonus permanents des paliers d’index — appliqués en jeu (earn, XP, coffres).
 * Cumul par palier atteint (cohérent avec `itemMatrix.INDEX_BONUSES`).
 */
const indexProgress = require('./indexProgress');

/** Effets par palier (basis points / 10000 = 1.0000). */
const TIER_EFFECTS = [
  { pct: 10, xpBp: 100 },
  { pct: 20, starsBp: 100 },
  { pct: 30, xpBp: 200 },
  { pct: 40, starsBp: 200 },
  { pct: 50, gxpBp: 300 },
  { pct: 60, chestBp: 500 },
  { pct: 70, grpBp: 500 },
  { pct: 90, xpBp: 1000 },
];

function completionPct(userId) {
  const row = indexProgress.getRow(userId);
  return Math.min(100, Math.max(0, row?.completion_pct || 0));
}

function multipliersForUser(userId) {
  const pct = completionPct(userId);
  let xpBp = 10000;
  let starsBp = 10000;
  let gxpBp = 10000;
  let grpBp = 10000;
  let chestBp = 10000;
  for (const t of TIER_EFFECTS) {
    if (pct < t.pct) continue;
    if (t.xpBp) xpBp += t.xpBp;
    if (t.starsBp) starsBp += t.starsBp;
    if (t.gxpBp) gxpBp += t.gxpBp;
    if (t.grpBp) grpBp += t.grpBp;
    if (t.chestBp) chestBp += t.chestBp;
  }
  return { pct, xpBp, starsBp, gxpBp, grpBp, chestBp };
}

function applyStars(userId, base) {
  const b = typeof base === 'bigint' ? base : BigInt(base);
  const { starsBp } = multipliersForUser(userId);
  return (b * BigInt(starsBp)) / 10000n;
}

function applyXpDelta(userId, delta) {
  const d = Math.floor(Number(delta) || 0);
  if (d <= 0) return d;
  const { xpBp } = multipliersForUser(userId);
  return Math.max(1, Math.floor((d * xpBp) / 10000));
}

function applyBp(userId, base, field) {
  const b = typeof base === 'bigint' ? base : BigInt(base);
  const m = multipliersForUser(userId);
  const bp = m[field] || 10000;
  return (b * BigInt(bp)) / 10000n;
}

/** Multiplicateur entier coffres (arbre shop × index). */
function chestLootMultN(userId, skillTreeMultN) {
  const { chestBp } = multipliersForUser(userId);
  const indexN = chestBp / 10000;
  return Math.max(1, Math.round(skillTreeMultN * indexN));
}

module.exports = {
  TIER_EFFECTS,
  multipliersForUser,
  applyStars,
  applyXpDelta,
  applyBp,
  chestLootMultN,
};
