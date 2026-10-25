const { TEST_GUILD_ID, MAIN_GUILD_ID } = require('./config');
const { isDeployed } = require('./store');

/** Les soldes Halloween sont partagés entre les serveurs : le test s'arrête dès que le principal est lancé. */
function isLive(guildId) {
    const id = String(guildId || '');
    if (!id) return false;
    if (id === TEST_GUILD_ID) return !isDeployed(MAIN_GUILD_ID);
    return isDeployed(id);
}

module.exports = { isLive };
