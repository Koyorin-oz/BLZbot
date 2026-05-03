'use strict';

const path = require('node:path');
const { isBlzTestGuild } = require(path.join(__dirname, '..', '..', '..', 'blzbot-env.js'));
const CONFIG = require('./config');

const DEFAULT_TEST_ALL_LOG = '1493282572925669498';

/**
 * Salon des alertes anti-raid (prod / test).
 */
function resolveRaidLogChannelId(guildId) {
  if (!guildId) return CONFIG.RAID_LOG_CHANNEL_ID || CONFIG.ALL_LOG_CHANNEL_ID;
  if (isBlzTestGuild(guildId)) {
    const tr = String(process.env.TEST_RAID_LOG_CHANNEL_ID || '').trim();
    if (/^\d{17,22}$/.test(tr)) return tr;
    const tall = String(process.env.TEST_ALL_LOG_CHANNEL_ID || '').trim();
    if (/^\d{17,22}$/.test(tall)) return tall;
    return DEFAULT_TEST_ALL_LOG;
  }
  return CONFIG.RAID_LOG_CHANNEL_ID || CONFIG.ALL_LOG_CHANNEL_ID;
}

module.exports = { resolveRaidLogChannelId, DEFAULT_TEST_ALL_LOG };
