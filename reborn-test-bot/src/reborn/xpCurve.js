/**
 * XP cumulée doc REBORN :
 * 1→2 : 1 XP ; 2→3 : 99 XP ; puis pour L≥3, passage L→L+1 coûte (L-1)×100 XP.
 */

const MAX_LEVEL = 500;

function buildThresholdStarts() {
  /** T[L] = XP cumulée au début du niveau L (1-indexé). */
  const T = [];
  T[1] = 0;
  T[2] = 1;
  T[3] = 1 + 99;
  for (let L = 3; L < MAX_LEVEL; L++) {
    const cost = (L - 1) * 100;
    T[L + 1] = T[L] + cost;
  }
  return T;
}

const T_START = buildThresholdStarts();

/**
 * @param {number} totalXp
 * @returns {{ level: number, xpInto: number, xpTotal: number }}
 */
function totalToLevelState(totalXp) {
  const t = Math.max(0, Math.floor(Number(totalXp) || 0));
  let level = 1;
  for (let L = MAX_LEVEL - 1; L >= 1; L--) {
    if (t >= T_START[L]) {
      level = L;
      break;
    }
  }
  const xpInto = t - T_START[level];
  return { level, xpInto, xpTotal: t };
}

module.exports = { totalToLevelState, T_START, MAX_LEVEL };
