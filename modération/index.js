const path = require('path');
const { resolveDotenvPath, PEBBLE_HOST_ENV_PATH, applyTestGuildOverride } = require(path.join(
    __dirname,
    '..',
    'blzbot-env.js'
));
// Racine du repo puis modération/.env (override) pour que GUILD_ID soit cohérent même si cwd ≠ modération/
require('dotenv').config({
    path: resolveDotenvPath(
        path.join(__dirname, '..', '.env'),
        PEBBLE_HOST_ENV_PATH,
        path.join(process.cwd(), '.env')
    ),
    quiet: true,
});
require('dotenv').config({ path: path.join(__dirname, '.env'), quiet: true, override: true });
applyTestGuildOverride();

const { Client, GatewayIntentBits, Partials, Collection } = require('discord.js');
const { REST, Routes } = require('discord.js');
const schedule = require('node-schedule');
const fs = require('fs');

// Configuration
const config = require('./src/config');

/** Sous orchestrateur : BLZ_COMPACT_LOG=1 → moins de logs au chargement / déploiement slash. */
const BLZ_COMPACT = process.env.BLZ_COMPACT_LOG === '1';

// Modules 
const dbManager = require('./src/modules/database'); // Singleton déjà instancié
const VoteManager = require('./src/modules/votes');
const SnipeManager = require('./src/modules/snipe');
const RecruitmentManager = require('./src/modules/recruitment');
const Scheduler = require('./src/modules/scheduler');
const AntiRaidManager = require('./src/modules/antiraid');
const { deployModerationSlashCommands } = require('./src/utils/deploy-slash-commands');
const { handleTicketBridgeMessage } = require('./src/events/ticketBridge');
const { ensureTicketPanelIfMissing } = require('./src/utils/ticket-panel-payload');
const { installVerificationSystem } = require('./src/lib/verification');

// Création du client Discord
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildModeration,
        GatewayIntentBits.GuildInvites,
        GatewayIntentBits.GuildEmojisAndStickers,
    ],
    partials: [Partials.Channel, Partials.Message],
});

// Initialisation des modules
const voteManager = new VoteManager();
const snipeManager = new SnipeManager();
const recruitmentManager = new RecruitmentManager();
let scheduler; // Sera initialisé quand le bot sera prêt
let antiRaidManager; // Sera initialisé quand le bot sera prêt

// Collections pour les commandes et événements
client.commands = new Collection();

/**
 * Chargement des commandes
 */
function loadCommands() {
    const commandFiles = fs
        .readdirSync(path.join(__dirname, 'src/commands'))
        .filter((file) => file.endsWith('.js') && !file.endsWith('-ancien.js'));
    let n = 0;
    for (const file of commandFiles) {
        const command = require(`./src/commands/${file}`);
        if (command.data && command.execute) {
            client.commands.set(command.data.name, command);
            n++;
            if (!BLZ_COMPACT) console.log(`✓ Commande chargée: ${command.data.name}`);
        }
    }
    return n;
}

/**
 * Chargement des événements
 */
function loadEvents() {
    const eventFiles = fs.readdirSync(path.join(__dirname, 'src/events')).filter(file => file.endsWith('.js'));

    // Fichiers d'événements gérés manuellement dans interactionCreate (ne pas charger automatiquement)
    const manuallyHandledEvents = ['buttonInteraction.js', 'modalSubmit.js', 'applyModeratorButton.js', 'loggingEvents.js', 'ticketButtons.js', 'welcome.js'];
    let loaded = 0;
    for (const file of eventFiles) {
        // Ignorer les événements gérés manuellement
        if (manuallyHandledEvents.includes(file)) {
            if (!BLZ_COMPACT) console.log(`⊘ Événement ignoré (géré manuellement): ${file}`);
            continue;
        }

        const event = require(`./src/events/${file}`);
        if (event.name && event.execute) {
            if (event.once) {
                client.once(event.name, (...args) => event.execute(...args, { dbManager, voteManager, snipeManager, recruitmentManager, config }));
            } else {
                client.on(event.name, (...args) => event.execute(...args, { dbManager, voteManager, snipeManager, recruitmentManager, config }));
            }
            loaded++;
            if (!BLZ_COMPACT) console.log(`✓ Événement chargé: ${event.name}`);
        }
    }
    return loaded;
}

