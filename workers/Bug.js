const path = require('path');
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
const { Client, GatewayIntentBits, Partials, REST, Routes, SlashCommandBuilder } = require('discord.js');
const { creerIssueGitHub } = require('../niveau/src/utils/github-issues');


if (!process.env.BOT_TOKEN) {
    console.error('Error: BOT_TOKEN is not set in .env file');
    process.exit(1);
}

const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.DirectMessages],
    partials: [Partials.Channel]
});

client.once('clientReady', async () => {
    console.log('[Bug] Ready');

    const guildId = process.env.GUILD_ID;
    const rest = new REST({ version: '10' }).setToken(process.env.BOT_TOKEN);

    const bugCommand = new SlashCommandBuilder()
        .setName('bug')
        .setDescription('Signale un bug.')
        .addStringOption(option =>
            option.setName('titre')
                .setDescription('Titre du bug')
                .setRequired(true)
        )
        .addStringOption(option => 
            option.setName('bug')
                .setDescription('Description du bug')
                .setRequired(true)
        );

    if (!guildId) {
        console.warn('[Bug] GUILD_ID manquant — /bug non enregistré.');
        return;
    }

    try {
        await rest.post(
            Routes.applicationGuildCommands(client.user.id, guildId),
            { body: bugCommand.toJSON() }
        );
        console.log('[Bug] Commande /bug enregistrée.');
    } catch (error) {
        if (error.code === 50001 || error.code === 10004) {
            console.warn(
                `[Bug] /bug non enregistré (${error.code}): bot sans accès à cette guilde ou GUILD_ID invalide.`
            );
        } else {
            console.error('[Bug]', error.message || error);
        }
    }
});

client.on('interactionCreate', async interaction => {
    if (!interaction.isCommand()) return;

    const { commandName, options } = interaction;

    if (commandName === 'bug') {
        const bugTitle = options.getString('titre');
        const bugDescription = options.getString('bug');
        const reporter = interaction.user;

        const issueTitle = `🐛 ${bugTitle}`;
        const issueBody = [
            `### Bug signalé depuis Discord`,
            '',
            `**Reporter :** ${reporter.tag} (${reporter.id})`,
            `**Date :** ${new Date().toISOString()}`,
            '',
            '### Description',
            bugDescription
        ].join('\n');

        try {
            const resultat = await creerIssueGitHub({ title: issueTitle, body: issueBody });
            await interaction.reply({
                content: `✅ Bug envoyé au developper avec succès (note : veuillez ne pas envoyer plusieurs fois le même bug.)`,
                ephemeral: true
            });
        } catch (error) {
            console.error('Erreur lors de la création de l\'issue GitHub :', error);
            await interaction.reply({
                content: '❌ Une erreur est survenue lors de la création de l\'issue GitHub.',
                ephemeral: true
            });
        }
    }
});

client.login(process.env.BOT_TOKEN);
