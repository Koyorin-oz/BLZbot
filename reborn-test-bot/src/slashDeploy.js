const path = require('path');
const fs = require('fs');
const { REST, Routes, SlashCommandBuilder } = require('discord.js');
const cfg = require('./config');

const NIVEAU_COMMAND_SUBDIRS = ['core', 'guilde', 'admin', 'misc'];
const NIVEAU_SLASH_OBSOLETE = new Set(['profil-v2', 'profile', 'testprofil', 'testprofilguilde']);
const DISCORD_APPLICATION_COMMAND_MAX = 100;
const REPO_ROOT = path.join(__dirname, '..', '..');

/**
 * Parcourt les fichiers commande `niveau` (mêmes règles que le miroir slash).
 * @returns {Generator<{ name: string, filePath: string, mod: object }>}
 */
function* iterNiveauMirrorCommandFiles() {
  const seen = new Set();
  for (const sub of NIVEAU_COMMAND_SUBDIRS) {
    const dir = path.join(REPO_ROOT, 'niveau', 'src', 'commands', sub);
    if (!fs.existsSync(dir)) continue;
    for (const file of fs.readdirSync(dir)) {
      if (!file.endsWith('.js') || file.endsWith('-ancien.js')) continue;
      const filePath = path.join(dir, file);
      let mod;
      try {
        delete require.cache[require.resolve(filePath)];
        mod = require(filePath);
      } catch (e) {
        console.warn(
          `[reborn-test-bot] Miroir niveau — chargement ignoré (${path.relative(REPO_ROOT, filePath)}):`,
          e?.message || e,
        );
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
      yield { name: j.name, filePath, mod };
    }
  }
}

/**
 * Charge les définitions slash du module **niveau** (bot principal) pour les enregistrer
 * sur l’application du bot de test — l’exécution : vrais handlers si `cfg.mirrorNiveauExecute`, sinon stub.
 */
function collectNiveauSlashBodiesForMirror() {
  const bodies = [];
  for (const { mod } of iterNiveauMirrorCommandFiles()) {
    bodies.push(mod.data.toJSON());
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
 * Enregistre les handlers miroir `niveau` (vraie exécution ou stub) pour chaque slash absent du dossier `commands/`.
 * @param {import('discord.js').Client} client
 */
function registerNiveauMirrorStubs(client) {
  if (String(process.env.REBORN_MIRROR_NIVEAU_SLASH || '1').trim() === '0') return;
  const useExecute = cfg.mirrorNiveauExecute;
  for (const { name, filePath, mod: preloaded } of iterNiveauMirrorCommandFiles()) {
    if (client.commands.has(name)) continue;
    if (useExecute) {
      try {
        const mod = preloaded;
        if (mod?.data && typeof mod.execute === 'function') {
          client.commands.set(name, mod);
          continue;
        }
      } catch (e) {
        console.warn(`[reborn-test-bot] Miroir niveau exéc. — /${name} :`, e?.message || e);
      }
    }
    client.commands.set(name, makeNiveauMirrorStub(name));
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