/**
 * Enregistrement des commandes slash
 */
async function registerCommands() {
    try {
        await deployModerationSlashCommands(client, config, { compact: BLZ_COMPACT });
    } catch (error) {
        const msg = error.code === 10004 ? 'Unknown Guild (vérifie GUILD_ID).' : (error.message || String(error));
        console.error('❌ Modération — commandes slash:', msg);
    }
}

/**
 * Event: Bot prêt
 */
client.once('clientReady', async () => {
    if (!BLZ_COMPACT) {
        console.log('═══════════════════════════════════════════════════════');
        console.log(`✓ Bot connecté en tant que ${client.user.tag}`);
        console.log('═══════════════════════════════════════════════════════');
    }

    // ⭐ NOUVEAU - Initialiser le Scheduler pour les votes automatiques et refresh des chances
    scheduler = new Scheduler(client, voteManager, dbManager);

    // Programmation des tâches planifiées (anciennes)
    schedule.scheduleJob('0 * * * *', () => checkModoTestPeriod());
    schedule.scheduleJob('*/10 * * * *', () => checkVotesPeriod());
    schedule.scheduleJob('*/5 * * * *', () => restoreExpiredRoles()); // Vérifier les rôles à restaurer toutes les 5 minutes
    schedule.scheduleJob('*/30 * * * *', () => checkExpiredBans()); // Vérifier les bans expirés toutes les 30 minutes
    schedule.scheduleJob('0 0 * * *', () => cleanupExpiredWarns()); // Nettoyage des warns expirés chaque jour à minuit
    schedule.scheduleJob('*/10 * * * *', () => checkExpiredAbsences()); // Vérifier les absences expirées toutes les 10 minutes
    schedule.scheduleJob('*/15 * * * *', () => checkPendingDebanRequests()); // Demandes de deban en attente (toutes les 15 min)
    schedule.scheduleJob('0 4 * * *', () => voteManager.purgeExpiredDebanCooldowns()); // Purge cooldowns deban expirés (1×/jour)

    if (!BLZ_COMPACT) {
        console.log('✓ Tâches planifiées configurées');
        console.log('═══════════════════════════════════════════════════════');
    }

    // Au boot : rattraper les demandes de deban en attente qui sont devenues éligibles pendant l'offline
    // + purger les cooldowns expirés.
    try {
        const processed = await voteManager.processPendingDebanRequests(client);
        if (processed > 0) console.log(`[Deban] Boot : ${processed} demande(s) en attente rattrapée(s).`);
        const purged = voteManager.purgeExpiredDebanCooldowns();
        if (purged > 0) console.log(`[Deban] Boot : ${purged} cooldown(s) expiré(s) purgé(s).`);
    } catch (error) {
        console.error('[Deban] Erreur rattrapage au boot:', error);
    }

    try {
        await ensureTicketPanelIfMissing(client);
    } catch (e) {
        console.error('[Tickets] Panneau auto au boot:', e?.message || e);
    }
});

/**
 * Event: Nouveau membre (système de bienvenue)
 */
client.on('guildMemberAdd', async member => {
    try {
        const welcomeModule = require('./src/events/welcome');
        await welcomeModule.handleMemberJoin(member);
    } catch (error) {
        console.error('[Welcome] Erreur:', error);
    }

    // --- Attribution des auto-roles ---
    try {
        if (member.user.bot) return;
        const autoRolesPath = path.join(__dirname, 'src', 'data', 'auto-roles.json');
        if (!fs.existsSync(autoRolesPath)) return;
        const autoRoles = JSON.parse(fs.readFileSync(autoRolesPath, 'utf-8'));
        for (const entry of autoRoles) {
            const role = member.guild.roles.cache.get(entry.roleId);
            if (role && !member.roles.cache.has(role.id)) {
                await member.roles.add(role, 'Auto-role : nouveau membre').catch(err =>
                    console.error(`[Auto-role] Erreur attribution ${role.name} à ${member.user.tag}:`, err)
                );
            }
        }
    } catch (error) {
        console.error('[Auto-role] Erreur:', error);
    }
});

