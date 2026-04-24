const users = require('./users');
const gm = require('./guildMember');
const C = require('../reborn/constants');
const grpSeason = require('./grpSeason');
const playerGuilds = require('./playerGuilds');

/** @type {Map<string, { guildId: string, since: number }>} */
const voiceSince = new Map();

function gxpMultForUser(userId) {
  const u = users.getUser(userId);
  if (!u) return 1n;
  return Date.now() < (u.gxp_boost_ms || 0) ? 2n : 1n;
}

function grpMultForUser(hubId, userId) {
  const raw = require('./meta').get(`grp_half:${hubId}:${userId}`);
  if (!raw) return 1n;
  if (Date.now() < Number(raw)) return 1n; // placeholder: could be /2
  return 1n;
}

function grantVoiceMinutes(guildId, userId, minutes) {
  if (minutes <= 0n) return;
  users.getOrCreate(userId, '');
  const row = users.getUser(userId);
  const baseStars = BigInt(C.STARSS_PER_VOICE_MINUTE) * minutes;
  const stars = users.applyStarssMultiplier(userId, baseStars);
  users.addStars(userId, stars);
  const gr = C.gxpRatesForPlayerLevel(row?.level || 1);
  const mult = gxpMultForUser(userId);
  gm.addGxp(guildId, userId, gr.vocMin * minutes * mult);
  const gmult = grpMultForUser(guildId, userId);
  gm.addGrp(guildId, userId, C.grpRatesForMessage().vocMin * minutes * gmult);
  grpSeason.maybeResetMonthlyGrp(guildId);
  const after = gm.getMemberRow(guildId, userId);
  grpSeason.recordGrpPeaksIfNeeded(guildId, userId, after.grp);
  playerGuilds.addGxpFromMemberActivity(guildId, userId, gr.vocMin * minutes * mult);
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
      users.addXp(uid, 1);
      const u = users.getUser(uid);
      const gr = C.gxpRatesForPlayerLevel(u?.level || 1);
      const mult = gxpMultForUser(uid);
      if (gr.msg > 0n) {
        gm.addGxp(hub, uid, gr.msg * mult);
      }
      grpSeason.maybeResetMonthlyGrp(hub);
      const gmult = grpMultForUser(hub, uid);
      gm.addGrp(hub, uid, C.grpRatesForMessage().msg * gmult);
      const after = gm.getMemberRow(hub, uid);
      grpSeason.recordGrpPeaksIfNeeded(hub, uid, after.grp);
      playerGuilds.addGxpFromMemberActivity(hub, uid, gr.msg * mult);
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
