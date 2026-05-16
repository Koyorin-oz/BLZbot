/**
 * Série de jours (streak) — même logique que le bot `niveau` (message du jour).
 */
const schedule = require('node-schedule');
const db = require('../db');
const users = require('./users');
const catalog = require('../reborn/catalog');

function calculateStreakReward(streak) {
  if (streak < 10) return { stars: 0n, itemId: null };
  if (streak < 20) return { stars: 5000n, itemId: null };
  if (streak < 30) return { stars: 10000n, itemId: null };
  if (streak < 40) return { stars: 20000n, itemId: null };
  if (streak < 50) return { stars: 30000n, itemId: null };
  if (streak < 60) return { stars: 40000n, itemId: null };
  if (streak < 70) return { stars: 50000n, itemId: null };
  if (streak < 80) return { stars: 60000n, itemId: null };
  if (streak < 90) return { stars: 80000n, itemId: null };
  if (streak < 100) return { stars: 100000n, itemId: null };
  return { stars: 0n, itemId: 'coffre_classique' };
}

function todayStartMs() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
}

/**
 * @param {import('discord.js').Client} client
 * @param {string} userId
 */
function updateStreak(client, userId) {
  users.getOrCreate(userId, '');
  const u = users.getUser(userId);
  if (!u) return { streakUpdated: false, newStreak: 0 };

  const todayTs = todayStartMs();
  const lastTs = u.last_streak_timestamp || 0;
  let newStreak = u.streak || 0;
  let streakUpdated = false;

  if (lastTs >= todayTs) {
    return { streakUpdated: false, newStreak };
  }

  const yesterdayTs = todayTs - 24 * 60 * 60 * 1000;

  if (lastTs === yesterdayTs) {
    newStreak += 1;
    streakUpdated = true;
  } else if (lastTs > 0 && lastTs < yesterdayTs) {
    db.prepare(
      'UPDATE users SET streak_lost_timestamp = ?, previous_streak = ?, streak = 1, last_streak_timestamp = ? WHERE id = ?',
    ).run(Date.now(), u.streak || 0, todayTs, userId);
    newStreak = 1;
    streakUpdated = true;
  } else if (lastTs === 0) {
    newStreak = 1;
    streakUpdated = true;
  }

  if (streakUpdated && lastTs !== yesterdayTs && !(lastTs > 0 && lastTs < yesterdayTs)) {
    db.prepare('UPDATE users SET streak = ?, last_streak_timestamp = ? WHERE id = ?').run(newStreak, todayTs, userId);
  }

  if (!streakUpdated) {
    return { streakUpdated: false, newStreak };
  }

  const reward = calculateStreakReward(newStreak);
  const indexBonuses = require('./indexBonuses');
  if (reward.stars > 0n) {
    users.addStars(userId, indexBonuses.applyStars(userId, reward.stars));
  }
  if (reward.itemId && catalog.getItem(reward.itemId)) {
    users.addInventory(userId, reward.itemId, 1);
  }

  if (client) sendStreakAnnouncement(client, userId, newStreak, reward).catch(() => {});
  return { streakUpdated: true, newStreak };
}

async function sendStreakAnnouncement(client, userId, newStreak, reward) {
  const channelId = (
    process.env.REBORN_STREAK_CHANNEL_ID ||
    process.env.STREAK_CHANNEL_ID ||
    ''
  ).trim();
  if (!channelId) return;
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel || !channel.isTextBased()) return;

  let message = `Bravo <@${userId}> — **${newStreak}** jour${newStreak > 1 ? 's' : ''} de streak !`;
  if (reward.stars > 0n) {
    message += `\nRécompense : **+${reward.stars.toLocaleString('fr-FR')}** ★`;
  } else if (reward.itemId) {
    const def = catalog.getItem(reward.itemId);
    message += `\nRécompense : **${def?.name || reward.itemId}**`;
  }
  await channel.send({ content: message.slice(0, 1900) });
}

function scheduleStreakReset() {
  const rule = new schedule.RecurrenceRule();
  rule.hour = 0;
  rule.minute = 0;
  rule.tz = 'Europe/Paris';

  schedule.scheduleJob(rule, () => {
    try {
      const yesterdayTs = todayStartMs() - 24 * 60 * 60 * 1000;
      const result = db
        .prepare('UPDATE users SET streak = 0 WHERE last_streak_timestamp < ? AND streak > 0')
        .run(yesterdayTs);
      if (result.changes > 0) {
        console.log(`[streak] Reset minuit : ${result.changes} joueur(s).`);
      }
    } catch (e) {
      console.error('[streak reset]', e?.message || e);
    }
  });
  console.log('[streak] Reset quotidien 00:00 Europe/Paris actif.');
}

/** Streak Keeper : restaure la streak perdue si < 48 h (bot principal). */
function restoreLostStreak(userId) {
  const u = users.getUser(userId);
  if (!u?.streak_lost_timestamp) {
    return { ok: false, error: 'Aucune streak perdue à restaurer.' };
  }
  if (Date.now() - u.streak_lost_timestamp > 48 * 60 * 60 * 1000) {
    return { ok: false, error: 'Trop tard : plus de **48 h** depuis la perte de streak.' };
  }
  const prev = Math.max(1, u.previous_streak || 1);
  db.prepare(
    'UPDATE users SET streak = ?, last_streak_timestamp = ?, streak_lost_timestamp = 0, previous_streak = 0 WHERE id = ?',
  ).run(prev, todayStartMs(), userId);
  return { ok: true, streak: prev };
}

module.exports = {
  updateStreak,
  calculateStreakReward,
  scheduleStreakReset,
  restoreLostStreak,
};
