// main.js

// --- Modules et configuration de l'environnement ---
const { fork, execFile } = require('child_process');
const path = require('path');
const {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  REST,
  Routes,
  PermissionsBitField,
  ApplicationCommandOptionType
} = require('discord.js');
const derankUrgence = require('./derank-urgence.js');
const { resolveDotenvPath, PEBBLE_HOST_ENV_PATH, applyTestGuildOverride } = require(path.join(
  __dirname,
  '..',
  'blzbot-env.js'
));
require('dotenv').config({
  path: resolveDotenvPath(
    path.join(__dirname, '..', '.env'),
    PEBBLE_HOST_ENV_PATH,
    path.join(process.cwd(), '.env')
  ),
  quiet: true,
});
applyTestGuildOverride();

/** Racine du dépôt (parent de orchestrator/) */
const REPO_ROOT = path.join(__dirname, '..');

/** Délai entre chaque process forké (ms). 0 = tout lancer d’un coup. Défaut 400 ms. */
const FORK_DELAY_MS = Math.max(0, parseInt(process.env.BLZ_FORK_DELAY_MS || '400', 10));

const BOT_TOKEN = process.env.BOT_TOKEN;
const GUILD_ID = process.env.GUILD_ID;
const ALLOWED_ROLE_ID = '1335390733003259964';
const NOTIFICATION_CHANNEL_ID = '1343196193421000704';

// --- Auto-restart & crash reporting ---
const CRASH_REPORT_CHANNEL_ID = '1472248219072332008';
const CRASH_REPORT_GUILD_ID = '1287382398287216650';
const DEV_USER_ID = '965984018216665099';
const CRASH_WINDOW_MS = 10 * 60 * 1000; // 10 minutes
const MAX_CRASHES_IN_WINDOW = 2;

// scriptName -> [timestamp, timestamp, ...]
const crashHistory = new Map();
// scriptName -> accumulated stderr string
const stderrBuffers = new Map();

if (!BOT_TOKEN || !GUILD_ID) {
  console.error("BOT_TOKEN et/ou GUILD_ID manquant(s) dans le fichier .env.");
  process.exit(1);
}

// Initialisation du client Discord
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.GuildMembers]
});

/**
 * Registre unique : /settings et statuts. Par défaut on ne fork plus que modération + niveau
 * (évite plusieurs sessions Discord avec le même token — linkScanner/Bug/IA restent optionnels).
 * BLZ_FORK_SERVICES=moderation,niveau,ia | all | liste: checktoken,moderation,niveau,linkscanner,ia,bug
 */
const SCRIPT_REGISTRY = [
  { key: 'checktoken', name: 'workers/CheckToken.js', description: 'Vérif token (webhook)', status: 'inactive' },
  { key: 'moderation', name: 'modération/index.js', description: 'Modération V5', status: 'inactive' },
  { key: 'niveau', name: 'niveau/src/index.js', description: 'Bot principal (niveaux, économie)', status: 'inactive' },
  { key: 'linkscanner', name: 'workers/linkScanner.js', description: 'Scan des liens (2e session même token)', status: 'inactive' },
  { key: 'ia', name: 'ia/index.js', description: 'Module IA (GROQ_API_KEY requis)', status: 'inactive' },
  { key: 'bug', name: 'workers/Bug.js', description: 'Commande /bug (2e session même token)', status: 'inactive' },
];

function parseForkServiceKeys() {
  const raw = (process.env.BLZ_FORK_SERVICES || 'moderation,niveau,ia').trim().toLowerCase();
  if (!raw || raw === 'all' || raw === '*') return null;
  return new Set(raw.split(/[,;]/).map((k) => k.trim()).filter(Boolean));
}

const _forkKeys = parseForkServiceKeys();
const scriptsToRun = SCRIPT_REGISTRY.filter((s) => _forkKeys === null || _forkKeys.has(s.key));

if (scriptsToRun.length === 0) {
  console.error('[maintemp] BLZ_FORK_SERVICES ne correspond à aucun service connu. Clés: checktoken, moderation, niveau, linkscanner, ia, bug — ou "all".');
  process.exit(1);
}
console.log(`[maintemp] Services: ${scriptsToRun.map((s) => s.key).join(', ')}`);

