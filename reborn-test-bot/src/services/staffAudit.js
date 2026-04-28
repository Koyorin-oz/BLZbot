/**
 * Audit & timeouts staff.
 *
 * - `audit(...)` enregistre une action staff (warn, kick, mute, ban, perms…)
 *   pour traçabilité (`staff_audit`). Idempotent côté lecture (`recent`).
 * - `addTimeout(...)` enregistre un TO + applique le timeout Discord si le
 *   client/membre est passé en argument (best-effort, n'échoue pas).
 * - `listTimeouts(...)` renvoie les TOs récents pour un membre cible.
 */

const db = require('../db');

function audit(hubDiscordId, modId, targetId, action, details = '') {
  db.prepare(
    'INSERT INTO staff_audit (hub_discord_id, mod_id, target_id, action, details, created_ms) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(
    String(hubDiscordId || ''),
    String(modId || ''),
    String(targetId || ''),
    String(action || '').slice(0, 64),
    String(details || '').slice(0, 500),
    Date.now(),
  );
}

function recent(hubDiscordId, limit = 25) {
  return db
    .prepare(
      'SELECT * FROM staff_audit WHERE hub_discord_id = ? ORDER BY id DESC LIMIT ?',
    )
    .all(hubDiscordId, Math.max(1, Math.min(100, limit)));
}

function recentForTarget(hubDiscordId, targetId, limit = 15) {
  return db
    .prepare(
      'SELECT * FROM staff_audit WHERE hub_discord_id = ? AND target_id = ? ORDER BY id DESC LIMIT ?',
    )
    .all(hubDiscordId, targetId, Math.max(1, Math.min(50, limit)));
}

/**
 * Enregistre un timeout staff. Si `member` (GuildMember) est fourni, applique
 * le TO Discord directement (best-effort).
 * @param {{ hubDiscordId: string, targetId: string, modId: string, durationMin: number, reason?: string, member?: import('discord.js').GuildMember }} args
 */
async function addTimeout(args) {
  const dur = Math.max(1, Math.floor(Number(args.durationMin) || 0));
  const reason = String(args.reason || '').slice(0, 500);
  db.prepare(
    'INSERT INTO staff_timeouts (hub_discord_id, target_id, mod_id, duration_min, reason, created_ms) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(args.hubDiscordId, args.targetId, args.modId, dur, reason, Date.now());
  audit(args.hubDiscordId, args.modId, args.targetId, 'timeout', `${dur} min${reason ? ` — ${reason}` : ''}`);
  if (args.member?.timeout) {
    try {
      await args.member.timeout(dur * 60 * 1000, reason || `TO ${dur}min`);
      return { ok: true, applied: true };
    } catch (e) {
      return { ok: true, applied: false, error: e?.message || String(e) };
    }
  }
  return { ok: true, applied: false };
}

function listTimeouts(hubDiscordId, targetId, limit = 10) {
  return db
    .prepare(
      'SELECT * FROM staff_timeouts WHERE hub_discord_id = ? AND target_id = ? ORDER BY id DESC LIMIT ?',
    )
    .all(hubDiscordId, targetId, Math.max(1, Math.min(50, limit)));
}

module.exports = { audit, recent, recentForTarget, addTimeout, listTimeouts };
