/**
 * Récompenses one-shot « étapes ranked » 1-12 du gdoc.
 * Chaque palier correspond au passage d'une famille de rang (Plastique → Star)
 * et ne se réclame qu'une fois : tracé dans `ranked_milestones_claimed`.
 *
 * Quand `checkAndClaim(userId)` est appelé, on vérifie le RP courant et on
 * accorde toutes les récompenses débloquées non encore prises.
 *
 * Coffres : CAT = coffre_classique · CATM = coffre_catm · CATL = coffre_catl · CATS = coffre_cats.
 */

const db = require('../db');
const users = require('./users');

/** @typedef {{ key: string, rp: bigint, label: string, stars: bigint, items?: { id: string, qty: number }[] }} Milestone */

/** @type {Milestone[]} */
const MILESTONES = [
  { key: 'rk_plastique', rp: 50n, label: 'Passer Plastique', stars: 10_000n },
  { key: 'rk_bronze', rp: 300n, label: 'Passer Bronze', stars: 50_000n, items: [{ id: 'coffre_classique', qty: 1 }] },
  { key: 'rk_argent', rp: 1_000n, label: 'Passer Argent', stars: 100_000n, items: [{ id: 'coffre_classique', qty: 1 }] },
  { key: 'rk_or', rp: 3_000n, label: 'Passer Or', stars: 200_000n, items: [{ id: 'coffre_catm', qty: 1 }] },
  { key: 'rk_diamant', rp: 6_000n, label: 'Passer Diamant', stars: 300_000n, items: [{ id: 'coffre_catm', qty: 1 }] },
  { key: 'rk_emeraude', rp: 10_000n, label: 'Passer Émeraude', stars: 500_000n, items: [{ id: 'coffre_catl', qty: 1 }] },
  { key: 'rk_rubis', rp: 25_000n, label: 'Passer Rubis', stars: 750_000n, items: [{ id: 'coffre_catl', qty: 1 }] },
  { key: 'rk_legendaire', rp: 50_000n, label: 'Passer Légendaire', stars: 1_000_000n, items: [{ id: 'coffre_catl', qty: 2 }] },
  { key: 'rk_mythique', rp: 60_000n, label: 'Passer Mythique', stars: 1_500_000n, items: [{ id: 'coffre_cats', qty: 1 }] },
  { key: 'rk_master', rp: 70_000n, label: 'Passer Master', stars: 2_000_000n, items: [{ id: 'coffre_cats', qty: 1 }] },
  { key: 'rk_goat', rp: 80_000n, label: 'Passer Goat', stars: 3_000_000n, items: [{ id: 'coffre_cats', qty: 2 }] },
  { key: 'rk_star', rp: 100_000n, label: 'Passer Star', stars: 5_000_000n, items: [{ id: 'coffre_cats', qty: 3 }] },
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
