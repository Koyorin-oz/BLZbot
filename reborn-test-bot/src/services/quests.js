const db = require('../db');
const shop = require('./shop');
const users = require('./users');
const skillTree = require('./skillTree');

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
  defi_400k: {
    label: 'Défi 400k : accumuler 400 000 starss cette semaine',
    kind: 'starss_gain',
    target: 400_000n,
    reward: 100_000n,
  },
  defi_catl: {
    label: 'Défi CATL : ouvrir 1× Coffre Au Trésor Légendaire',
    kind: 'catl_open',
    target: 1,
    reward: 250_000n,
  },
};

/**
 * Ladder « ligne définitive » 10→1000 messages cumulés.
 * Chaque palier débloque une récompense one-shot (claimée auto par /quetes).
 */
const LIFETIME_LADDER = [
  { id: 'life_10', target: 10, reward: 5_000n, label: 'Ligne — 10 messages' },
  { id: 'life_50', target: 50, reward: 25_000n, label: 'Ligne — 50 messages' },
  { id: 'life_100', target: 100, reward: 75_000n, label: 'Ligne — 100 messages' },
  { id: 'life_250', target: 250, reward: 200_000n, label: 'Ligne — 250 messages' },
  { id: 'life_500', target: 500, reward: 500_000n, label: 'Ligne — 500 messages' },
  { id: 'life_1000', target: 1000, reward: 1_500_000n, label: 'Ligne — 1 000 messages' },
];

function isMilestoneClaimed(userId, key) {
  return !!db.prepare('SELECT 1 FROM quest_milestones WHERE user_id = ? AND milestone_key = ?').get(userId, key);
}

function claimMilestone(userId, key) {
  if (isMilestoneClaimed(userId, key)) return false;
  db.prepare('INSERT INTO quest_milestones (user_id, milestone_key, claimed_ms) VALUES (?, ?, ?)').run(
    userId,
    key,
    Date.now(),
  );
  return true;
}

/** Notifie un déblocage de quête (CATL / starss / défi). */
function trackCatlOpen(userId) {
  let row = syncDayWeek(getState(userId));
  const sid = row.selection_id;
  if (sid !== 'defi_catl') return null;
  if (row.selection_claimed) return null;
  const next = (row.selection_progress || 0) + 1;
  db.prepare('UPDATE user_quest_state SET selection_progress = ? WHERE user_id = ?').run(next, userId);
  if (next >= SELECTIONS.defi_catl.target) {
    db.prepare('UPDATE user_quest_state SET selection_claimed = 1 WHERE user_id = ?').run(userId);
    const reward = SELECTIONS.defi_catl.reward * skillTree.questRewardMult(userId);
    users.addStars(userId, reward);
    return { reward, label: SELECTIONS.defi_catl.label };
  }
  return null;
}

function trackStarssGain(userId, amount) {
  let row = syncDayWeek(getState(userId));
  const sid = row.selection_id;
  if (sid !== 'defi_400k') return null;
  if (row.selection_claimed) return null;
  const cur = BigInt(row.selection_progress || 0);
  const next = cur + (amount > 0n ? amount : 0n);
  const clipped = next > Number.MAX_SAFE_INTEGER ? Number.MAX_SAFE_INTEGER : Number(next);
  db.prepare('UPDATE user_quest_state SET selection_progress = ? WHERE user_id = ?').run(clipped, userId);
  if (next >= SELECTIONS.defi_400k.target) {
    db.prepare('UPDATE user_quest_state SET selection_claimed = 1 WHERE user_id = ?').run(userId);
    const reward = SELECTIONS.defi_400k.reward * skillTree.questRewardMult(userId);
    users.addStars(userId, reward);
    return { reward, label: SELECTIONS.defi_400k.label };
  }
  return null;
}

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
      weekly_skips_used: 0,
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

/** Compteur messages + progression + auto-claim si seuil atteint. */
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

  let selProgress = row.selection_progress || 0;
  const sid = row.selection_id || '';
  const def = sid ? SELECTIONS[sid] : null;
  if (sid && !row.selection_claimed && def?.kind === 'msgs') {
    selProgress += 1;
    db.prepare('UPDATE user_quest_state SET selection_progress = ? WHERE user_id = ?').run(selProgress, userId);
  }

  const unlocked = { daily: null, weekly: null, selection: null };
  const mult = skillTree.questRewardMult(userId);

  if (!row.daily_claimed && msgs >= DAILY_MSG_TARGET) {
    db.prepare('UPDATE user_quest_state SET daily_claimed = 1 WHERE user_id = ?').run(userId);
    const reward = DAILY_REWARD * mult;
    users.addStars(userId, reward);
    unlocked.daily = { reward, label: 'Quête quotidienne' };
  }
  if (!row.weekly_claimed && wp >= WEEKLY_MSG_TARGET) {
    db.prepare('UPDATE user_quest_state SET weekly_claimed = 1 WHERE user_id = ?').run(userId);
    const reward = WEEKLY_REWARD * mult;
    users.addStars(userId, reward);
    unlocked.weekly = { reward, label: 'Quête hebdomadaire' };
  }
  if (def?.kind === 'msgs' && !row.selection_claimed && selProgress >= def.target) {
    db.prepare('UPDATE user_quest_state SET selection_claimed = 1 WHERE user_id = ?').run(userId);
    const reward = def.reward * mult;
    users.addStars(userId, reward);
    unlocked.selection = { reward, label: def.label };
  }

  return {
    msgs_today: msgs,
    week_points: wp,
    day_key: row.day_key,
    lifetime_msgs: life,
    unlocked,
  };
}