/**
 * Event: Mise à jour d'un membre (détection de fin de timeout)
 */
client.on('guildMemberUpdate', async (oldMember, newMember) => {
    // Vérifier si le timeout a été levé
    if (oldMember.communicationDisabledUntilTimestamp && !newMember.communicationDisabledUntilTimestamp) {
        const dbTempRemovedRoles = dbManager.getTempRemovedRolesDb();

        // Restaurer les rôles qui étaient temporairement retirés
        dbTempRemovedRoles.all(
            'SELECT * FROM temp_removed_roles WHERE userId = ?',
            [newMember.id],
            async (err, rows) => {
                if (err || !rows || rows.length === 0) return;

                for (const row of rows) {
                    try {
                        const role = newMember.guild.roles.cache.get(row.roleId);
                        if (role && !newMember.roles.cache.has(row.roleId)) {
                            await newMember.roles.add(role, 'Restauration automatique après fin de timeout');
                            console.log(`✅ Rôle ${role.name} restauré automatiquement pour ${newMember.user.tag}`);
                        }

                        // Supprimer l'entrée de la base de données
                        dbTempRemovedRoles.run(
                            'DELETE FROM temp_removed_roles WHERE userId = ? AND roleId = ?',
                            [newMember.id, row.roleId]
                        );
                    } catch (error) {
                        console.error('Erreur lors de la restauration automatique d\'un rôle:', error);
                    }
                }
            }
        );
    }
});

/**
 * Event: Messages supprimés (pour snipe)
 */
client.on('messageDelete', async message => {
    if (message.partial) {
        try {
            message = await message.fetch();
        } catch {
            return;
        }
    }
    snipeManager.onMessageDelete(message);
});

/**
 * Event: Messages édités (pour esnipe)
 */
client.on('messageUpdate', async (oldMsg, newMsg) => {
    if (oldMsg.partial) {
        try {
            oldMsg = await oldMsg.fetch();
            newMsg = await newMsg.fetch();
        } catch {
            return;
        }
    }
    snipeManager.onMessageUpdate(oldMsg, newMsg);
});

/**
 * Event: Messages créés (pour commandes préfixe comme !snipe et anti-spam)
 */
// Stockage temporaire des messages par utilisateur pour détecter le spam
const userMessageHistory = new Map();

client.on('messageCreate', async message => {
    if (!message.guild) return;

    try {
        const consumed = await handleTicketBridgeMessage(message);
        if (consumed) return;
    } catch (e) {
        console.error('[TicketBridge]', e?.message || e);
    }

    if (message.author.bot) return;

    const userId = message.author.id;
    const messageContent = message.content.trim().toLowerCase();
    const now = Date.now();

    // ===== SYSTÈME ANTI-SPAM =====
    if (messageContent.length > 0) {
        // Récupérer l'historique de l'utilisateur
        if (!userMessageHistory.has(userId)) {
            userMessageHistory.set(userId, []);
        }
        const history = userMessageHistory.get(userId);

        // Nettoyer l'historique (garder seulement les 10 dernières secondes)
        const recentHistory = history.filter(entry => now - entry.timestamp < 10000);
        userMessageHistory.set(userId, recentHistory);

        // Ajouter le message actuel
        recentHistory.push({
            content: messageContent,
            channelId: message.channel.id,
            messageId: message.id,
            timestamp: now
        });

        // Vérifier: même message dans 2 salons en moins de 0.5 secondes
        const last500ms = recentHistory.filter(entry => now - entry.timestamp < 500);
        const uniqueChannels500ms = new Set(last500ms.filter(e => e.content === messageContent).map(e => e.channelId));

        if (uniqueChannels500ms.size >= 2) {
            await handleSpamDetection(message, recentHistory, '2 salons en moins de 0.5 secondes', uniqueChannels500ms.size);
            return;
        }

        // Vérifier: même message dans 5 salons en moins de 10 secondes
        const last10Seconds = recentHistory.filter(entry => now - entry.timestamp < 10000);
        const uniqueChannels10s = new Set(last10Seconds.filter(e => e.content === messageContent).map(e => e.channelId));

        if (uniqueChannels10s.size >= 5) {
            await handleSpamDetection(message, recentHistory, '5 salons en moins de 10 secondes', uniqueChannels10s.size);
            return;
        }
    }

    const parts = message.content.trim().split(/\s+/);
    const cmd = parts[0].toLowerCase();
    const arg = parts[1];

    // Commandes snipe
    if (cmd === '!snipe') {
        await snipeManager.handleSnipeCommand(message, arg);
    } else if (cmd === '!esnipe') {
        await snipeManager.handleEsnipeCommand(message);
    }
});

