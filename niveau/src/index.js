const path = require('node:path');
const { resolveDotenvPath, PEBBLE_HOST_ENV_PATH, applyTestGuildOverride } = require(path.join(
    __dirname,
    '..',
    '..',
    'blzbot-env.js'
));
require('dotenv').config({
    path: resolveDotenvPath(
        path.join(__dirname, '..', '..', '.env'),
        PEBBLE_HOST_ENV_PATH,
        path.join(process.cwd(), '.env')
    ),
    quiet: true,
});
applyTestGuildOverride();

const logger = require('./utils/logger');
const fs = require('node:fs');
const { Client, Collection, GatewayIntentBits } = require('discord.js');
const { getEventState } = require('./utils/db-halloween');
const { initializeSharesSystem } = require('./utils/ranked-shares');
const { loadTopLevelCommands, loadSeasonalCommands } = require('./utils/command-loader');
const { registerClientReady } = require('./bootstrap/client-ready');

initializeSharesSystem();

const isHalloweenActive = getEventState('halloween');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMessageReactions
    ]
});

client.commands = new Collection();
loadTopLevelCommands(client);
loadSeasonalCommands(client);

const eventsPath = path.join(__dirname, 'events');
const eventFiles = fs.readdirSync(eventsPath).filter((file) => file.endsWith('.js'));
const eventCount = eventFiles.length;

for (const file of eventFiles) {
    const filePath = path.join(eventsPath, file);
    const event = require(filePath);
    if (event.once) {
        client.once(event.name, (...args) => event.execute(...args, client));
    } else {
        client.on(event.name, (...args) => event.execute(...args, client));
    }
}

registerClientReady(client, { isHalloweenActive });

const deployCommands = require('./utils/deploy-commands');

const BLZ_COMPACT = process.env.BLZ_COMPACT_LOG === '1';

const skipSlashDeployEnv = ['1', 'true', 'yes'].includes(
    String(process.env.SKIP_SLASH_DEPLOY_ON_START || '').toLowerCase()
);
if (skipSlashDeployEnv) {
    console.warn(
        '[niveau] SKIP_SLASH_DEPLOY_ON_START est activé : aucune commande slash ne sera enregistrée au démarrage. ' +
            'Mets 0 ou supprime la variable, ou lance : npm run deploy:commands'
    );
}

(async () => {
    if (!BLZ_COMPACT) logger.info('✅ Commandes des événements chargées');

    await new Promise((resolve) => {
        client.once('clientReady', () => {
            resolve();
        });
        client.login(process.env.BOT_TOKEN);
    });

    const cmdCount = client.commands.size;
    if (BLZ_COMPACT) {
        console.log(`[niveau] ${client.user.tag} — ${cmdCount} cmd · ${eventCount} événements`);
    }

    /** Déploiement slash tout de suite par défaut (ancien défaut 5s en compact retardait /panel-voc, etc.). */
    const rawDefer = process.env.BLZ_DEFER_SLASH_DEPLOY_MS;
    let slashDeferMs =
        rawDefer !== undefined && rawDefer !== '' ? parseInt(rawDefer, 10) : 0;
    if (!Number.isFinite(slashDeferMs) || slashDeferMs < 0) slashDeferMs = 0;

    const runSlashDeploy = async () => {
        if (skipSlashDeployEnv) {
            const skipMsg =
                'Déploiement slash DÉSACTIVÉ (SKIP_SLASH_DEPLOY_ON_START). Les nouvelles commandes (/panel-voc, etc.) ne seront pas sur Discord. Mets SKIP_SLASH_DEPLOY_ON_START=0 ou lance depuis la machine locale: npm run deploy:commands';
            console.warn(`[niveau] ${skipMsg}`);
            logger.warn(skipMsg);
            return;
        }
        try {
            await deployCommands(client);
            if (!BLZ_COMPACT) logger.info('✅ Commandes déployées avec succès');
        } catch (error) {
            const msg =
                error.code === 10004
                    ? 'GUILD_ID inconnu — mets l’ID du serveur où le bot est invité (même valeur que modération/.env si besoin).'
                    : error.message || String(error);
            console.error(`[niveau] ❌ Déploiement slash: ${msg}`);
            logger.error(`❌ Déploiement slash: ${msg}`);
        }
    };

    if (slashDeferMs > 0) {
        console.log(`[niveau] Déploiement slash dans ${slashDeferMs / 1000}s (BLZ_DEFER_SLASH_DEPLOY_MS)…`);
        setTimeout(() => {
            runSlashDeploy().catch((e) => logger.error(`[niveau] Slash: ${e?.message || e}`));
        }, slashDeferMs);
    } else {
        await runSlashDeploy();
    }
})();
