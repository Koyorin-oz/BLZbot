const path = require('path');
const fs = require('fs');
const { Events } = require('discord.js');

const REBORN_SRC = __dirname;

function resolveDbPath(explicitPath) {
  const fromEnv = (process.env.REBORN_DB_PATH || '').trim();
  if (fromEnv) return fromEnv;
  if (explicitPath) return explicitPath;
  return path.join(REBORN_SRC, '..', 'data', 'reborn.sqlite');
}

/**
 * Configure le chemin SQLite REBORN avant le premier `require('./db')`.
 * @param {string} [explicitPath]
 */
function initDbPath(explicitPath) {
  const p = resolveDbPath(explicitPath);
  process.env.REBORN_DB_PATH = p;
  return p;
}

function ensureDbLoaded() {
  const dbModule = path.join(REBORN_SRC, 'db', 'index.js');
  if (!require.cache[require.resolve(dbModule)]) {
    require('./db');
  }
}

function getCommandsDir() {
  return path.join(REBORN_SRC, 'commands');
}

function makeExecuteCtx(client, isOwnerFn) {
  return {
    client,
    isOwner: typeof isOwnerFn === 'function' ? isOwnerFn : () => false,
  };
}

/**
 * Charge les commandes REBORN dans `client.commands` (écrase les homonymes existants).
 * @param {import('discord.js').Client} client
 * @param {{ isOwner?: (userId: string) => boolean }} [opts]
 * @returns {number}
 */
function loadCommands(client, opts = {}) {
  ensureDbLoaded();
  const { isOwner: isOwnerFn } = require('./lib/owners');
  const isOwner =
    typeof opts.isOwner === 'function'
      ? opts.isOwner
      : (userId) => isOwnerFn(userId);
  const dir = getCommandsDir();
  if (!fs.existsSync(dir)) return 0;
  let count = 0;
  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith('.js')) continue;
    const fp = path.join(dir, file);
    try {
      delete require.cache[require.resolve(fp)];
      const mod = require(fp);
      if (!mod?.data?.name || typeof mod.execute !== 'function') continue;
      const name = mod.data.name;
      const wrapped = {
        data: mod.data,
        async execute(interaction) {
          return mod.execute(interaction, makeExecuteCtx(client, isOwner));
        },
      };
      if (typeof mod.autocomplete === 'function') {
        wrapped.autocomplete = mod.autocomplete;
      }
      client.commands.set(name, wrapped);
      count++;
    } catch (e) {
      console.warn(`[reborn-runtime] Commande ignorée (${file}):`, e?.message || e);
    }
  }
  return count;
}

/**
 * @returns {object[]}
 */
function collectSlashBodies() {
  ensureDbLoaded();
  const dir = getCommandsDir();
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith('.js')) continue;
    const fp = path.join(dir, file);
    try {
      delete require.cache[require.resolve(fp)];
      const mod = require(fp);
      if (mod?.data?.toJSON) out.push(mod.data.toJSON());
    } catch {
      /* ignore */
    }
  }
  return out;
}

/**
 * @param {import('discord.js').Client} client
 */
function registerEarn(client) {
  ensureDbLoaded();
  const { registerEarn: reg } = require('./services/earn');
  reg(client);
}

/**
 * Tâches périodiques REBORN (séparation, GRP, temple, streak).
 * @param {import('discord.js').Client} client
 */
function registerReadyTasks(client) {
  ensureDbLoaded();
  const { tickSeparations } = require('./services/separation');
  const grpSeason = require('./services/grpSeason');

  setInterval(() => {
    try {
      tickSeparations();
    } catch (e) {
      console.error('[reborn separation tick]', e);
    }
  }, 60_000);

  setInterval(() => {
    try {
      grpSeason.tickCalendarFirstOfMonthUTC();
    } catch (e) {
      console.error('[reborn grp calendar]', e);
    }
  }, 60_000);

  setInterval(() => {
    try {
      const { flushTempleRoleSyncQueue } = require('./services/templeDiscordRoles');
      flushTempleRoleSyncQueue(client).catch(() => {});
    } catch (e) {
      console.error('[reborn temple roles flush]', e);
    }
  }, 30_000);

  setInterval(() => {
    try {
      require('./services/eventsSO').tick(client).catch(() => {});
    } catch (e) {
      console.error('[reborn events spawn tick]', e);
    }
  }, 60_000);

  try {
    const { scheduleStreakReset } = require('./services/streak');
    scheduleStreakReset();
  } catch (e) {
    console.error('[reborn streak init]', e?.message || e);
  }
}

