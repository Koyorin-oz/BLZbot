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
const { handlePanelInteraction } = require('./services/panelComponents');
const { deploySlashCommands, registerNiveauMirrorStubs } = require('./slashDeploy');
const { tickSeparations } = require('./services/separation');
const grpSeason = require('./services/grpSeason');

cfg.assertToken();

const fullIntents = [
  GatewayIntentBits.Guilds,
  GatewayIntentBits.GuildMembers,
  GatewayIntentBits.GuildMessages,
  GatewayIntentBits.GuildMessageReactions,
  GatewayIntentBits.GuildVoiceStates,
  GatewayIntentBits.GuildModeration,
  GatewayIntentBits.MessageContent,
  GatewayIntentBits.DirectMessages,
  GatewayIntentBits.DirectMessageReactions,
];
/** Intents privilégiés côté portail : « Contenu des messages » + « Membres du serveur ». */
const minimalIntents = fullIntents.filter(
  (b) => b !== GatewayIntentBits.GuildMembers && b !== GatewayIntentBits.MessageContent,
);

if (cfg.minimalDiscordIntents) {
  console.warn(
    '[reborn-test-bot] REBORN_MINIMAL_DISCORD_INTENTS=1 : sans MessageContent / GuildMembers. Pour le mode complet, active les intents privilégiés (Portail Discord → ton app → Bot) et repasse la variable à 0 ou supprime-la.',
  );
}

const client = new Client({
  intents: cfg.minimalDiscordIntents ? minimalIntents : fullIntents,
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

registerNiveauMirrorStubs(client);

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
  client.user?.setActivity('/profil pour commencer', { type: ActivityType.Playing });

  setInterval(() => {
    try {
      tickSeparations();
    } catch (e) {
      console.error('[separation tick]', e);
    }
  }, 60_000);

  setInterval(() => {
    try {
      grpSeason.tickCalendarFirstOfMonthUTC();
    } catch (e) {
      console.error('[grp calendar]', e);
    }
  }, 60_000);
});

client.on('interactionCreate', async (interaction) => {
  // ─── Bouton « 🎯 Quêtes » du /profil niveau → on ouvre notre panel REBORN ──
  // Notre listener est enregistré AVANT le collector niveau (créé à chaque /profil),
  // donc on acknowledge en premier ; le collector niveau échouera silencieusement
  // (try/catch interne dans niveau).
  if (
    interaction.isButton() &&
    /^pv2_q_\d+(?:_\d+)?$/.test(interaction.customId)
  ) {
    const m = interaction.customId.match(/^pv2_q_(\d+)/);
    const targetId = m ? m[1] : null;
    if (targetId === interaction.user.id) {
      try {
        await interaction.deferUpdate();
        const { buildQuetesPayload } = require('./lib/quetesPanelUi');
        const payload = await buildQuetesPayload(interaction.user.id, 0, {
          displayName: interaction.member?.displayName || interaction.user.username,
          avatarUrl: interaction.user.displayAvatarURL({ extension: 'png', size: 256 }),
        });
        await interaction.editReply(payload);
      } catch (e) {
        console.error('[profil → quetes]', e?.message || e);
      }
      return;
    }
    // Pas l'auteur → laisser niveau gérer le message d'erreur d'origine.
  }

  if (interaction.isStringSelectMenu()) {
    const id = interaction.customId;
    if (id === 'rb:shop:sel' || id === 'rb:inv:sel' || id === 'rb:tree:sel' || id === 'rb:q:pick') {
      try {
        await handlePanelInteraction(interaction);
      } catch (e) {
        console.error('[panel select]', e);
        if (!interaction.replied && !interaction.deferred) {
          await interaction.reply({ content: `Erreur: \`${e?.message || e}\`` }).catch(() => {});
        }
      }
      return;
    }
  }

  if (interaction.isButton() && interaction.customId.startsWith('rb:')) {
    if (
      interaction.customId.startsWith('rb:shop:') ||
      interaction.customId.startsWith('rb:inv:') ||
      interaction.customId.startsWith('rb:tree:') ||
      interaction.customId.startsWith('rb:ps:')
    ) {
      try {
        await handlePanelInteraction(interaction);
      } catch (e) {
        console.error('[panel bouton]', e);
        const msg = { content: `Erreur: \`${e?.message || e}\`` };
        if (interaction.replied || interaction.deferred) await interaction.followUp(msg).catch(() => {});
        else await interaction.reply(msg).catch(() => {});
      }
      return;
    }
    try {
      await handlePurchase(interaction, interaction.customId.split(':'));
    } catch (e) {
      console.error('[boutique bouton]', e);
      const msg = { content: `Erreur: \`${e?.message || e}\`` };
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
    const msg = { content: `Erreur: \`${e?.message || e}\`` };
    if (interaction.replied || interaction.deferred) await interaction.followUp(msg).catch(() => {});
    else await interaction.reply(msg).catch(() => {});
  }
});

client.login(cfg.token);
