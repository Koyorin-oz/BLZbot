/**
 * Déploiement GLOBAL des slash commands modération.
 *
 * Politique : TOUTES les commandes sont déployées en GLOBAL sur l'application du bot,
 * donc automatiquement disponibles sur chaque serveur où le bot est invité
 * (support, test, production, futurs serveurs, etc.).
 *
 * Le déployeur nettoie aussi les résidus guild-spécifiques laissés par d'anciennes
 * versions du déployeur (évite les doublons si Discord affichait deux fois la même commande).
 */
const fs = require('fs');
const path = require('path');

const COMMANDS_DIR = path.join(__dirname, '..', 'commands');
// Anciens noms à supprimer proprement (renommages / commandes retirées).
const LEGACY_COMMAND_NAMES_TO_REMOVE = new Set(['panel']);
// Slash obsolètes à purger (ancienne convention, remplacée par autre chose).
const OBSOLETE_COMMAND_NAMES = new Set(['profil-staff-v2', 'profilstaff']);

function isArchivedSlashCommandFile(basename) {
    return typeof basename === 'string' && basename.endsWith('-ancien.js');
}

function toCmdJson(data) {
    if (!data) return null;
    return typeof data.toJSON === 'function' ? data.toJSON() : data;
}

function permsComparable(p) {
    if (p == null || p === undefined) return '';
    return String(p);
}

/**
 * Compare une commande locale (toJSON) et la version distante Discord pour éviter
 * de ré-écrire si rien n'a changé.
 */
function globalCommandUnchanged(existing, cmdJson) {
    const remoteOpts = JSON.stringify(
        existing.options?.map((o) => (o.toJSON ? o.toJSON() : o)) || []
    );
    const localOpts = JSON.stringify(cmdJson.options || []);
    const permsOk =
        permsComparable(existing.defaultMemberPermissions) ===
        permsComparable(cmdJson.default_member_permissions);
    return (
        existing.description === cmdJson.description &&
        remoteOpts === localOpts &&
        permsOk
    );
}

/**
 * @param {import('discord.js').Client} client
 * @param {object} _config — gardé pour compat (non utilisé)
 * @param {{ compact?: boolean }} [opts]
 */
async function deployModerationSlashCommands(client, _config, opts = {}) {
    const compact = Boolean(opts.compact);

    /** Noms forcés à re-PUT (bypass comparaison) — pour commandes dont Discord skip à tort. */
    const forceRefreshNames = new Set(
        String(process.env.BLZ_FORCE_MOD_SLASH_NAMES || 'profil-staff')
            .split(/[,;]/)
            .map((s) => s.trim())
            .filter(Boolean)
    );

    const commandFiles = fs
        .readdirSync(COMMANDS_DIR)
        .filter((f) => f.endsWith('.js') && !isArchivedSlashCommandFile(f));

    /** Commandes locales à déployer, indexées par nom. */
    const localCommands = new Map();
    for (const file of commandFiles) {
        const command = require(path.join(COMMANDS_DIR, file));
        if (!command.data) continue;
        const cmdJson = toCmdJson(command.data);
        if (!cmdJson || !cmdJson.name) continue;
        localCommands.set(cmdJson.name, command.data);
    }

    const localNames = [...localCommands.keys()];
    console.log(
        `[modération/deploy] ${localNames.length} commande(s) locales → déploiement GLOBAL (toutes guildes).`
    );

    if (!compact) console.log('🔄 Modération — enregistrement GLOBAL des slash commands…');

    if (!client.isReady()) {
        await new Promise((resolve) => client.once('clientReady', resolve));
    }

    // ==================== DÉPLOIEMENT GLOBAL ====================
    let createdCount = 0;
    let updatedCount = 0;
    let skippedCount = 0;
    let errorCount = 0;
    let deletedGlobal = 0;

    let appCommands;
    try {
        appCommands = await client.application.commands.fetch();
    } catch (fetchError) {
        console.error(
            '❌ Modération — impossible de fetch les commandes globales:',
            fetchError.message || fetchError
        );
        return;
    }

    const appMap = new Map();
    appCommands.forEach((cmd) => appMap.set(cmd.name, cmd));

    for (const [name, data] of localCommands.entries()) {
        let cmdJson;
        try {
            cmdJson = toCmdJson(data);
            const existing = appMap.get(name);
            if (existing) {
                if (globalCommandUnchanged(existing, cmdJson) && !forceRefreshNames.has(name)) {
                    skippedCount++;
                    continue;
                }
                await client.application.commands.edit(existing.id, cmdJson);
                if (!compact) console.log(`🔄 [GLOBAL] mise à jour : /${name}`);
                updatedCount++;
            } else {
                await client.application.commands.create(cmdJson);
                if (!compact) console.log(`✨ [GLOBAL] créée : /${name}`);
                createdCount++;
            }
        } catch (cmdError) {
            const errMsg = cmdError?.message || String(cmdError);
            console.error(`❌ Modération [GLOBAL] /${name}: ${errMsg}`);
            errorCount++;
        }
    }

    // Purge des anciens noms globaux (renommages + commandes retirées)
    for (const cmd of appCommands.values()) {
        if (LEGACY_COMMAND_NAMES_TO_REMOVE.has(cmd.name) || OBSOLETE_COMMAND_NAMES.has(cmd.name)) {
            try {
                await cmd.delete();
                deletedGlobal++;
                if (!compact) console.log(`🗑️ [GLOBAL] ancienne commande supprimée : /${cmd.name}`);
            } catch (_) { /* noop */ }
        }
    }

    // ==================== NETTOYAGE PAR GUILDE ====================
    // On supprime TOUTES les commandes guild-spécifiques qui existent aussi dans notre
    // liste locale (car elles sont désormais globales) + les legacies.
    // Résultat : plus aucun doublon dans les serveurs où le bot est invité.
    let guildCleanupTotal = 0;
    let guildsVisited = 0;
    let guildsInError = 0;

    for (const [, guild] of client.guilds.cache) {
        guildsVisited++;
        try {
            const existing = await guild.commands.fetch();
            for (const cmd of existing.values()) {
                const shouldDelete =
                    localCommands.has(cmd.name) ||
                    LEGACY_COMMAND_NAMES_TO_REMOVE.has(cmd.name) ||
                    OBSOLETE_COMMAND_NAMES.has(cmd.name);
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
                    `[modération/deploy] nettoyage ${guild.name} (${guild.id}) : ${guildError?.message || guildError}`
                );
            }
        }
    }

    if (compact) {
        console.log(
            `[modération] Slash GLOBAL : +${createdCount} maj ${updatedCount} skip ${skippedCount} err ${errorCount} · legacyGlobal ${deletedGlobal} · cleanGuilds ${guildCleanupTotal}/${guildsVisited}${guildsInError ? ` (err ${guildsInError})` : ''}`
        );
    } else {
        console.log(
            `✓ Modération GLOBAL: ${createdCount} new, ${updatedCount} updated, ${skippedCount} skipped, ${errorCount} errors, ${deletedGlobal} legacy supprimée(s).`
        );
        console.log(
            `✓ Modération — nettoyage guildes : ${guildCleanupTotal} doublon(s) supprimé(s) sur ${guildsVisited} guilde(s)${guildsInError ? ` (${guildsInError} erreur(s))` : ''}.`
        );
    }
}

module.exports = { deployModerationSlashCommands };
