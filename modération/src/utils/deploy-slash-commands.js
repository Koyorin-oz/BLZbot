/**
 * Déploiement GLOBAL des slash commands modération.
 *
 * Politique : TOUTES les commandes sont déployées en GLOBAL sur l'application du bot,
 * donc automatiquement disponibles sur chaque serveur où le bot est invité
 * (support, test, production, futurs serveurs, etc.).
 *
 * Le déployeur nettoie aussi les résidus guild-spécifiques laissés par d'anciennes
 * versions du déployeur (évite les doublons si Discord affichait deux fois la même commande).
 *
 * **Miroir guild** : sur le serveur support (par défaut), `guild.commands.set` republie
 * toute la liste des commandes en enregistrement **guild**, pour les serveurs où l’invite
 * n’incluait pas le scope `applications.commands` (les globaux ne s’y affichent pas).
 */
const fs = require('fs');
const path = require('path');
const CONFIG = require('../config.js');

const COMMANDS_DIR = path.join(__dirname, '..', 'commands');

/**
 * Commandes déployées uniquement sur certaines guildes (jamais en global).
 * Map : nom de commande → Set d'IDs de guildes cibles.
 */
const DEFAULT_SUPPORT_GUILD_ID = String(CONFIG.TICKETS?.SUPPORT_GUILD_ID || '1351221530998345828');

/**
 * Commandes strictement guild-only (jamais en global, déployées en commande guild
 * sur les guilds explicitement listées). Utile quand l'app Discord approche les
 * 100 commandes globales (limite Discord) — on évite de consommer les slots globaux.
 *
 * Note : `/verify`, `/setup-verification`, `/unverify` ont été extraites dans le
 * bot dédié `verification/` (app Discord séparée, son propre token). Plus rien
 * lié à la vérif n'est déployé depuis ce déployeur.
 */
const GUILD_ONLY_BY_COMMAND = new Map([]);

/**
 * Guildes où on enregistre **toutes** les commandes modération en guild (`commands.set`),
 * en plus du déploiement global. Utile si l’invite du bot n’avait pas `applications.commands`
 * (les slash globaux n’apparaissent pas, seules d’éventuelles commandes guild restaient visibles).
 *
 * Défaut : serveur support. Surcharge : `BLZ_MOD_SLASH_MIRROR_GUILD_IDS=id1,id2`
 */
function getSlashMirrorGuildIds() {
    const raw = String(process.env.BLZ_MOD_SLASH_MIRROR_GUILD_IDS || '').trim();
    if (raw) {
        return [
            ...new Set(
                raw
                    .split(/[,;]/)
                    .map((s) => s.trim())
                    .filter((id) => /^\d{17,22}$/.test(id))
            ),
        ];
    }
    return /^\d{17,22}$/.test(DEFAULT_SUPPORT_GUILD_ID) ? [DEFAULT_SUPPORT_GUILD_ID] : [];
}

/**
 * Payload complet des slash pour une guilde (globales + guild-only autorisées sur cette guilde).
 */
