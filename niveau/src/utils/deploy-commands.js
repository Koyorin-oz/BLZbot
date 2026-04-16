const logger = require('./logger');
const fs = require('node:fs');
const path = require('node:path');
const { MAIN_COMMAND_SUBDIRS: mainCommandSubdirs } = require('./command-loader');
const { getEventState: getHalloweenState } = require('./db-halloween');
const { getEventState: getChristmasState } = require('./db-noel');
const { getEventState: getValentinState } = require('./db-valentin');
const { getSlashDeployGuildIds } = require(path.join(__dirname, '..', '..', '..', 'blzbot-env.js'));

// Fonction pour charger les données de commande depuis un fichier
function loadCommandData(filePath) {
    try {
        const resolved = path.resolve(filePath);
        /* Slash sensibles aux options : recharger le module pour un toJSON à jour au deploy. */
        if (path.basename(filePath) === 'testprofil.js' || path.basename(filePath) === 'profil-v2.js') {
            delete require.cache[resolved];
        }
        const command = require(filePath);
        if (command.data && command.execute) {
            const raw =
                typeof command.data.toJSON === 'function' ? command.data.toJSON() : command.data;
            return raw && typeof raw === 'object' ? { ...raw } : null;
        }
    } catch (e) {
        logger.error(`Erreur de chargement pour la commande à ${filePath}: ${e?.message || e}`);
    }
    return null;
}

/**
 * Payload stable pour comparer une commande locale (toJSON) et une commande Discord (ApplicationCommand).
 * Évite les « skip » à tort (ordre d’options, champs extra API, objets vs plain JSON).
 */
function normalizeSlashCommandPayload(cmd) {
    const c = cmd && typeof cmd.toJSON === 'function' ? cmd.toJSON() : cmd;
    if (!c || typeof c !== 'object') return '';
    const pickChoice = (ch) => ({ name: ch.name, value: ch.value });
    const pickOption = (o) => {
        const j = o && typeof o.toJSON === 'function' ? o.toJSON() : o;
        if (!j || typeof j !== 'object') return null;
        const out = {
            type: j.type,
            name: j.name,
            description: j.description || '',
            required: Boolean(j.required),
        };
        if (Array.isArray(j.choices) && j.choices.length) {
            out.choices = [...j.choices]
                .map(pickChoice)
                .sort((a, b) => String(a.value).localeCompare(String(b.value)));
        }
        if (Array.isArray(j.options) && j.options.length) {
            out.options = [...j.options].map(pickOption).filter(Boolean).sort((a, b) => a.name.localeCompare(b.name));
        }
        return out;
    };
    const opts = [...(c.options || [])]
        .map(pickOption)
        .filter(Boolean)
        .sort((a, b) => a.name.localeCompare(b.name));
    const perm =
        c.default_member_permissions != null
            ? String(c.default_member_permissions)
            : c.defaultMemberPermissions != null
              ? String(c.defaultMemberPermissions)
              : null;
    return JSON.stringify({
        description: c.description || '',
        options: opts,
        default_member_permissions: perm,
    });
}

// Compare deux commandes pour déterminer si elles sont identiques
function commandsAreEqual(remote, local) {
    return normalizeSlashCommandPayload(remote) === normalizeSlashCommandPayload(local);
}

