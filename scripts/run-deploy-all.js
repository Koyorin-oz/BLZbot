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
const { loadBlzbotEnvFiles, applyTestGuildOverride } = require(path.join(__dirname, '..', 'blzbot-env.js'));
const { assertRebornSlashReady } = require(path.join(__dirname, 'reborn-slash-preflight.js'));

loadBlzbotEnvFiles(path.join(__dirname, '..'));
applyTestGuildOverride();

const rebornPre = assertRebornSlashReady({ exitOnFail: false });
if (rebornPre.ok && !rebornPre.skipped) {
    blzLine('deploy', `REBORN ${rebornPre.count} cmd prêtes (/salon-hacker inclus)`);
} else if (!rebornPre.skipped && !rebornPre.ok) {
    blzError('deploy', rebornPre.message || 'REBORN absent');
    blzError('deploy', 'Deploy annulé — vérifie le dossier reborn-test-bot/ puis redémarre le serveur Pebble.');
    process.exit(1);
}

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

    const appId = client.application?.id;
    const wantId = String(process.env.CLIENT_ID || '').trim();
    if (wantId && appId && wantId !== appId) {
        blzError(
            'deploy',
            `BOT_TOKEN pointe vers l'app ${appId}, pas CLIENT_ID=${wantId}. Corrige le .env avant deploy.`,
        );
        process.exit(1);
    }
    if (!isCompact()) {
        console.log(
            `[deploy-all] Connecté : ${client.user.tag} · app ${appId || '?'} · GUILD_ID=${process.env.GUILD_ID}\n`,
        );
    } else {
        blzLine('deploy', `Connecté ${client.user.tag} · app ${appId || '?'}`);
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