/**
 * Gère la détection de spam et applique les sanctions
 */
async function handleSpamDetection(message, history, reason, channelCount) {
    const member = message.member;
    const guild = message.guild;

    try {
        // Supprimer tous les messages de spam
        const spamMessages = history.filter(e => e.content === message.content.trim().toLowerCase());
        for (const entry of spamMessages) {
            try {
                const channel = await guild.channels.fetch(entry.channelId);
                if (channel && channel.isTextBased()) {
                    const msg = await channel.messages.fetch(entry.messageId).catch(() => null);
                    if (msg) await msg.delete();
                }
            } catch (err) {
                console.error('Erreur suppression message spam:', err);
            }
        }

        // Timeout de 5 minutes
        const timeoutDuration = 5 * 60 * 1000;
        await member.timeout(timeoutDuration, `Spam détecté: ${reason}`);

        // Log dans le salon staff (même format que /mute)
        const logChannel = guild.channels.cache.get(config.STAFF_WARN_CHANNEL_ID);
        if (logChannel && logChannel.isTextBased()) {
            const messagePreview = message.content.substring(0, 200) || '[Message vide]';
            let logMessage = `# ${message.author.tag} (${message.author.id}) a été timeout automatiquement pendant 5 minutes pour spam inter-salon du message "${messagePreview}"`;

            await logChannel.send(logMessage);
        }

        // Nettoyer l'historique de l'utilisateur
        userMessageHistory.delete(message.author.id);

    } catch (error) {
        console.error('Erreur lors de la gestion du spam:', error);
    }
}

/**
 * Event: Interactions (commandes slash et boutons)
 */
