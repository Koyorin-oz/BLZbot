const db = require('../db');
const users = require('./users');

const RECOVER_MS = 30 * 24 * 60 * 60 * 1000;
const RECOVER_PTS = 2;
const MAX_SECU = 10;

function maybeRecoverSecu(userId) {
  const u = users.getUser(userId);
  if (!u) return;
  const pts = u.secu_points ?? 10;
  if (pts >= MAX_SECU) return;
  const last = u.secu_last_recovery_ms || 0;
  const now = Date.now();
  if (now - last < RECOVER_MS) return;
  const next = Math.min(MAX_SECU, pts + RECOVER_PTS);
  db.prepare('UPDATE users SET secu_points = ?, secu_last_recovery_ms = ? WHERE id = ?').run(next, now, userId);
}

function addWarn(hubDiscordId, targetId, modId, degree, reason) {
  const loss = { leger: 1, moyen: 2, fort: 5 }[degree] ?? 1;
  users.getOrCreate(targetId, '');
  maybeRecoverSecu(targetId);
  const u = users.getUser(targetId);
  const pts = Math.max(0, (u.secu_points ?? 10) - loss);
  db.prepare('INSERT INTO warns (hub_discord_id, target_id, mod_id, degree, reason, created_ms) VALUES (?, ?, ?, ?, ?, ?)').run(
    hubDiscordId,
    targetId,
    modId,
    loss,
    (reason || '').slice(0, 500),
    Date.now(),
  );
  db.prepare('UPDATE users SET secu_points = ? WHERE id = ?').run(pts, targetId);
  return { ok: true, newPoints: pts, loss };
}

function listWarns(hubDiscordId, targetId, limit = 15) {
  return db
    .prepare(
      'SELECT * FROM warns WHERE hub_discord_id = ? AND target_id = ? ORDER BY id DESC LIMIT ?',
    )
    .all(hubDiscordId, targetId, limit);
}

module.exports = { maybeRecoverSecu, addWarn, listWarns, MAX_SECU, RECOVER_MS };
