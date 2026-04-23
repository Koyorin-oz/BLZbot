const logger = require('./logger');
const fs = require('node:fs');
const path = require('node:path');
const {
    MAIN_COMMAND_SUBDIRS: mainCommandSubdirs,
    isArchivedSlashCommandFile,
} = require('./command-loader');
const { getEventState: getHalloweenState } = require('./db-halloween');
const { getEventState: getChristmasState } = require('./db-noel');
const { getEventState: getValentinState } = require('./db-valentin');

// Slash obsolètes à retirer (ancienne convention, remplacés par /profil, ou commandes de test retirées).
const OBSOLETE_SLASH_NAMES = new Set(['profil-v2', 'profile', 'testprofil', 'testprofilguilde']);

function loadCommandData(filePath) {
    try {
        const resolved = path.resolve(filePath);
        /* Slash sensibles aux options : recharger le module pour un toJSON à jour au deploy. */
        const slashReloadBasenames = new Set(['testprofil.js', 'profil.js']);
        if (slashReloadBasenames.has(path.basename(filePath))) {
            delete require.cache[resolved];
            const helpers = [
                path.resolve(__dirname, 'render-profile-fiche-preview-interaction.js'),
                path.resolve(__dirname, '..', 'commands', 'core', 'profil-v2-factory.js'),
            ];
            for (const h of helpers) {
                if (require.cache[h]) delete require.cache[h];
            }
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
 * Payload stable pour comparer une commande locale (toJSON) et une commande Discord.
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

function commandsAreEqual(remote, local) {
    return normalizeSlashCommandPayload(remote) === normalizeSlashCommandPayload(local);
}

/**
 * Déploiement GLOBAL des slash commands du bot « niveau ».
 *
 * Politique : TOUTES les commandes vont sur l'application globale du bot et deviennent
 * donc automatiquement disponibles sur chaque serveur où le bot est invité.
 * Les commandes d'événements (Halloween / Noël / Saint-Valentin) sont publiées seulement
 * quand l'événement est actif ; sinon elles sont retirées du global.
 */
module.exports = async function deployCommands(client) {
    const compact = process.env.BLZ_COMPACT_LOG === '1';
    if (!compact) {
        console.log('\n═══════════════════════════════════════════════════════════════');
        console.log('[DEPLOY-COMMANDS] Déploiement GLOBAL — disponible sur toutes les guildes.');
        console.log('═══════════════════════════════════════════════════════════════\n');
    }

    const commandsPath = path.join(__dirname, '..', 'commands');
    const halloweenCommandsPath = path.join(commandsPath, 'halloween');
    const christmasCommandsPath = path.join(commandsPath, 'noël');
    const valentinCommandsPath = path.join(commandsPath, 'saint-valentin');
    const isHalloweenActive = getHalloweenState('halloween');
    const isChristmasActive = getChristmasState('noël');
    const isValentinActive = getValentinState('valentin');

    // 1. Charger toutes les commandes locales depuis le disque
    const localCommands = new Map();

    for (const sub of mainCommandSubdirs) {
        const dir = path.join(commandsPath, sub);
        if (!fs.existsSync(dir)) continue;
        fs.readdirSync(dir)
            .filter((file) => file.endsWith('.js') && !isArchivedSlashCommandFile(file))
            .forEach((file) => {
                const commandData = loadCommandData(path.join(dir, file));
                if (commandData) localCommands.set(commandData.name, { ...commandData, source: 'normal' });
            });
    }

    if (fs.existsSync(halloweenCommandsPath)) {
        fs.readdirSync(halloweenCommandsPath)
            .filter((file) => file.endsWith('.js') && !isArchivedSlashCommandFile(file))
            .forEach((file) => {
                const commandData = loadCommandData(path.join(halloweenCommandsPath, file));
                if (commandData) localCommands.set(commandData.name, { ...commandData, source: 'halloween' });
            });
    }

    if (fs.existsSync(christmasCommandsPath)) {
        fs.readdirSync(christmasCommandsPath)
            .filter((file) => file.endsWith('.js') && !isArchivedSlashCommandFile(file))
            .forEach((file) => {
                const commandData = loadCommandData(path.join(christmasCommandsPath, file));
                if (commandData) localCommands.set(commandData.name, { ...commandData, source: 'christmas' });
            });
    }

    if (fs.existsSync(valentinCommandsPath)) {
        fs.readdirSync(valentinCommandsPath)
            .filter((file) => file.endsWith('.js') && !isArchivedSlashCommandFile(file))
            .forEach((file) => {
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
        // 2. Filtrer : ne garder que les commandes actives (events saisonniers éteints = à retirer)
        const commandsToDeploy = new Map();
        for (const [name, command] of localCommands.entries()) {
            const shouldBeActive =
                command.source === 'normal' ||
                (command.source === 'halloween' && isHalloweenActive) ||
                (command.source === 'christmas' && isChristmasActive) ||
                (command.source === 'valentin' && isValentinActive);
            if (!shouldBeActive) continue;
            const { source, ...cleanCmd } = command;
            commandsToDeploy.set(name, cleanCmd);
        }

        const forceRefreshNames = new Set(
            ['testprofil', 'profil']
                .concat(
                    String(process.env.BLZ_FORCE_SLASH_REFRESH_NAMES || '')
                        .split(/[,;]/)
                        .map((s) => s.trim())
                        .filter(Boolean)
                )
        );

        // 3. Déploiement GLOBAL
        let appCommands;
        try {
            appCommands = await client.application.commands.fetch();
        } catch (fetchError) {
            throw new Error(`Fetch application commands: ${fetchError.message || fetchError}`);
        }
        const appMap = new Map();
        appCommands.forEach((cmd) => appMap.set(cmd.name, cmd));

        let createdCount = 0;
        let updatedCount = 0;
        let skippedCount = 0;
        let errorCount = 0;
        let deletedGlobal = 0;

        for (const [name, commandData] of commandsToDeploy.entries()) {
            const existing = appMap.get(name);
            const forceRefresh = forceRefreshNames.has(name);

            if (existing && commandsAreEqual(existing, commandData) && !forceRefresh) {
                skippedCount++;
                continue;
            }

            const action = existing ? 'Updating' : 'Creating';
            try {
                if (!compact) {
                    console.log(`[${createdCount + updatedCount + errorCount + 1}] ${action} /${name} (global)…`);
                }
                if (existing) {
                    await client.application.commands.edit(existing.id, commandData);
                    updatedCount++;
                    if (!compact) console.log(`  ✅ Updated: /${name}`);
                } else {
                    await client.application.commands.create(commandData);
                    createdCount++;
                    if (!compact) console.log(`  ✅ Created: /${name}`);
                }
            } catch (cmdError) {
                const errLine = `${cmdError?.message || cmdError}${cmdError?.code ? ` [${cmdError.code}]` : ''}`;
                console.error(`[DEPLOY] /${name}: ${errLine}`);
                logger.error(`Erreur commande /${name}: ${errLine}`);
                errorCount++;
            }
        }

        // 4. Purge globale : retirer du global les commandes obsolètes + events désactivés + commandes
        // supprimées côté code. Critère : présente en global mais absente de commandsToDeploy.
        for (const cmd of appCommands.values()) {
            if (commandsToDeploy.has(cmd.name)) continue;
            // On ne touche qu'à ce qu'on connaît (obsolètes, ou commande qui était en local mais désactivée)
            const isKnownObsolete = OBSOLETE_SLASH_NAMES.has(cmd.name);
            const wasLocalButDisabled = localCommands.has(cmd.name);
            if (!isKnownObsolete && !wasLocalButDisabled) continue;
            try {
                await cmd.delete();
                deletedGlobal++;
                if (!compact) console.log(`🗑️ [GLOBAL] supprimée : /${cmd.name}`);
            } catch (_) { /* noop */ }
        }

        // 5. Nettoyage par guilde : supprimer les doublons guild-spécifiques d'anciennes versions.
        let guildCleanupTotal = 0;
        let guildsVisited = 0;
        let guildsInError = 0;
        for (const [, guild] of client.guilds.cache) {
            guildsVisited++;
            try {
                const existing = await guild.commands.fetch();
                for (const cmd of existing.values()) {
                    const shouldDelete =
                        commandsToDeploy.has(cmd.name) ||
                        localCommands.has(cmd.name) ||
                        OBSOLETE_SLASH_NAMES.has(cmd.name);
                    if (!shouldDelete) continue;
                    try {
                        await cmd.delete();
                        guildCleanupTotal++;
                        if (!compact) console.log(`🗑️ [${guild.name}] doublon guilde supprimé : /${cmd.name}`);
                    } catch (_) { /* noop */ }
                }
            } catch (guildError) {
                guildsInError++;
                if (!compact) {
                    console.warn(
                        `[niveau/deploy] nettoyage ${guild.name} (${guild.id}) : ${guildError?.message || guildError}`
                    );
                }
            }
        }

        if (compact) {
            console.log(
                `[niveau] Slash GLOBAL : +${createdCount} ~${updatedCount} skip ${skippedCount} err ${errorCount} · purgeGlobal ${deletedGlobal} · cleanGuilds ${guildCleanupTotal}/${guildsVisited}${guildsInError ? ` (err ${guildsInError})` : ''} · /panel-voc:${hasPanelVoc} · /stats-voc-panel:${hasStatsVocPanel}`
            );
        } else {
            console.log('\n═══════════════════════════════════════════════════════════════');
            console.log(`[DEPLOY] ✅ Déploiement GLOBAL terminé`);
            console.log(`  📦 ${createdCount} créée(s), 🔄 ${updatedCount} MAJ, ⏭️ ${skippedCount} inchangée(s), ❌ ${errorCount} erreur(s)`);
            console.log(`  🗑️ ${deletedGlobal} retirée(s) du global (obsolètes/désactivées)`);
            console.log(`  🧹 ${guildCleanupTotal} doublon(s) guilde purgé(s) sur ${guildsVisited} guilde(s)${guildsInError ? ` (${guildsInError} erreur(s))` : ''}`);
            console.log('═══════════════════════════════════════════════════════════════\n');
        }

        if (!compact) {
            logger.info(`Commandes niveau (global): ${createdCount} new, ${updatedCount} updated, ${skippedCount} skipped, ${errorCount} errors`);
        }
    } catch (error) {
        console.error('[DEPLOY] ❌', error.message || error);
        logger.error('Erreur déploiement commandes:', error.message || error);
        throw error;
    }
};