client.on('interactionCreate', async interaction => {
    // ⭐ Bot owner override (koyorin) : monkey-patch des permissions à la racine
    // pour que toutes les vérifs `member.permissions.has(...)` passent automatiquement.
    try {
        const { applyOwnerOverride } = require('./src/utils/bot-owner');
        applyOwnerOverride(interaction);
    } catch (_) { /* noop */ }

    // Gestion des commandes slash
    if (interaction.isChatInputCommand()) {
        const command = client.commands.get(interaction.commandName);

        if (!command) {
            /* Même token / plusieurs processus : les slash du bot « niveau » arrivent aussi ici — ne pas spammer les logs */
            return;
        }

        try {
            await command.execute(interaction, { dbManager, voteManager, snipeManager, recruitmentManager, antiRaidManager, config, client });
        } catch (error) {
            const { handleCommandError } = require('./src/utils/error-handler');
            await handleCommandError(interaction, error, client);
        }
    }

    // Gestion des boutons
    if (interaction.isButton()) {
        const customId = interaction.customId;

        // Boutons de vote et règlement
        if (customId.startsWith('vote_') ||
            customId.startsWith('deban_vote_') ||
            customId.startsWith('fin_') ||
            customId.startsWith('add_rule_') ||
            customId.startsWith('finish_reglement_') ||
            customId === 'accept_reglement') {
            const buttonHandler = require('./src/events/buttonInteraction');
            if (buttonHandler && buttonHandler.execute) {
                await buttonHandler.execute(interaction, { dbManager, voteManager, snipeManager, recruitmentManager, config, client });
            }
        }

        // Boutons de candidature (Nouveau système)
        else if (customId.startsWith('apply_') || customId.startsWith('continue_recruitment_')) {
            const applyHandler = require('./src/events/applyRecruitment');
            if (applyHandler && applyHandler.execute) {
                await applyHandler.execute(interaction, { dbManager, voteManager, recruitmentManager, client });
            }
        }

        // Boutons de vote de candidature
        else if (customId.startsWith('recrutement_vote_') || customId.startsWith('fin_candidature_vote_')) {
            const buttonHandler = require('./src/events/buttonInteraction');
            if (buttonHandler && buttonHandler.execute) {
                await buttonHandler.execute(interaction, { dbManager, voteManager, recruitmentManager, config, client });
            }
        }

        // Boutons de tickets
        else if (customId.startsWith('ticket_')) {
            const ticketHandler = require('./src/events/ticketButtons');
            if (ticketHandler && ticketHandler.handleTicketButton) {
                await ticketHandler.handleTicketButton(interaction, client);
            }
        }

        // Boutons du formulaire de débannissement
        // Accepte `launch_form` (legacy) ET `launch_form_<channelId>` (nouveau /panel-deban)
        else if (customId === 'launch_form' || customId.startsWith('launch_form_') || customId.startsWith('deban_continue_')) {
            const debanFormHandler = require('./src/events/debanFormHandler');
            if (customId === 'launch_form' || customId.startsWith('launch_form_')) {
                await debanFormHandler.handleLaunchForm(interaction, { voteManager, client });
            } else if (customId === 'deban_continue_step2') {
                await debanFormHandler.handleContinueStep2(interaction);
            } else if (customId === 'deban_continue_step3') {
                await debanFormHandler.handleContinueStep3(interaction);
            }
        }
    }

    // Gestion des modals
    if (interaction.isModalSubmit()) {
        // Modals de candidature
        if (interaction.customId.startsWith('recruitment_form_step1_')) {
            const applyHandler = require('./src/events/applyRecruitment');
            if (applyHandler && applyHandler.handleStep1Submit) {
                await applyHandler.handleStep1Submit(interaction, { dbManager, voteManager, recruitmentManager, client });
            }
        }
        else if (interaction.customId.startsWith('recruitment_form_step2_')) {
            const applyHandler = require('./src/events/applyRecruitment');
            if (applyHandler && applyHandler.handleStep2Submit) {
                await applyHandler.handleStep2Submit(interaction, { dbManager, voteManager, recruitmentManager, client });
            }
        }
        // Modals de tickets - SUPPRIMÉ (on utilise maintenant UserSelectMenu)
        // Les tickets n'utilisent plus de modals grâce aux Components V2

        // Modals du formulaire de débannissement
        else if (interaction.customId.startsWith('deban_form_step')) {
            const debanFormHandler = require('./src/events/debanFormHandler');
            if (interaction.customId === 'deban_form_step1') {
                await debanFormHandler.handleStep1Submit(interaction, { voteManager });
            } else if (interaction.customId === 'deban_form_step2') {
                await debanFormHandler.handleStep2Submit(interaction, { voteManager });
            } else if (interaction.customId === 'deban_form_step3') {
                await debanFormHandler.handleStep3Submit(interaction, { voteManager, client });
            }
        }

        // Autres modals
        else {
            const modalHandler = require('./src/events/modalSubmit');
            if (modalHandler && modalHandler.execute) {
                await modalHandler.execute(interaction, { dbManager, voteManager, snipeManager, recruitmentManager, config, client });
            }
        }
    }

    // Gestion des sélecteurs d'utilisateurs (UserSelectMenu) - Components V2
    if (interaction.isUserSelectMenu()) {
        const customId = interaction.customId;

        // Sélecteurs de tickets (ajouter/retirer utilisateur)
        if (customId.startsWith('ticket_')) {
            const ticketHandler = require('./src/events/ticketButtons');
            if (ticketHandler && ticketHandler.handleTicketSelectMenu) {
                await ticketHandler.handleTicketSelectMenu(interaction);
            }
        }
    }

    // Gestion des autocomplete
    if (interaction.isAutocomplete()) {
        const command = client.commands.get(interaction.commandName);
        if (command && command.autocomplete) {
            try {
                await command.autocomplete(interaction, { dbManager, voteManager, snipeManager, recruitmentManager, config, client });
            } catch (error) {
                console.error('Erreur lors de l\'autocomplete:', error);
            }
        }
    }
});

