const db = require('../db');

const getStmt = db.prepare('SELECT * FROM users WHERE id = ?');
const upsertStmt = db.prepare(
  'INSERT INTO users (id, username) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET username = excluded.username',
);
const starsStmt = db.prepare('UPDATE users SET stars = ? WHERE id = ?');
const pointsStmt = db.prepare('UPDATE users SET points = ? WHERE id = ?');
const xpStmt = db.prepare('UPDATE users SET xp = ?, level = ?, xp_total = ? WHERE id = ?');
const boostStmt = db.prepare(
  'UPDATE users SET xp_boost_ms = ?, gxp_boost_ms = ?, starss_boost_ms = ? WHERE id = ?',
);
const catmStmt = db.prepare('UPDATE users SET catm_day = ?, catm_count = ? WHERE id = ?');

function B(s) {
  try {
    return BigInt(s || '0');
  } catch {
    return 0n;
  }
}

function getOrCreate(userId, username) {
  upsertStmt.run(userId, username || 'unknown');
  return getStmt.get(userId);
}

function getStars(userId) {
  const u = getStmt.get(userId);
  return u ? B(u.stars) : 0n;
}

function setStars(userId, amount) {
  const v = typeof amount === 'bigint' ? amount : B(amount);
  starsStmt.run(v.toString(), userId);
}

function addStars(userId, delta) {
  const n = getStars(userId) + (typeof delta === 'bigint' ? delta : B(delta));
  setStars(userId, n);
  return n;
}

function getPoints(userId) {
  const u = getStmt.get(userId);
  return u ? B(u.points) : 0n;
}

function setPoints(userId, amount) {
  const v = typeof amount === 'bigint' ? amount : B(amount);
  pointsStmt.run(v.toString(), userId);
}

function addPoints(userId, delta) {
  const n = getPoints(userId) + (typeof delta === 'bigint' ? delta : B(delta));
  setPoints(userId, n);
  db.prepare('UPDATE users SET rp_last_activity_ms = ? WHERE id = ?').run(Date.now(), userId);
  return n;
}

function applyStarssMultiplier(userId, base) {
  const u = getStmt.get(userId);
  if (!u) return base;
  if (Date.now() < (u.starss_boost_ms || 0)) return base * 2n;
  return base;
}

const { totalToLevelState } = require('../reborn/xpCurve');

function addXp(userId, delta) {
  const u = getOrCreate(userId, '');
  let d = Math.floor(Number(delta) || 0);
  if (d <= 0) {
    const t = u.xp_total ?? 0;
    const st = totalToLevelState(t);
    return { xp: st.xpInto, level: st.level, xpTotal: t };
  }
  const mult = Date.now() < (u.xp_boost_ms || 0) ? 2 : 1;
  d *= mult;
  const oldTotal = u.xp_total ?? 0;
  const oldLevel = totalToLevelState(oldTotal).level;
  const newTotal = oldTotal + d;
  const st = totalToLevelState(newTotal);
  xpStmt.run(st.xpInto, st.level, newTotal, userId);
  if (st.level > oldLevel) {
    try {
      require('./skillTree').onLevelUp(userId, st.level - oldLevel);
    } catch {
      /* ignore */
    }
  }
  return { xp: st.xpInto, level: st.level, xpTotal: newTotal };
}

function getEventCurrency(userId) {
  const u = getStmt.get(userId);
  return u ? B(u.event_currency) : 0n;
}

function setEventCurrency(userId, amount) {
  const v = typeof amount === 'bigint' ? amount : B(amount);
  db.prepare('UPDATE users SET event_currency = ? WHERE id = ?').run(v.toString(), userId);
}

function addEventCurrency(userId, delta) {
  const n = getEventCurrency(userId) + (typeof delta === 'bigint' ? delta : B(delta));
  setEventCurrency(userId, n);
  return n;
}

function setBoostField(userId, field, untilMs) {
  getOrCreate(userId, '');
  const row = getStmt.get(userId);
  const xp = field === 'xp_boost_ms' ? untilMs : row.xp_boost_ms || 0;
  const gxp = field === 'gxp_boost_ms' ? untilMs : row.gxp_boost_ms || 0;
  const st = field === 'starss_boost_ms' ? untilMs : row.starss_boost_ms || 0;
  boostStmt.run(xp, gxp, st, userId);
}

function addInventory(userId, itemId, qty = 1) {
  db.prepare(
    `INSERT INTO inventory (user_id, item_id, qty) VALUES (?, ?, ?)
     ON CONFLICT(user_id, item_id) DO UPDATE SET qty = qty + excluded.qty`,
  ).run(userId, itemId, qty);
}

function getInventory(userId) {
  return db.prepare('SELECT item_id, qty FROM inventory WHERE user_id = ? ORDER BY item_id').all(userId);
}

function takeInventory(userId, itemId, qty = 1) {
  const row = db.prepare('SELECT qty FROM inventory WHERE user_id = ? AND item_id = ?').get(userId, itemId);
  if (!row || row.qty < qty) return false;
  const n = row.qty - qty;
  if (n <= 0) db.prepare('DELETE FROM inventory WHERE user_id = ? AND item_id = ?').run(userId, itemId);
  else db.prepare('UPDATE inventory SET qty = ? WHERE user_id = ? AND item_id = ?').run(n, userId, itemId);
  return true;
}

function getCatmState(userId) {
  const u = getStmt.get(userId);
  return { day: u?.catm_day || '', count: u?.catm_count || 0 };
}

function bumpCatm(userId, dayKey) {
  const u = getStmt.get(userId);
  if (!u) return 0;
  let count = u.catm_count || 0;
  let day = u.catm_day || '';
  if (day !== dayKey) {
    day = dayKey;
    count = 0;
  }
  count += 1;
  catmStmt.run(day, count, userId);
  return count;
}

function resetCatmIfNewDay(userId, dayKey) {
  const u = getStmt.get(userId);
  if (!u) return;
  if (u.catm_day !== dayKey) catmStmt.run(dayKey, 0, userId);
}

function setDailyLastMs(userId, t) {
  db.prepare('UPDATE users SET daily_last_ms = ? WHERE id = ?').run(t, userId);
}

function getUser(userId) {
  return getStmt.get(userId);
}

function setModTestsScore(userId, score) {
  getOrCreate(userId, '');
  const n = Math.max(0, Math.min(100, Number(score) || 0));
  db.prepare('UPDATE users SET mod_tests_score = ? WHERE id = ?').run(n, userId);
}

function setCandidatureStatus(userId, status) {
  getOrCreate(userId, '');
  const s = String(status || 'aucune').slice(0, 80);
  db.prepare('UPDATE users SET candidature_status = ? WHERE id = ?').run(s, userId);
}

module.exports = {
  getUser,
  getOrCreate,
  getStars,
  setStars,
  addStars,
  getPoints,
  setPoints,
  addPoints,
  applyStarssMultiplier,
  addXp,
  getEventCurrency,
  setEventCurrency,
  addEventCurrency,
  setBoostField,
  addInventory,
  getInventory,
  takeInventory,
  getCatmState,
  bumpCatm,
  resetCatmIfNewDay,
  setDailyLastMs,
  setModTestsScore,
  setCandidatureStatus,
  B,
};
