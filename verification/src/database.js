/**
 * SQLite — config par guilde + table de vérification (un compte = un email par guilde).
 * Stocke uniquement le hash SHA-256 de l'email (anti double-compte sans PII en clair).
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const Database = require('better-sqlite3');

const dbPath = path.join(__dirname, '..', 'data', 'verification.sqlite');
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const db = new Database(dbPath);

db.exec(`
CREATE TABLE IF NOT EXISTS guild_config (
  guild_id TEXT PRIMARY KEY,
  panel_channel_id TEXT,
  panel_message_id TEXT,
  verified_role_id TEXT,
  log_channel_no_ip_id TEXT,
  embed_title TEXT,
  embed_description TEXT,
  embed_color INTEGER DEFAULT 3447003,
  updated_at INTEGER DEFAULT (strftime('%s', 'now') * 1000)
);

CREATE TABLE IF NOT EXISTS guild_verifications (
  guild_id TEXT NOT NULL,
  discord_user_id TEXT NOT NULL,
  email_hash TEXT NOT NULL,
  ip_hash TEXT,
  verified_at INTEGER NOT NULL,
  PRIMARY KEY (guild_id, discord_user_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_guild_verifications_email
  ON guild_verifications(guild_id, email_hash);

CREATE TABLE IF NOT EXISTS oauth_ticket (
  id TEXT PRIMARY KEY,
  guild_id TEXT NOT NULL,
  discord_user_id TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_oauth_ticket_created ON oauth_ticket(created_at);
`);

/** Migration safe : ajoute `ip_hash` aux DB existantes (pré-1.1). */
function safeAddVerificationColumn(name, sqlType) {
  try {
    db.exec(`ALTER TABLE guild_verifications ADD COLUMN ${name} ${sqlType}`);
  } catch (e) {
    if (!/duplicate column/i.test(String(e.message))) throw e;
  }
}
safeAddVerificationColumn('ip_hash', 'TEXT');

db.exec(`CREATE INDEX IF NOT EXISTS idx_guild_verifications_ip
  ON guild_verifications(guild_id, ip_hash);`);

const DEFAULT_EMBED = {
  embed_title: '🔐 Vérification',
  embed_description:
    'Clique sur le bouton ci-dessous pour vérifier ton compte avec ton **email Discord vérifié**.\n\n' +
    'Cela limite les doubles comptes sur ce serveur (une adresse email = un compte Discord ici).',
  embed_color: 3447003,
};

function rowToConfig(row) {
  if (!row) return null;
  return { ...row };
}

function getGuildConfig(guildId) {
  const row = db.prepare('SELECT * FROM guild_config WHERE guild_id = ?').get(guildId);
  return rowToConfig(row);
}

const CONFIG_KEYS = new Set([
  'panel_channel_id',
  'panel_message_id',
  'verified_role_id',
  'log_channel_no_ip_id',
  'embed_title',
  'embed_description',
  'embed_color',
]);

function upsertGuildConfig(guildId, patch) {
  db.prepare('INSERT OR IGNORE INTO guild_config (guild_id) VALUES (?)').run(guildId);
  const keys = Object.keys(patch).filter((k) => CONFIG_KEYS.has(k));
  if (keys.length === 0) return getGuildConfig(guildId);
  const setClause = keys.map((k) => `${k} = @${k}`).join(', ');
  const params = { guild_id: guildId, updated_at: Date.now() };
  for (const k of keys) {
    params[k] = patch[k];
  }
  const sql = `UPDATE guild_config SET ${setClause}, updated_at = @updated_at WHERE guild_id = @guild_id`;
  db.prepare(sql).run(params);
  return getGuildConfig(guildId);
}

function getEffectiveEmbed(config) {
  const c = config || {};
  const n = Number(c.embed_color);
  const color =
    c.embed_color != null && c.embed_color !== '' && Number.isFinite(n) && n >= 0 && n <= 0xffffff
      ? n
      : DEFAULT_EMBED.embed_color;
  return {
    title: (c.embed_title && String(c.embed_title).trim()) || DEFAULT_EMBED.embed_title,
    description:
      (c.embed_description && String(c.embed_description).trim()) || DEFAULT_EMBED.embed_description,
    color,
  };
}

function resetEmbedToDefault(guildId) {
  return upsertGuildConfig(guildId, {
    embed_title: null,
    embed_description: null,
    embed_color: null,
  });
}

const getVerificationRow = db.prepare(
  'SELECT guild_id, discord_user_id, email_hash, verified_at FROM guild_verifications WHERE guild_id = ? AND discord_user_id = ?',
);
const getByGuildEmailHash = db.prepare(
  'SELECT discord_user_id FROM guild_verifications WHERE guild_id = ? AND email_hash = ?',
);
const delGuildUser = db.prepare(
  'DELETE FROM guild_verifications WHERE guild_id = ? AND discord_user_id = ?',
);
const insertGuildVerification = db.prepare(
  'INSERT INTO guild_verifications (guild_id, discord_user_id, email_hash, ip_hash, verified_at) VALUES (?, ?, ?, ?, ?)',
);
const findAltsByIpStmt = db.prepare(
  'SELECT discord_user_id, verified_at FROM guild_verifications WHERE guild_id = ? AND ip_hash = ? AND discord_user_id != ? ORDER BY verified_at DESC',
);

function findVerifiedInGuild(guildId, discordUserId) {
  return getVerificationRow.get(guildId, discordUserId) || null;
}

