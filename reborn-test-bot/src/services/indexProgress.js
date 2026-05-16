const db = require('../db');

/** Paliers doc + coffres catalogue REBORN (rôle Discord 100 % : hors scope bot → message). */
const STEPS = [
  { pct: 10, stars: 10_000n, chests: [] },
  { pct: 20, stars: 50_000n, chests: [{ id: 'coffre_classique', qty: 1 }] },
  { pct: 30, stars: 100_000n, chests: [{ id: 'coffre_classique', qty: 1 }] },
  { pct: 40, stars: 200_000n, chests: [{ id: 'coffre_catm', qty: 1 }] },
  { pct: 50, stars: 300_000n, chests: [{ id: 'coffre_catm', qty: 1 }] },
  { pct: 60, stars: 500_000n, chests: [{ id: 'coffre_catl', qty: 1 }] },
  { pct: 70, stars: 750_000n, chests: [{ id: 'coffre_catl', qty: 1 }] },
  { pct: 80, stars: 1_000_000n, chests: [{ id: 'coffre_catl', qty: 2 }] },
  { pct: 90, stars: 1_500_000n, chests: [{ id: 'coffre_cats', qty: 1 }] },
  { pct: 100, stars: 2_000_000n, chests: [{ id: 'coffre_cats', qty: 1 }], roleNote: 'pipelette ultime (rôle Discord à attribuer côté serveur)' },
];

function getRow(userId) {
  let r = db.prepare('SELECT * FROM user_item_index WHERE user_id = ?').get(userId);
  if (!r) {
    db.prepare('INSERT INTO user_item_index (user_id, completion_pct, claimed_json) VALUES (?, 0, ?)').run(
      userId,
      '[]',
    );
    r = db.prepare('SELECT * FROM user_item_index WHERE user_id = ?').get(userId);
  }
  return r;
}

function parseClaimed(json) {
  try {
    const a = JSON.parse(json || '[]');
    return Array.isArray(a) ? a.map(Number) : [];
  } catch {
    return [];
  }
}

function setCompletion(userId, pct) {
  getRow(userId);
  db.prepare('UPDATE user_item_index SET completion_pct = ? WHERE user_id = ?').run(Math.min(100, Math.max(0, pct)), userId);
}

/** @deprecated Utiliser `autoClaimAll` — conservé pour compat interne. */
function claimNext(userId, usersSvc) {
  const r = autoClaimAll(userId, usersSvc);
  if (!r.newly.length) {
    return { ok: false, error: 'Aucun palier à valider (collectionne plus d’items ou tout est déjà reçu).' };
  }
  return { ok: true, step: r.newly[r.newly.length - 1] };
}

/**
 * Crédite tous les paliers atteints et pas encore enregistrés dans `claimed_json`.
 * @returns {{ pct: number, claimed: number[], newly: typeof STEPS }}
 */
function autoClaimAll(userId, usersSvc) {
  getRow(userId);
  const r = db.prepare('SELECT * FROM user_item_index WHERE user_id = ?').get(userId);
  let claimed = parseClaimed(r.claimed_json);
  const pct = r.completion_pct || 0;
  const newly = [];

  for (const step of STEPS) {
    if (claimed.includes(step.pct)) continue;
    if (pct < step.pct) continue;
    claimed.push(step.pct);
    usersSvc.addStars(userId, step.stars);
    for (const c of step.chests || []) {
      usersSvc.addInventory(userId, c.id, c.qty || 1);
    }
    newly.push(step);
  }

  if (newly.length) {
    claimed = [...new Set(claimed)].sort((a, b) => a - b);
    db.prepare('UPDATE user_item_index SET claimed_json = ? WHERE user_id = ?').run(
      JSON.stringify(claimed),
      userId,
    );
  }

  return { pct, claimed, newly };
}

module.exports = { STEPS, getRow, setCompletion, claimNext, parseClaimed, autoClaimAll };
