const db = require('../db');
const shop = require('./shop');
const users = require('./users');

const DAILY_MSG_TARGET = 5;
const DAILY_REWARD = 25_000n;
const WEEKLY_MSG_TARGET = 50;
const WEEKLY_REWARD = 150_000n;

function weekBucketMs() {
  return Math.floor(Date.now() / (7 * 24 * 60 * 60 * 1000));
}

function getState(userId) {
  let r = db.prepare('SELECT * FROM user_quest_state WHERE user_id = ?').get(userId);
  if (!r) {
    db.prepare(
      `INSERT INTO user_quest_state (user_id) VALUES (?)`,
    ).run(userId);
    r = db.prepare('SELECT * FROM user_quest_state WHERE user_id = ?').get(userId);
  }
  return r;
}

function syncDayWeek(row) {
  const day = shop.utcDateKey();
  const wk = String(weekBucketMs());
  let patch = {};
  if (row.day_key !== day) {
    patch = {
      ...patch,
      day_key: day,
      msgs_today: 0,
      daily_claimed: 0,
    };
  }
  if (row.week_key !== wk) {
    patch = {
      ...patch,
      week_key: wk,
      week_points: 0,
      weekly_claimed: 0,
    };
  }
  if (Object.keys(patch).length) {
    const keys = Object.keys(patch);
    const sets = keys.map((k) => `${k} = ?`).join(', ');
    db.prepare(`UPDATE user_quest_state SET ${sets} WHERE user_id = ?`).run(...keys.map((k) => patch[k]), row.user_id);
    return { ...row, ...patch };
  }
  return row;
}

/** Compteur messages + progression (appelé depuis earn). */
function onMessage(userId) {
  users.getOrCreate(userId, '');
  let row = getState(userId);
  row = syncDayWeek(row);
  const msgs = (row.msgs_today || 0) + 1;
  const wp = (row.week_points || 0) + 1;
  db.prepare('UPDATE user_quest_state SET msgs_today = ?, week_points = ? WHERE user_id = ?').run(msgs, wp, userId);
  return { msgs_today: msgs, week_points: wp, day_key: row.day_key };
}

function claimDaily(userId) {
  users.getOrCreate(userId, '');
  let row = syncDayWeek(getState(userId));
  if (row.daily_claimed) return { ok: false, error: 'Déjà réclamé aujourd’hui.' };
  if ((row.msgs_today || 0) < DAILY_MSG_TARGET) {
    return { ok: false, error: `Encore **${DAILY_MSG_TARGET - (row.msgs_today || 0)}** message(s) sur ce serveur aujourd’hui.` };
  }
  db.prepare('UPDATE user_quest_state SET daily_claimed = 1 WHERE user_id = ?').run(userId);
  users.addStars(userId, DAILY_REWARD);
  return { ok: true, reward: DAILY_REWARD };
}

function claimWeekly(userId) {
  users.getOrCreate(userId, '');
  let row = syncDayWeek(getState(userId));
  if (row.weekly_claimed) return { ok: false, error: 'Récompense hebdo déjà prise.' };
  if ((row.week_points || 0) < WEEKLY_MSG_TARGET) {
    return { ok: false, error: `**${WEEKLY_MSG_TARGET - (row.week_points || 0)}** points manquants (1 pt = 1 message cette semaine).` };
  }
  db.prepare('UPDATE user_quest_state SET weekly_claimed = 1 WHERE user_id = ?').run(userId);
  users.addStars(userId, WEEKLY_REWARD);
  return { ok: true, reward: WEEKLY_REWARD };
}

function summary(userId) {
  users.getOrCreate(userId, '');
  const row = syncDayWeek(getState(userId));
  return {
    msgs_today: row.msgs_today || 0,
    daily_target: DAILY_MSG_TARGET,
    daily_claimed: !!row.daily_claimed,
    daily_reward: DAILY_REWARD,
    week_points: row.week_points || 0,
    weekly_target: WEEKLY_MSG_TARGET,
    weekly_claimed: !!row.weekly_claimed,
    weekly_reward: WEEKLY_REWARD,
  };
}

module.exports = {
  onMessage,
  claimDaily,
  claimWeekly,
  summary,
  DAILY_MSG_TARGET,
  WEEKLY_MSG_TARGET,
};
