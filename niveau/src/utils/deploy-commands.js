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

// Compare deux commandes pour déterminer si elles sont identiques
function commandsAreEqual(remote, local) {
    // Comparer les champs principaux
    if (remote.description !== local.description) return false;

    // Comparer les options (arguments, sous-commandes, etc.)
    const remoteOpts = JSON.stringify(remote.options || []);
    const localOpts = JSON.stringify(local.options || []);
    if (remoteOpts !== localOpts) return false;

    // Comparer default_member_permissions (Discord renvoie souvent un BigInt, le JSON local une chaîne)
    const rp = remote.defaultMemberPermissions != null ? String(remote.defaultMemberPermissions) : '';
    const lp = local.default_member_permissions != null ? String(local.default_member_permissions) : '';
    if (rp !== lp) return false;

    return true;
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
    console.log(
        `[niveau/deploy] /panel-voc présent dans le code : ${hasPanelVoc ? 'OUI ✓' : 'NON ✗ (fichier panel-voc.js manquant sur ce serveur ?)'}`
    );

    if (!client.isReady()) {
        if (!compact) console.log('[DEPLOY] Waiting for client to be ready...');
        await new Promise((resolve) => client.once('clientReady', resolve));
    }

    try {
        const guild = await client.guilds.fetch(process.env.GUILD_ID);
        if (!guild) {
            const msg = 'Guilde introuvable pour enregistrer les commandes (vérifie GUILD_ID dans .env).';
            console.error(`[DEPLOY] ❌ ${msg}`);
            logger.error(msg);
            throw new Error(msg);
        }

        if (!compact) console.log(`[DEPLOY] Guild found: ${guild.name}\n`);

        const existingCommands = await guild.commands.fetch();
        const existingMap = new Map();
        existingCommands.forEach(cmd => existingMap.set(cmd.name, cmd));

        if (!compact) console.log(`[DEPLOY] ${existingMap.size} commands already on Discord`);

        // 3. Filtrer les commandes actives
        const commandsToCreate = [];
        const managedNames = new Set(); // Noms gérés par ce script

        for (const [name, command] of localCommands.entries()) {
            const shouldBeActive = command.source === 'normal' ||
                (command.source === 'halloween' && isHalloweenActive) ||
                (command.source === 'christmas' && isChristmasActive) ||
                (command.source === 'valentin' && isValentinActive);

            managedNames.add(name);

            if (shouldBeActive) {
                const { source, ...cleanCmd } = command;
                commandsToCreate.push(cleanCmd);
            }
        }

        // 4. Comparer et ne déployer que ce qui a changé
        let createdCount = 0;
        let updatedCount = 0;
        let skippedCount = 0;
        let errorCount = 0;

        for (let i = 0; i < commandsToCreate.length; i++) {
            const commandData = commandsToCreate[i];
            const existing = existingMap.get(commandData.name);

            if (existing && commandsAreEqual(existing, commandData)) {
                // La commande existe et n'a pas changé → skip
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

        if (compact) {
            const hasPanelVoc = localCommands.has('panel-voc');
            console.log(
                `[niveau] Slash : +${createdCount} ~${updatedCount} skip ${skippedCount} err ${errorCount} (${guild.name}) · chargé /panel-voc:${hasPanelVoc}`
            );
        } else {
            console.log('\n═══════════════════════════════════════════════════════════════');
            console.log(`[DEPLOY] ✅ Deployment complete:`);
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
