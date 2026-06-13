const { Client, IntentsBitField, SlashCommandBuilder, PermissionsBitField, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType, AuditLogEvent, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const { REST } = require('@discordjs/rest');
const { Routes } = require('discord-api-types/v10');
const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
require('dotenv').config();

const dbSanctions = new sqlite3.Database('./sanctions.db', sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE, (err) => {
    if (err) {
        console.error('Erreur lors de la connexion à la base de données des sanctions :', err);
    } else {
        console.log('Connecté à la base de données des sanctions.');
        dbSanctions.run(`CREATE TABLE IF NOT EXISTS sanctions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            userId TEXT NOT NULL,
            type TEXT NOT NULL,
            reason TEXT,
            moderatorId TEXT NOT NULL,
            duration TEXT,
            date INTEGER NOT NULL,
            expires_at INTEGER,
            active INTEGER DEFAULT 1,
            rule_id INTEGER,
            pendingDeletion INTEGER DEFAULT 0,
            deletionReason TEXT,
            deletionModeratorId TEXT,
            deletionDate INTEGER
        )`);
        dbSanctions.run(`CREATE INDEX IF NOT EXISTS idx_sanctions_userId ON sanctions (userId)`);
        dbSanctions.run(`CREATE INDEX IF NOT EXISTS idx_sanctions_id ON sanctions (id)`);
        dbSanctions.run(`CREATE INDEX IF NOT EXISTS idx_sanctions_expires_at ON sanctions (expires_at)`);
    }
});

const dbNotes = new sqlite3.Database('./notes.db', sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE, (err) => {
    if (err) {
        console.error('Erreur lors de la connexion à la base de données des notes :', err);
    } else {
        console.log('Connecté à la base de données des notes.');
        dbNotes.run(`CREATE TABLE IF NOT EXISTS notes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            userId TEXT NOT NULL,
            note TEXT NOT NULL,
            moderatorId TEXT NOT NULL,
            date INTEGER NOT NULL
        )`);
        dbNotes.run(`CREATE INDEX IF NOT EXISTS idx_notes_userId ON notes (userId)`);
        dbNotes.run(`CREATE INDEX IF NOT EXISTS idx_notes_id ON notes (id)`);
    }
});

const dbRules = new sqlite3.Database('./rules.db', sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE, (err) => {
    if (err) {
        console.error('Erreur lors de la connexion à la base de données des règles :', err);
    } else {
        console.log('Connecté à la base de données des règles.');
        dbRules.run(`CREATE TABLE IF NOT EXISTS rules (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            description TEXT NOT NULL
        )`);
    }
});

const dbTempRemovedRoles = new sqlite3.Database('./temp_removed_roles.db', sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE, (err) => {
    if (err) {
        console.error('Erreur lors de la connexion à la base de données des rôles temporairement supprimés :', err);
    } else {
        console.log('Connecté à la base de données des rôles temporairement supprimés.');
        dbTempRemovedRoles.run(`CREATE TABLE IF NOT EXISTS temp_removed_roles (
            userId TEXT NOT NULL,
            roleId TEXT NOT NULL,
            expires_at INTEGER NOT NULL,
            PRIMARY KEY (userId, roleId)
        )`);
    }
});

const dbStaffWarns = new sqlite3.Database('./staff_warns.db', sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE, (err) => {
    if (err) {
        console.error('Erreur lors de la connexion à la base de données des avertissements du staff :', err);
    } else {
        console.log('Connecté à la base de données des avertissements du staff.');
        dbStaffWarns.run(`CREATE TABLE IF NOT EXISTS staff_warns (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            userId TEXT NOT NULL,
            moderatorId TEXT NOT NULL,
            reason TEXT NOT NULL,
            date INTEGER NOT NULL
        )`);
    }
});

const client = new Client({
    intents: [
        IntentsBitField.Flags.Guilds,
        IntentsBitField.Flags.GuildMembers,
        IntentsBitField.Flags.GuildMessages,
    ],
    partials: ['CHANNEL'],
});

const userMessageMap = new Map();
const recentBotSanctions = new Set();

function msToReadableTime(duration) {
    const seconds = Math.floor((duration / 1000) % 60),
        minutes = Math.floor((duration / (1000 * 60)) % 60),
        hours = Math.floor((duration / (1000 * 60 * 60)) % 24),
        days = Math.floor(duration / (1000 * 60 * 60 * 24));

    let time = '';
    if (days > 0) time += `${days} jour(s) `;
    if (hours > 0) time += `${hours} heure(s) `;
    if (minutes > 0) time += `${minutes} minute(s) `;
    if (seconds > 0) time += `${seconds} seconde(s)`;
    return time.trim();
}

client.on('ready', async () => {
    console.log(`Connecté en tant que ${client.user.tag} [Modération]`);
    console.log('Bot de modération en ligne.');
});

client.on('ready', async () => {
    const guildId = process.env.GUILD_ID;
    const guild = guildId ? client.guilds.cache.get(guildId) : client.guilds.cache.first();

    if (!guild) {
        console.error('Aucun serveur trouvé pour l\'enregistrement des commandes. Assurez-vous que GUILD_ID est défini dans .env ou que le bot est dans un serveur.');
        return;
    }

    const commandsToRegister = [
        new SlashCommandBuilder()
            .setName('mute')
            .setDescription('Rendre un membre muet avec une durée et une raison spécifiques.')
            .addUserOption(option =>
                option.setName('utilisateur')
                    .setDescription('Le membre à rendre muet')
                    .setRequired(true))
            .addStringOption(option =>
                option.setName('temps')
                    .setDescription('Durée du mute (ex: 10m, 2h, 1j, 3w)')
                    .setRequired(true))
            .addStringOption(option =>
                option.setName('raison')
                    .setDescription('Raison personnalisée du mute')
                    .setRequired(true))
            .addStringOption(option =>
                option.setName('regle')
                    .setDescription('Règle enfreinte (commencez à taper pour voir les règles)')
                    .setRequired(true)
                    .setAutocomplete(true))
            .addBooleanOption(option =>
                option.setName('warn')
                .setDescription('Donner également un avertissement à l\'utilisateur')
                .setRequired(true))
            .addAttachmentOption(option =>
                option.setName('preuve')
                    .setDescription('Preuve (uniquement des captures d\'écran)')
                    .setRequired(false)),

        new SlashCommandBuilder()
            .setName('ban')
            .setDescription('Bannir un membre avec une raison spécifique.')
            .addUserOption(option =>
                option.setName('utilisateur')
                    .setDescription('Le membre à bannir')
                    .setRequired(true))
            .addStringOption(option =>
                option.setName('raison')
                    .setDescription('Raison du bannissement')
                    .setRequired(true))
            .addAttachmentOption(option =>
                option.setName('preuve')
                    .setDescription('Preuve (uniquement des captures d\'écran)')
                    .setRequired(false)),

        new SlashCommandBuilder()
            .setName('modlog')
            .setDescription('Afficher l\'historique des sanctions et des notes d\'un membre.')
            .addUserOption(option =>
                option.setName('utilisateur')
                    .setDescription('Le membre dont vous voulez voir les sanctions')
                    .setRequired(true)),

        new SlashCommandBuilder()
            .setName('note')
            .setDescription('Ajouter une note à un membre.')
            .addUserOption(option =>
                option.setName('utilisateur')
                    .setDescription('Le membre à noter')
                    .setRequired(true))
            .addStringOption(option =>
                option.setName('contenu')
                    .setDescription('Contenu de la note')
                    .setRequired(true)),

        new SlashCommandBuilder()
            .setName('note-retirer')
            .setDescription('Retirer une note d\'un membre.')
            .addUserOption(option =>
                option.setName('utilisateur')
                    .setDescription('Le membre dont vous voulez retirer une note')
                    .setRequired(true))
            .addIntegerOption(option =>
                option.setName('id')
                    .setDescription('ID de la note à retirer (visible dans /modlog)')
                    .setRequired(true)),

        new SlashCommandBuilder()
            .setName('modlog-sup')
            .setDescription('Programmer la suppression d\'une sanction de l\'historique d\'un membre.')
            .addUserOption(option =>
                option.setName('utilisateur')
                    .setDescription('Le membre dont vous voulez supprimer une sanction')
                    .setRequired(true))
            .addIntegerOption(option =>
                option.setName('id')
                    .setDescription('ID de la sanction à supprimer (visible dans /modlog)')
                    .setRequired(true))
            .addStringOption(option =>
                option.setName('raison')
                    .setDescription('Raison de la suppression')
                    .setRequired(true)),

        new SlashCommandBuilder()
            .setName('reglement-cree')
            .setDescription('Créer une nouvelle règle.'),

        new SlashCommandBuilder()
            .setName('warn')
            .setDescription('Avertir un utilisateur.')
            .addUserOption(option =>
                option.setName('utilisateur')
                    .setDescription('L\'utilisateur à avertir')
                    .setRequired(true))
            .addStringOption(option =>
                option.setName('raison')
                    .setDescription('Raison de l\'avertissement (commencez à taper pour voir les règles)')
                    .setRequired(true)
                    .setAutocomplete(true)),

        new SlashCommandBuilder()
            .setName('delete-warn')
            .setDescription('Supprimer un avertissement.')
            .addIntegerOption(option =>
                option.setName('warn_id')
                    .setDescription('L\'ID de l\'avertissement à supprimer')
                    .setRequired(true)),

        new SlashCommandBuilder()
            .setName('deban')
            .setDescription('Révoquer le bannissement d\'un utilisateur.')
            .addUserOption(option =>
                option.setName('utilisateur')
                    .setDescription('L\'utilisateur à débannir')
                    .setRequired(true)),

        new SlashCommandBuilder()
            .setName('demute')
            .setDescription('Révoquer le mute d\'un utilisateur.')
            .addUserOption(option =>
                option.setName('utilisateur')
                    .setDescription('L\'utilisateur à démute')
                    .setRequired(true)),

        new SlashCommandBuilder()
            .setName('staffwarn')
            .setDescription('Avertir un membre du staff.')
            .addUserOption(option =>
                option.setName('utilisateur')
                    .setDescription('Le membre du staff à avertir')
                    .setRequired(true))
            .addStringOption(option =>
                option.setName('raison')
                    .setDescription('La raison de l\'avertissement')
                    .setRequired(true)),
    ];

    try {
        // Utilisation de l'API REST pour créer ou mettre à jour les commandes sans passer par guild.commands
        const rest = new REST({ version: '10' }).setToken(process.env.BOT_TOKEN);

        // Préparer les objets JSON des commandes
        const commandsBody = commandsToRegister.map(cmd => cmd.toJSON());

        // Récupérer les commandes existantes pour cette guilde afin de décider s'il faut créer ou mettre à jour
        let existingCommands = [];
        try {
            existingCommands = await rest.get(Routes.applicationGuildCommands(client.user.id, guild.id));
        } catch (fetchErr) {
            console.warn('Impossible de récupérer les commandes existantes :', fetchErr);
        }

        for (const commandData of commandsBody) {
            const existing = existingCommands.find(c => c.name === commandData.name);
            if (existing) {
                await rest.patch(Routes.applicationGuildCommand(client.user.id, guild.id, existing.id), { body: commandData });
            } else {
                await rest.post(Routes.applicationGuildCommands(client.user.id, guild.id), { body: commandData });
            }
        }

        console.log('Commandes enregistrées/mises à jour avec succès (via REST).');
    } catch (error) {
        console.error('Erreur lors de l\'enregistrement des commandes :', error);
    }
});

client.on('interactionCreate', async interaction => {
    if (!interaction.isCommand()) return;

    const roleModerateur = '1172237685763608579';
    const logChannelId = '1343193683595366482';

    try {
        if (interaction.isAutocomplete() && interaction.commandName === 'mute') {
            const focusedValue = interaction.options.getFocused();
            dbRules.all('SELECT name FROM rules', [], (err, rows) => {
                if (err) {
                    console.error(err);
                    interaction.respond([]);
                    return;
                }
                const choices = rows.map(row => row.name);
                const filtered = choices.filter(choice => choice.toLowerCase().startsWith(focusedValue.toLowerCase()));
                interaction.respond(
                    filtered.map(choice => ({ name: choice, value: choice })),
                );
            });
        }

        if (interaction.commandName === 'mute') {
            if (!interaction.member.permissions.has(PermissionsBitField.Flags.ModerateMembers)) {
                return interaction.reply({ content: 'Vous n\'avez pas l\'autorisation d\'utiliser cette commande.', ephemeral: true });
            }

            const utilisateur = interaction.options.getUser('utilisateur');
            const temps = interaction.options.getString('temps');
            const raison = interaction.options.getString('raison');
            const regle = interaction.options.getString('regle');
            const shouldWarn = interaction.options.getBoolean('warn');
            const preuve = interaction.options.getAttachment('preuve');
            const modérateur = interaction.member;

            const regexTemps = /^(\d+)([mhjs])$/i;
            const match = temps.match(regexTemps);
            if (!match) {
                return interaction.reply({ content: 'Le format du temps est invalide. Utilisez par exemple 10m, 2h, 1j, 3s.', ephemeral: true });
            }

            const valeurTemps = parseInt(match[1]);
            const unitéTemps = match[2].toLowerCase();

            let duréeMs;
            let duréeTexte;
            switch (unitéTemps) {
                case 'm':
                    duréeMs = valeurTemps * 60 * 1000;
                    duréeTexte = `${valeurTemps} minute(s)`;
                    break;
                case 'h':
                    duréeMs = valeurTemps * 60 * 60 * 1000;
                    duréeTexte = `${valeurTemps} heure(s)`;
                    break;
                case 'j':
                    duréeMs = valeurTemps * 24 * 60 * 60 * 1000;
                    duréeTexte = `${valeurTemps} jour(s)`;
                    break;
                case 's':
                    duréeMs = valeurTemps * 7 * 24 * 60 * 60 * 1000;
                    duréeTexte = `${valeurTemps} semaine(s)`;
                    break;
                default:
                    return interaction.reply({ content: 'Unité de temps invalide. Utilisez m pour minutes, h pour heures, j pour jours, s pour semaines.', ephemeral: true });
            }

            const maxDurationMs = 28 * 24 * 60 * 60 * 1000;
            if (duréeMs > maxDurationMs) {
                return interaction.reply({ content: 'La durée maximale pour un time out est de 28 jours.', ephemeral: true });
            }

            const membreCible = await interaction.guild.members.fetch(utilisateur.id).catch(() => null);
            if (!membreCible) {
                return interaction.reply({ content: 'Membre introuvable.', ephemeral: true });
            }

            if (membreCible.roles.highest.position >= modérateur.roles.highest.position) {
                return interaction.reply({ content: 'Vous ne pouvez pas rendre muet ce membre car il est au même niveau ou au-dessus de vous dans la hiérarchie des rôles.', ephemeral: true });
            }

            if (membreCible.roles.highest.position >= interaction.guild.members.me.roles.highest.position) {
                return interaction.reply({ content: 'Je ne peux pas rendre muet ce membre car il est au-dessus de moi dans la hiérarchie des rôles.', ephemeral: true });
            }

            dbRules.get('SELECT id FROM rules WHERE name = ?', [regle], async (err, ruleRow) => {
                if (err || !ruleRow) {
                    return interaction.reply({ content: 'Règle invalide. Veuillez choisir une règle dans la liste.', ephemeral: true });
                }

                const adminRoles = membreCible.roles.cache.filter(role => role.permissions.has(PermissionsBitField.Flags.Administrator));
                if (adminRoles.size > 0) {
                    if (!interaction.guild.members.me.permissions.has(PermissionsBitField.Flags.ManageRoles)) {
                        return interaction.reply({ content: 'Je n\'ai pas la permission de gérer les rôles pour retirer les rôles administrateurs de ce membre.', ephemeral: true });
                    }
                    const expires_at = Date.now() + duréeMs;
                    for (const role of adminRoles.values()) {
                        await membreCible.roles.remove(role, 'Retrait temporaire pour mute');
                        dbTempRemovedRoles.run('INSERT INTO temp_removed_roles (userId, roleId, expires_at) VALUES (?, ?, ?)', [membreCible.id, role.id, expires_at]);
                    }
                }

                try {
                    await membreCible.timeout(duréeMs, raison);

                    const finalReason = `${regle} - ${raison}`;

                    dbSanctions.run(`INSERT INTO sanctions (userId, type, reason, moderatorId, duration, date, rule_id) VALUES (?, ?, ?, ?, ?, ?, ?)`,
                        [membreCible.id, 'Time Out', finalReason, modérateur.id, duréeTexte, Date.now(), ruleRow.id]);

                    if (shouldWarn) {
                        const expires_at = Date.now() + 60 * 24 * 60 * 60 * 1000; // 60 days
                        dbSanctions.run('INSERT INTO sanctions (userId, type, reason, moderatorId, date, expires_at, rule_id) VALUES (?, ?, ?, ?, ?, ?, ?)', 
                        [membreCible.id, 'Warn', regle, modérateur.id, Date.now(), expires_at, ruleRow.id]);
                    }

                    const canalLog = interaction.guild.channels.cache.get(logChannelId);
                    if (canalLog && canalLog.isTextBased()) {
                        let messageLog = `# ${membreCible.user.tag} (${membreCible.id}) a été rendu muet pendant ${duréeTexte} pour la raison "${finalReason}" par ${modérateur} (${modérateur.id})`;
                        if (preuve && preuve.contentType && preuve.contentType.startsWith('image/')) {
                            canalLog.send({ content: messageLog, files: [preuve.url] });
                        } else {
                            if (preuve) {
                                messageLog += '\n⚠️ Preuve non acceptée (seules les captures d\'écran sont autorisées).';
                            }
                            canalLog.send({ content: messageLog });
                        }
                    }

                    try {
                        await membreCible.send(`Vous avez été rendu muet pour la raison : "${finalReason}" pendant une durée de ${duréeTexte}.`);
                    } catch {
                        console.warn('Impossible d\'envoyer un message privé au membre ciblé.');
                    }

                    await interaction.reply({ content: 'Le mute a été appliqué avec succès.', ephemeral: true });
                } catch (erreur) {
                    console.error('Erreur lors de l\'application du mute :', erreur);
                    await interaction.reply({ content: 'Une erreur est survenue lors de l\'application du mute.', ephemeral: true });
                }
            });
        }

        if (interaction.commandName === 'ban') {
            if (!interaction.member.permissions.has(PermissionsBitField.Flags.BanMembers)) {
                return interaction.reply({ content: 'Vous n\'avez pas la permission de bannir des membres.', ephemeral: true });
            }

            const utilisateur = interaction.options.getUser('utilisateur');
            const raison = interaction.options.getString('raison');
            const preuve = interaction.options.getAttachment('preuve');
            const modérateur = interaction.member;

            let membreCible = null;
            try {
                membreCible = await interaction.guild.members.fetch(utilisateur.id);
            } catch (error) {
                console.log(`L'utilisateur ${utilisateur.tag} n'est pas sur le serveur. Procéder au bannissement.`);
            }

            if (membreCible) {
                if (membreCible.roles.highest.position >= interaction.guild.members.me.roles.highest.position) {
                    return interaction.reply({ content: 'Je ne peux pas bannir ce membre car il est au-dessus de moi dans la hiérarchie des rôles.', ephemeral: true });
                }

                // Vérification de la hiérarchie des rôles pour le modérateur qui exécute la commande
                if (membreCible.roles.highest.position >= modérateur.roles.highest.position) {
                    return interaction.reply({ content: 'Vous ne pouvez pas bannir ce membre car il est au même niveau ou au-dessus de vous dans la hiérarchie des rôles.', ephemeral: true });
                }

                try {
                    await utilisateur.send(`Vous avez été BANNI définitivement du serveur pour la raison : "${raison}".\nSi vous souhaitez vous faire debannir, vous pouvez rejoindre le serveur support : https://discord.gg/5yE4BXZ3Qn `);
                } catch {
                    console.warn('Impossible d\'envoyer un message privé avant le bannissement.');
                }
            }

            try {
                await interaction.guild.members.ban(utilisateur.id, { reason: raison });

                dbSanctions.run(`INSERT INTO sanctions (userId, type, reason, moderatorId, date) VALUES (?, ?, ?, ?, ?)`,
                    [utilisateur.id, 'Ban', raison, modérateur.id, Date.now()], function(err) {
                        if (!err) {
                            recentBotSanctions.add(`${utilisateur.id}_Ban`);
                            setTimeout(() => recentBotSanctions.delete(`${utilisateur.id}_Ban`), 5000);
                        }
                    });

                const canalLog = interaction.guild.channels.cache.get(logChannelId);
                if (canalLog && canalLog.isTextBased()) {
                    let messageLog = `# ${utilisateur.tag} (${utilisateur.id}) a été banni définitivement pour la raison : "${raison}" par ${modérateur} (${modérateur.id})`;
                    if (preuve && preuve.contentType && preuve.contentType.startsWith('image/')) {
                        canalLog.send({ content: messageLog, files: [preuve.url] });
                    } else {
                        if (preuve) {
                            messageLog += '\n⚠️ Preuve non acceptée (seules les captures d\'écran sont autorisées).';
                        }
                        canalLog.send({ content: messageLog });
                    }
                }

                await interaction.reply({ content: `${utilisateur.tag} a été banni définitivement.`, ephemeral: true });
            } catch (erreur) {
                console.error('Erreur lors du bannissement :', erreur);
                await interaction.reply({ content: 'Une erreur est survenue lors du bannissement.', ephemeral: true });
            }
        }

        if (interaction.commandName === 'note') {
            if (!interaction.member.roles.cache.has(roleModerateur)) {
                return interaction.reply({ content: 'Vous n\'avez pas l\'autorisation d\'utiliser cette commande.', ephemeral: true });
            }

            const utilisateur = interaction.options.getUser('utilisateur');
            const contenu = interaction.options.getString('contenu');
            const modérateur = interaction.member;

            dbNotes.run(`INSERT INTO notes (userId, note, moderatorId, date) VALUES (?, ?, ?, ?)`,
                [utilisateur.id, contenu, modérateur.id, Date.now()], function(err) {
                    if (err) {
                        console.error('Erreur lors de l\'ajout de la note :', err);
                        return interaction.reply({ content: 'Une erreur est survenue lors de l\'ajout de la note.', ephemeral: true });
                    }

                    interaction.reply({ content: `Note ajoutée à ${utilisateur.tag}. ID de la note : ${this.lastID}`, ephemeral: true });
                });
        }

        if (interaction.commandName === 'note-retirer') {
            if (!interaction.member.roles.cache.has(roleModerateur)) {
                return interaction.reply({ content: 'Vous n\'avez pas l\'autorisation d\'utiliser cette commande.', ephemeral: true });
            }

            const utilisateur = interaction.options.getUser('utilisateur');
            const noteId = interaction.options.getInteger('id');

            dbNotes.get(`SELECT * FROM notes WHERE id = ? AND userId = ?`, [noteId, utilisateur.id], (err, row) => {
                if (err) {
                    console.error('Erreur lors de la vérification de la note :', err);
                    return interaction.reply({ content: 'Une erreur est survenue lors de la vérification.', ephemeral: true });
                }

                if (!row) {
                    return interaction.reply({ content: 'Aucune note trouvée avec cet ID pour cet utilisateur.', ephemeral: true });
                }

                dbNotes.run(`DELETE FROM notes WHERE id = ?`, [noteId], (err) => {
                    if (err) {
                        console.error('Erreur lors de la suppression de la note :', err);
                        return interaction.reply({ content: 'Une erreur est survenue lors de la suppression de la note.', ephemeral: true });
                    }

                    interaction.reply({ content: `Note avec l'ID ${noteId} retirée de ${utilisateur.tag}.`, ephemeral: true });
                });
            });
        }

        if (interaction.commandName === 'modlog-sup') {
            if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
                return interaction.reply({ content: 'Vous n\'avez pas l\'autorisation d\'utiliser cette commande (réservée aux administrateurs).', ephemeral: true });
            }

            const utilisateur = interaction.options.getUser('utilisateur');
            const sanctionId = interaction.options.getInteger('id');
            const raisonSuppression = interaction.options.getString('raison');
            const modérateur = interaction.member;

            dbSanctions.get(`SELECT * FROM sanctions WHERE id = ? AND userId = ?`, [sanctionId, utilisateur.id], (err, row) => {
                if (err) {
                    console.error('Erreur lors de la vérification de la sanction :', err);
                    return interaction.reply({ content: 'Une erreur est survenue lors de la vérification.', ephemeral: true });
                }

                if (!row) {
                    return interaction.reply({ content: 'Aucune sanction trouvée avec cet ID pour cet utilisateur.', ephemeral: true });
                }

                if (row.pendingDeletion) {
                    return interaction.reply({ content: 'Cette sanction est déjà en cours de suppression.', ephemeral: true });
                }

                const suppressionTimestamp = Date.now() + (30 * 24 * 60 * 60 * 1000);

                dbSanctions.run(`UPDATE sanctions SET pendingDeletion = 1, deletionReason = ?, deletionModeratorId = ?, deletionDate = ? WHERE id = ?`,
                    [raisonSuppression, modérateur.id, suppressionTimestamp, sanctionId], (err) => {
                        if (err) {
                            console.error('Erreur lors de la mise à jour de la sanction :', err);
                            return interaction.reply({ content: 'Une erreur est survenue lors de la mise à jour de la sanction.', ephemeral: true });
                        }

                        interaction.reply({ content: `La sanction avec l'ID ${sanctionId} est programmée pour suppression dans un mois.`, ephemeral: true });
                    });
            });
        }

        if (interaction.commandName === 'modlog') {
            if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator) && !interaction.member.roles.cache.has(roleModerateur)) {
                return interaction.reply({ content: 'Vous n\'avez pas l\'autorisation d\'utiliser cette commande.', ephemeral: true });
            }

            const utilisateur = interaction.options.getUser('utilisateur');
            const cible = utilisateur;

            const [sanctions, notes] = await Promise.all([
                new Promise((resolve, reject) => {
                    dbSanctions.all(`SELECT s.*, r.name as rule_name FROM sanctions s LEFT JOIN rules r ON s.rule_id = r.id WHERE s.userId = ? ORDER BY s.date DESC`, [cible.id], (err, rows) => {
                        if (err) reject(err);
                        else resolve(rows);
                    });
                }),
                new Promise((resolve, reject) => {
                    dbNotes.all(`SELECT * FROM notes WHERE userId = ? ORDER BY date DESC`, [cible.id], (err, rows) => {
                        if (err) reject(err);
                        else resolve(rows);
                    });
                })
            ]);

            if (sanctions.length === 0 && notes.length === 0) {
                return interaction.reply({ content: 'Aucune sanction ou note trouvée pour cet utilisateur.' });
            }

            const historique = [];

            sanctions.forEach(s => {
                historique.push({
                    type: 'sanction',
                    date: s.date,
                    data: s
                });
            });

            notes.forEach(n => {
                historique.push({
                    type: 'note',
                    date: n.date,
                    data: n
                });
            });

            historique.sort((a, b) => b.date - a.date);

            const itemsParPage = 5;
            const pages = [];
            for (let i = 0; i < historique.length; i += itemsParPage) {
                const currentPage = historique.slice(i, i + itemsParPage);
                const embed = new EmbedBuilder()
                    .setTitle(`Historique des sanctions et des notes de ${cible.tag}`)
                    .setColor('#808080')
                    .setTimestamp();

                currentPage.forEach(item => {
                    const date = new Date(item.date).toLocaleString('fr-FR');
                    if (item.type === 'sanction') {
                        const sanction = item.data;
                        let description = `**ID :** ${sanction.id}\n`;
                        description += `**Type :** ${sanction.type}\n`;

                        if (sanction.type === 'Warn') {
                            description += `**Statut :** ${sanction.active ? 'Actif' : 'Expiré'}\n`;
                            description += `**Règle :** ${sanction.rule_name || sanction.reason}\n`;
                            if (sanction.active) {
                                const expiresDate = new Date(sanction.expires_at).toLocaleString('fr-FR');
                                description += `**Expire le :** ${expiresDate}\n`;
                            }
                        } else {
                            if (sanction.duration) {
                                description += `**Durée :** ${sanction.duration}\n`;
                            }
                            description += `**Raison :** ${sanction.reason}\n`;
                        }

                        description += `**Modérateur :** ${sanction.moderatorId.startsWith('Inconnu') || sanction.moderatorId === 'System' ? sanction.moderatorId : `<@${sanction.moderatorId}>`}\n`;
                        description += `**Date :** ${date}`;

                        if (sanction.pendingDeletion) {
                            const dateSuppression = new Date(sanction.deletionDate).toLocaleString('fr-FR');
                            const modSup = `<@${sanction.deletionModeratorId}>`;
                            description += `\n⚠️ **En cours de suppression par ${modSup} pour la raison : "${sanction.deletionReason}". Cette sanction sera supprimée le ${dateSuppression}.**`;
                        }

                        embed.addFields({ name: `${sanction.type} - ${date}`, value: description });
                    } else if (item.type === 'note') {
                        const note = item.data;
                        const modo = `<@${note.moderatorId}>`;
                        const description = `**Note ID :** ${note.id}\n**Modérateur :** ${modo}\n**Date :** ${date}\n**Contenu :** ${note.note}`;

                        embed.addFields({ name: `📝 Note ajoutée le ${date}`, value: description });
                    }
                });

                pages.push(embed);
            }

            let pageActuelle = 0;
            const row = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId('previous')
                        .setLabel('Précédent')
                        .setStyle(ButtonStyle.Primary)
                        .setDisabled(true),
                    new ButtonBuilder()
                        .setCustomId('next')
                        .setLabel('Suivant')
                        .setStyle(ButtonStyle.Primary)
                        .setDisabled(pages.length <= 1)
                );

            // Réponse éphémère avec bouton pour envoyer publiquement
            const publicButton = new ButtonBuilder()
                .setCustomId('send_public')
                .setLabel("Envoyer publiquement")
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(false);

            const rowWithPublic = new ActionRowBuilder()
                .addComponents(row.components[0], row.components[1], publicButton);

            await interaction.reply({ embeds: [pages[pageActuelle]], components: [rowWithPublic], ephemeral: true });
            const messageEmbed = await interaction.fetchReply();

            const collector = messageEmbed.createMessageComponentCollector({ componentType: ComponentType.Button, time: 60000 });

            collector.on('collect', async i => {
                if (i.user.id !== interaction.user.id) {
                    return i.reply({ content: 'Vous ne pouvez pas utiliser ces boutons.', ephemeral: true });
                }

                if (i.customId === 'previous') {
                    pageActuelle--;
                } else if (i.customId === 'next') {
                    pageActuelle++;
                } else if (i.customId === 'send_public') {
                    // Envoi public : envoyer une copie de l'embed sans boutons dans le canal courant
                    try {
                        const publicChannel = interaction.channel;
                        if (publicChannel && publicChannel.isTextBased()) {
                            await publicChannel.send({ embeds: [pages[pageActuelle]] });
                            await i.reply({ content: 'Embed envoyé publiquement.', ephemeral: true });
                        } else {
                            await i.reply({ content: 'Impossible d\'envoyer publiquement dans ce canal.', ephemeral: true });
                        }
                    } catch (err) {
                        console.error('Erreur en envoyant publiquement :', err);
                        await i.reply({ content: 'Erreur lors de l\'envoi public.', ephemeral: true });
                    }
                }

                row.components[0].setDisabled(pageActuelle === 0);
                row.components[1].setDisabled(pageActuelle === pages.length - 1);

                await i.update({ embeds: [pages[pageActuelle]], components: [rowWithPublic] });
            });

            collector.on('end', async () => {
                // Ajout d'un bloc try...catch pour éviter l'erreur si le message est déjà supprimé
                try {
                    // Réactiver la désactivation des boutons car le message n'est plus éphémère
                    row.components.forEach(button => button.setDisabled(true));
                    publicButton.setDisabled(true);
                    await messageEmbed.edit({ components: [rowWithPublic] });
                } catch (err) {
                    console.error('Impossible d\'éditer le message car il a probablement été supprimé:', err.message);
                }
            });
        }

        if (interaction.isAutocomplete() && interaction.commandName === 'warn') {
            const focusedValue = interaction.options.getFocused();
            dbRules.all('SELECT name FROM rules', [], (err, rows) => {
                if (err) {
                    console.error(err);
                    interaction.respond([]);
                    return;
                }
                const choices = rows.map(row => row.name);
                const filtered = choices.filter(choice => choice.toLowerCase().startsWith(focusedValue.toLowerCase()));
                interaction.respond(
                    filtered.map(choice => ({ name: choice, value: choice })),
                );
            });
        }

        if (interaction.commandName === 'warn') {
            if (!interaction.member.permissions.has(PermissionsBitField.Flags.ModerateMembers)) {
                return interaction.reply({ content: 'Vous n\'avez pas la permission d\'utiliser cette commande.', ephemeral: true });
            }

            const user = interaction.options.getUser('utilisateur');
            const reason = interaction.options.getString('raison');
            const moderator = interaction.member;

            dbRules.get('SELECT id FROM rules WHERE name = ?', [reason], (err, rule) => {
                if (err || !rule) {
                    return interaction.reply({ content: 'Raison invalide. Veuillez choisir une règle dans la liste.', ephemeral: true });
                }

                const expires_at = Date.now() + 60 * 24 * 60 * 60 * 1000; // 60 days

                dbSanctions.run('INSERT INTO sanctions (userId, type, reason, moderatorId, date, expires_at, rule_id) VALUES (?, ?, ?, ?, ?, ?, ?)', 
                [user.id, 'Warn', reason, moderator.id, Date.now(), expires_at, rule.id], function(err) {
                    if (err) {
                        return interaction.reply({ content: 'Erreur lors de l\'ajout du warn.', ephemeral: true });
                    }

                    interaction.reply({ content: `${user.tag} a été averti pour la raison : ${reason}.`, ephemeral: true });

                    // Check warns count
                    dbSanctions.all('SELECT id FROM sanctions WHERE userId = ? AND type = \'Warn\' AND active = 1', [user.id], async (err, rows) => {
                        if (err) return;

                        const warnCount = rows.length;
                        const member = await interaction.guild.members.fetch(user.id).catch(() => null);
                        if (!member) return;

                        if (warnCount === 4) {
                            // Ban
                            await member.ban({ reason: '4ème avertissement.' });
                            dbSanctions.run('INSERT INTO sanctions (userId, type, reason, moderatorId, date) VALUES (?, ?, ?, ?, ?)', 
                                [user.id, 'Ban', '4ème avertissement.', client.user.id, Date.now()]);
                            interaction.channel.send(`${user.tag} a été banni car il a atteint 4 avertissements.`);
                        } else if (warnCount === 3) {
                            // Mute for 1 week
                            const duration = 7 * 24 * 60 * 60 * 1000;
                            await member.timeout(duration, '3ème avertissement.');
                            dbSanctions.run('INSERT INTO sanctions (userId, type, reason, moderatorId, duration, date) VALUES (?, ?, ?, ?, ?, ?)', 
                                [user.id, 'Time Out', '3ème avertissement.', client.user.id, '1 semaine', Date.now()]);
                            interaction.channel.send(`${user.tag} a été mis en sourdine pendant 1 semaine car il a atteint 3 avertissements.`);
                        }
                    });
                });
            });
        }

        if (interaction.commandName === 'delete-warn') {
            if (!interaction.member.permissions.has(PermissionsBitField.Flags.ModerateMembers)) {
                return interaction.reply({ content: 'Vous n\'avez pas la permission d\'utiliser cette commande.', ephemeral: true });
            }

            const warnId = interaction.options.getInteger('warn_id');

            dbSanctions.run('UPDATE sanctions SET active = 0 WHERE id = ? AND type = \'Warn\'', [warnId], function(err) {
                if (err) {
                    return interaction.reply({ content: 'Erreur lors de la suppression du warn.', ephemeral: true });
                }
                if (this.changes === 0) {
                    return interaction.reply({ content: `Aucun avertissement trouvé avec l'ID ${warnId}.`, ephemeral: true });
                }
                interaction.reply({ content: `L\'avertissement avec l'ID ${warnId} a été supprimé.`, ephemeral: true });
            });
        }

        if (interaction.commandName === 'reglement-cree') {
            if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
                return interaction.reply({ content: 'Vous n\'avez pas la permission d\'utiliser cette commande.', ephemeral: true });
            }

            const modal = new ModalBuilder()
                .setCustomId('creerRegleModal')
                .setTitle('Créer une nouvelle règle');

            const nomInput = new TextInputBuilder()
                .setCustomId('nomRegleInput')
                .setLabel("Nom de la règle")
                .setStyle(TextInputStyle.Short)
                .setRequired(true);

            const descriptionInput = new TextInputBuilder()
                .setCustomId('descriptionRegleInput')
                .setLabel("Description de la règle")
                .setStyle(TextInputStyle.Paragraph)
                .setRequired(true);

            const firstActionRow = new ActionRowBuilder().addComponents(nomInput);
            const secondActionRow = new ActionRowBuilder().addComponents(descriptionInput);

            modal.addComponents(firstActionRow, secondActionRow);

            await interaction.showModal(modal);
        }

        if (interaction.isModalSubmit() && interaction.customId === 'creerRegleModal') {
            const nomRegle = interaction.fields.getTextInputValue('nomRegleInput');
            const descriptionRegle = interaction.fields.getTextInputValue('descriptionRegleInput');

            dbRules.run(`INSERT INTO rules (name, description) VALUES (?, ?)`, [nomRegle, descriptionRegle], async (err) => {
                if (err) {
                    console.error('Erreur lors de l\'ajout de la règle :', err);
                    return interaction.reply({ content: 'Une erreur est survenue lors de l\'ajout de la règle.', ephemeral: true });
                }

                await interaction.reply({ content: `Règle "${nomRegle}" ajoutée avec succès.`, ephemeral: true });

                // Mettre à jour le message du règlement
                const channel = interaction.channel;
                dbRules.all(`SELECT name, description FROM rules ORDER BY id`, [], async (err, rows) => {
                    if (err) {
                        console.error('Erreur lors de la récupération des règles :', err);
                        return;
                    }

                    const embeds = [];
                    let currentDescription = '';

                    rows.forEach(rule => {
                        const ruleText = `**${rule.name}**\n${rule.description}\n\n`;
                        if (currentDescription.length + ruleText.length > 4096) {
                            embeds.push(new EmbedBuilder().setTitle('Règlement du serveur').setDescription(currentDescription).setColor('#808080'));
                            currentDescription = '';
                        }
                        currentDescription += ruleText;
                    });

                    if (currentDescription) {
                        embeds.push(new EmbedBuilder().setTitle('Règlement du serveur').setDescription(currentDescription).setColor('#808080'));
                    }

                    // Chercher un ancien message de règlement
                    const messages = await channel.messages.fetch({ limit: 100 });
                    const botMessages = messages.filter(m => m.author.id === client.user.id && m.embeds.length > 0 && m.embeds[0].title === 'Règlement du serveur');

                    if (botMessages.size > 0) {
                        // Supprimer les anciens messages et envoyer les nouveaux
                        const oldMessages = Array.from(botMessages.values());
                        for (const oldMsg of oldMessages) {
                            await oldMsg.delete();
                        }
                    }
                    
                    for (const embed of embeds) {
                        await channel.send({ embeds: [embed] });
                    }
                });

                const row = new ActionRowBuilder()
                    .addComponents(
                        new ButtonBuilder()
                            .setCustomId('encore_reglement-cree')
                            .setLabel('Ajouter une autre règle')
                            .setStyle(ButtonStyle.Primary),
                    );

                await interaction.followUp({ content: 'Voulez-vous ajouter une autre règle ?', components: [row], ephemeral: true });
            });
        }

        if (interaction.isButton() && interaction.customId === 'encore_reglement-cree') {
            const modal = new ModalBuilder()
                .setCustomId('creerRegleModal')
                .setTitle('Créer une nouvelle règle');

            const nomInput = new TextInputBuilder()
                .setCustomId('nomRegleInput')
                .setLabel("Nom de la règle")
                .setStyle(TextInputStyle.Short)
                .setRequired(true);

            const descriptionInput = new TextInputBuilder()
                .setCustomId('descriptionRegleInput')
                .setLabel("Description de la règle")
                .setStyle(TextInputStyle.Paragraph)
                .setRequired(true);

            const firstActionRow = new ActionRowBuilder().addComponents(nomInput);
            const secondActionRow = new ActionRowBuilder().addComponents(descriptionInput);

            modal.addComponents(firstActionRow, secondActionRow);

            await interaction.showModal(modal);
        }

        if (interaction.commandName === 'staffwarn') {
            if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
                return interaction.reply({ content: 'Vous n\'avez pas la permission d\'utiliser cette commande.', ephemeral: true });
            }

            const utilisateur = interaction.options.getUser('utilisateur');
            const raison = interaction.options.getString('raison');
            const modérateur = interaction.member;

            const membreCible = await interaction.guild.members.fetch(utilisateur.id).catch(() => null);
            if (!membreCible) {
                return interaction.reply({ content: 'Membre introuvable.', ephemeral: true });
            }

            let modRoles;
            try {
                modRoles = JSON.parse(fs.readFileSync('./modération/mod_roles.json'));
            } catch (error) {
                console.error('Erreur lors de la lecture de mod_roles.json:', error);
                return interaction.reply({ content: 'Erreur de configuration des rôles de modération.', ephemeral: true });
            }

            const userRoles = membreCible.roles.cache.map(r => r.id);
            const userModRole = Object.keys(modRoles).find(roleId => userRoles.includes(roleId));

            if (!userModRole) {
                return interaction.reply({ content: 'Cet utilisateur n\'est pas un modérateur configurable pour la rétrogradation.', ephemeral: true });
            }

            dbStaffWarns.run('INSERT INTO staff_warns (userId, moderatorId, reason, date) VALUES (?, ?, ?, ?)', 
            [utilisateur.id, modérateur.id, raison, Date.now()], function(err) {
                if (err) {
                    return interaction.reply({ content: 'Erreur lors de l\'ajout du staffwarn.', ephemeral: true });
                }

                interaction.reply({ content: `${utilisateur.tag} a été averti (staff) pour la raison : ${raison}.`, ephemeral: true });

                dbStaffWarns.all('SELECT id FROM staff_warns WHERE userId = ?', [utilisateur.id], async (err, rows) => {
                    if (err) return;

                    if (rows.length >= 3) {
                        const demotionAction = modRoles[userModRole];

                        if (typeof demotionAction === 'string') { // Rétrogradation simple
                            const demotionRole = interaction.guild.roles.cache.get(demotionAction);
                            if (demotionRole) {
                                await membreCible.roles.remove(userModRole);
                                await membreCible.roles.add(demotionRole);
                                dbStaffWarns.run('DELETE FROM staff_warns WHERE userId = ?', [utilisateur.id]);
                                interaction.channel.send(`${utilisateur.tag} a été rétrogradé au rôle ${demotionRole.name} après 3 avertissements staff.`);
                            } else {
                                interaction.channel.send(`Erreur: Le rôle de rétrogradation pour ${utilisateur.tag} n\'a pas été trouvé.`);
                            }
                        } else if (Array.isArray(demotionAction)) { // Derank complet
                            for (const roleIdToRemove of demotionAction) {
                                const roleToRemove = interaction.guild.roles.cache.get(roleIdToRemove);
                                if (roleToRemove) {
                                    await membreCible.roles.remove(roleToRemove);
                                }
                            }
                            dbStaffWarns.run('DELETE FROM staff_warns WHERE userId = ?', [utilisateur.id]);
                            interaction.channel.send(`${utilisateur.tag} a été complètement rétrogradé après 3 avertissements staff.`);
                        }
                    }
                });
            });
        }

        if (interaction.commandName === 'demute') {
            if (!interaction.member.permissions.has(PermissionsBitField.Flags.ModerateMembers)) {
                return interaction.reply({ content: 'Vous n\'avez pas la permission d\'utiliser cette commande.', ephemeral: true });
            }

            const utilisateur = interaction.options.getUser('utilisateur');
            const membre = await interaction.guild.members.fetch(utilisateur.id).catch(() => null);

            if (!membre) {
                return interaction.reply({ content: 'Membre introuvable.', ephemeral: true });
            }

            try {
                await membre.timeout(null);
                await interaction.reply({ content: `${utilisateur.tag} a été démute.`, ephemeral: true });

                const canalLog = interaction.guild.channels.cache.get(logChannelId);
                if (canalLog && canalLog.isTextBased()) {
                    canalLog.send(`# ${utilisateur.tag} (${utilisateur.id}) a été démute par ${interaction.member} (${interaction.member.id})`);
                }
            } catch (error) {
                console.error('Erreur lors du demute:', error);
                interaction.reply({ content: 'Une erreur est survenue lors du demute.', ephemeral: true });
            }
        }

        if (interaction.commandName === 'deban') {
            if (!interaction.member.permissions.has(PermissionsBitField.Flags.BanMembers)) {
                return interaction.reply({ content: 'Vous n\'avez pas la permission d\'utiliser cette commande.', ephemeral: true });
            }

            const utilisateur = interaction.options.getUser('utilisateur');

            try {
                await interaction.guild.members.unban(utilisateur);
                await interaction.reply({ content: `${utilisateur.tag} a été débanni.`, ephemeral: true });

                const canalLog = interaction.guild.channels.cache.get(logChannelId);
                if (canalLog && canalLog.isTextBased()) {
                    canalLog.send(`# ${utilisateur.tag} (${utilisateur.id}) a été débanni par ${interaction.member} (${interaction.member.id})`);
                }
            } catch (error) {
                console.error('Erreur lors du deban:', error);
                interaction.reply({ content: 'Une erreur est survenue lors du deban. Il se peut que l\'utilisateur ne soit pas banni.', ephemeral: true });
            }
        }

    } catch (erreur) {
        console.error('Erreur lors du traitement de la commande :', erreur);
        try {
            // S'assurer que le message d'erreur reste éphémère pour ne pas spammer le canal
            await interaction.reply({ content: 'Une erreur est survenue lors du traitement de la commande.', ephemeral: true });
        } catch (err) {
            console.error('Erreur lors de l\'envoi du message d\'erreur à l\'utilisateur :', err);
        }
    }
});