// Stocke les processus enfants
const scriptProcesses = {};

function updateScriptStatus(scriptName, newStatus) {
  const script = SCRIPT_REGISTRY.find((s) => s.name === scriptName);
  if (script) script.status = newStatus;
}

// Envoie une notification dans le canal défini
function notifyScriptStatus(scriptName, statusMessage) {
  const channel = client.channels.cache.get(NOTIFICATION_CHANNEL_ID);
  if (channel) {
    channel.send(`Le script \`${scriptName}\` a été ${statusMessage}.`).catch(() => { });
  }
}

// Envoie le rapport de crash dans le salon dédié
async function sendCrashReport(scriptName, exitCode, stderrOutput) {
  try {
    const guild = client.guilds.cache.get(CRASH_REPORT_GUILD_ID);
    if (!guild) return;
    const channel = guild.channels.cache.get(CRASH_REPORT_CHANNEL_ID);
    if (!channel) return;

    const errorText = stderrOutput || 'Aucune sortie stderr capturée.';
    // Discord limite les messages à 2000 caractères, on split si nécessaire
    const header = `🔴 **Crash détecté** — \`${scriptName}\` (code ${exitCode})\n\n`;
    const fullMessage = header + '```\n' + errorText + '\n```';

    if (fullMessage.length <= 2000) {
      await channel.send(fullMessage);
    } else {
      // Envoyer le header puis l'erreur en chunks
      await channel.send(header);
      const chunks = errorText.match(/[\s\S]{1,1900}/g) || [];
      for (const chunk of chunks) {
        await channel.send('```\n' + chunk + '\n```');
      }
    }
  } catch (err) {
    console.error(`[maintemp] Erreur lors de l'envoi du rapport de crash pour ${scriptName}:`, err);
  }
}

// Envoie un MP au développeur quand un script crash trop souvent
async function notifyDevCrashLoop(scriptName) {
  try {
    const devUser = await client.users.fetch(DEV_USER_ID);
    await devUser.send(
      `⚠️ **Crash Loop détecté** — Le script \`${scriptName}\` a crashé **${MAX_CRASHES_IN_WINDOW} fois en moins de ${CRASH_WINDOW_MS / 60000} minutes**.\nLe script n'a **pas été relancé**. Vérifiez les logs.`
    );
  } catch (err) {
    console.error(`[maintemp] MP dev impossible (${scriptName}): ${err.message || err}`);
  }
}

// Vérifie si le script peut être relancé (pas plus de MAX_CRASHES_IN_WINDOW en CRASH_WINDOW_MS)
function canRestart(scriptName) {
  const now = Date.now();
  const history = crashHistory.get(scriptName) || [];
  // Ne garder que les crashs dans la fenêtre de temps
  const recent = history.filter(ts => now - ts < CRASH_WINDOW_MS);
  crashHistory.set(scriptName, recent);
  return recent.length < MAX_CRASHES_IN_WINDOW;
}

// Enregistre un crash pour le tracking
function recordCrash(scriptName) {
  const history = crashHistory.get(scriptName) || [];
  history.push(Date.now());
  crashHistory.set(scriptName, history);
}

/** Limite la taille des logs enfant (évite les murs de stack trace dans le terminal). */
function clipChildLog(text, maxChars = 3500) {
  const t = String(text).replace(/\r\n/g, '\n').trimEnd();
  if (t.length <= maxChars) return t;
  const head = t.slice(0, 1600);
  const tail = t.slice(-1400);
  return `${head}\n\n… (${t.length - 3000} caractères masqués) …\n\n${tail}`;
}