function buildGuildSlashPayloadForMirror(localCommands, guildOnlyCommandNames, guildId) {
    const out = [];
    for (const [name, data] of localCommands.entries()) {
        if (guildOnlyCommandNames.has(name)) {
            const allowed = GUILD_ONLY_BY_COMMAND.get(name);
            if (!allowed || !allowed.has(String(guildId))) continue;
        }
        const cmdJson = toCmdJson(data);
        if (cmdJson) out.push(cmdJson);
    }
    return out;
}
// Anciens noms à supprimer proprement (renommages / commandes retirées).
// Important : on garde `verify`, `setup-verification`, `unverify` et `antiraid` ici pour que
// Discord les supprime automatiquement de l'app modération lors du prochain
// déploiement (elles tournent désormais sur l'app séparée du bot vérif / protect).
const LEGACY_COMMAND_NAMES_TO_REMOVE = new Set([
    'panel',
    'verify',
    'setup-verification',
    'unverify',
    'antiraid',
]);
// Slash obsolètes à purger (ancienne convention, remplacée par autre chose).
const OBSOLETE_COMMAND_NAMES = new Set([
    'profil-staff-v2',
    'profilstaff',
    'test-bienvenue',
    'panel-deban-test',
    'panel-deban-forum',
]);

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
    const guildOnlyCommandNames = new Set();
    for (const file of commandFiles) {
        const command = require(path.join(COMMANDS_DIR, file));
        if (!command.data) continue;
        const cmdJson = toCmdJson(command.data);
        if (!cmdJson || !cmdJson.name) continue;
        if (command.guildOnly === true || GUILD_ONLY_BY_COMMAND.has(cmdJson.name)) {
            guildOnlyCommandNames.add(cmdJson.name);
        }
        localCommands.set(cmdJson.name, command.data);
    }

    const mirrorGuildIds = getSlashMirrorGuildIds();
    const mirrorGuildIdSet = new Set(mirrorGuildIds);

    const localNames = [...localCommands.keys()];
    console.log(
        `[modération/deploy] ${localNames.length} commande(s) locales — global sauf guild-only (${guildOnlyCommandNames.size}).`
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
        if (guildOnlyCommandNames.has(name)) continue;
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

    // Purge des anciens noms globaux (renommages + commandes retirées) + commandes strictement guild-only
    for (const cmd of appCommands.values()) {
        const remove =
            LEGACY_COMMAND_NAMES_TO_REMOVE.has(cmd.name) ||
            OBSOLETE_COMMAND_NAMES.has(cmd.name) ||
            guildOnlyCommandNames.has(cmd.name);
        if (!remove) continue;
        try {
            await cmd.delete();
            deletedGlobal++;
            if (!compact) console.log(`🗑️ [GLOBAL] commande supprimée : /${cmd.name}`);
        } catch (_) { /* noop */ }
    }

    // ==================== MIROIR GUILD (ex. support sans scope applications.commands) ====================
    let mirrorGuildSetOk = 0;
    for (const gid of mirrorGuildIds) {
        const guild = await client.guilds.fetch(gid).catch(() => null);
        if (!guild) {
            if (!compact) {
                console.warn(
                    `[modération/deploy] slash miroir : guilde ${gid} introuvable — bot absent ou ID incorrect.`
                );
            }
            continue;
        }
        try {
            const payload = buildGuildSlashPayloadForMirror(
                localCommands,
                guildOnlyCommandNames,
                guild.id
            );
            await guild.commands.set(payload);
            mirrorGuildSetOk++;
            if (!compact) {
                console.log(
                    `✓ [${guild.name}] slash **miroir guild** : ${payload.length} commande(s) (liste complète).`
                );
            }
        } catch (e) {
            console.error(`❌ [${gid}] guild.commands.set (miroir):`, e?.message || e);
            errorCount++;
        }
    }

    // ==================== COMMANDES GUILD-ONLY ====================
    let guildOnlyCreated = 0;
    let guildOnlyUpdated = 0;
    for (const name of guildOnlyCommandNames) {
        const data = localCommands.get(name);
        if (!data) continue;
        const targetGuildIds = GUILD_ONLY_BY_COMMAND.get(name) || new Set();
        const cmdJson = toCmdJson(data);
        for (const gid of targetGuildIds) {
            if (mirrorGuildIdSet.has(String(gid))) continue;
            const guild = await client.guilds.fetch(gid).catch(() => null);
            if (!guild) {
                if (!compact) console.warn(`[modération/deploy] guild-only /${name} : guilde ${gid} introuvable.`);
                continue;
            }
            try {
                const existingGuildCmds = await guild.commands.fetch();
                const hit = [...existingGuildCmds.values()].find((c) => c.name === name);
                if (hit) {
                    await guild.commands.edit(hit.id, cmdJson);
                    guildOnlyUpdated++;
                    if (!compact) console.log(`🔄 [${guild.name}] /${name} (guild-only) mise à jour`);
                } else {
                    await guild.commands.create(cmdJson);
                    guildOnlyCreated++;
                    if (!compact) console.log(`✨ [${guild.name}] /${name} (guild-only) créée`);
                }
            } catch (e) {
                console.error(`❌ [${gid}] /${name} guild-only:`, e?.message || e);
                errorCount++;
            }
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
        if (mirrorGuildIdSet.has(guild.id)) continue;
        try {
            const existing = await guild.commands.fetch();
            for (const cmd of existing.values()) {
                let shouldDelete = false;
                if (LEGACY_COMMAND_NAMES_TO_REMOVE.has(cmd.name) || OBSOLETE_COMMAND_NAMES.has(cmd.name)) {
                    shouldDelete = true;
                } else if (guildOnlyCommandNames.has(cmd.name)) {
                    const allowed = GUILD_ONLY_BY_COMMAND.get(cmd.name);
                    shouldDelete = !allowed || !allowed.has(guild.id);
                } else if (localCommands.has(cmd.name) && !guildOnlyCommandNames.has(cmd.name)) {
                    // Doublon guilde d'une commande déployée en global
                    shouldDelete = true;
                }
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
            `[modération] Slash GLOBAL : +${createdCount} maj ${updatedCount} skip ${skippedCount} err ${errorCount} · legacyGlobal ${deletedGlobal} · mirrorGuild ok=${mirrorGuildSetOk}/${mirrorGuildIds.length} · guildOnly +${guildOnlyCreated}/~${guildOnlyUpdated} · cleanGuilds ${guildCleanupTotal}/${guildsVisited}${guildsInError ? ` (err ${guildsInError})` : ''}`
        );
    } else {
        console.log(
            `✓ Modération GLOBAL: ${createdCount} new, ${updatedCount} updated, ${skippedCount} skipped, ${errorCount} errors, ${deletedGlobal} retirée(s) du global.`
        );
        if (mirrorGuildIds.length > 0) {
            console.log(
                `✓ Modération slash miroir (guild complète) : ${mirrorGuildSetOk}/${mirrorGuildIds.length} guilde(s) — ${mirrorGuildIds.join(', ')}`
            );
        }
        if (guildOnlyCommandNames.size > 0) {
            console.log(
                `✓ Modération guild-only : ${guildOnlyCreated} créée(s), ${guildOnlyUpdated} MAJ — ${[...guildOnlyCommandNames].join(', ')}`
            );
        }
        console.log(
            `✓ Modération — nettoyage guildes : ${guildCleanupTotal} doublon(s) supprimé(s) sur ${guildsVisited} guilde(s) (miroirs exclus)${guildsInError ? ` (${guildsInError} erreur(s))` : ''}.`
        );
    }
}

module.exports = { deployModerationSlashCommands };
