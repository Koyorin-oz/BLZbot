const path = require('path');
const fs = require('fs');
const {
  Client,
  Collection,
  Events,
  GatewayIntentBits,
  Partials,
  ActivityType,
} = require('discord.js');
const cfg = require('./config');
const { refreshApplicationOwners, isOwner } = require('./lib/owners');

cfg.assertToken();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildModeration,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.DirectMessageReactions,
  ],
  partials: [
    Partials.Channel,
    Partials.Message,
    Partials.Reaction,
    Partials.User,
    Partials.GuildMember,
  ],
});

/** @type {Collection<string, import('./commands/ping')>} */
client.commands = new Collection();
const commandsDir = path.join(__dirname, 'commands');
for (const file of fs.readdirSync(commandsDir)) {
  if (!file.endsWith('.js')) continue;
  const cmd = require(path.join(commandsDir, file));
  if (cmd.data?.name) client.commands.set(cmd.data.name, cmd);
}

client.once('clientReady', async () => {
  await refreshApplicationOwners(client);
  console.log(
    `[reborn-test-bot] Connecté en tant que ${client.user?.tag} — TEST_NO_LIMITS=${cfg.TEST_NO_LIMITS}`,
  );
  client.user?.setActivity('sandbox REBORN', { type: ActivityType.Playing });
});

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  const cmd = client.commands.get(interaction.commandName);
  if (!cmd) return;
  try {
    await cmd.execute(interaction, { client, isOwner: () => isOwner(interaction.user.id) });
  } catch (e) {
    console.error(`[cmd ${interaction.commandName}]`, e);
    const msg = { content: `Erreur: \`${e?.message || e}\``, ephemeral: true };
    if (interaction.replied || interaction.deferred) await interaction.followUp(msg).catch(() => {});
    else await interaction.reply(msg).catch(() => {});
  }
});

client.login(cfg.token);
