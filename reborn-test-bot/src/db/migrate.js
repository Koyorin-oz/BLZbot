const fs = require('fs');
const path = require('path');

function addColumnIfMissing(db, table, name, sqlTypeDefault) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (cols.some((c) => c.name === name)) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${sqlTypeDefault}`);
}

/**
 * @param {import('better-sqlite3').Database} db
 */
function migrate(db) {
  const dir = path.join(__dirname, '..', '..', 'data');
  fs.mkdirSync(dir, { recursive: true });

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL DEFAULT '',
      stars TEXT NOT NULL DEFAULT '0',
      points TEXT NOT NULL DEFAULT '0',
      xp INTEGER NOT NULL DEFAULT 0,
      level INTEGER NOT NULL DEFAULT 1,
      daily_last_ms INTEGER NOT NULL DEFAULT 0,
      xp_boost_ms INTEGER NOT NULL DEFAULT 0,
      gxp_boost_ms INTEGER NOT NULL DEFAULT 0,
      starss_boost_ms INTEGER NOT NULL DEFAULT 0,
      catm_day TEXT NOT NULL DEFAULT '',
      catm_count INTEGER NOT NULL DEFAULT 0,
      catl_next_ms INTEGER NOT NULL DEFAULT 0,
      cats_next_ms INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS inventory (
      user_id TEXT NOT NULL,
      item_id TEXT NOT NULL,
      qty INTEGER NOT NULL DEFAULT 1,
      PRIMARY KEY (user_id, item_id)
    );

    CREATE TABLE IF NOT EXISTS user_shop (
      user_id TEXT NOT NULL,
      shop_date TEXT NOT NULL,
      slot INTEGER NOT NULL,
      item_id TEXT NOT NULL,
      price TEXT NOT NULL,
      PRIMARY KEY (user_id, shop_date, slot)
    );

    CREATE TABLE IF NOT EXISTS guild_member_gxp (
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      gxp TEXT NOT NULL DEFAULT '0',
      grp TEXT NOT NULL DEFAULT '0',
      PRIMARY KEY (guild_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS guilds (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL DEFAULT '',
      grade TEXT NOT NULL DEFAULT '',
      level INTEGER NOT NULL DEFAULT 0,
      gxp_total TEXT NOT NULL DEFAULT '0',
      created_ms INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS meta (
      k TEXT PRIMARY KEY,
      v TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS player_guilds (
      id TEXT PRIMARY KEY,
      hub_discord_id TEXT NOT NULL,
      name TEXT NOT NULL,
      leader_id TEXT NOT NULL,
      created_ms INTEGER NOT NULL,
      member_cap INTEGER NOT NULL DEFAULT 5,
      gxp TEXT NOT NULL DEFAULT '0',
      guild_level INTEGER NOT NULL DEFAULT 1,
      grade TEXT NOT NULL DEFAULT '',
      treasury TEXT NOT NULL DEFAULT '0',
      anti_separation INTEGER NOT NULL DEFAULT 0,
      last_focus_ms INTEGER NOT NULL DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_pg_hub ON player_guilds(hub_discord_id);
    CREATE INDEX IF NOT EXISTS idx_pg_leader ON player_guilds(leader_id);

    CREATE TABLE IF NOT EXISTS player_guild_members (
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      joined_ms INTEGER NOT NULL,
      PRIMARY KEY (guild_id, user_id)
    );

    CREATE INDEX IF NOT EXISTS idx_pgm_user ON player_guild_members(user_id);

    CREATE TABLE IF NOT EXISTS user_grp_peaks (
      hub_discord_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      rank_key TEXT NOT NULL,
      season_key TEXT NOT NULL,
      PRIMARY KEY (hub_discord_id, user_id, rank_key, season_key)
    );

    CREATE TABLE IF NOT EXISTS separations (
      id TEXT PRIMARY KEY,
      hub_discord_id TEXT NOT NULL,
      guild_id TEXT NOT NULL,
      initiator_id TEXT NOT NULL,
      phase INTEGER NOT NULL DEFAULT 1,
      started_ms INTEGER NOT NULL,
      phase1_end_ms INTEGER NOT NULL,
      phase2_end_ms INTEGER NOT NULL DEFAULT 0,
      camp_split TEXT NOT NULL DEFAULT '[]',
      camp_leader TEXT NOT NULL DEFAULT '[]',
      grp_snapshot_a TEXT NOT NULL DEFAULT '0',
      grp_snapshot_b TEXT NOT NULL DEFAULT '0',
      winner TEXT NOT NULL DEFAULT '',
      cancelled INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS trades (
      id TEXT PRIMARY KEY,
      hub_discord_id TEXT NOT NULL,
      from_user TEXT NOT NULL,
      to_user TEXT NOT NULL,
      from_stars TEXT NOT NULL DEFAULT '0',
      to_stars TEXT NOT NULL DEFAULT '0',
      status TEXT NOT NULL DEFAULT 'pending',
      created_ms INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS user_item_index (
      user_id TEXT PRIMARY KEY,
      completion_pct INTEGER NOT NULL DEFAULT 0,
      claimed_json TEXT NOT NULL DEFAULT '[]'
    );

    CREATE TABLE IF NOT EXISTS warns (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      hub_discord_id TEXT NOT NULL,
      target_id TEXT NOT NULL,
      mod_id TEXT NOT NULL,
      degree INTEGER NOT NULL,
      reason TEXT NOT NULL DEFAULT '',
      created_ms INTEGER NOT NULL
    );
  `);

  addColumnIfMissing(db, 'users', 'secu_points', 'INTEGER NOT NULL DEFAULT 10');
  addColumnIfMissing(db, 'users', 'secu_last_recovery_ms', 'INTEGER NOT NULL DEFAULT 0');
}

module.exports = { migrate };