function runScript(scriptObj) {
  if (!scriptObj || !scriptObj.name) {
    console.error('[maintemp] Script invalide (nom manquant).');
    return;
  }
  const scriptName = scriptObj.name;
  if (process.env.BLZ_VERBOSE_FORK === '1') console.log(`▶ ${scriptName}`);

  const env = {
    ...process.env,
    DOTENV_CONFIG_QUIET: 'true',
    BLZ_COMPACT_LOG: '1',
    // Aligné avec niveau/src/utils/logger.js (compact → ERROR sauf BLZ_CHILD_LOG_LEVEL).
    LOG_LEVEL: process.env.BLZ_CHILD_LOG_LEVEL || 'ERROR',
    NODE_OPTIONS: process.env.NODE_OPTIONS
      ? `${process.env.NODE_OPTIONS} --no-deprecation`.trim()
      : '--no-deprecation',
  };
  // Ne plus désactiver le déploiement slash via BLZ_FAST_START : les nouvelles commandes (/panel-voc, etc.)
  // n’apparaissaient jamais sur Discord. Pour sauter le deploy au boot : SKIP_SLASH_DEPLOY_ON_START=1 explicitement.
  // Démarrage plus fluide : déploiement slash après le READY (défaut côté bot si non défini).
  if (
    (scriptName === 'niveau/src/index.js' || scriptName === 'modération/index.js') &&
    (env.BLZ_DEFER_SLASH_DEPLOY_MS === undefined || env.BLZ_DEFER_SLASH_DEPLOY_MS === '')
  ) {
    env.BLZ_DEFER_SLASH_DEPLOY_MS = '5000';
  }

  const proc = fork(path.join(REPO_ROOT, scriptName), [], {
    stdio: ['inherit', 'pipe', 'pipe', 'ipc'],
    env,
  });

  scriptProcesses[scriptName] = proc;
  updateScriptStatus(scriptName, 'running');
  stderrBuffers.set(scriptName, '');

  proc.stdout.on('data', (data) => {
    const out = clipChildLog(data.toString());
    if (out) console.log(`[${scriptName}] ${out}`);
  });
  proc.stderr.on('data', (data) => {
    const text = data.toString();
    console.error(`[${scriptName}] ${clipChildLog(text)}`);
    const current = stderrBuffers.get(scriptName) || '';
    const updated = current + text;
    stderrBuffers.set(scriptName, updated.length > 4000 ? updated.slice(-4000) : updated);
  });

  proc.on('message', message => {
    if (message.action === 'shutdown') {
      console.log(`[${scriptName}] Message "shutdown" reçu, arrêt du processus.`);
      proc.kill();
    }
  });

  proc.on('exit', async (code, signal) => {
    const stderrOutput = stderrBuffers.get(scriptName) || '';
    stderrBuffers.delete(scriptName);
    delete scriptProcesses[scriptName];

    if (signal) {
      updateScriptStatus(scriptName, 'stopped');
      notifyScriptStatus(scriptName, `arrêté avec le signal ${signal}`);
    } else if (code === 1) {
      // --- Crash avec code 1 : reporting + auto-restart ---
      updateScriptStatus(scriptName, 'error');
      console.error(`[${scriptName}] Crash (code 1) — rapport Discord…`);

      await sendCrashReport(scriptName, code, stderrOutput);
      recordCrash(scriptName);

      if (canRestart(scriptName)) {
        console.log(`[${scriptName}] Relance dans 5 s…`);
        notifyScriptStatus(scriptName, `crashé (code 1) — relancement automatique`);
        setTimeout(() => runScript(scriptObj), 5000);
      } else {
        console.error(`[${scriptName}] Trop de crashs — relance désactivée.`);
        notifyScriptStatus(scriptName, `crashé trop souvent — relancement désactivé`);
        await notifyDevCrashLoop(scriptName);
      }
    } else if (code !== 0) {
      updateScriptStatus(scriptName, 'error');
      notifyScriptStatus(scriptName, `arrêté avec le code ${code}`);
    } else {
      updateScriptStatus(scriptName, 'stopped');
    }
  });

  proc.on('error', error => {
    console.error(`[${scriptName}] Erreur dans le processus :`, error);
    updateScriptStatus(scriptName, 'error');
    notifyScriptStatus(scriptName, 'en erreur');
    stderrBuffers.delete(scriptName);
    delete scriptProcesses[scriptName];
  });
}

// Lancement des scripts avec un délai entre chaque
function runScriptsWithDelay(scripts, delay) {
  let index = 0;
  function runNext() {
    if (index >= scripts.length) return;
    runScript(scripts[index]);
    index++;
    setTimeout(runNext, delay);
  }
  runNext();
}

