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
require('./db');
const cfg = require('./config');
const { refreshApplicationOwners, isOwner } = require('./lib/owners');
const { registerEarn } = require('./services/earn');
const { handlePurchase } = require('./services/purchase');
const { deploySlashCommands } = require('./slashDeploy');
const { tickSeparations } = require('./services/separation');

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

/** @type {Collection<string, { data: import('discord.js').SlashCommandBuilder, execute: Function }>} */
client.commands = new Collection();
const commandsDir = path.join(__dirname, 'commands');
for (const file of fs.readdirSync(commandsDir)) {
  if (!file.endsWith('.js')) continue;
  const cmd = require(path.join(commandsDir, file));
  if (cmd.data?.name) client.commands.set(cmd.data.name, cmd);
}

registerEarn(client);

client.once(Events.ClientReady, async () => {
  if (cfg.autoDeploySlashOnReady) {
    if (!cfg.clientId) {
      console.warn(
        '[reborn-test-bot] Slash auto-deploy ignoré : ajoute REBORN_TEST_BOT_CLIENT_ID dans reborn-test-bot/.env',
      );
    } else {
      try {
        const r = await deploySlashCommands();
        if (r.ok) {
          console.log(
            `[reborn-test-bot] Slash déployés (${r.scope}, ${r.count} cmd${r.guildId ? `, guild ${r.guildId}` : ''})`,
          );
        } else {
          console.warn('[reborn-test-bot] Slash deploy :', r.reason);
        }
      } catch (e) {
        console.error('[reborn-test-bot] Erreur deploy slash au démarrage :', e?.message || e);
      }
    }
  }

  await refreshApplicationOwners(client);
  console.log(
    `[reborn-test-bot] Connecté en tant que ${client.user?.tag} — TEST_NO_LIMITS=${cfg.TEST_NO_LIMITS}`,
  );
  client.user?.setActivity('REBORN sandbox', { type: ActivityType.Playing });

  setInterval(() => {
    try {
      tickSeparations();
    } catch (e) {
      console.error('[separation tick]', e);
    }
  }, 60_000);
});

client.on('interactionCreate', async (interaction) => {
  if (interaction.isButton() && interaction.customId.startsWith('rb:')) {
    try {
      await handlePurchase(interaction, interaction.customId.split(':'));
    } catch (e) {
      console.error('[boutique bouton]', e);
      const msg = { content: `Erreur: \`${e?.message || e}\``, ephemeral: true };
      if (interaction.replied || interaction.deferred) await interaction.followUp(msg).catch(() => {});
      else await interaction.reply(msg).catch(() => {});
    }
    return;
  }

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
