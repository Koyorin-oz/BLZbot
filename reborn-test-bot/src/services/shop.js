const db = require('../db');
const { SHOP_ROW1_RARITY_WEIGHTS } = require('../reborn/constants');
const { randomItemOfRarity, getItem, priceFor } = require('../reborn/catalog');
const meta = require('./meta');

function utcDateKey() {
  return new Date().toISOString().slice(0, 10);
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
  const day = utcDateKey();
  const count = db.prepare('SELECT COUNT(*) AS c FROM user_shop WHERE user_id = ? AND shop_date = ?').get(userId, day).c;
  const ins = db.prepare(
    'INSERT INTO user_shop (user_id, shop_date, slot, item_id, price) VALUES (?, ?, ?, ?, ?)',
  );
  for (let slot = count; slot < 5; slot++) {
    const item = pickShopItemExcludingDiamondConflict();
    const price = priceFor(item);
    ins.run(userId, day, slot, item.id, price.toString());
  }
}

function getTodaySlots(userId) {
  ensureShopSlots(userId);
  return db
    .prepare('SELECT slot, item_id, price FROM user_shop WHERE user_id = ? AND shop_date = ? ORDER BY slot')
    .all(userId, utcDateKey());
}

function getSlot(userId, slot) {
  return db
    .prepare('SELECT * FROM user_shop WHERE user_id = ? AND shop_date = ? AND slot = ?')
    .get(userId, utcDateKey(), slot);
}

function removeSlot(userId, slot) {
  db.prepare('DELETE FROM user_shop WHERE user_id = ? AND shop_date = ? AND slot = ?').run(userId, utcDateKey(), slot);
}

module.exports = { utcDateKey, ensureShopSlots, getTodaySlots, getSlot, removeSlot, rollRarity };
