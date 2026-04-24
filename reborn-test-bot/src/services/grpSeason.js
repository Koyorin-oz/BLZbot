const db = require('../db');
const { GRP_RANK_KEYS, GRP_THRESHOLDS, grpRankFromTotal } = require('../reborn/grades');
const meta = require('./meta');

function currentSeasonKey() {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function maybeResetMonthlyGrp(hubDiscordId) {
  const key = `grp_reset:${hubDiscordId}`;
  const sk = currentSeasonKey();
  const last = meta.get(key);
  if (last === sk) return false;
  db.prepare('UPDATE guild_member_gxp SET grp = ? WHERE guild_id = ?').run('0', hubDiscordId);
  meta.set(key, sk);
  return true;
}

function recordGrpPeaksIfNeeded(hubDiscordId, userId, grpTotal) {
  const rank = grpRankFromTotal(grpTotal);
  if (!rank) return;
  const idx = GRP_RANK_KEYS.indexOf(rank);
  if (idx < 0) return;
  const season = currentSeasonKey();
  for (let i = 0; i <= idx; i++) {
    const rk = GRP_RANK_KEYS[i];
    const th = GRP_THRESHOLDS[i];
    if (grpTotal >= th) {
      db.prepare(
        'INSERT OR IGNORE INTO user_grp_peaks (hub_discord_id, user_id, rank_key, season_key) VALUES (?, ?, ?, ?)',
      ).run(hubDiscordId, userId, rk, season);
    }
  }
}

module.exports = { currentSeasonKey, maybeResetMonthlyGrp, recordGrpPeaksIfNeeded, grpRankFromTotal };