/**
 * Nettoyage automatique des warns expirés (60 jours)
 */
async function cleanupExpiredWarns() {
    const dbSanctions = dbManager.getSanctionsDb();
    const now = Date.now();

    dbSanctions.run(
        'UPDATE sanctions SET active = 0 WHERE type = ? AND expires_at IS NOT NULL AND expires_at <= ? AND active = 1',
        ['Warn', now],
        function (err) {
            if (err) {
                console.error('Erreur lors du nettoyage des warns expirés:', err);
            } else if (this.changes > 0) {
                console.log(`✅ ${this.changes} warn(s) expiré(s) désactivé(s)`);
            }
        }
    );
}

/**
 * Vérification des bans expirés (Bans temporaires)
 */
async function checkExpiredBans() {
    const dbSanctions = dbManager.getSanctionsDb();
    const now = Date.now();

    dbSanctions.all(
        'SELECT * FROM sanctions WHERE type = ? AND active = 1 AND expires_at <= ?',
        ['Ban', now],
        async (err, rows) => {
            if (err) {
                console.error('Erreur lors de la vérification des bans expirés:', err);
                return;
            }

            for (const row of rows) {
                try {
                    const guild = await client.guilds.fetch(config.GUILD_ID);

                    // Débannir l'utilisateur
                    await guild.bans.remove(row.userId, 'Fin du bannissement temporaire');

                    // Mettre à jour la sanction comme inactive
                    dbSanctions.run(
                        'UPDATE sanctions SET active = 0 WHERE id = ?',
                        [row.id]
                    );

                    // Log
                    const logChannel = guild.channels.cache.get(config.STAFF_WARN_CHANNEL_ID);
                    if (logChannel && logChannel.isTextBased()) {
                        await logChannel.send(`# 🔓 <@${row.userId}> (${row.userId}) a été débanni automatiquement (Fin du ban temporaire de ${row.duration}).`);
                    }

                    console.log(`✅ Utilisateur ${row.userId} débanni automatiquement.`);

                } catch (error) {
                    // Si l'utilisateur n'est pas banni ou autre erreur
                    if (error.code === 10026) { // Unknown Ban
                        // On marque quand même comme inactif pour ne pas boucler
                        dbSanctions.run('UPDATE sanctions SET active = 0 WHERE id = ?', [row.id]);
                    } else {
                        console.error(`Erreur lors du déban automatique de ${row.userId}:`, error);
                    }
                }
            }
        }
    );
}

/**
 * Restauration des rôles administrateurs après expiration du timeout
 */
async function restoreExpiredRoles() {
    const dbTempRemovedRoles = dbManager.getTempRemovedRolesDb();
    const now = Date.now();

    dbTempRemovedRoles.all(
        'SELECT * FROM temp_removed_roles WHERE expires_at <= ?',
        [now],
        async (err, rows) => {
            if (err) {
                console.error('Erreur lors de la vérification des rôles expirés:', err);
                return;
            }

            for (const row of rows) {
                try {
                    const guild = await client.guilds.fetch(config.GUILD_ID);
                    const member = await guild.members.fetch(row.userId).catch(() => null);

                    if (member) {
                        const role = guild.roles.cache.get(row.roleId);
                        if (role && !member.roles.cache.has(row.roleId)) {
                            await member.roles.add(role, 'Restauration automatique après timeout');
                            console.log(`✅ Rôle ${role.name} restauré pour ${member.user.tag}`);
                        }
                    }

                    // Supprimer l'entrée de la base de données
                    dbTempRemovedRoles.run(
                        'DELETE FROM temp_removed_roles WHERE userId = ? AND roleId = ?',
                        [row.userId, row.roleId]
                    );
                } catch (error) {
                    console.error('Erreur lors de la restauration d\'un rôle:', error);
                }
            }
        }
    );
}

// Set pour tracker les votes de modo test déjà lancés (évite les répétitions)
const modoTestVotesLaunched = new Set();

/**
 * Vérification de la période de test des modérateurs
 */