// Fonction pour vérifier et supprimer les sanctions arrivées à échéance de suppression
setInterval(() => {
    const now = Date.now();
    dbSanctions.all(`SELECT id FROM sanctions WHERE pendingDeletion = 1 AND deletionDate <= ?`, [now], (err, rows) => {
        if (err) {
            console.error('Erreur lors de la vérification des sanctions à supprimer :', err);
            return;
        }

        // Utiliser une transaction pour les suppressions multiples
        if (rows.length > 0) {
            dbSanctions.serialize(() => {
                dbSanctions.run('BEGIN TRANSACTION;');
                rows.forEach(sanction => {
                    dbSanctions.run(`DELETE FROM sanctions WHERE id = ?`, [sanction.id], (err) => {
                        if (err) {
                            console.error(`Erreur lors de la suppression de la sanction ID ${sanction.id} :`, err);
                        } else {
                            console.log(`Sanction ID ${sanction.id} supprimée avec succès.`);
                        }
                    });
                });
                dbSanctions.run('COMMIT;', (err) => {
                    if (err) {
                        console.error('Erreur lors de la validation de la transaction de suppression :', err);
                    }
                });
            });
        }
    });
}, 60 * 60 * 1000);

client.on('messageCreate', async message => {
    if (message.author.bot) return;

    try {
        const userId = message.author.id;
        const currentChannelId = message.channel.id;
        const currentTime = Date.now();
        const lastMessageData = userMessageMap.get(userId);

        if (lastMessageData) {
            const { time: lastMessageTime, channelId: lastChannelId, content: lastMessageContent, count: messageCount } = lastMessageData;

            if (currentChannelId !== lastChannelId && (currentTime - lastMessageTime) <= 1000) {

                if (message.content === lastMessageContent) {
                    const membre = await message.guild.members.fetch(userId);

                    const newMessageCount = (messageCount || 0) + 1;

                    if (newMessageCount > 3) {
                        const duréeMs = 60 * 60 * 1000;
                        const duréeTexte = '1 heure';
                        const raison = `Spam inter-salons du message : "${message.content}"`;

                        if (membre.communicationDisabledUntilTimestamp && membre.communicationDisabledUntilTimestamp > Date.now()) {
                            return;
                        }

                        await membre.timeout(duréeMs, raison);

                        dbSanctions.run(`INSERT INTO sanctions (userId, type, reason, moderatorId, duration, date) VALUES (?, ?, ?, ?, ?, ?)`,
                            [userId, 'Time Out', raison, 'System', duréeTexte, Date.now()]);

                        const channelLog = client.channels.cache.get(logChannelId);
                        if (channelLog && channelLog.isTextBased()) {
                            channelLog.send(`# ${membre.user.tag} (${userId}) a été time out pendant ${duréeTexte} pour la raison "${raison}"`);
                        }

                        try {
                            await membre.send(`Vous avez été time out (mute) pour la raison : "${raison}" pendant une durée de ${duréeTexte}.`);
                        } catch {
                            console.warn('Impossible d\'envoyer un message privé au membre.');
                        }

                        message.delete();

                        userMessageMap.set(userId, {
                            time: currentTime,
                            channelId: currentChannelId,
                            content: message.content,
                            count: 0
                        });

                        return;
                    } else {
                        userMessageMap.set(userId, {
                            time: currentTime,
                            channelId: currentChannelId,
                            content: message.content,
                            count: newMessageCount
                        });
                    }
                }
            }
        }

        userMessageMap.set(userId, {
            time: currentTime,
            channelId: currentChannelId,
            content: message.content,
            count: 0
        });

    } catch (erreur) {
        console.error('Erreur lors de la gestion du spam inter-salons :', erreur);
    }
});

