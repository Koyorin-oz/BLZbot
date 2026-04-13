const path = require('path');
const { resolveDotenvPath, PEBBLE_HOST_ENV_PATH } = require(path.join(__dirname, '..', 'blzbot-env.js'));
require('dotenv').config({
    path: resolveDotenvPath(
        path.resolve(__dirname, '../.env'),
        PEBBLE_HOST_ENV_PATH,
        path.join(process.cwd(), '.env')
    ),
    quiet: true,
});

if (!process.env.GEMINI_API_KEY) {
    console.log(
        '[ia] Pas de GEMINI_API_KEY — module IA non démarré (obligatoire : l’IA utilise Gemini ; GROQ_API_KEY reste optionnel pour les modèles Groq du panneau).'
    );
    process.exit(0);
}

const { Client, GatewayIntentBits, Partials } = require('discord.js');
const { handleMessageCreate, handleInteractionCreate } = require('./handlers.js');
const utils = require('./utils.js');
const config = require('./config.js');

const activeThreads = new Map();

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
    ],
    partials: [Partials.Channel],
});

client.once('clientReady', async (c) => {
    utils.log(`${c.user.tag} est prêt.`);
    config.clientUser = c.user; // Make client.user available in config for utils

    if (typeof utils.loadUserSettings === 'function') {
        utils.loadUserSettings();
    } else {
        utils.log('ERREUR CRITIQUE: loadUserSettings n\'est pas une fonction dans utils.js');
    }

    if (typeof utils.loadQuotas === 'function') {
        utils.loadQuotas();
    }

    if (typeof utils.loadAndGenerateKnowledgeBaseEmbeddings === 'function') {
        await utils.loadAndGenerateKnowledgeBaseEmbeddings();
    }

    if (typeof utils.setupPanelIfNeeded === 'function') {
        await utils.setupPanelIfNeeded(client);
    }

    const commands = [{ name: 'ia', description: 'Gère les paramètres du bot.', options: [{ name: 'settings', description: 'Ouvre le panneau de configuration.', type: 1 }] }];
    try {
        for (const cmd of commands) {
            await client.application.commands.create(cmd);
        }
        utils.log('Commandes slash enregistrées (mode additif).');
    } catch (error) { utils.log(`Erreur enregistrement commandes: ${error}`); }

    setInterval(() => {
        utils.archiveOldThreads(client);
    }, 3 * 60 * 60 * 1000); // 3 hours
});
client.on('messageCreate', async (message) => handleMessageCreate(message, client, activeThreads));
client.on('interactionCreate', async (interaction) => handleInteractionCreate(interaction, client, activeThreads));

client.login(process.env.BOT_TOKEN);