module.exports = async function deployCommands(client) {
    const compact = process.env.BLZ_COMPACT_LOG === '1';
    if (!compact) {
        console.log('\n═══════════════════════════════════════════════════════════════');
        console.log('[DEPLOY-COMMANDS] Starting command deployment (Safe Mode)...');
        console.log('═══════════════════════════════════════════════════════════════\n');
    }

    const commandsPath = path.join(__dirname, '..', 'commands');
    const halloweenCommandsPath = path.join(commandsPath, 'halloween');
    const christmasCommandsPath = path.join(commandsPath, 'noël');
    const valentinCommandsPath = path.join(commandsPath, 'saint-valentin');
    const isHalloweenActive = getHalloweenState('halloween');
    const isChristmasActive = getChristmasState('noël');
    const isValentinActive = getValentinState('valentin');

    // 1. Déterminer la liste des commandes que ce script est censé gérer
    const localCommands = new Map();

    // Charger les commandes principales (core, guilde, admin, misc)
    for (const sub of mainCommandSubdirs) {
        const dir = path.join(commandsPath, sub);
        if (!fs.existsSync(dir)) continue;
        fs.readdirSync(dir)
            .filter((file) => file.endsWith('.js'))
            .forEach((file) => {
                const commandData = loadCommandData(path.join(dir, file));
                if (commandData) localCommands.set(commandData.name, { ...commandData, source: 'normal' });
            });
    }

    if (fs.existsSync(halloweenCommandsPath)) {
        fs.readdirSync(halloweenCommandsPath)
            .filter((file) => file.endsWith('.js'))
            .forEach((file) => {
                const commandData = loadCommandData(path.join(halloweenCommandsPath, file));
                if (commandData) localCommands.set(commandData.name, { ...commandData, source: 'halloween' });
            });
    }

    if (fs.existsSync(christmasCommandsPath)) {
        fs.readdirSync(christmasCommandsPath)
            .filter((file) => file.endsWith('.js'))
            .forEach((file) => {
                const commandData = loadCommandData(path.join(christmasCommandsPath, file));
                if (commandData) localCommands.set(commandData.name, { ...commandData, source: 'christmas' });
            });
    }

    // Charger les commandes de Saint-Valentin
    if (fs.existsSync(valentinCommandsPath)) {
        fs.readdirSync(valentinCommandsPath)
            .filter(file => file.endsWith('.js'))
            .forEach(file => {
                const commandData = loadCommandData(path.join(valentinCommandsPath, file));
                if (commandData) localCommands.set(commandData.name, { ...commandData, source: 'valentin' });
            });
    }

    if (!compact) console.log(`[DEPLOY] Loaded ${localCommands.size} local commands`);
    const hasPanelVoc = localCommands.has('panel-voc');
    const hasStatsVocPanel = localCommands.has('stats-voc-panel');
    console.log(
        `[niveau/deploy] /panel-voc code : ${hasPanelVoc ? 'OUI ✓' : 'NON ✗'} · /stats-voc-panel code : ${
            hasStatsVocPanel ? 'OUI ✓' : 'NON ✗'
        }`
    );

    if (!client.isReady()) {
        if (!compact) console.log('[DEPLOY] Waiting for client to be ready...');
        await new Promise((resolve) => client.once('clientReady', resolve));
    }

    try {
        const guildIds = getSlashDeployGuildIds();
        if (guildIds.length === 0) {
            const msg = 'Aucun GUILD_ID valide pour enregistrer les commandes (vérifie le .env).';
            console.error(`[DEPLOY] ❌ ${msg}`);
            logger.error(msg);
            throw new Error(msg);
        }

        if (!compact) console.log(`[DEPLOY] Guildes cibles: ${guildIds.join(', ')}`);

        const commandsToCreate = [];
        for (const [name, command] of localCommands.entries()) {
            const shouldBeActive =
                command.source === 'normal' ||
                (command.source === 'halloween' && isHalloweenActive) ||
                (command.source === 'christmas' && isChristmasActive) ||
                (command.source === 'valentin' && isValentinActive);

            if (shouldBeActive) {
                const { source, ...cleanCmd } = command;
                commandsToCreate.push(cleanCmd);
            }
        }

        let createdCount = 0;
        let updatedCount = 0;
        let skippedCount = 0;
        let errorCount = 0;
        let anyGuildOk = false;

        for (const gid of guildIds) {
            const guild = await client.guilds.fetch(gid).catch((err) => {
                console.error(`[DEPLOY] Guilde ${gid} introuvable ou pas membre: ${err.message || err}`);
                return null;
            });
            if (!guild) continue;
            anyGuildOk = true;

            if (!compact) console.log(`\n[DEPLOY] — ${guild.name} (${guild.id})`);

            const existingCommands = await guild.commands.fetch();
            const existingMap = new Map();
            existingCommands.forEach((cmd) => existingMap.set(cmd.name, cmd));

            if (!compact) console.log(`[DEPLOY] ${existingMap.size} commandes déjà sur cette guilde`);

            for (let i = 0; i < commandsToCreate.length; i++) {
                const commandData = commandsToCreate[i];
                const existing = existingMap.get(commandData.name);

                /* Toujours re-PUT /testprofil : évite les définitions slash obsolètes (option style) si Discord/API skip à tort. */
                const forceRefresh =
                    commandData.name === 'testprofil' ||
                    String(process.env.BLZ_FORCE_SLASH_REFRESH_NAMES || '')
                        .split(/[,;]/)
                        .map((s) => s.trim())
                        .filter(Boolean)
                        .includes(commandData.name);

                if (existing && commandsAreEqual(existing, commandData) && !forceRefresh) {
                    skippedCount++;
                    continue;
                }

                const action = existing ? 'Updating' : 'Creating';
                try {
                    if (!compact) {
                        console.log(`[${createdCount + updatedCount + errorCount + 1}] ${action} /${commandData.name}...`);
                    }
                    if (existing) {
                        await guild.commands.edit(existing.id, commandData);
                    } else {
                        await guild.commands.create(commandData);
                    }
                    if (!compact) {
                        console.log(`  ✅ ${action === 'Creating' ? 'Created' : 'Updated'}: /${commandData.name}`);
                    }
                    if (existing) updatedCount++;
                    else createdCount++;
                } catch (cmdError) {
                    const errLine = `${cmdError?.message || cmdError}${cmdError?.code ? ` [${cmdError.code}]` : ''}`;
                    console.error(`[DEPLOY] /${commandData.name}: ${errLine}`);
                    logger.error(`Erreur commande /${commandData.name}: ${errLine}`);
                    errorCount++;
                }
            }
        }

        if (!anyGuildOk) {
            throw new Error('Aucune guilde accessible pour le déploiement des slash.');
        }

        if (compact) {
            const hasPanelVoc = localCommands.has('panel-voc');
            const hasStatsVocPanel = localCommands.has('stats-voc-panel');
            console.log(
                `[niveau] Slash : +${createdCount} ~${updatedCount} skip ${skippedCount} err ${errorCount} · guildes ${guildIds.join(',')} · /panel-voc:${hasPanelVoc} · /stats-voc-panel:${hasStatsVocPanel}`
            );
        } else {
            console.log('\n═══════════════════════════════════════════════════════════════');
            console.log(`[DEPLOY] ✅ Deployment complete (${guildIds.length} guilde(s)):`);
            console.log(`  📦 ${createdCount} created, 🔄 ${updatedCount} updated, ⏭️ ${skippedCount} unchanged, ❌ ${errorCount} errors`);
            console.log('═══════════════════════════════════════════════════════════════\n');
        }

        if (!compact) {
            logger.info(`Commandes niveau: ${createdCount} new, ${updatedCount} updated, ${skippedCount} skipped, ${errorCount} errors`);
        }
    } catch (error) {
        const code = error && error.code;
        if (code === 10004) {
            const hint =
                '[DEPLOY] Unknown Guild — vérifie GUILD_ID dans le .env à la racine (identique au serveur où le bot est membre).';
            console.error(hint);
            logger.warn(hint);
        } else {
            console.error('[DEPLOY] ❌', error.message || error);
            logger.error('Erreur déploiement commandes:', error.message || error);
        }
        throw error;
    }
};