client.on('guildMemberUpdate', async (oldMember, newMember) => {
    if (!oldMember.communicationDisabledUntil && newMember.communicationDisabledUntil) {
        if (recentBotSanctions.has(`${newMember.id}_Time Out`)) {
            recentBotSanctions.delete(`${newMember.id}_Time Out`);
            return;
        }

        const durationMs = newMember.communicationDisabledUntilTimestamp - Date.now();
        const duration = msToReadableTime(durationMs);

        const auditLogs = await newMember.guild.fetchAuditLogs({ limit: 1, type: AuditLogEvent.MemberUpdate });
        const logEntry = auditLogs.entries.first();

        let modérateur = 'Inconnu (action externe)';
        let raison = 'Raison non spécifiée';

        // Vérifier si l'entrée de log correspond à l'action sur le membre et est récente
        if (logEntry && logEntry.target.id === newMember.id && (Date.now() - logEntry.createdTimestamp) < 5000) {
            modérateur = logEntry.executor ? logEntry.executor.id : 'Inconnu (action externe)';
            raison = logEntry.reason || 'Raison non spécifiée';
        }

        // Vérification que la durée est valide (Discord a une limite de 28 jours pour les time out)
        if (durationMs > 0 && durationMs <= 28 * 24 * 60 * 60 * 1000) {
            // Enregistrement de la sanction dans la base de données
            dbSanctions.run(`INSERT INTO sanctions (userId, type, reason, moderatorId, duration, date) VALUES (?, ?, ?, ?, ?, ?)`,
                [newMember.id, 'Time Out', raison, modérateur, duration, Date.now()]);
        }
    }
});

