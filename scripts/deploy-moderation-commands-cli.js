/**
 * Déploie les slash commands du bot modération (sans lancer tout le bot).
 * Usage : npm run deploy:commands:moderation
 * Prérequis : BOT_TOKEN, GUILD_ID (racine .env + override modération/.env comme le bot).
 */
const path = require('node:path');
const {
    resolveDotenvPath,
    PEBBLE_HOST_ENV_PATH,
    applyTestGuildOverride,
    getSlashDeployGuildIds,
} = require(path.join(__dirname, '..', 'blzbot-env.js'));

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

const { Client, GatewayIntentBits } = require('discord.js');
const config = require(path.join(__dirname, '..', 'modération', 'src', 'config.js'));
const { deployModerationSlashCommands } = require(path.join(__dirname, '..', 'modération', 'src', 'utils', 'deploy-slash-commands.js'));

async function main() {
    const token = config.BOT_TOKEN;
    if (!token) {
        console.error('❌ BOT_TOKEN manquant (racine .env ou modération/.env).');
        process.exit(1);
    }
    if (!config.GUILD_ID) {
        console.error('❌ GUILD_ID manquant.');
        process.exit(1);
    }

    const client = new Client({ intents: [GatewayIntentBits.Guilds] });

    await new Promise((resolve, reject) => {
        client.once('clientReady', resolve);
        client.once('error', reject);
        client.login(token);
    });

    console.log(`✅ Connecté : ${client.user.tag}`);
    console.log(
        `[modération] Guildes slash : ${getSlashDeployGuildIds().join(', ') || config.GUILD_ID} (GUILD_ID + BLZ_MAIN_GUILD_ID)\n`
    );

    try {
        await deployModerationSlashCommands(client, config, { compact: false });
        console.log(
            '\n💡 /profil-staff : réponse visible par tout le monde dans le salon. Pour prod + test : BLZ_MAIN_GUILD_ID dans le .env, bot invité sur les deux serveurs, puis relance ce script.'
        );
    } finally {
        client.destroy();
    }
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