/**
 * Boutons des events Espace / Océan (`evso:<event>:tab:<x>` et `evso:<event>:act:<x>`).
 * Réponses éphémères : on opère toujours sur `interaction.user.id`.
 */
async function handleEventButton(interaction, client) {
  const eventsSO = require('./services/eventsSO');
  const eventRoles = require('./services/eventRoles');
  const { buildEventPanel } = require('./lib/eventPanel');
  const parts = interaction.customId.split(':'); // evso : event : kind : value
  const eventKey = parts[1];
  const kind = parts[2];
  const value = parts[3];
  const uid = interaction.user.id;
  const hub = interaction.guildId;

  async function syncRoles() {
    if (!hub) return;
    try {
      await eventRoles.syncEventRolesForUser(client, hub, uid, eventsSO.claimedRoleKeys(uid));
    } catch {
      /* ignore */
    }
  }

  if (kind === 'tab') {
    eventsSO.checkAndClaim(uid);
    await interaction.update(buildEventPanel(eventKey, uid, value));
    syncRoles();
    return;
  }

  // Actions boutique.
  await interaction.deferUpdate();
  let note = '';
  if (value === 'buychest') {
    const r = eventsSO.buyChest(uid, eventKey);
    note = r.ok ? `${r.chestName} acheté (stock : ${r.count}).` : r.error;
  } else if (value === 'openchest') {
    const r = eventsSO.openChest(uid, eventKey);
    if (r.ok) {
      const claim = eventsSO.checkAndClaim(uid);
      await syncRoles();
      note = `Coffre ouvert : **${r.itemName}** *(${r.rarity})*.`;
      if (claim.newly.length) {
        note += ` Quête validée : ${claim.newly.map((n) => n.roleLabel).join(', ')}.`;
      }
    } else {
      note = r.error;
    }
  } else if (value === 'convert') {
    const r = eventsSO.convertAll(uid, eventKey);
    note = r.ok
      ? `Converti **${r.converted.toLocaleString('fr-FR')}** → **${r.starss.toLocaleString('fr-FR')}** starss.`
      : r.error;
  } else if (value === 'buyrole') {
    const r = eventsSO.buyRole(uid, eventKey);
    if (r.ok) {
      await syncRoles();
      note = `Rôle **${r.roleLabel}** obtenu.`;
    } else {
      note = r.error;
    }
  }
  await interaction.editReply(buildEventPanel(eventKey, uid, 'shop', note));
}

/**
 * Boutons / menus / achats REBORN (pas les slash — gérés via `client.commands`).
 * @returns {Promise<boolean>} true si l’interaction a été consommée
 */
