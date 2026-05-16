/**
 * Déploie les slash niveau + modération en une seule session (un seul login Discord).
 * Ne dépend pas de `npm` dans le PATH — à utiliser sur PebbleHost / hébergeurs minimalistes.
 *
 * Usage : node scripts/run-deploy-all.js
 *         (racine du dépôt, même .env que le bot : /home/container/.env sur Pebble)
 */
const path = require('node:path');
const { applyGlobalLogPolicy, isCompact, blzLine, blzError } = require(path.join(__dirname, '..', 'blz-log.js'));
applyGlobalLogPolicy();
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
require('dotenv').config({ path: path.join(__dirname, '..', 'modération', '.env'), quiet: true, override: true });
applyTestGuildOverride();

if (!isCompact()) {
    console.log(
        '[deploy-all] Démarrage — si rien ne s’affiche pendant ~10s, c’est normal (chargement SQLite / modules).'
    );
    console.log(
        '[deploy-all] Déploiement : modération (src/utils/deploy-slash-commands) + niveau (src/utils/deploy-commands).'
    );
} else {
    blzLine('deploy', 'Slash niveau + modération…');
}

const { Client, GatewayIntentBits } = require('discord.js');
const deployNiveau = require(path.join(__dirname, '..', 'niveau', 'src', 'utils', 'deploy-commands'));
const config = require(path.join(__dirname, '..', 'modération', 'src', 'config.js'));
const { deployModerationSlashCommands } = require(path.join(__dirname, '..', 'modération', 'src', 'utils', 'deploy-slash-commands.js'));

async function main() {
    const token = process.env.BOT_TOKEN || config.BOT_TOKEN;
    if (!token) {
        blzError('deploy', 'BOT_TOKEN manquant dans le .env');
        process.exit(1);
    }
    if (!process.env.GUILD_ID) {
        blzError('deploy', 'GUILD_ID manquant');
        process.exit(1);
    }

    const client = new Client({ intents: [GatewayIntentBits.Guilds] });

    await new Promise((resolve, reject) => {
        client.once('clientReady', resolve);
        client.once('error', reject);
        client.login(token);
    });

    if (!isCompact()) {
        console.log(`[deploy-all] Connecté : ${client.user.tag} (GUILD_ID=${process.env.GUILD_ID})\n`);
    }

    try {
        if (!isCompact()) console.log('[deploy-all] 1/2 — bot niveau…');
        await deployNiveau(client);
        if (!isCompact()) console.log('[deploy-all] 2/2 — bot modération…');
        await deployModerationSlashCommands(client, config, { compact: isCompact() });
    } finally {
        client.destroy();
    }

    blzLine('deploy', 'Terminé — slash à jour sur Discord');
}

main().catch((err) => {
    blzError('deploy', 'Échec', err);
    process.exit(1);
});
