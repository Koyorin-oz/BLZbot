/**
 * Enregistre les slash commands modération (guilde principale + serveur panel si besoin).
 * Utilisable depuis le bot ou depuis scripts/deploy-moderation-commands-cli.js
 */
const fs = require('fs');
const path = require('path');
const { getSlashDeployGuildIds } = require(path.join(__dirname, '..', '..', '..', 'blzbot-env.js'));

const COMMANDS_DIR = path.join(__dirname, '..', 'commands');
// Commandes déployées en GLOBAL (accessibles sur tous les serveurs où le bot est présent).
// Elles ne sont JAMAIS déployées par guilde (évite les doublons).
const GLOBAL_COMMAND_NAMES = new Set(['panel-deban']);
// Anciens noms à supprimer proprement (renommages)
const LEGACY_COMMAND_NAMES_TO_REMOVE = new Set(['panel']);

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
 * @param {import('discord.js').Client} client
 * @param {object} config — même export que src/config.js
 * @param {{ compact?: boolean }} [opts]
 */
async function deployModerationSlashCommands(client, config, opts = {}) {
    const compact = Boolean(opts.compact);
    const commands = [];
    const globalCommands = [];

    const commandFiles = fs
        .readdirSync(COMMANDS_DIR)
        .filter((f) => f.endsWith('.js') && !isArchivedSlashCommandFile(f));
    for (const file of commandFiles) {
        const command = require(path.join(COMMANDS_DIR, file));
        if (!command.data) continue;
        const cmdJson = toCmdJson(command.data);
        if (!cmdJson || !cmdJson.name) continue;
        if (GLOBAL_COMMAND_NAMES.has(cmdJson.name)) {
            globalCommands.push(command.data);
        } else {
            commands.push(command.data);
        }
    }

    const modNames = [...commands, ...globalCommands].map((c) => toCmdJson(c).name).filter(Boolean);
    const hasTestBienvenue = modNames.includes('test-bienvenue');
    console.log(
        `[modération/deploy] ${modNames.length} commande(s) lues sur disque — /test-bienvenue : ${hasTestBienvenue ? 'OUI ✓' : 'NON ✗ (fichier test-bienvenue.js manquant sur ce serveur ?)'}`
    );

    if (!compact) console.log('🔄 Démarrage de l\'enregistrement des commandes slash (Mode Sûr)...');

    if (!client.isReady()) {
        await new Promise((resolve) => client.once('clientReady', resolve));
    }

    const mainGuildIds = getSlashDeployGuildIds();
    if (mainGuildIds.length === 0) {
        console.error(
            '❌ Modération — aucun GUILD_ID valide (vérifie le .env / mode TEST et BLZ_MAIN_GUILD_ID).'
        );
        return;
    }

    if (!compact) {
        console.log(
            `[modération/deploy] Guildes cibles : ${mainGuildIds.join(', ')} (GUILD_ID + BLZ_MAIN_GUILD_ID si défini). Le bot doit être invité sur chacune.`
        );
    }

    // ==================== COMMANDES GLOBALES ====================
    // Déployées sur toute l'application (disponibles automatiquement sur chaque serveur où le bot est invité).
    // Propagation Discord : quasi instantanée pour une MAJ, quelques minutes la première fois.
    if (globalCommands.length > 0) {
        try {
            const appCommands = await client.application.commands.fetch();
            for (const cmdData of globalCommands) {
                const cmdJsonGlobal = toCmdJson(cmdData);
                const existingGlobal = appCommands.find((x) => x.name === cmdJsonGlobal.name);
                if (existingGlobal) {
                    await client.application.commands.edit(existingGlobal.id, cmdJsonGlobal);
                    if (!compact) console.log(`🔄 Commande GLOBALE mise à jour : /${cmdJsonGlobal.name}`);
                } else {
                    await client.application.commands.create(cmdJsonGlobal);
                    if (!compact) console.log(`✨ Commande GLOBALE créée : /${cmdJsonGlobal.name}`);
                }
            }

            // Nettoyage : si une commande globale a été renommée (ex. /panel → /panel-deban),
            // on purge l'ancien nom à la fois en global ET sur chaque guilde où il aurait traîné.
            for (const legacy of LEGACY_COMMAND_NAMES_TO_REMOVE) {
                const oldGlobal = appCommands.find((x) => x.name === legacy);
                if (oldGlobal) {
                    await oldGlobal.delete().catch(() => null);
                    if (!compact) console.log(`🗑️ Ancienne commande globale supprimée : /${legacy}`);
                }
            }
            for (const gid of mainGuildIds) {
                const g = await client.guilds.fetch(gid).catch(() => null);
                if (!g) continue;
                const ex = await g.commands.fetch().catch(() => null);
                if (!ex) continue;
                for (const cmd of ex.values()) {
                    if (LEGACY_COMMAND_NAMES_TO_REMOVE.has(cmd.name) || GLOBAL_COMMAND_NAMES.has(cmd.name)) {
                        // On supprime les résidus : legacy (renommé) + doublons guilde d'une commande globale
                        await cmd.delete().catch(() => null);
                        if (!compact) console.log(`🗑️ [${g.name}] résidu guilde supprimé : /${cmd.name}`);
                    }
                }
            }
        } catch (globalError) {
            console.error('❌ Erreur déploiement commandes globales:', globalError.message || globalError);
        }
    }

    let createdCount = 0;
    let updatedCount = 0;
    let skippedCount = 0;
    let errorCount = 0;
    let anyGuildOk = false;

    for (const gid of mainGuildIds) {
        const guild = await client.guilds.fetch(gid).catch((e) => {
            if (e.code === 10004) {
                console.error(`❌ Modération — guilde ${gid} inconnue ou bot non membre.`);
            } else {
                console.error(`❌ Modération — guilde ${gid}:`, e.message || e);
            }
            return null;
        });
        if (!guild) continue;
        anyGuildOk = true;

        if (!compact) console.log(`[modération/deploy] — ${guild.name} (${guild.id})`);

        const existingCommands = await guild.commands.fetch();
        const existingMap = new Map();
        existingCommands.forEach((cmd) => existingMap.set(cmd.name, cmd));

        /** Toujours re-PUT ces commandes (évite un slash obsolète si Discord compare mal). */
        const forceModerationSlashRefresh = new Set(
            String(process.env.BLZ_FORCE_MOD_SLASH_NAMES || 'profil-staff')
                .split(/[,;]/)
                .map((s) => s.trim())
                .filter(Boolean)
        );

        for (const commandData of commands) {
            let cmdJson;
            try {
                cmdJson = toCmdJson(commandData);
                const existing = existingMap.get(cmdJson.name);

                if (existing) {
                    const remoteOpts = JSON.stringify(existing.options?.map((o) => (o.toJSON ? o.toJSON() : o)) || []);
                    const localOpts = JSON.stringify(cmdJson.options || []);
                    const permsOk =
                        permsComparable(existing.defaultMemberPermissions) ===
                        permsComparable(cmdJson.default_member_permissions);
                    const unchanged =
                        existing.description === cmdJson.description && remoteOpts === localOpts && permsOk;
                    if (unchanged && !forceModerationSlashRefresh.has(cmdJson.name)) {
                        skippedCount++;
                        continue;
                    }
                }

                if (existing) {
                    await guild.commands.edit(existing.id, cmdJson);
                } else {
                    await guild.commands.create(cmdJson);
                }
                if (!compact) {
                    const action = existing ? '🔄' : '✨';
                    console.log(`${action} [${guild.name}] ${existing ? 'mise à jour' : 'créée'}: ${cmdJson.name}`);
                }
                if (existing) updatedCount++;
                else createdCount++;
            } catch (cmdError) {
                const errMsg = cmdError?.message || String(cmdError);
                const name = cmdJson?.name || (typeof commandData?.name === 'string' ? commandData.name : '?');
                console.error(`❌ Modération [${guild.id}] /${name}: ${errMsg}`);
                errorCount++;
            }
        }

        const obsoleteModSlash = new Set(['profil-staff-v2', 'profilstaff']);
        for (const cmd of existingMap.values()) {
            if (!obsoleteModSlash.has(cmd.name)) continue;
            try {
                await cmd.delete();
                if (!compact) console.log(`🗑️ [${guild.name}] Slash obsolète retiré: /${cmd.name}`);
            } catch (delErr) {
                console.warn(`[modération/deploy] Suppression /${cmd.name}: ${delErr?.message || delErr}`);
            }
        }
    }

    if (!anyGuildOk) {
        console.error('❌ Modération — aucune guilde accessible pour enregistrer les commandes.');
        return;
    }

    if (compact) {
        console.log(
            `[modération] Slash : +${createdCount} maj ${updatedCount} skip ${skippedCount} err ${errorCount} · guildes ${mainGuildIds.join(',')}`
        );
    } else {
        console.log(`✓ Modération: ${createdCount} new, ${updatedCount} updated, ${skippedCount} skipped, ${errorCount} errors`);
    }
}

module.exports = { deployModerationSlashCommands };
