const path = require('path');
const fs = require('fs');
const { REST, Routes } = require('discord.js');
const cfg = require('./config');

function loadSlashCommandBody() {
  const commandsPath = path.join(__dirname, 'commands');
  const body = [];
  for (const file of fs.readdirSync(commandsPath)) {
    if (!file.endsWith('.js')) continue;
    const mod = require(path.join(commandsPath, file));
    if (mod.data) body.push(mod.data.toJSON());
  }
  return body;
}

/**
 * Enregistre les slash commands (guild si REBORN_TEST_GUILD_ID, sinon global).
 * @returns {Promise<{ ok: boolean, scope?: string, count?: number, reason?: string }>}
 */
async function deploySlashCommands() {
  const body = loadSlashCommandBody();
  if (!body.length) return { ok: false, reason: 'no-commands' };
  if (!cfg.clientId) return { ok: false, reason: 'no-client-id' };

  const rest = new REST({ version: '10' }).setToken(cfg.token);
  if (cfg.guildId) {
    await rest.put(Routes.applicationGuildCommands(cfg.clientId, cfg.guildId), { body });
    return { ok: true, scope: 'guild', count: body.length, guildId: cfg.guildId };
  }
  await rest.put(Routes.applicationCommands(cfg.clientId), { body });
  return { ok: true, scope: 'global', count: body.length };
}

module.exports = { loadSlashCommandBody, deploySlashCommands };
