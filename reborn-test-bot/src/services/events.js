const db = require('../db');
const users = require('./users');
const skillTree = require('./skillTree');

const TYPES = {
  chasse: { name: 'Chasse aux étoiles', durationMs: 24 * 60 * 60 * 1000, baseScore: 10n },
  raid: { name: 'Raid Cosmique', durationMs: 12 * 60 * 60 * 1000, baseScore: 25n },
  marathon: { name: 'Marathon Stellaire', durationMs: 48 * 60 * 60 * 1000, baseScore: 5n },
};

function genKey(typeKey) {
  return `${typeKey}_${Date.now().toString(36)}`;
}

function activeEvents(hubDiscordId) {
  const now = Date.now();
  return db
    .prepare('SELECT * FROM events_active WHERE hub_discord_id = ? AND ends_ms > ? ORDER BY ends_ms')
    .all(hubDiscordId, now);
}

function startEvent(hubDiscordId, typeKey) {
  const t = TYPES[typeKey];
  if (!t) return { ok: false, error: 'Type inconnu (chasse, raid, marathon).' };
  const key = genKey(typeKey);
  const now = Date.now();
  db.prepare(
    `INSERT INTO events_active (hub_discord_id, event_key, starts_ms, ends_ms, meta_json) VALUES (?, ?, ?, ?, ?)`,
  ).run(hubDiscordId, key, now, now + t.durationMs, JSON.stringify({ type: typeKey, name: t.name }));
  return { ok: true, key, name: t.name, endsMs: now + t.durationMs };
}

function endEvent(hubDiscordId, eventKey) {
  const ev = db
    .prepare('SELECT * FROM events_active WHERE hub_discord_id = ? AND event_key = ?')
    .get(hubDiscordId, eventKey);
  if (!ev) return { ok: false, error: 'Événement introuvable.' };
  const top = db
    .prepare(
      'SELECT user_id, score FROM event_participation WHERE hub_discord_id = ? AND event_key = ? ORDER BY score DESC LIMIT 5',
    )
    .all(hubDiscordId, eventKey);
  // Remove from active.
  db.prepare('DELETE FROM events_active WHERE hub_discord_id = ? AND event_key = ?').run(hubDiscordId, eventKey);
  if (!top.length) return { ok: true, top: [] };
  const winnerId = top[0].user_id;
  // Bonus champion → temple key + récompense starss.
  try {
    const temple = require('./temple');
    temple.markKey(winnerId, 'event_champion');
    users.addStars(winnerId, 1_000_000n);
  } catch { /* ignore */ }
  // Récompenses top 5 : 1M / 500k / 250k / 100k / 50k.
  const REW = [1_000_000n, 500_000n, 250_000n, 100_000n, 50_000n];
  for (let i = 0; i < top.length; i++) {
    if (i === 0) continue; // déjà payé via champion bonus
    users.addStars(top[i].user_id, REW[i] || 25_000n);
  }
  return { ok: true, top, winnerId };
}

/**
 * Contribution joueur (appelée depuis earn / commandes).
 * Applique les bonus arbre Événement (currency mult, défense, discount via shop).
 */
function contribute(hubDiscordId, eventKey, userId, baseScore) {
  const ev = db
    .prepare('SELECT * FROM events_active WHERE hub_discord_id = ? AND event_key = ? AND ends_ms > ?')
    .get(hubDiscordId, eventKey, Date.now());
  if (!ev) return { ok: false, error: 'Événement non actif.' };
  const bp = skillTree.eventCurrencyMultBp(userId);
  const eff = (BigInt(baseScore) * BigInt(bp)) / 10000n;
  db.prepare(
    `INSERT INTO event_participation (hub_discord_id, event_key, user_id, score, contributed_ms)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(hub_discord_id, event_key, user_id)
     DO UPDATE SET score = score + excluded.score, contributed_ms = excluded.contributed_ms`,
  ).run(hubDiscordId, eventKey, userId, Number(eff), Date.now());
  // L'event_currency persiste indépendamment (donne du fun cross-event).
  users.addEventCurrency(userId, eff);
  return { ok: true, gained: eff };
}

function leaderboard(hubDiscordId, eventKey, limit = 10) {
  return db
    .prepare(
      'SELECT user_id, score FROM event_participation WHERE hub_discord_id = ? AND event_key = ? ORDER BY score DESC LIMIT ?',
    )
    .all(hubDiscordId, eventKey, limit);
}

/** Applique le bonus de défense (bp /10000) à un montant — ex. réduire les pertes en raid. */
function applyDefense(userId, damage) {
  const bp = skillTree.eventDefenseBonusBp(userId);
  if (bp <= 0) return damage;
  const reduced = (BigInt(damage) * BigInt(10000 - bp)) / 10000n;
  return reduced > 0n ? reduced : 0n;
}

/** Réduction de prix sur un coffre d'event (fraction 0–1). */
function applyChestDiscount(userId, price) {
  const f = skillTree.eventChestDiscountFrac(userId);
  if (f <= 0) return price;
  const m = BigInt(Math.round((1 - f) * 10000));
  return (BigInt(price) * m) / 10000n;
}

module.exports = {
  TYPES,
  startEvent,
  endEvent,
  activeEvents,
  contribute,
  leaderboard,
  applyDefense,
  applyChestDiscount,
};
