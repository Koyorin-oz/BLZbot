const { REST, Routes } = require('discord.js');
const path = require('path');
const fs = require('fs');
const cfg = require('./config');

cfg.assertToken();
cfg.assertClientIdForDeploy();

const commandsPath = path.join(__dirname, 'commands');
const body = [];
for (const file of fs.readdirSync(commandsPath)) {
  if (!file.endsWith('.js')) continue;
  const mod = require(path.join(commandsPath, file));
  if (mod.data) body.push(mod.data.toJSON());
}

const rest = new REST({ version: '10' }).setToken(cfg.token);

(async () => {
  try {
    if (cfg.guildId) {
      await rest.put(Routes.applicationGuildCommands(cfg.clientId, cfg.guildId), { body });
      console.log(`[deploy] ${body.length} commande(s) guild → ${cfg.guildId}`);
    } else {
      await rest.put(Routes.applicationCommands(cfg.clientId), { body });
      console.log(`[deploy] ${body.length} commande(s) globales`);
    }
  } catch (e) {
    console.error('[deploy]', e);
    process.exit(1);
  }
})();