function claimDaily(userId) {
  users.getOrCreate(userId, '');
  let row = syncDayWeek(getState(userId));
  if (row.daily_claimed) return { ok: false, error: 'Déjà réclamé aujourd’hui.' };
  if ((row.msgs_today || 0) < DAILY_MSG_TARGET) {
    return { ok: false, error: `Encore **${DAILY_MSG_TARGET - (row.msgs_today || 0)}** message(s) sur ce serveur aujourd’hui.` };
  }
  db.prepare('UPDATE user_quest_state SET daily_claimed = 1 WHERE user_id = ?').run(userId);
  const reward = DAILY_REWARD * skillTree.questRewardMult(userId);
  users.addStars(userId, reward);
  return { ok: true, reward };
}

function claimWeekly(userId) {
  users.getOrCreate(userId, '');
  let row = syncDayWeek(getState(userId));
  if (row.weekly_claimed) return { ok: false, error: 'Récompense hebdo déjà prise.' };
  if ((row.week_points || 0) < WEEKLY_MSG_TARGET) {
    return { ok: false, error: `**${WEEKLY_MSG_TARGET - (row.week_points || 0)}** points manquants (1 pt = 1 message cette semaine).` };
  }
  db.prepare('UPDATE user_quest_state SET weekly_claimed = 1 WHERE user_id = ?').run(userId);
  const reward = WEEKLY_REWARD * skillTree.questRewardMult(userId);
  users.addStars(userId, reward);
  return { ok: true, reward };
}

/** Consomme un skip et débloque la récompense daily (ou hebdo) sans devoir compléter la cible. */
function skipDaily(userId) {
  users.getOrCreate(userId, '');
  let row = syncDayWeek(getState(userId));
  if (row.daily_claimed) return { ok: false, error: 'Quête daily déjà validée.' };
  const total = skillTree.questSkipsPerWeek(userId);
  const used = row.weekly_skips_used || 0;
  if (used >= total) {
    return { ok: false, error: `Aucun skip disponible cette semaine (**${used}/${total}** utilisés).` };
  }
  db.prepare('UPDATE user_quest_state SET weekly_skips_used = ?, daily_claimed = 1 WHERE user_id = ?').run(used + 1, userId);
  const reward = DAILY_REWARD * skillTree.questRewardMult(userId);
  users.addStars(userId, reward);
  return { ok: true, reward, skipsLeft: total - (used + 1) };
}

function skipWeekly(userId) {
  users.getOrCreate(userId, '');
  let row = syncDayWeek(getState(userId));
  if (row.weekly_claimed) return { ok: false, error: 'Quête hebdo déjà validée.' };
  const total = skillTree.questSkipsPerWeek(userId);
  const used = row.weekly_skips_used || 0;
  if (used >= total) {
    return { ok: false, error: `Aucun skip disponible cette semaine (**${used}/${total}** utilisés).` };
  }
  db.prepare('UPDATE user_quest_state SET weekly_skips_used = ?, weekly_claimed = 1 WHERE user_id = ?').run(used + 1, userId);
  const reward = WEEKLY_REWARD * skillTree.questRewardMult(userId);
  users.addStars(userId, reward);
  return { ok: true, reward, skipsLeft: total - (used + 1) };
}

function pickSelection(userId, selectionKey) {
  users.getOrCreate(userId, '');
  let row = syncDayWeek(getState(userId));
  if (!SELECTIONS[selectionKey]) return { ok: false, error: 'Choix inconnu.' };
  if (row.selection_claimed) return { ok: false, error: 'Tu as déjà terminé ta quête à choix cette semaine.' };
  if (row.selection_id === selectionKey && !row.selection_claimed) {
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
  if (!sid) return { ok: false, error: 'Choisis d’abord une quête à choix dans `/quetes`.' };
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
  const reward = def.reward * skillTree.questRewardMult(userId);
  users.addStars(userId, reward);
  return { ok: true, reward, label: def.label };
}

function summary(userId) {
  users.getOrCreate(userId, '');
  const row = syncDayWeek(getState(userId));
  const sid = row.selection_id || '';
  const def = sid ? SELECTIONS[sid] : null;
  let selLine = 'Aucune quête à choix sélectionnée — choisis-en une dans le menu ci-dessous.';
  if (def) {
    if (row.selection_claimed) selLine = `**${def.label}** — terminée cette semaine.`;
    else if (def.kind === 'msgs') {
      selLine = `**${def.label}** — **${row.selection_progress || 0}** / **${def.target}** *(auto)*`;
    } else {
      selLine = `**${def.label}** — utilise le bouton « Réclamer » dès que tu as l’item.`;
    }
  }
  const mult = skillTree.questRewardMult(userId);
  const skipsTotal = skillTree.questSkipsPerWeek(userId);
  const skipsUsed = row.weekly_skips_used || 0;
  return {
    msgs_today: row.msgs_today || 0,
    lifetime_msgs: row.lifetime_msgs ?? 0,
    daily_target: DAILY_MSG_TARGET,
    daily_claimed: !!row.daily_claimed,
    daily_reward: DAILY_REWARD * mult,
    week_points: row.week_points || 0,
    weekly_target: WEEKLY_MSG_TARGET,
    weekly_claimed: !!row.weekly_claimed,
    weekly_reward: WEEKLY_REWARD * mult,
    selection_line: selLine,
    selection_id: sid,
    reward_mult: Number(mult),
    skips_total: skipsTotal,
    skips_used: skipsUsed,
    skips_left: Math.max(0, skipsTotal - skipsUsed),
    selection_slots: skillTree.questSelectionSlots(userId),
  };
}

module.exports = {
  onMessage,
  claimDaily,
  claimWeekly,
  skipDaily,
  skipWeekly,
  pickSelection,
  claimSelection,
  summary,
  SELECTIONS,
  DAILY_MSG_TARGET,
  WEEKLY_MSG_TARGET,
};
