const path = require("path");
const {
  Client,
  Collection,
  Events,
  GatewayIntentBits,
  Partials,
  ActivityType,
} = require("discord.js");
const cfg = require("./config");
const rebornRuntime = require("./rebornRuntime");
const pg = require("./services/playerGuilds");
const { refreshApplicationOwners } = require("./lib/owners");
const {
  deploySlashCommands,
  registerNiveauMirrorStubs,
} = require("./slashDeploy");

rebornRuntime.initDbPath();
require("./db");

if (cfg.mirrorNiveauExecute) {
  rebornRuntime.applyProfilBypassEnv();
}

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
const minimalIntents = fullIntents.filter(
  (b) =>
    b !== GatewayIntentBits.GuildMembers &&
    b !== GatewayIntentBits.MessageContent,
);

if (cfg.minimalDiscordIntents) {
  console.warn(
    "[reborn-test-bot] REBORN_MINIMAL_DISCORD_INTENTS=1 : sans MessageContent / GuildMembers. Pour le mode complet, active les intents privilégiés (Portail Discord → ton app → Bot) et repasse la variable à 0 ou supprime-la.",
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

client.commands = new Collection();
rebornRuntime.loadCommands(client);
registerNiveauMirrorStubs(client);
rebornRuntime.registerEarn(client);
rebornRuntime.registerInteractionHandler(client);

client.once(Events.ClientReady, async () => {
  if (cfg.autoDeploySlashOnReady) {
    if (!cfg.clientId) {
      console.warn(
        "[reborn-test-bot] Slash auto-deploy ignoré : ajoute REBORN_TEST_BOT_CLIENT_ID dans reborn-test-bot/.env",
      );
    } else {
      try {
        const r = await deploySlashCommands();
        if (r.ok) {
          console.log(
            `[reborn-test-bot] Slash déployés (${r.scope}, ${r.count} cmd${r.guildId ? `, guild ${r.guildId}` : ""}) — /profil : ${r.includesProfil ? "oui" : "NON"}`,
          );
          if (!cfg.mirrorNiveauSlash) {
            console.warn(
              "[reborn-test-bot] REBORN_MIRROR_NIVEAU_SLASH=0 → aucune commande « niveau » (/profil, /daily, …). Remets **1** (ou supprime la ligne), puis `npm run deploy`.",
            );
          } else if (!r.includesProfil) {
            console.warn(
              "[reborn-test-bot] `/profil` absent du paquet (échec chargement `niveau` ou liste tronquée >100). Vérifie les logs au-dessus.",
            );
          }
          if (r.scope === "guild" && r.guildId) {
            console.warn(
              `[reborn-test-bot] Slash **guild** : ils n’apparaissent que sur le serveur d’ID \`${r.guildId}\`. Pour un autre serveur : mets à jour REBORN_TEST_GUILD_ID ou vide-le pour un déploiement global.`,
            );
          }
          if (r.scope === "global") {
            console.warn(
              "[reborn-test-bot] Slash **globaux** : Discord peut mettre jusqu’à ~1 h avant d’afficher toutes les commandes.",
            );
          }
        } else {
          console.warn("[reborn-test-bot] Slash deploy :", r.reason);
        }
      } catch (e) {
        console.error(
          "[reborn-test-bot] Erreur deploy slash au démarrage :",
          e?.message || e,
        );
      }
    }
  }

  await refreshApplicationOwners(client);
  console.log(
    `[reborn-test-bot] Connecté en tant que ${client.user?.tag} — TEST_NO_LIMITS=${cfg.TEST_NO_LIMITS}`,
  );
  client.user?.setActivity("/profil pour commencer", {
    type: ActivityType.Playing,
  });
  rebornRuntime.registerReadyTasks(client);
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (interaction.customId.startsWith("guild_invite:")
  ) {
    const [prefix, action, inviteId] = interaction.customId.split(":")
    try {
      if (!interaction.replied && !interaction.deferred) {
        await interaction.deferReply({ ephemeral: true });
      }

      let result;
      if (action === "accept") {
        result = pg.acceptGuildInvite(
          inviteId,
          interaction.user.id,
          interaction.user.username,
        );
      } else if (action === "decline") {
        result = pg.declineGuildInvite(inviteId, interaction.user.id);
      } else {
        result = { ok: false, error: "Action inconnue." };
      }

      const content = result?.ok
        ? action === "accept"
          ? "✅ Tu as rejoint la guilde."
          : "❌ Invitation refusée."
        : result?.error || "Une erreur est survenue.";

      await interaction.editReply({ content }).catch(() => {});

      try {
        await interaction.message?.edit?.({ components: [] }).catch(() => {});
      } catch {
        /* ignore */
      }
    } catch (e) {
      console.error("[guild invite button]", e);
      await interaction
        .reply({ content: "Une erreur est survenue.", ephemeral: true })
        .catch(() => {});
    }
    return;
  }

  if (interaction.isAutocomplete()) {
    const cmdAuto = client.commands.get(interaction.commandName);
    if (!cmdAuto?.autocomplete) {
      try {
        await interaction.respond([]);
      } catch {
        /* ignore */
      }
      return;
    }
    try {
      await cmdAuto.autocomplete(interaction);
    } catch (e) {
      if (e?.code !== 10062 && e?.code !== 40060) {
        console.error(
          `[autocomplete ${interaction.commandName}]`,
          e?.message || e,
        );
      }
    }
    return;
  }

  if (!interaction.isChatInputCommand()) return;
  const cmd = client.commands.get(interaction.commandName);
  if (!cmd) return;
  const interactionAgeMs = Date.now() - interaction.createdTimestamp;
  if (interactionAgeMs > 1500) return;
  const { isOwner } = require("./lib/owners");
  try {
    await cmd.execute(
      interaction,
      rebornRuntime.makeExecuteCtx(client, isOwner),
    );
  } catch (e) {
    if (e?.code === 10062 || e?.code === 40060) return;
    console.error(`[cmd ${interaction.commandName}]`, e);
    const msg = { content: `Erreur: \`${e?.message || e}\`` };
    if (interaction.replied || interaction.deferred)
      await interaction.followUp(msg).catch(() => {});
    else await interaction.reply(msg).catch(() => {});
  }
});

client.login(cfg.token);
