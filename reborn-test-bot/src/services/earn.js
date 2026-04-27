const db = require('../db');
const users = require('./users');
const gm = require('./guildMember');
const C = require('../reborn/constants');
const grpSeason = require('./grpSeason');
const playerGuilds = require('./playerGuilds');
const quests = require('./quests');
const trophies = require('./trophies');
const rankedRp = require('./rankedRp');
const skillTree = require('./skillTree');
const meta = require('./meta');

/** @type {Map<string, { guildId: string, since: number }>} */
const voiceSince = new Map();

function gxpMultForUser(userId) {
  const u = users.getUser(userId);
  if (!u) return 1n;
  return Date.now() < (u.gxp_boost_ms || 0) ? 2n : 1n;
}

function grpFocusMultForUser(hubDiscordId, userId) {
  const m = playerGuilds.getMembershipInHub(userId, hubDiscordId);
  if (!m) return 100n;
  const until = parseInt(meta.get(`grp_half_${m.guild_id}`) || '0', 10) || 0;
  return Date.now() < until ? 50n : 100n;
}

/**
 * Multiplicateur GRP « camp loyal pendant séparation » (bp/10000).
 * Si une séparation est active et que l'utilisateur appartient au camp loyal
 * (= NON inscrit dans `camp_split`), il bénéficie du bonus de palier 5 du chef.
 */
function loyalCampGrpMultBp(hubDiscordId, userId) {
  const m = playerGuilds.getMembershipInHub(userId, hubDiscordId);
  if (!m) return 10000;
  const sep = db
    .prepare("SELECT camp_split FROM separations WHERE guild_id = ? AND cancelled = 0 AND winner = '' AND phase > 0")
    .get(m.guild_id);
  if (!sep) return 10000;
  let camp = [];
  try { camp = JSON.parse(sep.camp_split || '[]'); } catch { /* ignore */ }
  if (camp.includes(userId)) return 10000;
  const g = playerGuilds.getGuild(m.guild_id);
  if (!g) return 10000;
  return skillTree.loyalGrpBonusBp(g.leader_id);
}

function grantVoiceMinutes(guildId, userId, minutes) {
  if (minutes <= 0n) return;
  users.getOrCreate(userId, '');
  const row = users.getUser(userId);
  const baseStars = BigInt(C.STARSS_PER_VOICE_MINUTE) * minutes;
  const stars = users.applyStarssMultiplier(userId, baseStars);
  users.addStars(userId, stars);
  users.addXp(userId, Number(minutes) * C.XP_PER_VOICE_MINUTE);
  rankedRp.decayForUserIfIdle(userId);
  rankedRp.grantFromActivity(userId, 'voc', minutes);
  const gr = C.gxpRatesForPlayerLevel(row?.level || 1);
  const mult = gxpMultForUser(userId);
  const gxpBp = skillTree.guildGxpMultBp(userId);
  const gxpGain = (gr.vocMin * minutes * mult * BigInt(gxpBp)) / 10000n;
  gm.addGxp(guildId, userId, gxpGain);
  const baseGrp = C.grpRatesForMessage().vocMin * minutes;
  const grpBp = skillTree.guildGrpMultBp(userId);
  const focus = grpFocusMultForUser(guildId, userId);
  const loyalBp = loyalCampGrpMultBp(guildId, userId);
  gm.addGrp(
    guildId,
    userId,
    (baseGrp * BigInt(grpBp) * focus * BigInt(loyalBp)) / 10_000_000_000n,
  );
  grpSeason.maybeResetMonthlyGrp(guildId);
  const after = gm.getMemberRow(guildId, userId);
  grpSeason.recordGrpPeaksIfNeeded(guildId, userId, after.grp);
  playerGuilds.addGxpFromMemberActivity(guildId, userId, gxpGain);
}

/**
 * @param {import('discord.js').Client} client
 */
function registerEarn(client) {
  client.on('messageCreate', async (msg) => {
    try {
      if (!msg.guild || msg.author.bot) return;
      const uid = msg.author.id;
      const hub = msg.guild.id;
      users.getOrCreate(uid, msg.author.username);
      const base = BigInt(C.STARSS_PER_MESSAGE);
      const gain = users.applyStarssMultiplier(uid, base);
      users.addStars(uid, gain);
      users.addXp(uid, C.XP_PER_MESSAGE);
      rankedRp.decayForUserIfIdle(uid);
      rankedRp.grantFromActivity(uid, 'msg');
      const u = users.getUser(uid);
      const gr = C.gxpRatesForPlayerLevel(u?.level || 1);
      const mult = gxpMultForUser(uid);
      const gxpBp = skillTree.guildGxpMultBp(uid);
      const gxpGain = (gr.msg * mult * BigInt(gxpBp)) / 10000n;
      if (gxpGain > 0n) {
        gm.addGxp(hub, uid, gxpGain);
      }
      grpSeason.maybeResetMonthlyGrp(hub);
      const baseGrp = C.grpRatesForMessage().msg;
      const grpBp = skillTree.guildGrpMultBp(uid);
      const focus = grpFocusMultForUser(hub, uid);
      gm.addGrp(hub, uid, (baseGrp * BigInt(grpBp) * focus) / 1_000_000n);
      const after = gm.getMemberRow(hub, uid);
      grpSeason.recordGrpPeaksIfNeeded(hub, uid, after.grp);
      playerGuilds.addGxpFromMemberActivity(hub, uid, gxpGain);
      quests.onMessage(uid);
      trophies.evaluate(uid, hub);
    } catch (e) {
      console.error('[earn message]', e);
    }
  });

  client.on('voiceStateUpdate', (oldS, newS) => {
    try {
      const uid = newS.id;
      const guildId = newS.guild?.id || oldS.guild?.id;
      if (!guildId) return;

      if (!oldS.channelId && newS.channelId) {
        voiceSince.set(uid, { guildId, since: Date.now() });
        return;
      }

      if (oldS.channelId && newS.channelId && oldS.channelId !== newS.channelId) {
        const rec = voiceSince.get(uid);
        if (rec) {
          const ms = Date.now() - rec.since;
          const minutes = BigInt(Math.max(0, Math.floor(ms / 60000)));
          grantVoiceMinutes(rec.guildId, uid, minutes);
        }
        voiceSince.set(uid, { guildId, since: Date.now() });
        return;
      }

      if (oldS.channelId && !newS.channelId) {
        const rec = voiceSince.get(uid);
        voiceSince.delete(uid);
        if (!rec) return;
        const ms = Date.now() - rec.since;
        const minutes = BigInt(Math.max(0, Math.floor(ms / 60000)));
        grantVoiceMinutes(rec.guildId, uid, minutes);
      }
    } catch (e) {
      console.error('[earn voice]', e);
    }
  });
}

module.exports = { registerEarn, grantVoiceMinutes };
