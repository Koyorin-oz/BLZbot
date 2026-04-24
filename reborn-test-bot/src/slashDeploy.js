const path = require('path');
const fs = require('fs');
const { REST, Routes, SlashCommandBuilder } = require('discord.js');
const cfg = require('./config');

const NIVEAU_COMMAND_SUBDIRS = ['core', 'guilde', 'admin', 'misc'];
const NIVEAU_SLASH_OBSOLETE = new Set(['profil-v2', 'profile', 'testprofil', 'testprofilguilde']);
const DISCORD_APPLICATION_COMMAND_MAX = 100;

/**
 * Charge les définitions slash du module **niveau** (bot principal) pour les enregistrer
 * sur l’application du bot de test — l’exécution reste un stub sauf si une commande locale existe.
 */
function collectNiveauSlashBodiesForMirror() {
  const repoRoot = path.join(__dirname, '..', '..');
  const bodies = [];
  const seen = new Set();
  for (const sub of NIVEAU_COMMAND_SUBDIRS) {
    const dir = path.join(repoRoot, 'niveau', 'src', 'commands', sub);
    if (!fs.existsSync(dir)) continue;
    for (const file of fs.readdirSync(dir)) {
      if (!file.endsWith('.js') || file.endsWith('-ancien.js')) continue;
      const fp = path.join(dir, file);
      let mod;
      try {
        delete require.cache[require.resolve(fp)];
        mod = require(fp);
      } catch {
        continue;
      }
      if (!mod?.data?.toJSON || typeof mod.execute !== 'function') continue;
      let j;
      try {
        j = mod.data.toJSON();
      } catch {
        continue;
      }
      if (!j?.name || NIVEAU_SLASH_OBSOLETE.has(j.name) || seen.has(j.name)) continue;
      seen.add(j.name);
      bodies.push(j);
    }
  }
  return bodies;
}

function loadLocalSlashBodies() {
  const commandsPath = path.join(__dirname, 'commands');
  const out = [];
  for (const file of fs.readdirSync(commandsPath)) {
    if (!file.endsWith('.js')) continue;
    const fp = path.join(commandsPath, file);
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

function mergeSlashBodies() {
  const mirrorOff = String(process.env.REBORN_MIRROR_NIVEAU_SLASH || '1').trim() === '0';
  const local = loadLocalSlashBodies();
  const localNames = new Set(local.map((j) => j.name));
  let merged = [...local];
  if (!mirrorOff) {
    for (const j of collectNiveauSlashBodiesForMirror()) {
      if (localNames.has(j.name)) continue;
      merged.push(j);
    }
  }
  if (merged.length > DISCORD_APPLICATION_COMMAND_MAX) {
    const prim = merged.filter((j) => localNames.has(j.name));
    const sec = merged.filter((j) => !localNames.has(j.name));
    merged = [...prim, ...sec].slice(0, DISCORD_APPLICATION_COMMAND_MAX);
  }
  return merged;
}

function makeNiveauMirrorStub(commandName) {
  return {
    data: new SlashCommandBuilder()
      .setName(commandName)
      .setDescription('Miroir BLZbot — exécution non portée sur ce sandbox.'),
    async execute(interaction) {
      await interaction.reply({
        content:
          `La commande \`/${interaction.commandName}\` est en **miroir** du bot principal (niveau) : le menu Discord reprend la définition BLZbot, mais **reborn-test-bot** ne l’exécute pas ici.\n` +
          `→ Utilise **BLZbot** pour cette action, ou **/reborn-ref** pour les commandes vraiment branchées sur ce sandbox.`,
        ephemeral: true,
      });
    },
  };
}

/**
 * Enregistre des handlers « stub » pour chaque slash mirroir niveau absent du dossier `commands/`.
 * @param {import('discord.js').Client} client
 */
function registerNiveauMirrorStubs(client) {
  if (String(process.env.REBORN_MIRROR_NIVEAU_SLASH || '1').trim() === '0') return;
  for (const j of collectNiveauSlashBodiesForMirror()) {
    if (client.commands.has(j.name)) continue;
    client.commands.set(j.name, makeNiveauMirrorStub(j.name));
  }
}

/**
 * @deprecated utiliser mergeSlashBodies ; conservé pour appels internes.
 */
function loadSlashCommandBody() {
  return mergeSlashBodies();
}

/**
 * Enregistre les slash commands (guild si REBORN_TEST_GUILD_ID, sinon global).
 * @returns {Promise<{ ok: boolean, scope?: string, count?: number, guildId?: string, reason?: string }>}
 */
async function deploySlashCommands() {
  const body = mergeSlashBodies();
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

module.exports = {
  loadSlashCommandBody,
  mergeSlashBodies,
  collectNiveauSlashBodiesForMirror,
  registerNiveauMirrorStubs,
  deploySlashCommands,
};
