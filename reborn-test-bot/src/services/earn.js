const users = require('./users');
const gm = require('./guildMember');
const C = require('../reborn/constants');

/** @type {Map<string, { guildId: string, since: number }>} */
const voiceSince = new Map();

function gxpMultForUser(userId) {
  const u = users.getUser(userId);
  if (!u) return 1n;
  return Date.now() < (u.gxp_boost_ms || 0) ? 2n : 1n;
}

function grantVoiceMinutes(guildId, userId, minutes) {
  if (minutes <= 0n) return;
  users.getOrCreate(userId, '');
  const u = users.getUser(userId);
  const uname = u?.username || 'voc';
  users.getOrCreate(userId, uname);
  const row = users.getUser(userId);
  const baseStars = BigInt(C.STARSS_PER_VOICE_MINUTE) * minutes;
  const stars = users.applyStarssMultiplier(userId, baseStars);
  users.addStars(userId, stars);
  const gr = C.gxpRatesForPlayerLevel(row.level);
  const mult = gxpMultForUser(userId);
  gm.addGxp(guildId, userId, gr.vocMin * minutes * mult);
  gm.addGrp(guildId, userId, C.grpRatesForMessage().vocMin * minutes);
}

/**
 * @param {import('discord.js').Client} client
 */
function registerEarn(client) {
  client.on('messageCreate', async (msg) => {
    try {
      if (!msg.guild || msg.author.bot) return;
      const uid = msg.author.id;
      users.getOrCreate(uid, msg.author.username);
      const base = BigInt(C.STARSS_PER_MESSAGE);
      const gain = users.applyStarssMultiplier(uid, base);
      users.addStars(uid, gain);
      users.addXp(uid, 1);
      const u = users.getUser(uid);
      const gr = C.gxpRatesForPlayerLevel(u?.level || 1);
      const mult = gxpMultForUser(uid);
      gm.addGxp(msg.guild.id, uid, gr.msg * mult);
      gm.addGrp(msg.guild.id, uid, C.grpRatesForMessage().msg);
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

      if (oldS.channelId && !newS.channelId) {
        const rec = voiceSince.get(uid);
        voiceSince.delete(uid);
        if (!rec) return;
        const ms = Date.now() - rec.since;
        const minutes = BigInt(Math.max(0, Math.floor(ms / 60000)));
        grantVoiceMinutes(rec.guildId, uid, minutes);
        return;
      }

      if (oldS.channelId && !newS.channelId) return;
    } catch (e) {
      console.error('[earn voice]', e);
    }
  });
}

module.exports = { registerEarn, grantVoiceMinutes };
