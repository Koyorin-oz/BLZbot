const { Events } = require('discord.js');
const logger = require('../utils/logger');
const { onMemberLeft } = require('../utils/member-stats-voice');

module.exports = {
    name: Events.GuildMemberRemove,
    async execute(member, client) {
        try {
            await onMemberLeft(member.guild, member);
        } catch (e) {
            logger.debug(`[member-stats-voice] GuildMemberRemove: ${e?.message || e}`);
        }
    },
};
