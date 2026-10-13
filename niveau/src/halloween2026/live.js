const { TEST_GUILD_ID } = require('./config');
const { isDeployed } = require('./store');

function isLive(guildId) {
    const id = String(guildId || '');
    if (!id) return false;
    if (id === TEST_GUILD_ID) return true;
    return isDeployed(id);
}

module.exports = { isLive };