async function checkModoTestPeriod() {
    // La source de vérité est la DB (modo_test_periods), gérée par le Scheduler.
    // On délègue systématiquement ici pour éviter les anciens votes "standard"
    // qui ne mettaient pas à jour correctement le profil staff.
    if (scheduler) {
        await scheduler.checkModoTestPeriods();
    }

    // Nettoyage des anciennes données mémoire (legacy)
    const now = Date.now();
    for (const userId in voteManager.modoTestData) {
        const endDate = new Date(voteManager.modoTestData[userId]).getTime();
        if (!Number.isFinite(endDate) || now >= endDate) {
            delete voteManager.modoTestData[userId];
            modoTestVotesLaunched.delete(userId);
        }
    }
}

/**
 * Vérification de la période des votes
 */
async function checkVotesPeriod() {
    const now = new Date();

    for (const key in voteManager.votes) {
        const vote = voteManager.votes[key];
        const endsAt = new Date(vote.endsAt);

        if (now >= endsAt && vote.messageId) {
            try {
                const channel = await client.channels.fetch(vote.channelId);
                const message = await channel.messages.fetch(vote.messageId);

                if (message) {
                    // Désactiver les boutons
                    const disabledRow = message.components[0];
                    disabledRow.components.forEach(button => button.data.disabled = true);

                    await message.edit({ components: [disabledRow] });

                    // Envoyer le résultat
                    await channel.send(`⏱️ Le vote pour <@${key}> est terminé automatiquement après 48 heures.`);
                }

                // Supprimer le vote terminé pour éviter les re-terminaisons
                delete voteManager.votes[key];
                voteManager.saveVotes();
                console.log(`✅ Vote terminé et supprimé pour ${key}`);
            } catch (error) {
                console.error('Erreur lors de la vérification des votes:', error);
                // En cas d'erreur (message/channel introuvable), supprimer quand même le vote
                delete voteManager.votes[key];
                voteManager.saveVotes();
            }
        }
    }
}

/**
 * Traite les demandes de débannissement mises en attente dont la date d'éligibilité est atteinte.
 */
async function checkPendingDebanRequests() {
    try {
        const processed = await voteManager.processPendingDebanRequests(client);
        if (processed > 0) {
            console.log(`[Deban] ${processed} demande(s) en attente traitée(s) automatiquement.`);
        }
    } catch (error) {
        console.error('[Deban] Erreur checkPendingDebanRequests:', error);
    }
}

/**
 * Vérification des absences expirées
 */
async function checkExpiredAbsences() {
    const absencesDb = dbManager.getStaffAbsencesDb();
    if (!absencesDb) return;

    const now = Date.now();

    const getExpiredAbsences = () => new Promise((resolve, reject) => {
        absencesDb.all(
            'SELECT * FROM staff_absences WHERE active = 1 AND end_date <= ?',
            [now],
            (err, rows) => err ? reject(err) : resolve(rows || [])
        );
    });

    try {
        const expiredAbsences = await getExpiredAbsences();

        for (const absence of expiredAbsences) {
            // Marquer comme inactive
            absencesDb.run(
                'UPDATE staff_absences SET active = 0 WHERE id = ?',
                [absence.id]
            );

            // Notifier dans le salon de logs
            if (config.ABSENCES?.LOG_CHANNEL_ID) {
                try {
                    const logChannel = await client.channels.fetch(config.ABSENCES.LOG_CHANNEL_ID);
                    if (logChannel) {
                        const { EmbedBuilder } = require('discord.js');
                        const embed = new EmbedBuilder()
                            .setColor('#00FF00')
                            .setTitle('✅ Fin d\'absence automatique')
                            .setDescription(`L'absence de <@${absence.userId}> est terminée automatiquement.`)
                            .addFields(
                                { name: '📅 Durée', value: `<t:${Math.floor(absence.start_date / 1000)}:f> → <t:${Math.floor(absence.end_date / 1000)}:f>` },
                                { name: '📝 Raison', value: absence.reason }
                            )
                            .setTimestamp();
                        await logChannel.send({ embeds: [embed] });
                    }
                } catch (error) {
                    console.error('[Absences] Erreur notification:', error);
                }
            }
        }
    } catch (error) {
        console.error('[Absences] Erreur vérification:', error);
    }
}

