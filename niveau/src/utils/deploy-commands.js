const logger = require('./logger');
const fs = require('node:fs');
const path = require('node:path');
const { getSlashDeployGuildIds } = require(path.join(__dirname, '..', '..', '..', 'blzbot-env.js'));
const {
    MAIN_COMMAND_SUBDIRS: mainCommandSubdirs,
    isArchivedSlashCommandFile,
    isLegacyTestProfilFile,
    isCommandHelperFile,
} = require('./command-loader');
const { getEventState: getHalloweenState } = require('./db-halloween');
const { getEventState: getChristmasState } = require('./db-noel');
const { getEventState: getValentinState } = require('./db-valentin');

// Slash obsolètes à retirer (ancienne convention, remplacés par /profil, ou commandes de test retirées).
const OBSOLETE_SLASH_NAMES = new Set(['profil-v2', 'profile', 'testprofil', 'testprofilguilde']);

const DISCORD_APPLICATION_COMMAND_MAX = 100;
/** Toujours tenter de (re)déployer ces noms — critiques REBORN / staff. */
const REBORN_SLASH_PRIORITY_NAMES = [
    'deploy-slash',
    'admin-roles',
    'salon-hacker',
    'itemindex',
    'arbre',
    'quetes',
    'ranked',
    'temple',
    'profil',
    'daily',
    'boutique',
];

/**
 * Discord : max 100 commandes globales. Garde d’abord la priorité REBORN + noms essentiels.
 * @param {Map<string, object>} commandsToDeploy
 * @param {Map<string, { source?: string }>} localCommands
 */
function capCommandsToDiscordLimit(commandsToDeploy, localCommands) {
    if (commandsToDeploy.size <= DISCORD_APPLICATION_COMMAND_MAX) return commandsToDeploy;
    const priority = new Set(REBORN_SLASH_PRIORITY_NAMES);
    const prim = [];
    const sec = [];
    for (const [name, data] of commandsToDeploy.entries()) {
        const src = localCommands.get(name)?.source;
        if (priority.has(name) || src === 'reborn') prim.push([name, data]);
        else sec.push([name, data]);
    }
    const merged = [...prim, ...sec].slice(0, DISCORD_APPLICATION_COMMAND_MAX);
    console.warn(
        `[niveau/deploy] ${commandsToDeploy.size} commandes → ${merged.length} après troncature (limite Discord ${DISCORD_APPLICATION_COMMAND_MAX}). Les noms REBORN prioritaires sont conservés en tête.`,
    );
    return new Map(merged);
}

