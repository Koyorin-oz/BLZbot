const db = require('../db');
const playerGuilds = require('./playerGuilds');

function B(s) {
  try {
    return BigInt(s || '0');
  } catch {
    return 0n;
  }
}

function genId() {
  return `sep${Date.now()}${Math.random().toString(36).slice(2, 8)}`;
}

const PHASE1_MS = 12 * 60 * 60 * 1000;
const PHASE2_MS = 48 * 60 * 60 * 1000;

function activeSeparationForGuild(guildId) {
  return db
    .prepare('SELECT * FROM separations WHERE guild_id = ? AND cancelled = 0 AND winner = ? AND phase > 0')
    .get(guildId, '');
}

function startSeparation(hubDiscordId, guildId, initiatorId) {
  const g = playerGuilds.getGuild(guildId);
  if (!g || g.hub_discord_id !== hubDiscordId) return { ok: false, error: 'Guilde invalide.' };
  if (g.anti_separation) return { ok: false, error: 'Cette guilde a **Anti-séparation** (grade Star).' };
  if (activeSeparationForGuild(guildId)) return { ok: false, error: 'Une séparation est déjà en cours.' };
  const now = Date.now();
  const id = genId();
  const camp = JSON.stringify([initiatorId]);
  db.prepare(
    `INSERT INTO separations (id, hub_discord_id, guild_id, initiator_id, phase, started_ms, phase1_end_ms, phase2_end_ms, camp_split, camp_leader, grp_snapshot_a, grp_snapshot_b, winner, cancelled)
     VALUES (?, ?, ?, ?, 1, ?, ?, 0, ?, '[]', '0', '0', '', 0)`,
  ).run(id, hubDiscordId, guildId, initiatorId, now, now + PHASE1_MS, camp);
  return { ok: true, separationId: id, phase1End: now + PHASE1_MS };
}

function joinSeparationCamp(hubDiscordId, userId, separationId) {
  const s = db.prepare('SELECT * FROM separations WHERE id = ? AND hub_discord_id = ?').get(separationId, hubDiscordId);
  if (!s || s.cancelled || (s.winner && String(s.winner).length > 0)) {
    return { ok: false, error: 'Séparation introuvable ou terminée.' };
  }
  if (s.phase !== 1 || Date.now() > s.phase1_end_ms) return { ok: false, error: 'Phase 1 terminée.' };
  const m = playerGuilds.getMembershipInHub(userId, hubDiscordId);
  if (!m || m.guild_id !== s.guild_id) return { ok: false, error: 'Tu dois être membre de cette guilde.' };
  let camp = [];
  try {
    camp = JSON.parse(s.camp_split || '[]');
  } catch {
    camp = [];
  }
  if (camp.includes(userId)) return { ok: true, joined: true };
  camp.push(userId);
  db.prepare('UPDATE separations SET camp_split = ? WHERE id = ?').run(JSON.stringify(camp), separationId);
  return { ok: true, joined: true };
}

function tickSeparations() {
  const rows = db.prepare('SELECT * FROM separations WHERE cancelled = 0 AND winner = ?').all('');
  const now = Date.now();
  for (const s of rows) {
    const total = playerGuilds.memberCount(s.guild_id);
    let camp = [];
    try {
      camp = JSON.parse(s.camp_split || '[]');
    } catch {
      camp = [];
    }
    if (s.phase === 1 && now >= s.phase1_end_ms) {
      const pct = total > 0 ? camp.length / total : 0;
      if (pct < 0.25) {
        db.prepare('UPDATE separations SET cancelled = 1, phase = 0 WHERE id = ?').run(s.id);
        continue;
      }
      const p2 = now + PHASE2_MS;
      const gm = require('./guildMember');
      let sumA = 0n;
      for (const uid of camp) {
        sumA += gm.getMemberRow(s.hub_discord_id, uid).grp;
      }
      const others = db.prepare('SELECT user_id FROM player_guild_members WHERE guild_id = ?').all(s.guild_id);
      let sumB = 0n;
      for (const { user_id } of others) {
        if (!camp.includes(user_id)) sumB += gm.getMemberRow(s.hub_discord_id, user_id).grp;
      }
      db.prepare(
        'UPDATE separations SET phase = 2, phase2_end_ms = ?, grp_snapshot_a = ?, grp_snapshot_b = ? WHERE id = ?',
      ).run(p2, sumA.toString(), sumB.toString(), s.id);
    } else if (s.phase === 2 && now >= s.phase2_end_ms) {
      const gm = require('./guildMember');
      let sumA = 0n;
      for (const uid of camp) {
        sumA += gm.getMemberRow(s.hub_discord_id, uid).grp;
      }
      const others = db.prepare('SELECT user_id FROM player_guild_members WHERE guild_id = ?').all(s.guild_id);
      const loyalIds = others.map((r) => r.user_id).filter((id) => !camp.includes(id));
      let sumB = 0n;
      for (const uid of loyalIds) {
        sumB += gm.getMemberRow(s.hub_discord_id, uid).grp;
      }
      const snapA = B(s.grp_snapshot_a);
      const snapB = B(s.grp_snapshot_b);
      const gainA = sumA - snapA;
      const gainB = sumB - snapB;
      const win = gainA > gainB ? 'split' : gainA < gainB ? 'loyal' : 'loyal';
      db.prepare('UPDATE separations SET winner = ?, phase = 0 WHERE id = ?').run(win, s.id);

      // Récompense gagnant : +25% des starss courants (cap 1M / membre) + point Temple + compteur trophée.
      try {
        const users = require('./users');
        const temple = require('./temple');
        const winners = win === 'split' ? camp : loyalIds;
        const cap = 1_000_000n;
        for (const uid of winners) {
          const cur = users.getStars(uid);
          let bonus = (cur * 25n) / 100n;
          if (bonus > cap) bonus = cap;
          if (bonus < 5_000n) bonus = 5_000n;
          users.addStars(uid, bonus);
          temple.markKey(uid, 'separation_won');
          try {
            db.prepare('UPDATE users SET separations_won = COALESCE(separations_won, 0) + 1 WHERE id = ?').run(uid);
          } catch { /* ignore */ }
        }
      } catch (e) {
        console.error('[separation reward]', e?.message || e);
      }
    }
  }
}

module.exports = { startSeparation, joinSeparationCamp, tickSeparations, activeSeparationForGuild };