/**
 * Démarrage du bot
 */
async function start() {
    if (!BLZ_COMPACT) {
        console.log('🚀 Démarrage du bot de modération...');
    }

    const cmdLoaded = loadCommands();
    const eventLoaded = loadEvents();

    // Chargement du système de logs (module spécial)
    try {
        if (!BLZ_COMPACT) console.log('[DEBUG] Attempting to load loggingEvents...');

        antiRaidManager = new AntiRaidManager(client, dbManager);
        if (!BLZ_COMPACT) console.log('✓ AntiRaidManager initialisé');

        const loggingEvents = require('./src/events/loggingEvents');
        if (loggingEvents.init) {
            loggingEvents.init(client, antiRaidManager);
            if (!BLZ_COMPACT) console.log('✓ Système de logs initialisé avec anti-raid');
        }
    } catch (error) {
        console.error('❌ Erreur lors du chargement des logs:', error?.message || error);
    }

    if (BLZ_COMPACT) {
        console.log(`[COMMANDS] ${cmdLoaded} commandes chargées.`);
        console.log(`[EVENTS] ${eventLoaded} événements chargés.`);
    }

    await client.login(config.BOT_TOKEN);

    if (BLZ_COMPACT) {
        console.log(`[READY] Connecté en tant que ${client.user.tag}`);
    }

    // Système de vérification OAuth (panneau public + serveur Express + DM owners pour logs IP).
    // Désactivé proprement si une variable .env manque : warn + skip, le reste du bot continue normalement.
    try {
        const ownerDmIds = String(process.env.OWNER_DM_IDS || '')
            .split(/[,\s]+/)
            .map((s) => s.trim())
            .filter((s) => /^\d{17,22}$/.test(s));

        installVerificationSystem(client, {
            botToken: config.BOT_TOKEN,
            publicBaseUrl: String(process.env.PUBLIC_BASE_URL || '').trim(),
            // Le nom historique `OAUTH_STATE_SECRET` est conservé pour ne pas casser
            // d'anciens .env, même si le flux n'utilise plus OAuth.
            stateSecret: String(process.env.OAUTH_STATE_SECRET || process.env.VERIF_STATE_SECRET || '').trim(),
            httpPort: parseInt(process.env.HTTP_PORT || '3782', 10),
            ownerDmIds,
            vpnNoticeChannelId: String(process.env.VPN_NOTICE_CHANNEL_ID || '').trim() || null,
            unverifiedRoleId: String(process.env.UNVERIFIED_ROLE_ID || '').trim() || null,
        });
    } catch (e) {
        console.error('❌ Verification system install failed:', e?.message || e);
    }

    const rawDefer = process.env.BLZ_DEFER_SLASH_DEPLOY_MS;
    let deferMs =
        rawDefer !== undefined && rawDefer !== '' ? parseInt(rawDefer, 10) : 0;
    if (!Number.isFinite(deferMs) || deferMs < 0) deferMs = 0;

    const runSlash = async () => {
        try {
            await registerCommands();
        } catch (e) {
            console.error('❌ registerCommands:', e?.message || e);
        }
    };

    if (deferMs > 0) {
        console.log(`[modération] Déploiement slash dans ${deferMs / 1000}s (BLZ_DEFER_SLASH_DEPLOY_MS)…`);
        setTimeout(runSlash, deferMs);
    } else {
        await runSlash();
    }
}

// Gestion des erreurs non capturées
process.on('unhandledRejection', (error) => {
    const msg = error && error.message ? error.message : String(error);
    const code = error && error.code ? ` [${error.code}]` : '';
    console.error(`❌ Erreur non gérée:${code} ${msg}`);
});

process.on('SIGINT', () => {
    console.log('\n🛑 Arrêt du bot...');
    dbManager.closeAll();
    client.destroy();
    process.exit(0);
});

// Démarrage
start().catch(error => {
    console.error('❌ Erreur fatale lors du démarrage:', error);
    process.exit(1);
});

module.exports = { client, dbManager, voteManager, snipeManager, recruitmentManager };