function loadCommandData(filePath) {
    try {
        const resolved = path.resolve(filePath);
        /* Slash sensibles aux options : recharger le module pour un toJSON à jour au deploy. */
        const slashReloadBasenames = new Set(['profil.js']);
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
 * Slash REBORN sur la/les guilde(s) GUILD_ID (+ BLZ_MAIN_GUILD_ID) — visible tout de suite (pas d’attente global).
 * @param {import('discord.js').Client} client
 * @param {Map<string, object>} rebornCommands
 */
/** Guildes où pousser les slash REBORN : .env + chaque serveur où le bot est membre. */
function getRebornDeployGuildIds(client) {
    const ids = new Set(getSlashDeployGuildIds());
    if (client?.guilds?.cache) {
        for (const gid of client.guilds.cache.keys()) ids.add(gid);
    }
    return [...ids];
}

async function deployRebornSlashToGuilds(
    client,
    rebornCommands,
    { compact = false, globalSlashNames = new Set() } = {},
) {
    const guildIds = getRebornDeployGuildIds(client);
    if (!rebornCommands.size || !guildIds.length) {
        console.warn('[niveau/deploy] REBORN guilde : rien à pousser (0 cmd ou 0 GUILD_ID).');
        return { created: 0, updated: 0, errors: 0, guildIds: [] };
    }

    let created = 0;
    let updated = 0;
    let errors = 0;

    for (const gid of guildIds) {
        let guild = client.guilds.cache.get(gid);
        if (!guild) {
            guild = await client.guilds.fetch(gid).catch(() => null);
        }
        if (!guild) {
            console.warn(`[niveau/deploy] REBORN guilde ${gid} : bot absent ou ID incorrect.`);
            continue;
        }

        let existing;
        try {
            existing = await guild.commands.fetch();
        } catch (e) {
            console.warn(`[niveau/deploy] REBORN guilde ${guild.name} fetch:`, e?.message || e);
            continue;
        }

        const keep = [];
        for (const cmd of existing.values()) {
            if (rebornCommands.has(cmd.name)) continue;
            if (globalSlashNames.has(cmd.name)) continue;
            keep.push(typeof cmd.toJSON === 'function' ? cmd.toJSON() : cmd);
        }
        const payload = [...keep, ...rebornCommands.values()];
        const prevReborn = existing.filter((c) => rebornCommands.has(c.name)).size;
        try {
            const setResult = await guild.commands.set(payload);
            const newReborn = setResult.filter((c) => rebornCommands.has(c.name)).length;
            created += Math.max(0, newReborn - prevReborn);
            updated += Math.min(prevReborn, newReborn);
            if (!compact) {
                console.log(
                    `  [REBORN guild ${guild.id}] ${rebornCommands.size} cmd (set atomique, ${setResult.length} total guilde)`,
                );
            }
        } catch (e) {
            errors += rebornCommands.size;
            console.error(`[niveau/deploy] REBORN guilde ${guild.name} set:`, e?.message || e);
        }
    }

    console.log(
        `[niveau/deploy] REBORN sur guilde(s) ${guildIds.join(', ')} : +${created} ~${updated} err ${errors} (${rebornCommands.size} cmd)`,
    );
    return { created, updated, errors, guildIds };
}

/**
 * Déploiement GLOBAL des slash commands du bot « niveau ».
 *
 * Politique : TOUTES les commandes vont sur l'application globale du bot et deviennent
 * donc automatiquement disponibles sur chaque serveur où le bot est invité.
 * Les commandes d'événements (Halloween / Noël / Saint-Valentin) sont publiées seulement
 * quand l'événement est actif ; sinon elles sont retirées du global.
 */
/**
 * Repousse uniquement les slash REBORN en guilde (léger, secours si deploy-all a échoué).
 */
async function deployRebornGuildSlashOnly(client, opts = {}) {
    const compact = Boolean(opts.compact);
    const { collectRebornSlashMap, isEnabled } = require('./reborn-integration');
    if (!isEnabled()) return { skipped: true };
    const rebornMap = collectRebornSlashMap();
    if (!rebornMap.size) {
        console.warn('[niveau/deploy] REBORN secours : 0 commande à pousser.');
        return { skipped: true };
    }
    const rebornForGuild = new Map();
    for (const [name, body] of rebornMap.entries()) {
        rebornForGuild.set(name, { ...body });
    }
    if (!client.isReady()) {
        await new Promise((resolve) => client.once('clientReady', resolve));
    }
    let globalNames = new Set();
    try {
        const app = await client.application.commands.fetch();
        app.forEach((c) => globalNames.add(c.name));
    } catch {
        /* noop */
    }
    const stats = await deployRebornSlashToGuilds(client, rebornForGuild, {
        compact,
        globalSlashNames: globalNames,
    });
    const hasTemple = rebornForGuild.has('temple');
    console.log(
        `[niveau] REBORN secours guilde : +${stats.created} ~${stats.updated} err ${stats.errors} · temple:${hasTemple ? 'oui' : 'NON'}`,
    );
    return stats;
}

const deployCommands = async function deployCommands(client) {
    const strictReborn =
        String(process.env.BLZ_REBORN_DEPLOY_STRICT ?? '1').trim().toLowerCase() !== '0';
    try {
        const { assertRebornSlashReady } = require(path.join(__dirname, '..', '..', '..', 'scripts', 'reborn-slash-preflight'));
        const pre = assertRebornSlashReady({ exitOnFail: false });
        if (pre.ok && !pre.skipped) {
            console.log(`[niveau/deploy] REBORN preflight OK (${pre.count} commandes locales)`);
        } else if (pre.skipped) {
            console.warn('[niveau/deploy] BLZ_REBORN_INTEGRATION désactivé — slash REBORN ignorés.');
        } else if (strictReborn && !pre.skipped) {
            const { rebornSlashJsonAvailable } = require('./reborn-integration');
            if (!rebornSlashJsonAvailable()) {
                throw new Error(pre.message || '[REBORN] preflight échoué');
            }
            console.warn(`[niveau/deploy] REBORN preflight : ${pre.message || ''} — tentative via JSON embarqué.`);
        } else {
            console.warn(`[niveau/deploy] REBORN preflight échoué (deploy continue) : ${pre.message || ''}`);
        }
    } catch (preErr) {
        console.warn('[niveau/deploy] preflight REBORN:', preErr?.message || preErr);
    }

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

    const isLoadable = (file) =>
        file.endsWith('.js') &&
        !isArchivedSlashCommandFile(file) &&
        !isLegacyTestProfilFile(file) &&
        !isCommandHelperFile(file);

    for (const sub of mainCommandSubdirs) {
        const dir = path.join(commandsPath, sub);
        if (!fs.existsSync(dir)) continue;
        fs.readdirSync(dir)
            .filter(isLoadable)
            .forEach((file) => {
                const commandData = loadCommandData(path.join(dir, file));
                if (commandData) localCommands.set(commandData.name, { ...commandData, source: 'normal' });
            });
    }

    if (fs.existsSync(halloweenCommandsPath)) {
        fs.readdirSync(halloweenCommandsPath)
            .filter(isLoadable)
            .forEach((file) => {
                const commandData = loadCommandData(path.join(halloweenCommandsPath, file));
                if (commandData) localCommands.set(commandData.name, { ...commandData, source: 'halloween' });
            });
    }

    if (fs.existsSync(christmasCommandsPath)) {
        fs.readdirSync(christmasCommandsPath)
            .filter(isLoadable)
            .forEach((file) => {
                const commandData = loadCommandData(path.join(christmasCommandsPath, file));
                if (commandData) localCommands.set(commandData.name, { ...commandData, source: 'christmas' });
            });
    }

    if (fs.existsSync(valentinCommandsPath)) {
        fs.readdirSync(valentinCommandsPath)
            .filter(isLoadable)
            .forEach((file) => {
                const commandData = loadCommandData(path.join(valentinCommandsPath, file));
                if (commandData) localCommands.set(commandData.name, { ...commandData, source: 'valentin' });
            });
    }

    let rebornSlashScope = 'guild';
    try {
        const { collectRebornSlashMap, isEnabled, getRebornSlashScope } = require('./reborn-integration');
        const envScope = getRebornSlashScope();
        if (envScope === 'both' || envScope === 'global') {
            console.warn(
                `[niveau/deploy] BLZ_REBORN_SLASH_SCOPE=${envScope} ignoré — REBORN est toujours en guilde uniquement (limite 100 global). Mets BLZ_REBORN_SLASH_SCOPE=guild dans .env.`,
            );
        }
        rebornSlashScope = 'guild';
        if (isEnabled()) {
            const rebornMap = collectRebornSlashMap();
            let rebornOverwrites = 0;
            for (const [name, body] of rebornMap.entries()) {
                const had = localCommands.has(name);
                localCommands.set(name, { ...body, source: 'reborn' });
                if (had) rebornOverwrites++;
            }
            if (rebornMap.size > 0) {
                console.log(
                    `[niveau/deploy] REBORN : ${rebornMap.size} slash (${rebornOverwrites} écrasement(s)) · scope=${rebornSlashScope}`,
                );
            } else {
                console.error(
                    '[niveau/deploy] REBORN : 0 slash — git pull requis (reborn-test-bot/ ou generated/reborn-slash-bodies.json).',
                );
            }
        }
    } catch (e) {
        logger.warn('[reborn/deploy] merge slash:', e?.message || e);
    }

    if (!compact) console.log(`[DEPLOY] Loaded ${localCommands.size} local commands`);
    const hasPanelVoc = localCommands.has('panel-voc');
    const hasStatsVocPanel = localCommands.has('stats-voc-panel');
    if (!compact) {
        console.log(
            `[niveau/deploy] /panel-voc code : ${hasPanelVoc ? 'OUI ✓' : 'NON ✗'} · /stats-voc-panel code : ${
                hasStatsVocPanel ? 'OUI ✓' : 'NON ✗'
            }`
        );
    }

    if (!client.isReady()) {
        if (!compact) console.log('[DEPLOY] Waiting for client to be ready...');
        await new Promise((resolve) => client.once('clientReady', resolve));
    }

    const expectedClientId = String(process.env.CLIENT_ID || '').trim();
    const appId = String(client.application?.id || '').trim();
    if (expectedClientId && appId && expectedClientId !== appId) {
        const mismatch =
            `[niveau/deploy] BOT_TOKEN ≠ CLIENT_ID : application Discord=${appId}, .env CLIENT_ID=${expectedClientId}. ` +
            'Les slash partent sur la mauvaise app — corrige BOT_TOKEN ou CLIENT_ID puis relance le deploy.';
        console.error(mismatch);
        throw new Error(mismatch);
    }
    if (!compact && appId) {
        console.log(`[niveau/deploy] Application Discord : ${appId}${expectedClientId ? '' : ' (CLIENT_ID non défini dans .env)'}`);
    }

    try {
        // 2. Filtrer : ne garder que les commandes actives (events saisonniers éteints = à retirer)
        const commandsToDeploy = new Map();
        const rebornForGuild = new Map();
        for (const [name, command] of localCommands.entries()) {
            const shouldBeActive =
                command.source === 'reborn' ||
                command.source === 'normal' ||
                (command.source === 'halloween' && isHalloweenActive) ||
                (command.source === 'christmas' && isChristmasActive) ||
                (command.source === 'valentin' && isValentinActive);
            if (!shouldBeActive) continue;
            const { source, ...cleanCmd } = command;
            if (command.source === 'reborn') {
                rebornForGuild.set(name, cleanCmd);
                // REBORN = guilde uniquement (limite Discord 100 commandes globales déjà pleine).
                continue;
            }
            commandsToDeploy.set(name, cleanCmd);
        }

        let commandsToDeployFinal = capCommandsToDiscordLimit(commandsToDeploy, localCommands);

        const forceRefreshNames = new Set(
            [
                'profil',
                'deploy-slash',
                'admin-roles',
                'salon-hacker',
                'daily',
                'boutique',
                'guilde',
                'itemindex',
                'arbre',
                'quetes',
                'temple',
                'ranked',
            ]
                .concat(
                    String(process.env.BLZ_FORCE_SLASH_REFRESH_NAMES || '')
                        .split(/[,;]/)
                        .map((s) => s.trim())
                        .filter(Boolean)
                )
        );

        const rebornKeys = [
            'admin-roles',
            'salon-hacker',
            'itemindex',
            'arbre',
            'quetes',
            'temple',
            'classement-guilde',
            'ranked',
            'daily',
            'boutique',
        ];
        const rebornPresent = rebornKeys
            .map((n) => `${n}:${rebornForGuild.has(n) ? 'guilde' : 'NON'}`)
            .join(' · ');
        console.log(
            `[niveau/deploy] Global niveau : ${commandsToDeployFinal.size} cmd · REBORN : ${rebornForGuild.size} en guilde(s) — ${rebornPresent}`,
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

        // Retirer d’anciennes slash REBORN du global (tentatives scope=both) pour libérer la limite 100.
        for (const cmd of [...appCommands.values()]) {
            if (!rebornForGuild.has(cmd.name)) continue;
            try {
                await cmd.delete();
                deletedGlobal++;
                appMap.delete(cmd.name);
                if (!compact) console.log(`🗑️ [GLOBAL] REBORN retirée du global : /${cmd.name}`);
            } catch (_) {
                /* noop */
            }
        }

        for (const [name, commandData] of commandsToDeployFinal.entries()) {
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
            if (commandsToDeployFinal.has(cmd.name)) continue;
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

        // 5. REBORN sur chaque guilde du bot (visible tout de suite dans le / du serveur).
        let rebornGuildStats = { created: 0, updated: 0, errors: 0, guildIds: [] };
        if (rebornForGuild.size > 0) {
            rebornGuildStats = await deployRebornSlashToGuilds(client, rebornForGuild, {
                compact,
                globalSlashNames: new Set(commandsToDeployFinal.keys()),
            });
            if (!compact) {
                console.log(
                    `[niveau/deploy] REBORN : ${rebornForGuild.size} cmd en guilde — tape / dans un salon du serveur (Ctrl+Maj+R).`,
                );
            }
        }

        // 6. Nettoyage guilde : supprimer uniquement les doublons déjà présents en GLOBAL (ne pas toucher aux slash REBORN guilde-only).
        let guildCleanupTotal = 0;
        let guildsVisited = 0;
        let guildsInError = 0;
        for (const [, guild] of client.guilds.cache) {
            guildsVisited++;
            try {
                const existing = await guild.commands.fetch();
                for (const cmd of existing.values()) {
                    if (rebornForGuild.has(cmd.name)) continue;
                    const shouldDelete =
                        appMap.has(cmd.name) &&
                        (commandsToDeployFinal.has(cmd.name) ||
                            OBSOLETE_SLASH_NAMES.has(cmd.name) ||
                            (localCommands.has(cmd.name) && localCommands.get(cmd.name)?.source !== 'reborn'));
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
                `[niveau] Slash GLOBAL : +${createdCount} ~${updatedCount} skip ${skippedCount} err ${errorCount} · purgeGlobal ${deletedGlobal} · REBORN guild +${rebornGuildStats.created} ~${rebornGuildStats.updated} · cleanGuilds ${guildCleanupTotal}/${guildsVisited}${guildsInError ? ` (err ${guildsInError})` : ''} · temple:${rebornForGuild.has('temple') ? 'oui' : 'NON'} · salon-hacker:${rebornForGuild.has('salon-hacker') ? 'oui' : 'NON'}`
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
