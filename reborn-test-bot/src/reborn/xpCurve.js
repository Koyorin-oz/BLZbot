/**
 * Courbe XP doc REBORN : 0→1 : 1 XP ; 1→2 : 99 ; puis k→k+1 pour k≥2 coûte k×100 XP.
 * `xp_total` = XP cumulée totale ; niveau 1 commence à total 0.
 */

/**
 * @param {number} totalXp
 * @returns {{ level: number, xpInto: number, xpTotal: number }}
 */
function totalToLevelState(totalXp) {
  const t = Math.max(0, Math.floor(Number(totalXp) || 0));
  let rem = t;
  let level = 1;
  if (rem < 1) {
    return { level: 1, xpInto: rem, xpTotal: t };
  }
  rem -= 1;
  level = 2;
  if (rem < 99) {
    return { level: 2, xpInto: rem, xpTotal: t };
  }
  rem -= 99;
  level = 3;
  while (rem >= level * 100) {
    rem -= level * 100;
    level += 1;
  }
  return { level, xpInto: rem, xpTotal: t };
}

module.exports = { totalToLevelState };
