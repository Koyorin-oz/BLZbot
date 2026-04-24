const db = require('../db');
const users = require('./users');

const RARITY_VALUE = {
  Commun: 10_000n,
  Rare: 50_000n,
  Epique: 100_000n,
  Légendaire: 500_000n,
  Mythique: 1_000_000n,
  Goatesque: 3_000_000n,
  Staresque: 10_000_000n,
};

function valueFromInventoryRows(rows) {
  const { getItem } = require('../reborn/catalog');
  let v = 0n;
  for (const r of rows) {
    const it = getItem(r.item_id);
    if (!it) continue;
    v += (RARITY_VALUE[it.rarity] || 0n) * BigInt(r.qty);
  }
  return v;
}

function totalOfferValue(stars, invRows, eventCurrency = 0n) {
  const ev = typeof eventCurrency === 'bigint' ? eventCurrency : B(eventCurrency);
  return BigInt(stars || '0') + valueFromInventoryRows(invRows) + ev * 5n;
}

/** Écart max 40 % (doc). Monnaie d’évent : 1 = 5 valeur. */
function tradeAllowed(aStars, aInv, bStars, bInv, aEvent = 0n, bEvent = 0n) {
  const va = totalOfferValue(aStars, aInv, aEvent);
  const vb = totalOfferValue(bStars, bInv, bEvent);
  if (va === 0n && vb === 0n) return { ok: false, error: 'Offres vides.' };
  const hi = va > vb ? va : vb;
  const lo = va > vb ? vb : va;
  if (hi === 0n) return { ok: true };
  const diff = hi - lo;
  if (diff * 100n > hi * 40n) return { ok: false, error: 'Écart de valeur > 40 % (règle REBORN).' };
  return { ok: true };
}

function genId() {
  return `tr${Date.now()}${Math.random().toString(36).slice(2, 8)}`;
}

/** @returns {{ id: string, qty: number }[]} */
function parseItemsSpec(raw) {
  const s = String(raw || '').trim();
  if (!s) return [];
  const out = [];
  for (const part of s.split(/[,;\n]/)) {
    const p = part.trim();
    if (!p) continue;
    const m = p.match(/^([^:]+):(\d+)$/);
    if (!m) throw new Error(`Format invalide : \`${p}\` (attendu \`item_id:quantité\`).`);
    const id = m[1].trim();
    const qty = parseInt(m[2], 10);
    if (!id || qty < 1 || qty > 999) throw new Error(`Quantité invalide pour \`${id}\`.`);
    const { getItem } = require('../reborn/catalog');
    if (!getItem(id)) throw new Error(`Item inconnu : \`${id}\`.`);
    out.push({ id, qty });
  }
  return out;
}

function mergeItems(items) {
  const m = new Map();
  for (const { id, qty } of items) {
    m.set(id, (m.get(id) || 0) + qty);
  }
  return [...m.entries()].map(([id, qty]) => ({ id, qty }));
}

function itemsToRows(userId, items) {
  const inv = users.getInventory(userId);
  const by = new Map(inv.map((r) => [r.item_id, r.qty]));
  const rows = [];
  for (const { id, qty } of items) {
    const have = by.get(id) || 0;
    if (have < qty) return { ok: false, error: `Inventaire insuffisant pour **${id}** (besoin ${qty}, as ${have}).` };
    rows.push({ item_id: id, qty });
  }
  return { ok: true, rows };
}

function serializeItems(items) {
  return JSON.stringify(items.map(({ id, qty }) => ({ id, qty })));
}

function deserializeItems(json) {
  try {
    const a = JSON.parse(json || '[]');
    if (!Array.isArray(a)) return [];
    return mergeItems(
      a
        .map((x) => ({ id: String(x.id || x.item_id || '').trim(), qty: parseInt(x.qty, 10) || 0 }))
        .filter((x) => x.id && x.qty > 0),
    );
  } catch {
    return [];
  }
}

/**
 * @param {string} hubDiscordId
 * @param {string} fromUser
 * @param {string} toUser
 * @param {bigint|string} fromStars
 * @param {bigint|string} toStars
 * @param {{ id: string, qty: number }[]} fromItems
 * @param {{ id: string, qty: number }[]} toItems
 */
function createTrade(hubDiscordId, fromUser, toUser, fromStars, toStars, fromItems = [], toItems = []) {
  users.getOrCreate(fromUser, '');
  users.getOrCreate(toUser, '');
  const fi = mergeItems(fromItems);
  const ti = mergeItems(toItems);
  const fromRowsCheck = itemsToRows(fromUser, fi);
  if (!fromRowsCheck.ok) return fromRowsCheck;
  const toRowsCheck = itemsToRows(toUser, ti);
  if (!toRowsCheck.ok) return toRowsCheck;
  const chk = tradeAllowed(fromStars, fromRowsCheck.rows, toStars, toRowsCheck.rows);
  if (!chk.ok) return chk;
  const id = genId();
  db.prepare(
    `INSERT INTO trades (id, hub_discord_id, from_user, to_user, from_stars, to_stars, from_items_json, to_items_json, status, created_ms)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
  ).run(
    id,
    hubDiscordId,
    fromUser,
    toUser,
    String(fromStars),
    String(toStars),
    serializeItems(fi),
    serializeItems(ti),
    Date.now(),
  );
  return { ok: true, tradeId: id };
}

function acceptTrade(tradeId, userId) {
  try {
    return db.transaction(() => {
      const t = db.prepare('SELECT * FROM trades WHERE id = ?').get(tradeId);
      if (!t || t.status !== 'pending') throw new Error('Trade introuvable.');
      if (t.to_user !== userId) throw new Error('Pas le destinataire.');
      users.getOrCreate(t.from_user, '');
      users.getOrCreate(t.to_user, '');
      const fs = BigInt(t.from_stars || '0');
      const ts = BigInt(t.to_stars || '0');
      const fromItems = deserializeItems(t.from_items_json);
      const toItems = deserializeItems(t.to_items_json);
      const fromRowsCheck = itemsToRows(t.from_user, fromItems);
      if (!fromRowsCheck.ok) throw new Error(fromRowsCheck.error);
      const toRowsCheck = itemsToRows(t.to_user, toItems);
      if (!toRowsCheck.ok) throw new Error(toRowsCheck.error);
      const chk = tradeAllowed(fs, fromRowsCheck.rows, ts, toRowsCheck.rows);
      if (!chk.ok) throw new Error(chk.error);
      if (users.getStars(t.from_user) < fs || users.getStars(t.to_user) < ts) {
        throw new Error('Solde starss insuffisant.');
      }
      for (const { id, qty } of fromItems) {
        if (!users.takeInventory(t.from_user, id, qty)) throw new Error(`Retrait impossible : ${id}`);
      }
      for (const { id, qty } of toItems) {
        if (!users.takeInventory(t.to_user, id, qty)) throw new Error(`Retrait impossible : ${id}`);
      }
      users.addStars(t.from_user, -fs);
      users.addStars(t.to_user, fs);
      users.addStars(t.to_user, -ts);
      users.addStars(t.from_user, ts);
      for (const { id, qty } of fromItems) users.addInventory(t.to_user, id, qty);
      for (const { id, qty } of toItems) users.addInventory(t.from_user, id, qty);
      db.prepare('UPDATE trades SET status = ? WHERE id = ?').run('accepted', tradeId);
      return { ok: true };
    })();
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
}

module.exports = {
  tradeAllowed,
  createTrade,
  acceptTrade,
  totalOfferValue,
  RARITY_VALUE,
  parseItemsSpec,
  deserializeItems,
};
