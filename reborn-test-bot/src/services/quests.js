const db = require('../db');
const shop = require('./shop');
const users = require('./users');

const DAILY_MSG_TARGET = 5;
const DAILY_REWARD = 25_000n;
const WEEKLY_MSG_TARGET = 50;
const WEEKLY_REWARD = 150_000n;

/** Quête « choix » hebdomadaire (une par semaine). */
const SELECTIONS = {
  chasse_messages: {
    label: 'Chasse : 20 messages cette semaine',
    kind: 'msgs',
    target: 20,
    reward: 40_000n,
  },
  offre_corail: {
    label: 'Offrir 1× corail à la cagnotte (retiré à la réclamation)',
    kind: 'item',
    itemId: 'corail',
    qty: 1,
    reward: 80_000n,
  },
};

function weekBucketMs() {
  return Math.floor(Date.now() / (7 * 24 * 60 * 60 * 1000));
}

function getState(userId) {
  let r = db.prepare('SELECT * FROM user_quest_state WHERE user_id = ?').get(userId);
  if (!r) {
    db.prepare(`INSERT INTO user_quest_state (user_id) VALUES (?)`).run(userId);
    r = db.prepare('SELECT * FROM user_quest_state WHERE user_id = ?').get(userId);
  }
  return r;
}

function syncDayWeek(row) {
  const day = shop.utcDateKey();
  const wk = String(weekBucketMs());
  let patch = {};
  if (row.day_key !== day) {
    patch = { ...patch, day_key: day, msgs_today: 0, daily_claimed: 0 };
  }
  if (row.week_key !== wk) {
    patch = {
      ...patch,
      week_key: wk,
      week_points: 0,
      weekly_claimed: 0,
      selection_id: '',
      selection_progress: 0,
      selection_claimed: 0,
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

function bumpSelectionProgress(userId, row) {
  const sid = row.selection_id || '';
  if (!sid || row.selection_claimed) return;
  const def = SELECTIONS[sid];
  if (!def || def.kind !== 'msgs') return;
  const p = (row.selection_progress || 0) + 1;
  db.prepare('UPDATE user_quest_state SET selection_progress = ? WHERE user_id = ?').run(p, userId);
}

/** Compteur messages + progression (appelé depuis earn). */
function onMessage(userId) {
  users.getOrCreate(userId, '');
  let row = getState(userId);
  row = syncDayWeek(row);
  const msgs = (row.msgs_today || 0) + 1;
  const wp = (row.week_points || 0) + 1;
  const life = (row.lifetime_msgs ?? 0) + 1;
  db.prepare('UPDATE user_quest_state SET msgs_today = ?, week_points = ?, lifetime_msgs = ? WHERE user_id = ?').run(
    msgs,
    wp,
    life,
    userId,
  );
  row = { ...row, msgs_today: msgs, week_points: wp, lifetime_msgs: life };
  bumpSelectionProgress(userId, row);
  return { msgs_today: msgs, week_points: wp, day_key: row.day_key, lifetime_msgs: life };
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

function pickSelection(userId, selectionKey) {
  users.getOrCreate(userId, '');
  let row = syncDayWeek(getState(userId));
  if (!SELECTIONS[selectionKey]) return { ok: false, error: 'Choix inconnu.' };
  if (row.selection_claimed) return { ok: false, error: 'Tu as déjà terminé ta quête à choix cette semaine.' };
  if (row.selection_id && row.selection_id === selectionKey) {
    return { ok: false, error: 'Tu as déjà ce choix actif.' };
  }
  db.prepare(
    'UPDATE user_quest_state SET selection_id = ?, selection_progress = 0, selection_claimed = 0 WHERE user_id = ?',
  ).run(selectionKey, userId);
  return { ok: true, def: SELECTIONS[selectionKey] };
}

function claimSelection(userId) {
  users.getOrCreate(userId, '');
  let row = syncDayWeek(getState(userId));
  const sid = row.selection_id || '';
  if (!sid) return { ok: false, error: 'Choisis d’abord une quête avec `/quete choisir`.' };
  if (row.selection_claimed) return { ok: false, error: 'Déjà réclamée cette semaine.' };
  const def = SELECTIONS[sid];
  if (!def) return { ok: false, error: 'Quête invalide.' };
  if (def.kind === 'msgs') {
    if ((row.selection_progress || 0) < def.target) {
      return { ok: false, error: `Progression **${row.selection_progress || 0}** / **${def.target}** messages.` };
    }
  } else if (def.kind === 'item') {
    if (!users.takeInventory(userId, def.itemId, def.qty)) {
      return { ok: false, error: `Il te faut **${def.qty}×** item \`${def.itemId}\` en inventaire.` };
    }
  }
  db.prepare('UPDATE user_quest_state SET selection_claimed = 1 WHERE user_id = ?').run(userId);
  users.addStars(userId, def.reward);
  return { ok: true, reward: def.reward, label: def.label };
}

function summary(userId) {
  users.getOrCreate(userId, '');
  const row = syncDayWeek(getState(userId));
  const sid = row.selection_id || '';
  const def = sid ? SELECTIONS[sid] : null;
  let selLine = 'Aucune quête à choix (prends-en une avec `/quete choisir`).';
  if (def) {
    if (row.selection_claimed) selLine = `**${def.label}** — terminée cette semaine.`;
    else if (def.kind === 'msgs') {
      selLine = `**${def.label}** — **${row.selection_progress || 0}** / **${def.target}**`;
    } else {
      selLine = `**${def.label}** — prêt à réclamer si tu as l’item (voir \`/quete reclamer_selection\`).`;
    }
  }
  return {
    msgs_today: row.msgs_today || 0,
    lifetime_msgs: row.lifetime_msgs ?? 0,
    daily_target: DAILY_MSG_TARGET,
    daily_claimed: !!row.daily_claimed,
    daily_reward: DAILY_REWARD,
    week_points: row.week_points || 0,
    weekly_target: WEEKLY_MSG_TARGET,
    weekly_claimed: !!row.weekly_claimed,
    weekly_reward: WEEKLY_REWARD,
    selection_line: selLine,
    selection_id: sid,
  };
}

module.exports = {
  onMessage,
  claimDaily,
  claimWeekly,
  pickSelection,
  claimSelection,
  summary,
  SELECTIONS,
  DAILY_MSG_TARGET,
  WEEKLY_MSG_TARGET,
};
