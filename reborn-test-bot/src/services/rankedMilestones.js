/**
 * Récompenses one-shot par palier de RP atteint (étapes 3-12 du doc REBORN).
 * Chaque palier ne se réclame qu'une fois : tracé dans `ranked_milestones_claimed`.
 *
 * Quand `checkAndClaim(userId)` est appelé, on vérifie le RP courant et on
 * accorde toutes les récompenses débloquées non encore prises.
 */

const db = require('../db');
const users = require('./users');

/** @typedef {{ key: string, rp: bigint, label: string, stars: bigint, items?: { id: string, qty: number }[] }} Milestone */

/** @type {Milestone[]} */
const MILESTONES = [
  { key: 'rp_50k', rp: 50_000n, label: 'Palier Argent', stars: 25_000n, items: [{ id: 'starss_boost', qty: 1 }] },
  { key: 'rp_60k', rp: 60_000n, label: 'Palier Or', stars: 50_000n, items: [{ id: 'planete', qty: 1 }] },
  { key: 'rp_70k', rp: 70_000n, label: 'Palier Platine', stars: 100_000n, items: [{ id: 'corail', qty: 1 }] },
  { key: 'rp_80k', rp: 80_000n, label: 'Palier Diamond', stars: 200_000n, items: [{ id: 'requin', qty: 1 }] },
  { key: 'rp_90k', rp: 90_000n, label: 'Palier Master', stars: 400_000n, items: [{ id: 'baleine', qty: 1 }] },
  { key: 'rp_100k', rp: 100_000n, label: 'Palier Apex', stars: 750_000n, items: [{ id: 'quasar', qty: 1 }] },
  { key: 'rp_110k', rp: 110_000n, label: 'Apex +10k', stars: 1_000_000n, items: [{ id: 'coffre_catl', qty: 1 }] },
  { key: 'rp_125k', rp: 125_000n, label: 'Apex +25k', stars: 1_500_000n, items: [{ id: 'galaxie', qty: 1 }] },
  { key: 'rp_150k', rp: 150_000n, label: 'Apex +50k', stars: 2_000_000n, items: [{ id: 'crystal', qty: 1 }] },
  { key: 'rp_175k', rp: 175_000n, label: 'Apex +75k', stars: 3_000_000n, items: [{ id: 'coffre_catl', qty: 2 }] },
  { key: 'rp_200k', rp: 200_000n, label: 'Apex +100k', stars: 5_000_000n, items: [{ id: 'coffre_cats', qty: 1 }] },
  { key: 'rp_250k', rp: 250_000n, label: 'Légende', stars: 10_000_000n, items: [{ id: 'coffre_cats', qty: 1 }] },
];

function ensureTable() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ranked_milestones_claimed (
      user_id TEXT NOT NULL,
      milestone_key TEXT NOT NULL,
      claimed_ms INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (user_id, milestone_key)
    );
  `);
}

ensureTable();

function isClaimed(userId, key) {
  return !!db
    .prepare('SELECT 1 FROM ranked_milestones_claimed WHERE user_id = ? AND milestone_key = ?')
    .get(userId, key);
}

function markClaimed(userId, key) {
  db.prepare(
    'INSERT OR IGNORE INTO ranked_milestones_claimed (user_id, milestone_key, claimed_ms) VALUES (?, ?, ?)',
  ).run(userId, key, Date.now());
}

/**
 * Réclame automatiquement tous les paliers franchis non encore pris.
 * @returns {{ key: string, label: string, stars: bigint, items: any[] }[]}
 */
function checkAndClaim(userId) {
  const rp = users.getPoints(userId);
  const claimed = [];
  for (const m of MILESTONES) {
    if (rp < m.rp) continue;
    if (isClaimed(userId, m.key)) continue;
    users.addStars(userId, m.stars);
    for (const it of m.items || []) {
      users.addInventory(userId, it.id, it.qty);
    }
    markClaimed(userId, m.key);
    claimed.push({ key: m.key, label: m.label, stars: m.stars, items: m.items || [] });
  }
  return claimed;
}

/** Liste des paliers + statut pour un user (utilisé par `/ranked-paliers`). */
function summary(userId) {
  const rp = users.getPoints(userId);
  return MILESTONES.map((m) => ({
    ...m,
    reached: rp >= m.rp,
    claimed: isClaimed(userId, m.key),
  }));
}

module.exports = { MILESTONES, checkAndClaim, summary, isClaimed };
