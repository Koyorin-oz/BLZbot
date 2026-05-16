/**
 * Progression index : % = items catalogue « collection » déjà obtenus au moins 1×.
 * Paliers et récompenses : crédités automatiquement (`autoClaimAll`).
 */
const db = require('../db');
const indexProgress = require('./indexProgress');
const users = require('./users');
const { isIndexable, totalIndexable } = require('./indexCatalog');

function parseOwned(json) {
  try {
    const a = JSON.parse(json || '[]');
    return new Set(Array.isArray(a) ? a.map(String) : []);
  } catch {
    return new Set();
  }
}

function saveOwned(userId, ownedSet) {
  const arr = [...ownedSet].sort();
  db.prepare('UPDATE user_item_index SET owned_json = ? WHERE user_id = ?').run(JSON.stringify(arr), userId);
  const total = totalIndexable();
  const pct = total > 0 ? Math.min(100, Math.floor((arr.length / total) * 100)) : 0;
  indexProgress.setCompletion(userId, pct);
  return pct;
}

/**
 * @param {string} userId
 * @param {string} itemId
 * @returns {number|null} nouveau % si mis à jour, sinon null
 */
function markDiscovered(userId, itemId) {
  if (!isIndexable(itemId)) return null;
  indexProgress.getRow(userId);
  const row = db.prepare('SELECT owned_json FROM user_item_index WHERE user_id = ?').get(userId);
  const owned = parseOwned(row?.owned_json);
  if (owned.has(itemId)) return null;
  owned.add(itemId);
  const pct = saveOwned(userId, owned);
  const grant = indexProgress.autoClaimAll(userId, users);
  return { pct, newly: grant.newly };
}

/** Recalcule le % depuis owned_json (sans ajouter d’item). */
function refreshCompletion(userId) {
  indexProgress.getRow(userId);
  const row = db.prepare('SELECT owned_json FROM user_item_index WHERE user_id = ?').get(userId);
  return saveOwned(userId, parseOwned(row?.owned_json));
}

function ownedCount(userId) {
  const row = db.prepare('SELECT owned_json FROM user_item_index WHERE user_id = ?').get(userId);
  return parseOwned(row?.owned_json).size;
}

module.exports = { markDiscovered, refreshCompletion, ownedCount, parseOwned };
