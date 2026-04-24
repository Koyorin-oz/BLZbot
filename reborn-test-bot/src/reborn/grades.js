/**
 * Grades de guilde « joueur » (doc REBORN) — ordre strict.
 * Simplifications test-bot : exigences starss + pics GR (saison) + comptes d’items par rareté.
 */

const ORDER = ['', 'bronze', 'argent', 'or', 'platine', 'diamant', 'goat', 'star'];

const NEXT_REQUIREMENTS = {
  bronze: { stars: 200_000n, minGrpRank: 'bronze', mythic: 0, crystal: 0, needDiamond: false },
  argent: { stars: 500_000n, minGrpRank: 'argent', mythic: 0, crystal: 0, needDiamond: false },
  or: { stars: 1_000_000n, minGrpRank: 'or', mythic: 0, crystal: 0, needDiamond: false },
  platine: { stars: 2_000_000n, minGrpRank: 'platine', mythic: 1, crystal: 0, needDiamond: false },
  diamant: { stars: 5_000_000n, minGrpRank: 'diamant', mythic: 3, crystal: 0, needDiamond: false },
  goat: { stars: 10_000_000n, minGrpRank: 'goat', mythic: 0, crystal: 1, needDiamond: false },
  star: { stars: 20_000_000n, minGrpRank: 'star', mythic: 0, crystal: 3, needDiamond: true },
};

const GRP_RANK_KEYS = ['bronze', 'argent', 'or', 'platine', 'diamant', 'goat', 'star'];
const GRP_THRESHOLDS = [1000n, 5000n, 10000n, 25000n, 50000n, 100000n, 200000n];

function grpRankFromTotal(grpTotal) {
  let best = '';
  for (let i = GRP_THRESHOLDS.length - 1; i >= 0; i--) {
    if (grpTotal >= GRP_THRESHOLDS[i]) {
      best = GRP_RANK_KEYS[i];
      break;
    }
  }
  return best;
}

function nextGrade(current) {
  const idx = ORDER.indexOf(current || '');
  if (idx < 0 || idx >= ORDER.length - 1) return null;
  return ORDER[idx + 1];
}

function rankAtLeast(currentRank, requiredRank) {
  const ir = GRP_RANK_KEYS.indexOf(requiredRank);
  const ic = GRP_RANK_KEYS.indexOf(currentRank);
  if (ir < 0) return true;
  if (ic < 0) return false;
  return ic >= ir;
}

function label(fr) {
  const m = {
    '': 'Aucun',
    bronze: 'Bronze',
    argent: 'Argent',
    or: 'Or',
    platine: 'Platine',
    diamant: 'Diamant',
    goat: 'Goat',
    star: 'Star',
  };
  return m[fr] || fr;
}

module.exports = { ORDER, NEXT_REQUIREMENTS, GRP_RANK_KEYS, GRP_THRESHOLDS, grpRankFromTotal, nextGrade, label };
