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
        if (e?.code !== 10062 && e?.code !== 40060) {
          console.error('[profil → quetes]', e?.message || e);
        }
      }
      return;
    }
    // Pas l'auteur → laisser niveau gérer le message d'erreur d'origine.
  }

  // ─── Bouton « 🎓 Classes » du /profil niveau → embed REBORN ──
  if (
    interaction.isButton() &&
    /^pv2_classes_\d+$/.test(interaction.customId)
  ) {
    const m = interaction.customId.match(/^pv2_classes_(\d+)$/);
    const targetId = m ? m[1] : null;
    if (targetId === interaction.user.id) {
      try {
        await interaction.deferReply({ ephemeral: true });
        const skillTree = require('./services/skillTree');
        const classes = skillTree.playerClasses(interaction.user.id);
        const PERKS = {
          aventurier: 'Plus de quêtes (+slot), skips, double claim — *pour explorer le serveur*.',
          suzerain: '+1/+2 membres guilde, +10 % GXP, +10 % GRP, +20 % GRP loyaliste — *pour bâtir une dynastie*.',
          marchand: 'Reset boutique, ×2 contenu coffres, rotation midi, CATL gratuit, -30 % prix — *pour briser la banque*.',
          duelliste: '+RP %, +RP/msg, +RP/min voc — *pour grimper le ladder ranked*.',
          conquerant: "+10 % monnaie d'event, +30 % défense, -20 % coffres event, spawner gratuit — *pour dominer les événements*.",
          maitre: 'Toutes les voies maîtrisées — accès au **Temple** + statut **Maître**.',
          initie: "Pas encore de classe — débloque un palier 5/5 dans une branche pour t'éveiller.",
        };
        const lines = ['# 🎓 Tes classes', ''];
        for (const c of classes) {
          lines.push(`${c.icon} **${c.name}** — ${PERKS[c.id] || ''}`);
        }
        lines.push('');
        lines.push("*Une classe se débloque dès qu'une **branche atteint 5/5**. Maîtrise les **5** branches et tu deviens **Maître des voies**.*");
        const { TextDisplayBuilder, ContainerBuilder, MessageFlags } = require('discord.js');
        const td = new TextDisplayBuilder().setContent(lines.join('\n'));
        await interaction.editReply({
          components: [new ContainerBuilder().addTextDisplayComponents(td)],
          flags: MessageFlags.IsComponentsV2,
        });
      } catch (e) {
        if (e?.code !== 10062 && e?.code !== 40060) {
          console.error('[profil → classes]', e?.message || e);
        }
      }
      return;
    }
  }

  // ─── Bouton « 🌳 Arbre » du /profil niveau → canvas /arbre REBORN ──
  if (
    interaction.isButton() &&
    /^pv2_arbre_\d+$/.test(interaction.customId)
  ) {
    const m = interaction.customId.match(/^pv2_arbre_(\d+)$/);
    const targetId = m ? m[1] : null;
    if (targetId === interaction.user.id) {
      try {
        await interaction.deferUpdate();
        const { buildArbreContainer } = require('./services/panelComponents');
        const b = await buildArbreContainer(
          interaction.user.id,
          interaction.member?.displayName || interaction.user.username,
          interaction.user.displayAvatarURL({ extension: 'png', size: 128 }),
          'demi',
        );
        if (b) {
          await interaction.editReply({
            files: [b.file],
            components: [b.container],
            flags: b.flags,
          });
        } else {
          await interaction.editReply({
            content: 'Arbre indisponible (canvas KO). Réessaie ou utilise `/arbre voir`.',
            files: [],
            components: [],
            embeds: [],
          });
        }
      } catch (e) {
        if (e?.code !== 10062 && e?.code !== 40060) {
          console.error('[profil → arbre]', e?.message || e);
        }
      }
      return;
    }
  }

  // ─── Bouton « 🛡️ Guilde » du /profil niveau → canvas /profil-guilde REBORN ──
  // On vérifie que le clicker EST l'auteur du /profil (sinon on laisse niveau
  // afficher son message « seul l'auteur peut… »).
  if (
    interaction.isButton() &&
    /^pv2_guild_\d+$/.test(interaction.customId)
  ) {
    const m = interaction.customId.match(/^pv2_guild_(\d+)$/);
    const niveauGuildId = m ? m[1] : null;
    const originalAuthor = interaction.message?.interaction?.user?.id;
    const isAuthor = originalAuthor && originalAuthor === interaction.user.id;
    if (niveauGuildId && isAuthor && interaction.guildId) {
      try {
        await interaction.deferUpdate();
        const profilGuilde = require('./commands/profil-guilde');
        const gRow = profilGuilde.resolveGuildForProfilButton(
          interaction.guildId,
          interaction.user.id,
          niveauGuildId,
        );
        if (!gRow) {
          await interaction.editReply({
            content: 'Guilde introuvable côté REBORN. Refais `/profil` pour rafraîchir.',
            files: [],
            components: [],
            embeds: [],
          });
          return;
        }
        const built = await profilGuilde.buildProfilGuildePayload(interaction, {
          hub: interaction.guildId,
          gRow,
        });
        if (built.error) {
          await interaction.editReply({
            content: built.error,
            files: [],
            components: [],
            embeds: [],
          });
          return;
        }
        await interaction.editReply(built.payload);
      } catch (e) {
        if (e?.code !== 10062 && e?.code !== 40060) {
          console.error('[profil → profil-guilde]', e?.message || e);
        }
      }
      return;
    }
    // Pas l'auteur → laisser niveau répondre.
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

  // Boutons « Liste / Carrières / Quêtes » du canvas /profil-guilde — handler
  // global (au lieu d'un collector lié au message) car ce canvas peut être
  // rendu depuis /profil-guilde OU depuis le bouton « Guilde » du /profil.
  if (interaction.isButton() && interaction.customId.startsWith('rb_pg_')) {
    try {
      const { handleRebornGuildButton } = require('./commands/profil-guilde');
      await handleRebornGuildButton(interaction);
    } catch (e) {
      if (e?.code !== 10062 && e?.code !== 40060) {
        console.error('[rb_pg_*]', e?.message || e);
      }
    }
    return;
  }

  if (interaction.isButton() && interaction.customId.startsWith('rb:')) {
    if (
      interaction.customId.startsWith('rb:shop:') ||
      interaction.customId.startsWith('rb:inv:') ||
      interaction.customId.startsWith('rb:tree:') ||
      interaction.customId.startsWith('rb:ps:') ||
      interaction.customId.startsWith('rb:q:')
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
  // Garde-fou : si l'interaction est déjà très vieille (>1.5 s), abandon
  // silencieux — la fenêtre de 3 s pour ack est trop serrée vu le round-trip
  // réseau Discord (~500 ms) + l'event loop éventuellement chargé. Cela arrive
  // typiquement après un redémarrage si l'utilisateur tape une commande avant
  // que le bot ne soit pleinement prêt (loaders canvas, niveau modules…).
  const interactionAgeMs = Date.now() - interaction.createdTimestamp;
  if (interactionAgeMs > 1500) {
    return;
  }
  try {
    await cmd.execute(interaction, { client, isOwner: () => isOwner(interaction.user.id) });
  } catch (e) {
    // 10062 (Unknown interaction) et 40060 (already acknowledged) sont des
    // courses bénignes : on les ignore silencieusement plutôt que de polluer.
    if (e?.code === 10062 || e?.code === 40060) return;
    console.error(`[cmd ${interaction.commandName}]`, e);
    const msg = { content: `Erreur: \`${e?.message || e}\`` };
    if (interaction.replied || interaction.deferred) await interaction.followUp(msg).catch(() => {});
    else await interaction.reply(msg).catch(() => {});
  }
});

client.login(cfg.token);
