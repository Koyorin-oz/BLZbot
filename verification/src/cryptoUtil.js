/**
 * Utilitaires crypto :
 *  - hashEmail : SHA-256 de l'email normalisé (anti double-compte sans stocker l'email clair).
 *  - signState / verifyState : HMAC sur l'état OAuth (anti-replay, expiration 30 min).
 */
const crypto = require('node:crypto');

function sha256Hex(input) {
  return crypto.createHash('sha256').update(input, 'utf8').digest('hex');
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function hashEmail(email) {
  return sha256Hex(normalizeEmail(email));
}

/**
 * Hash SHA-256 d'une IP normalisée (lowercase, trim).
 * Stocké en DB pour la détection d'alts sans persister l'IP en clair.
 */
function hashIp(ip) {
  return sha256Hex(String(ip || '').trim().toLowerCase());
}

/**
 * @param {{ discordUserId: string, guildId: string }} params
 * @param {string} secret
 */
function signState({ discordUserId, guildId }, secret) {
  const payload = `${discordUserId}.${guildId}.${Date.now()}`;
  const sig = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  return Buffer.from(`${payload}.${sig}`, 'utf8').toString('base64url');
}

/**
 * @returns {{ discordUserId: string, guildId: string } | null}
 */
function verifyState(stateB64, secret, maxAgeMs = 30 * 60 * 1000) {
  if (!stateB64 || !secret) return null;
  let raw;
  try {
    raw = Buffer.from(stateB64, 'base64url').toString('utf8');
  } catch {
    return null;
  }
  const lastDot = raw.lastIndexOf('.');
  if (lastDot <= 0) return null;
  const payload = raw.slice(0, lastDot);
  const sig = raw.slice(lastDot + 1);
  const expected = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  if (typeof sig !== 'string' || sig.length !== expected.length || expected.length !== 64) {
    return null;
  }
  let a;
  let b;
  try {
    a = Buffer.from(sig, 'hex');
    b = Buffer.from(expected, 'hex');
  } catch {
    return null;
  }
  if (a.length !== b.length) return null;
  if (!crypto.timingSafeEqual(a, b)) {
    return null;
  }
  const parts = payload.split('.');
  if (parts.length !== 3) return null;
  const [userId, guildId, tsStr] = parts;
  const ts = Number(tsStr);
  if (!/^\d{17,22}$/.test(userId) || !/^\d{17,22}$/.test(guildId) || !Number.isFinite(ts)) return null;
  if (Date.now() - ts > maxAgeMs) return null;
  return { discordUserId: userId, guildId };
}

module.exports = {
  hashEmail,
  hashIp,
  normalizeEmail,
  signState,
  verifyState,
};