async function handleComponentInteraction(interaction, client) {
  const { handlePurchase } = require('./services/purchase');
  const { handlePanelInteraction } = require('./services/panelComponents');

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
          console.error('[reborn profil → quetes]', e?.message || e);
        }
      }
      return true;
    }
    return false;
  }

  if (interaction.isButton() && /^pv2_classes_\d+$/.test(interaction.customId)) {
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
          marchand: 'Reset boutique, ×2 contenu coffres, rotation midi, Coffre légendaire gratuit, -30 % prix — *pour briser la banque*.',
          duelliste: '+RP %, +RP/msg, +RP/min voc — *pour grimper le ladder ranked*.',
          conquerant: "+10 % monnaie d'event, +30 % défense, -20 % coffres event, spawner gratuit — *pour dominer les événements*.",
          maitre: 'Toutes les voies maîtrisées — accès au **Temple** + statut **Maître**.',
          initie: "Pas encore de classe — débloque un palier 5/5 dans une branche pour t'éveiller.",
        };
        const { TextDisplayBuilder, ContainerBuilder, MessageFlags } = require('discord.js');
        const td = new TextDisplayBuilder().setContent(
          [
            '# 🎓 Tes classes',
            '',
            ...classes.map((c) => `${c.icon} **${c.name}** — ${PERKS[c.id] || ''}`),
            '',
            "*Une classe se débloque dès qu'une **branche atteint 5/5**. Maîtrise les **5** branches et tu deviens **Maître des voies**.*",
          ].join('\n'),
        );
        await interaction.editReply({
          components: [new ContainerBuilder().addTextDisplayComponents(td)],
          flags: MessageFlags.IsComponentsV2,
        });
      } catch (e) {
        if (e?.code !== 10062 && e?.code !== 40060) {
          console.error('[reborn profil → classes]', e?.message || e);
        }
      }
      return true;
    }
    return false;
  }

  if (interaction.isButton() && /^pv2_arbre_\d+$/.test(interaction.customId)) {
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
          console.error('[reborn profil → arbre]', e?.message || e);
        }
      }
      return true;
    }
    return false;
  }

  if (interaction.isButton() && /^pv2_guild_\d+$/.test(interaction.customId)) {
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
          return true;
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
          return true;
        }
        await interaction.editReply(built.payload);
      } catch (e) {
        if (e?.code !== 10062 && e?.code !== 40060) {
          console.error('[reborn profil → profil-guilde]', e?.message || e);
        }
      }
      return true;
    }
    return false;
  }

  if (interaction.isButton() && interaction.customId.startsWith('evso:')) {
    try {
      await handleEventButton(interaction, client);
    } catch (e) {
      if (e?.code !== 10062 && e?.code !== 40060) {
        console.error('[reborn evso bouton]', e?.message || e);
      }
    }
    return true;
  }

  if (interaction.isButton() && interaction.customId === 'rb:hacker:claim') {
    try {
      const { handleHackerSalonButton } = require('./commands/hacker');
      await handleHackerSalonButton(interaction);
    } catch (e) {
      if (e?.code !== 10062 && e?.code !== 40060) {
        console.error('[reborn hacker salon bouton]', e?.message || e);
      }
      try {
        if (!interaction.replied && !interaction.deferred) {
          await interaction.reply({ content: 'Erreur salon hacker.', ephemeral: true });
        }
      } catch {
        /* ignore */
      }
    }
    return true;
  }

  if (interaction.isStringSelectMenu()) {
    const id = interaction.customId;
    if (id === 'rb:shop:sel' || id === 'rb:inv:sel' || id === 'rb:tree:sel' || id === 'rb:q:pick') {
      try {
        await handlePanelInteraction(interaction);
      } catch (e) {
        console.error('[reborn panel select]', e);
        if (!interaction.replied && !interaction.deferred) {
          await interaction.reply({ content: `Erreur: \`${e?.message || e}\`` }).catch(() => {});
        }
      }
      return true;
    }
  }

  if (interaction.isButton() && interaction.customId.startsWith('rb_pg_')) {
    try {
      const { handleRebornGuildButton } = require('./commands/profil-guilde');
      await handleRebornGuildButton(interaction);
    } catch (e) {
      if (e?.code !== 10062 && e?.code !== 40060) {
        console.error('[reborn rb_pg_*]', e?.message || e);
      }
    }
    return true;
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
        console.error('[reborn panel bouton]', e);
        const msg = { content: `Erreur: \`${e?.message || e}\`` };
        if (interaction.replied || interaction.deferred) await interaction.followUp(msg).catch(() => {});
        else await interaction.reply(msg).catch(() => {});
      }
      return true;
    }
    try {
      await handlePurchase(interaction, interaction.customId.split(':'));
    } catch (e) {
      console.error('[reborn boutique bouton]', e);
      const msg = { content: `Erreur: \`${e?.message || e}\`` };
      if (interaction.replied || interaction.deferred) await interaction.followUp(msg).catch(() => {});
      else await interaction.reply(msg).catch(() => {});
    }
    return true;
  }

  return false;
}

/**
 * @param {import('discord.js').Client} client
 */
function registerInteractionHandler(client) {
  client.on(Events.InteractionCreate, async (interaction) => {
    try {
      const handled = await handleComponentInteraction(interaction, client);
      if (handled) return;
    } catch (e) {
      console.error('[reborn interaction]', e?.message || e);
    }
  });
}

/**
 * Active les bypass profil → REBORN sur le bot principal.
 */
function applyProfilBypassEnv() {
  const defaults = {
    REBORN_PROFIL_QUEST_BYPASS: '1',
    REBORN_PROFIL_GUILD_BYPASS: '1',
    REBORN_PROFIL_ARBRE_BYPASS: '1',
    REBORN_PROFIL_CLASSES_BYPASS: '1',
  };
  for (const [k, v] of Object.entries(defaults)) {
    if (process.env[k] === undefined) process.env[k] = v;
  }
}

module.exports = {
  REBORN_SRC,
  initDbPath,
  ensureDbLoaded,
  loadCommands,
  collectSlashBodies,
  registerEarn,
  registerReadyTasks,
  registerInteractionHandler,
  handleComponentInteraction,
  applyProfilBypassEnv,
  makeExecuteCtx,
};
