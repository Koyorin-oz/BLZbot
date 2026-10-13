const fs = require('fs');
const path = require('path');
const { REST, Routes } = require('discord.js');
const { TEST_GUILD_ID, MAIN_GUILD_ID } = require('./config');
const { isDeployed } = require('./store');

function loadBodies() {
    const dir = path.join(__dirname, '..', 'commands', 'halloween-beta');
    const bodies = [];
    for (const file of fs.readdirSync(dir)) {
        if (!file.endsWith('.js')) continue;
        const cmd = require(path.join(dir, file));
        if (cmd?.data?.toJSON) bodies.push(cmd.data.toJSON());
    }
    return bodies;
}

async function pushGuild(client, guildId) {
    const bodies = loadBodies();
    const rest = new REST({ version: '10' }).setToken(client.token);
    const appId = client.application.id;
    const route = Routes.applicationGuildCommands(appId, guildId);
    const existing = await rest.get(route);
    const names = new Set(bodies.map((b) => b.name));
    const kept = existing.filter((c) => !names.has(c.name)).map((c) => {
        const { id, application_id, version, guild_id, ...restCmd } = c;
        return restCmd;
    });
    await rest.put(route, { body: [...kept, ...bodies] });
    return bodies.map((b) => b.name);
}

async function registerBetaCommands(client, includeMain) {
    const names = await pushGuild(client, TEST_GUILD_ID);
    if (includeMain || isDeployed(MAIN_GUILD_ID)) {
        await pushGuild(client, MAIN_GUILD_ID);
    }
    return names;
}

module.exports = { loadBodies, pushGuild, registerBetaCommands };