// Enregistrement des commandes slash
async function registerCommands() {
  const scriptChoices = SCRIPT_REGISTRY.map((s) => ({ name: s.name, value: s.name }));

  const commands = [
    {
      name: 'settings',
      description: 'Gérer les scripts',
      options: [
        {
          name: 'action',
          type: ApplicationCommandOptionType.String,
          description: 'Action à effectuer',
          required: true,
          choices: [
            { name: 'shutdown', value: 'shutdown' },
            { name: 'reboot', value: 'reboot' },
            { name: 'start', value: 'start' }
          ]
        },
        {
          name: 'script',
          type: ApplicationCommandOptionType.String,
          description: 'Nom du script ou "all"',
          required: true,
          choices: [
            ...scriptChoices,
            { name: 'all', value: 'all' }
          ]
        }
      ]
    },
    {
      name: 'settings-view',
      description: 'Voir l\'état des scripts'
    },
    {
      name: 'derank-urgence',
      description: "Lance une procédure de derank d'urgence pour un utilisateur.",
      options: [
        {
          name: 'utilisateur',
          type: ApplicationCommandOptionType.User,
          description: "L'utilisateur à derank.",
          required: true,
        },
      ],
    }
  ];

  const rest = new REST({ version: '10' }).setToken(BOT_TOKEN);
  try {
    if (!client.isReady()) {
      await new Promise((resolve) => client.once('clientReady', resolve));
    }

    const guild = await client.guilds.fetch(GUILD_ID);
    if (!guild) {
      console.error('[maintemp.js] ❌ Could not find guild');
      return;
    }

    // Récupérer les commandes existantes sur Discord
    const existingCommands = await guild.commands.fetch();
    const existingMap = new Map();
    existingCommands.forEach(cmd => existingMap.set(cmd.name, cmd));

    let createdCount = 0;
    let updatedCount = 0;
    let skippedCount = 0;
    let errorCount = 0;

    for (const command of commands) {
      try {
        const existing = existingMap.get(command.name);

        // Vérifier si la commande existe et n'a pas changé
        if (existing) {
          const remoteOpts = JSON.stringify(existing.options?.map(o => o.toJSON ? o.toJSON() : o) || []);
          const localOpts = JSON.stringify(command.options || []);
          if (existing.description === command.description && remoteOpts === localOpts) {
            skippedCount++;
            continue;
          }
        }

        const action = existing ? 'Updating' : 'Creating';
        if (existing) {
          await guild.commands.edit(existing.id, command);
        } else {
          await guild.commands.create(command);
        }
        if (existing) updatedCount++;
        else createdCount++;
      } catch (cmdError) {
        console.error(`[maintemp] /${command.name}: ${cmdError.message}`);
        errorCount++;
      }
    }

    if (process.env.BLZ_VERBOSE_FORK === '1') {
      console.log(`[maintemp] Slash orchestrateur — +${createdCount} ~${updatedCount} =${skippedCount} err:${errorCount}`);
    }
  } catch (err) {
    console.error('[maintemp.js] Erreur lors de l\'enregistrement des commandes :', err);
  }
}

