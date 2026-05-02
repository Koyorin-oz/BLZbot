const db = require('../db');
const {
  SHOP_ROW1_RARITY_WEIGHTS,
  CATL_ROLL_MS,
  CATS_SPAWN_CHANCE,
  CATL_SPAWN_CHANCE,
} = require('../reborn/constants');
const { randomItemOfRarity, getItem, priceFor } = require('../reborn/catalog');
const meta = require('./meta');

function utcDateKey() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Clé de jour Europe/Paris (`YYYY-MM-DD`) — c'est ce qui sert de **reset minuit
 * fuseau Paris** : tous les slots de la veille sont ignorés dès que la date
 * change côté Paris.
 */
function parisDateKey() {
  return parisClock().ymd;
}

/** Jour + vague minuit / midi (Europe/Paris) si branche boutique étape ≥ 3 (doc REBORN). */
function parisClock() {
  const parts = new Intl.DateTimeFormat('fr-FR', {
    timeZone: 'Europe/Paris',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date());
  const g = (t) => parts.find((p) => p.type === t)?.value || '';
  const ymd = `${g('year')}-${g('month')}-${g('day')}`;
  const hour = parseInt(g('hour') || '0', 10) || 0;
  return { ymd, hour };
}

function effectiveShopDateKey(userId) {
  const { ymd, hour } = parisClock();
  try {
    const skillTree = require('./skillTree');
    if (skillTree.step(userId, 'shop') >= 3) {
      return `${ymd}_${hour >= 12 ? 'pm' : 'am'}`;
    }
  } catch {
    /* ignore */
  }
  return ymd;
}

function rollRarity() {
  const total = SHOP_ROW1_RARITY_WEIGHTS.reduce((a, [, w]) => a + w, 0);
  let r = Math.random() * total;
  for (const [name, w] of SHOP_ROW1_RARITY_WEIGHTS) {
    r -= w;
    if (r <= 0) return name;
  }
  return 'Commun';
}

function pickShopItemExcludingDiamondConflict() {
  for (let i = 0; i < 40; i++) {
    const rarity = rollRarity();
    const item = randomItemOfRarity(rarity);
    if (item.id === 'diamant' && meta.diamondHolder()) continue;
    return item;
  }
  return randomItemOfRarity('Commun');
}

function ensureShopSlots(userId) {
  const day = effectiveShopDateKey(userId);
  const rows = db.prepare('SELECT slot FROM user_shop WHERE user_id = ? AND shop_date = ?').all(userId, day);
  const taken = new Set(rows.map((r) => r.slot));
  const ins = db.prepare(
    'INSERT INTO user_shop (user_id, shop_date, slot, item_id, price) VALUES (?, ?, ?, ?, ?)',
  );
  for (let slot = 0; slot < 5; slot++) {
    if (taken.has(slot)) continue;
    const item = pickShopItemExcludingDiamondConflict();
    const price = priceFor(item);
    ins.run(userId, day, slot, item.id, price.toString());
  }
}

function getTodaySlots(userId) {
  ensureShopSlots(userId);
  const day = effectiveShopDateKey(userId);
  return db.prepare('SELECT slot, item_id, price FROM user_shop WHERE user_id = ? AND shop_date = ? ORDER BY slot').all(userId, day);
}

function getSlot(userId, slot) {
  const day = effectiveShopDateKey(userId);
  return db.prepare('SELECT * FROM user_shop WHERE user_id = ? AND shop_date = ? AND slot = ?').get(userId, day, slot);
}

function removeSlot(userId, slot) {
  const day = effectiveShopDateKey(userId);
  db.prepare('DELETE FROM user_shop WHERE user_id = ? AND shop_date = ? AND slot = ?').run(userId, day, slot);
}

module.exports = {
  utcDateKey,
  parisDateKey,
  effectiveShopDateKey,
  ensureShopSlots,
  getTodaySlots,
  getSlot,
  removeSlot,
  rollRarity,
};
