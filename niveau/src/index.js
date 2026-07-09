const path = require('node:path');
const {
    resolveDotenvPath,
    PEBBLE_HOST_ENV_PATH,
    applyTestGuildOverride,
    isOrchestratorSlashDeployEnabled,
} = require(path.join(__dirname, '..', '..', 'blzbot-env.js'));
require('dotenv').config({
    path: resolveDotenvPath(
        path.join(__dirname, '..', '..', '.env'),
        PEBBLE_HOST_ENV_PATH,
        path.join(process.cwd(), '.env')
    ),
    quiet: true,
});
applyTestGuildOverride();

// Gardes anti-crash : on log sans tuer le process pour qu'une interaction/donnée
// malformée (ex. abus depuis Discord) ne fasse pas tomber le bot principal.
process.on('unhandledRejection', (reason) => {
    try {
        require('./utils/logger').error(
            '[niveau] unhandledRejection: ' + (reason?.stack || reason?.message || reason),
        );
    } catch {
        console.error('[niveau] unhandledRejection:', reason);
    }
});
process.on('uncaughtException', (err) => {
    try {
        require('./utils/logger').error(
            '[niveau] uncaughtException: ' + (err?.stack || err?.message || err),
        );
    } catch {
        console.error('[niveau] uncaughtException:', err);
    }
});

const logger = require('./utils/logger');
const fs = require('node:fs');
const { Client, Collection, GatewayIntentBits } = require('discord.js');
const { getEventState } = require('./utils/db-halloween');
const { initializeSharesSystem } = require('./utils/ranked-shares');
const {
    loadTopLevelCommands,
    loadSeasonalCommands,
    loadRebornSlashCommands,
} = require('./utils/command-loader');
const { registerClientReady } = require('./bootstrap/client-ready');
const { startScheduler: startMemberStatsVoiceScheduler, loadState: loadMemberStatsVoiceState } = require('./utils/member-stats-voice');

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
const rebornIntegration = require('./utils/reborn-integration');
const rebornLoaded = loadRebornSlashCommands(client);
if (rebornIntegration.isEnabled()) {
    if (!rebornIntegration.rebornAvailable()) {
        console.error(
            '[niveau] REBORN : dossier reborn-test-bot/src absent — git pull requis. Aucune commande /salon-hacker, /itemindex, etc.',
        );
    } else if (rebornLoaded === 0) {
        console.error(
            '[niveau] REBORN : 0 commande chargée — vérifie que reborn-test-bot/ est sur le serveur (logs Pebble au démarrage).',
        );
    } else if (process.env.BLZ_COMPACT_LOG !== '1') {
        logger.info(`[reborn] ${rebornLoaded} commande(s) actives (écrasent les homonymes niveau).`);
    }
}
rebornIntegration.bootstrap(client);

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
            'Mets SKIP_SLASH_DEPLOY_ON_START=0 dans le .env (Pebble File Manager) puis redémarre le serveur.'
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

    if (Object.keys(loadMemberStatsVoiceState()).length > 0) {
        startMemberStatsVoiceScheduler(client);
    }

    const cmdCount = client.commands.size;
    if (BLZ_COMPACT) {
        const { blzLine } = require(path.join(__dirname, '..', '..', 'blz-log.js'));
        blzLine('niveau', `ready · ${client.user.tag} · ${cmdCount} cmd`);
    } else {
        console.log(`[niveau] ${client.user.tag} — ${cmdCount} cmd · ${eventCount} événements`);
    }

    /** Déploiement slash tout de suite par défaut (ancien défaut 5s en compact retardait /panel-voc, etc.). */
    const rawDefer = process.env.BLZ_DEFER_SLASH_DEPLOY_MS;
    let slashDeferMs =
        rawDefer !== undefined && rawDefer !== '' ? parseInt(rawDefer, 10) : 0;
    if (!Number.isFinite(slashDeferMs) || slashDeferMs < 0) slashDeferMs = 0;

    const runSlashDeploy = async () => {
        if (
            ['1', 'true', 'yes'].includes(String(process.env.BLZ_SKIP_CHILD_SLASH_DEPLOY || '').toLowerCase()) ||
            isOrchestratorSlashDeployEnabled()
        ) {
            if (!BLZ_COMPACT) {
                console.log(
                    '[niveau] Slash : orchestrateur (run-deploy-all) — pas de deploy ici (évite conflit modération).',
                );
            }
            return;
        }
        if (skipSlashDeployEnv) {
            const skipMsg =
                'Déploiement slash DÉSACTIVÉ (SKIP_SLASH_DEPLOY_ON_START). Mets SKIP_SLASH_DEPLOY_ON_START=0 dans le .env et redémarre Pebble, ou utilise /deploy-slash (admin) une fois disponible.';
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
        if (!BLZ_COMPACT) {
            console.log(`[niveau] Déploiement slash dans ${slashDeferMs / 1000}s (BLZ_DEFER_SLASH_DEPLOY_MS)…`);
        }
        setTimeout(() => {
            runSlashDeploy().catch((e) => logger.error(`[niveau] Slash: ${e?.message || e}`));
        }, slashDeferMs);
    } else {
        await runSlashDeploy();
    }

    /** Secours REBORN guilde : l’orchestrateur peut échouer silencieusement (OOM) ou la modération effaçait les slash. */
    if (isOrchestratorSlashDeployEnabled()) {
        const rebornBackupMs = Math.max(
            45000,
            parseInt(process.env.BLZ_REBORN_GUILD_BACKUP_MS || '120000', 10),
        );
        setTimeout(() => {
            deployCommands
                .deployRebornGuildSlashOnly(client, { compact: BLZ_COMPACT })
                .catch((e) => console.error('[niveau] REBORN secours guilde:', e?.message || e));
        }, rebornBackupMs);
        if (!BLZ_COMPACT) {
            console.log(
                `[niveau] REBORN secours guilde dans ${Math.round(rebornBackupMs / 1000)}s (BLZ_REBORN_GUILD_BACKUP_MS).`,
            );
        }
    }
})();