client.on('guildBanAdd', async (ban) => {
    // Vérifier si cette sanction a été initiée par le bot via une commande slash récente
    if (recentBotSanctions.has(`${ban.user.id}_Ban`)) {
        recentBotSanctions.delete(`${ban.user.id}_Ban`); // Supprimer du cache
        return; // Ignorer cet événement car la sanction a déjà été enregistrée par la commande
    }

    // Utilisation de AuditLogEvent.MemberBanAdd pour trouver qui a fait l'action et pourquoi
    const auditLogs = await ban.guild.fetchAuditLogs({ limit: 1, type: AuditLogEvent.MemberBanAdd });
    const logEntry = auditLogs.entries.first();

    let modérateur = 'Inconnu (action externe)';
    let raison = 'Raison non spécifiée';

    // Vérifier si l'entrée de log correspond à l'action sur l'utilisateur banni et est récente
    if (logEntry && logEntry.target.id === ban.user.id && (Date.now() - logEntry.createdTimestamp) < 5000) {
        modérateur = logEntry.executor ? logEntry.executor.id : 'Inconnu (action externe)';
        raison = logEntry.reason || 'Raison non spécifiée';
    }

    // Enregistrement de la sanction dans la base de données
    dbSanctions.run(`INSERT INTO sanctions (userId, type, reason, moderatorId, date) VALUES (?, ?, ?, ?, ?)`,
        [ban.user.id, 'Ban', raison, modérateur, Date.now()]);
});