// Gestion des interactions slash
client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  const { commandName, options } = interaction;

  // Commande /settings
  if (commandName === 'settings') {
    // Vérif d'autorisation uniquement pour /settings
    if (
      !interaction.member.permissions.has(PermissionsBitField.Flags.Administrator) &&
      !interaction.member.roles.cache.has(ALLOWED_ROLE_ID)
    ) {
      return interaction.reply('Vous n\'avez pas la permission d\'utiliser cette commande.');
    }

    const action = options.getString('action');
    const script = options.getString('script');

    if (action === 'shutdown') {
      if (script === 'all') {
        Object.values(scriptProcesses).forEach(p => p.kill());
        return interaction.reply('Tous les scripts ont été arrêtés.');
      }
      if (scriptProcesses[script]) {
        scriptProcesses[script].kill();
        return interaction.reply(`Le script ${script} a été arrêté.`);
      }
      return interaction.reply(`Le script ${script} n'est pas en cours d'exécution.`);
    }

    if (action === 'reboot') {
      if (script === 'all') {
        Object.keys(scriptProcesses).forEach(name => scriptProcesses[name].kill());
        setTimeout(() => runScriptsWithDelay(scriptsToRun, FORK_DELAY_MS), 3000);
        return interaction.reply('Tous les scripts ont été redémarrés.');
      }
      if (scriptProcesses[script]) {
        scriptProcesses[script].kill();
        setTimeout(() => {
          const obj = SCRIPT_REGISTRY.find((s) => s.name === script);
          if (obj) runScript(obj);
        }, 3000);
        return interaction.reply(`Le script ${script} a été redémarré.`);
      }
      const obj = SCRIPT_REGISTRY.find((s) => s.name === script);
      if (!obj) return interaction.reply('Script inconnu.');
      runScript(obj);
      return interaction.reply(`Le script ${script} n'était pas lancé — démarrage effectué.`);
    }

    if (action === 'start') {
      if (script === 'all') {
        const toStart = scriptsToRun.filter(s => !scriptProcesses[s.name]);
        if (toStart.length === 0) {
          return interaction.reply('Tous les scripts sont déjà en cours d\'exécution.');
        }
        runScriptsWithDelay(toStart, FORK_DELAY_MS);
        return interaction.reply('Les scripts non lancés ont été démarrés.');
      }
      if (scriptProcesses[script]) {
        return interaction.reply(`Le script ${script} fonctionne déjà.`);
      }
      const objStart = SCRIPT_REGISTRY.find((s) => s.name === script);
      if (!objStart) return interaction.reply('Script inconnu.');
      runScript(objStart);
      return interaction.reply(`Le script ${script} a été démarré.`);
    }

    return interaction.reply('Action ou script non reconnu.');
  }

  // Commande /settings-view
  if (commandName === 'settings-view') {
    // Vérif d'autorisation uniquement pour /settings-view
    if (
      !interaction.member.permissions.has(PermissionsBitField.Flags.Administrator) &&
      !interaction.member.roles.cache.has(ALLOWED_ROLE_ID)
    ) {
      return interaction.reply('Vous n\'avez pas la permission d\'utiliser cette commande.');
    }

    const embed = new EmbedBuilder()
      .setTitle('État des Scripts')
      .setDescription('Liste des scripts et leur état actuel :')
      .setColor(0x00AE86);

    SCRIPT_REGISTRY.forEach((s) => {
      const running = scriptProcesses[s.name] ? 'running' : s.status;
      embed.addFields({
        name: s.name,
        value: `Description: ${s.description}\nÉtat: ${running}`,
      });
    });

    return interaction.reply({ embeds: [embed] });
  }

  // Ici, toutes les autres commandes sont libres d'accès
});

/**
 * Re-pousse toutes les slash (niveau + modération) via npm — utile si SKIP_SLASH ou déploiement raté sur un enfant.
 * Désactive : BLZ_AUTO_DEPLOY_SLASH=0
 */
function scheduleSlashSyncFromOrchestrator() {
  const raw = process.env.BLZ_AUTO_DEPLOY_SLASH;
  const disabled = ['0', 'false', 'no', 'off'].includes(String(raw || '').toLowerCase());
  if (disabled) return;

  const delay = Math.max(2000, parseInt(process.env.BLZ_AUTO_DEPLOY_SLASH_DELAY_MS || '15000', 10));
  const deployScript = path.join(REPO_ROOT, 'scripts', 'run-deploy-all.js');
  console.log(
    `[maintemp] Dans ${Math.round(delay / 1000)}s → node scripts/run-deploy-all.js (niveau + modération, sans npm). Couper : BLZ_AUTO_DEPLOY_SLASH=0`
  );

  setTimeout(() => {
    execFile(
      process.execPath,
      [deployScript],
      { cwd: REPO_ROOT, env: process.env, maxBuffer: 4 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (stdout) process.stdout.write(stdout);
        if (stderr) process.stderr.write(stderr);
        if (err) console.error('[maintemp] run-deploy-all.js —', err.message);
        else console.log('[maintemp] run-deploy-all.js terminé.');
      }
    );
  }, delay);
}

// Au démarrage du bot
client.once('clientReady', async () => {
  await registerCommands();
  derankUrgence.initialize(client);
  runScriptsWithDelay(scriptsToRun, FORK_DELAY_MS);
  scheduleSlashSyncFromOrchestrator();
  console.log(
    `[maintemp] ${client.user.tag} · orchestrateur prêt · forks ${FORK_DELAY_MS}ms — ${scriptsToRun.map((s) => s.key).join(', ')}`
  );
});

client.login(BOT_TOKEN);