/**
 * Trouve tous les autres comptes Discord ayant la même empreinte IP que le membre courant
 * sur la même guilde. Utilisé pour la détection d'alts. Renvoie un tableau (peut être vide).
 *
 * Le hash IP doit être calculé via `cryptoUtil.hashIp(ipString)` côté appelant —
 * jamais l'IP en clair pour préserver la vie privée.
 *
 * @param {string} guildId
 * @param {string} ipHash
 * @param {string} excludeDiscordUserId  ID du membre courant (à exclure du résultat)
 * @returns {Array<{ discord_user_id: string, verified_at: number }>}
 */
function findAltsByIp(guildId, ipHash, excludeDiscordUserId) {
  if (!ipHash) return [];
  return findAltsByIpStmt.all(guildId, ipHash, excludeDiscordUserId) || [];
}

class DuplicateEmailError extends Error {
  /** @param {string} otherDiscordUserId */
  constructor(otherDiscordUserId) {
    super('duplicate_email');
    this.otherDiscordUserId = otherDiscordUserId;
  }
}

/**
 * Vérifie qu'aucun *autre* compte Discord n'a déjà cet email sur la guilde
 * (avant OAuth / rôle).
 * @throws {DuplicateEmailError}
 */
function assertUniqueVerificationEmail(guildId, discordUserId, emailHash) {
  const row = getByGuildEmailHash.get(guildId, emailHash);
  if (row && row.discord_user_id !== discordUserId) {
    throw new DuplicateEmailError(row.discord_user_id);
  }
}

/**
 * Persiste la ligne guild_verifications (appeler après assertUnique + attribution du rôle).
 * Gère la course rare deux inserts concurrents (UNIQUE sur email par guilde).
 *
 * @param {string} guildId
 * @param {string} discordUserId
 * @param {string} emailHash
 * @param {string|null} ipHash  hash SHA-256 de l'IP (peut être null si non capturée)
 */
function saveVerifiedForGuild(guildId, discordUserId, emailHash, ipHash = null, verifiedAt = Date.now()) {
  try {
    db.transaction(() => {
      delGuildUser.run(guildId, discordUserId);
      insertGuildVerification.run(guildId, discordUserId, emailHash, ipHash, verifiedAt);
    })();
  } catch (e) {
    const code = e && e.code;
    const msg = String(e && e.message);
    if (code === 'SQLITE_CONSTRAINT_UNIQUE' || /UNIQUE constraint failed/i.test(msg)) {
      const row = getByGuildEmailHash.get(guildId, emailHash);
      if (row && row.discord_user_id !== discordUserId) {
        throw new DuplicateEmailError(row.discord_user_id);
      }
    }
    throw e;
  }
}

/**
 * Supprime l'entrée de vérification d'un membre sur une guilde.
 *
 * Effets en cascade :
 *  - Le membre n'est plus considéré comme vérifié (re-soumettre /verify le re-passera dans le pipeline)
 *  - L'IP associée est libérée du registre d'alts pour cette guilde
 *  - L'email est libéré (un autre compte peut désormais utiliser le même email)
 *
 * Idempotente : renvoie `true` si une ligne a été supprimée, `false` sinon.
 *
 * @param {string} guildId
 * @param {string} discordUserId
 * @returns {boolean}
 */
function deleteVerifiedForGuild(guildId, discordUserId) {
  const info = delGuildUser.run(guildId, discordUserId);
  return info.changes > 0;
}

/** Durée de vie d’un ticket OAuth (bouton → authorize), évite l’accumulation en base. */
const OAUTH_TICKET_TTL_MS = 15 * 60 * 1000;

const OAUTH_TICKET_ID_RE = /^[a-f0-9]{32}$/;

const insertOauthTicketStmt = db.prepare(
  'INSERT INTO oauth_ticket (id, guild_id, discord_user_id, created_at) VALUES (?, ?, ?, ?)',
);
const selectOauthTicketStmt = db.prepare('SELECT * FROM oauth_ticket WHERE id = ?');
const deleteOauthTicketStmt = db.prepare('DELETE FROM oauth_ticket WHERE id = ?');
const purgeStaleOauthTicketsStmt = db.prepare('DELETE FROM oauth_ticket WHERE created_at < ?');

/**
 * Crée un ticket court (32 hex) pour l’URL Discord OAuth ; le `state` du bouton reste petit
 * → autorisation 100 % sur discord.com (pas de modal « tu quittes Discord »).
 */
function createOAuthTicket(guildId, discordUserId) {
  const id = crypto.randomBytes(16).toString('hex');
  const now = Date.now();
  db.transaction(() => {
    purgeStaleOauthTicketsStmt.run(now - OAUTH_TICKET_TTL_MS);
    insertOauthTicketStmt.run(id, guildId, discordUserId, now);
  })();
  return id;
}

/** Lecture seule + vérif TTL ; ne supprime pas (permets les réessais OAuth avec le même state). */
function peekOAuthTicket(id) {
  if (!id || typeof id !== 'string' || !OAUTH_TICKET_ID_RE.test(id)) return null;
  const row = selectOauthTicketStmt.get(id);
  if (!row) return null;
  const age = Date.now() - Number(row.created_at);
  if (age > OAUTH_TICKET_TTL_MS || age < 0) {
    deleteOauthTicketStmt.run(id);
    return null;
  }
  return { guildId: row.guild_id, discordUserId: row.discord_user_id };
}

function deleteOAuthTicket(id) {
  if (!id || typeof id !== 'string') return;
  deleteOauthTicketStmt.run(id);
}

module.exports = {
  db,
  getGuildConfig,
  upsertGuildConfig,
  getEffectiveEmbed,
  resetEmbedToDefault,
  findVerifiedInGuild,
  findAltsByIp,
  saveVerifiedForGuild,
  deleteVerifiedForGuild,
  assertUniqueVerificationEmail,
  DuplicateEmailError,
  DEFAULT_EMBED,
};
