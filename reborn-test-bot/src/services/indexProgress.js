const db = require('../db');

const STEPS = [
  { pct: 10, stars: 10_000n, label: '10 %' },
  { pct: 20, stars: 50_000n, label: '20 %' },
  { pct: 30, stars: 100_000n, label: '30 %' },
  { pct: 40, stars: 200_000n, label: '40 %' },
  { pct: 50, stars: 300_000n, label: '50 %' },
  { pct: 60, stars: 500_000n, label: '60 %' },
  { pct: 70, stars: 750_000n, label: '70 %' },
  { pct: 80, stars: 1_000_000n, label: '80 %' },
  { pct: 90, stars: 1_500_000n, label: '90 %' },
  { pct: 100, stars: 2_000_000n, label: '100 %' },
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

function claimNext(userId, usersSvc) {
  getRow(userId);
  const r = db.prepare('SELECT * FROM user_item_index WHERE user_id = ?').get(userId);
  const claimed = parseClaimed(r.claimed_json);
  const pct = r.completion_pct || 0;
  const next = STEPS.find((s) => s.pct <= pct && !claimed.includes(s.pct));
  if (!next) return { ok: false, error: 'Aucune étape réclamable (monte ton % ou tout est pris).' };
  if (pct < next.pct) {
    return { ok: false, error: `Complète au moins **${next.pct} %** de l’index (actuel : **${pct}**).` };
  }
  claimed.push(next.pct);
  usersSvc.addStars(userId, next.stars);
  db.prepare('UPDATE user_item_index SET claimed_json = ? WHERE user_id = ?').run(JSON.stringify(claimed.sort((a, b) => a - b)), userId);
  return { ok: true, step: next };
}

module.exports = { STEPS, getRow, setCompletion, claimNext, parseClaimed };
