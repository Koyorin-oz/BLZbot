'use strict';

const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');

/**
 * Base incidents anti-raid (better-sqlite3).
 * ANTI_RAID_DB_PATH : chemin absolu ou relatif au cwd ; par défaut verification/data/raid_incidents.sqlite
 * Pour réutiliser l’ancienne DB modération : ANTI_RAID_DB_PATH=modération/raid_incidents.db (une fois le bot modération délesté).
 */
function openRaidDb() {
  const defaultPath = path.join(__dirname, '..', '..', 'data', 'raid_incidents.sqlite');
  const raw = String(process.env.ANTI_RAID_DB_PATH || '').trim();
  const dbPath = raw ? path.resolve(process.cwd(), raw) : defaultPath;
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS raid_incidents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guildId TEXT NOT NULL,
      detected_at INTEGER NOT NULL,
      peak_score INTEGER NOT NULL,
      raider_count INTEGER DEFAULT 0,
      criteria_triggered TEXT,
      action_taken TEXT,
      lockdown_activated INTEGER DEFAULT 0,
      resolved_at INTEGER,
      resolved_by TEXT,
      notes TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_raid_incidents_guildId ON raid_incidents (guildId);
    CREATE INDEX IF NOT EXISTS idx_raid_incidents_detected_at ON raid_incidents (detected_at);

    CREATE TABLE IF NOT EXISTS detected_raiders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      incident_id INTEGER NOT NULL,
      userId TEXT NOT NULL,
      username TEXT,
      account_age_days INTEGER,
      join_timestamp INTEGER NOT NULL,
      score_contribution INTEGER,
      action_applied TEXT,
      FOREIGN KEY(incident_id) REFERENCES raid_incidents(id)
    );
    CREATE INDEX IF NOT EXISTS idx_detected_raiders_incident ON detected_raiders (incident_id);
    CREATE INDEX IF NOT EXISTS idx_detected_raiders_userId ON detected_raiders (userId);
  `);

  const insertIncident = db.prepare(`
    INSERT INTO raid_incidents (guildId, detected_at, peak_score, raider_count, criteria_triggered, action_taken, lockdown_activated)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const updLock = db.prepare(
    `UPDATE raid_incidents SET lockdown_activated = ?, action_taken = ? WHERE id = ?`,
  );
  const updResolve = db.prepare(
    `UPDATE raid_incidents SET resolved_at = ?, resolved_by = ? WHERE id = ?`,
  );
  const insertRaider = db.prepare(`
    INSERT INTO detected_raiders (incident_id, userId, username, account_age_days, join_timestamp, action_applied)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const listIncidents = db.prepare(`
    SELECT * FROM raid_incidents WHERE guildId = ? ORDER BY detected_at DESC LIMIT ?
  `);

  return {
    /** @returns {number|null} last row id */
    createIncident(guildId, score, criteria, lockdown, raiderCount) {
      try {
        const now = Date.now();
        const r = insertIncident.run(
          guildId,
          now,
          score,
          raiderCount || 0,
          criteria,
          'RAID_MODE_ACTIVATED',
          lockdown ? 1 : 0,
        );
        return Number(r.lastInsertRowid) || null;
      } catch (e) {
        console.error('[ANTI-RAID DB] createIncident:', e);
        return null;
      }
    },
    updateIncidentLockdown(incidentId, lockdown) {
      if (!incidentId) return;
      try {
        updLock.run(lockdown ? 1 : 0, 'LOCKDOWN_ACTIVATED', incidentId);
      } catch (e) {
        console.error('[ANTI-RAID DB] updateIncidentLockdown:', e);
      }
    },
    resolveIncident(incidentId, resolvedBy) {
      if (!incidentId) return;
      try {
        updResolve.run(Date.now(), resolvedBy, incidentId);
      } catch (e) {
        console.error('[ANTI-RAID DB] resolveIncident:', e);
      }
    },
    recordRaiderAction(incidentId, userId, username, accountAgeDays, action) {
      if (!incidentId) return;
      try {
        insertRaider.run(incidentId, userId, username, accountAgeDays, Date.now(), action);
      } catch (e) {
        console.error('[ANTI-RAID DB] recordRaiderAction:', e);
      }
    },
    /** @returns {object[]} */
    getIncidentHistory(guildId, limit) {
      try {
        return listIncidents.all(guildId, limit) || [];
      } catch (e) {
        console.error('[ANTI-RAID DB] getIncidentHistory:', e);
        return [];
      }
    },
  };
}

module.exports = { openRaidDb };