// Connexion du bot à Discord
setInterval(() => {
    dbSanctions.run('UPDATE sanctions SET active = 0 WHERE type = \'Warn\' AND expires_at < ? AND active = 1', [Date.now()], function(err) {
        if (err) {
            console.error('Erreur lors de la désactivation des avertissements expirés:', err);
        }
        if (this.changes > 0) {
            console.log(`${this.changes} avertissement(s) expirés ont été désactivés.`);
        }
    });
}, 60 * 60 * 1000); // Toutes les heures

setInterval(() => {
    dbTempRemovedRoles.all('SELECT * FROM temp_removed_roles WHERE expires_at < ?', [Date.now()], (err, rows) => {
        if (err) {
            console.error('Erreur lors de la récupération des rôles à restaurer:', err);
            return;
        }
        rows.forEach(async (row) => {
            const guild = client.guilds.cache.first();
            if (!guild) return;
            try {
                const member = await guild.members.fetch(row.userId);
                const role = guild.roles.cache.get(row.roleId);
                if (member && role) {
                    await member.roles.add(role, 'Restauration de rôle après mute');
                }
                dbTempRemovedRoles.run('DELETE FROM temp_removed_roles WHERE userId = ? AND roleId = ?', [row.userId, row.roleId]);
            } catch (e) {
                console.error('Erreur lors de la restauration de rôle:', e);
            }
        });
    });
}, 60 * 1000); // Toutes les minutes

client.login(process.env.BOT_TOKEN);
