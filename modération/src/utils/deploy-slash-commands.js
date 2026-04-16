/**
 * Enregistre les slash commands modération (guilde principale + serveur panel si besoin).
 * Utilisable depuis le bot ou depuis scripts/deploy-moderation-commands-cli.js
 */
const fs = require('fs');
const path = require('path');
const { getSlashDeployGuildIds } = require(path.join(__dirname, '..', '..', '..', 'blzbot-env.js'));

const COMMANDS_DIR = path.join(__dirname, '..', 'commands');
const PANEL_COMMAND_NAMES = new Set(['panel']);

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
    const panelCommands = [];

    const commandFiles = fs.readdirSync(COMMANDS_DIR).filter((f) => f.endsWith('.js'));
    for (const file of commandFiles) {
        const command = require(path.join(COMMANDS_DIR, file));
        if (!command.data) continue;
        const cmdJson = toCmdJson(command.data);
        if (!cmdJson || !cmdJson.name) continue;
        if (PANEL_COMMAND_NAMES.has(cmdJson.name)) {
            panelCommands.push(command.data);
        } else {
            commands.push(command.data);
        }
    }

    const modNames = [...commands, ...panelCommands].map((c) => toCmdJson(c).name).filter(Boolean);
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

    if (panelCommands.length > 0) {
        try {
            const panelGuild = await client.guilds.fetch(config.PANEL_GUILD_ID);
            if (panelGuild) {
                for (const cmdData of panelCommands) {
                    const cmdJsonPanel = toCmdJson(cmdData);
                    const existingPanel = await panelGuild.commands.fetch().then((c) => c.find((x) => x.name === cmdJsonPanel.name));
                    if (existingPanel) {
                        await panelGuild.commands.edit(existingPanel.id, cmdJsonPanel);
                    } else {
                        await panelGuild.commands.create(cmdJsonPanel);
                    }
                    if (!compact) console.log(`✨ Commande déployée sur serveur panel: ${cmdJsonPanel.name}`);
                }
                for (const gid of mainGuildIds) {
                    if (String(gid) === String(config.PANEL_GUILD_ID)) continue;
                    const stripGuild = await client.guilds.fetch(gid).catch(() => null);
                    if (!stripGuild) continue;
                    const mainExisting = await stripGuild.commands.fetch();
                    for (const cmd of mainExisting.values()) {
                        if (PANEL_COMMAND_NAMES.has(cmd.name)) {
                            await cmd.delete();
                            if (!compact) {
                                console.log(`🗑️ Commande supprimée (${stripGuild.name}): ${cmd.name}`);
                            }
                        }
                    }
                }
            } else {
                console.error('❌ Impossible de trouver le serveur panel pour enregistrer /panel.');
            }
        } catch (panelError) {
            if (panelError.code === 10004) {
                console.warn(
                    `[modération] Serveur panel (PANEL_GUILD_ID=${config.PANEL_GUILD_ID}) introuvable — /panel non déployé. ` +
                        'Invite le bot sur ce serveur ou mets PANEL_GUILD_ID=ton GUILD_ID dans le .env.'
                );
            } else {
                console.error('❌ Erreur déploiement commandes panel:', panelError.message || panelError);
            }
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
            String(process.env.BLZ_FORCE_MOD_SLASH_NAMES || 'profil-staff-v2')
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
