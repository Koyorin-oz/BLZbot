const {
    SlashCommandBuilder,
    PermissionFlagsBits,
    ButtonBuilder,
    ButtonStyle,
    ActionRowBuilder,
    ComponentType,
} = require('discord.js');
const { getAllGuilds } = require('../../utils/db-guilds');
const db = require('../../database/database');
const logger = require('../../utils/logger');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('guilde-migration')
        .setDescription('Migre les anciennes guildes vers la nouvelle structure (Admin)')
        .addBooleanOption(option =>
            option
                .setName('dry-run')
                .setDescription('Mode simulation : affiche les changements sans les appliquer')
                .setRequired(false)
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    async execute(interaction) {
        const dryRun = interaction.options.getBoolean('dry-run') || false;

        await interaction.deferReply({ ephemeral: true });

        try {
            const guilds = getAllGuilds();
            const issues = [];
            const fixes = [];

            // Analyser toutes les guildes
            for (const guild of guilds) {
                const guildIssues = [];
                
                // Issue 1: Guilde créée avant le système d'upgrade
                if (!guild.upgrade_level || guild.upgrade_level < 1) {
                    guildIssues.push({
                        type: 'MISSING_UPGRADE',
                        message: `Upgrade level manquant ou invalide (${guild.upgrade_level || 'NULL'})`,
                        fix: () => {
                            db.prepare('UPDATE guilds SET upgrade_level = 1 WHERE id = ?').run(guild.id);
                        }
                    });
                }

                // Issue 2: Ancien système de level (deprecated)
                if (guild.level && guild.level > 0) {
                    guildIssues.push({
                        type: 'OLD_LEVEL_SYSTEM',
                        message: `Utilise l'ancien système de level (level: ${guild.level})`,
                        fix: () => {
                            // Convertir l'ancien level en upgrade approximatif
                            const approximateUpgrade = Math.min(Math.floor(guild.level / 2) + 1, 10);
                            db.prepare('UPDATE guilds SET upgrade_level = ?, level = 0 WHERE id = ?').run(approximateUpgrade, guild.id);
                        }
                    });
                }

                // Issue 3: Channel ID sans upgrade 5
                if (guild.channel_id && guild.upgrade_level < 5) {
                    guildIssues.push({
                        type: 'CHANNEL_WITHOUT_UPGRADE',
                        message: `Salon privé (${guild.channel_id}) sans Upgrade 5`,
                        fix: async () => {
                            try {
                                const channel = await interaction.guild.channels
                                    .fetch(guild.channel_id)
                                    .catch(() => null);
                                if (channel) {
                                    await channel.delete('Migration : salon sans upgrade requis');
                                }
                            } catch (e) {
                                logger.warn(`Impossible de supprimer le salon ${guild.channel_id}:`, e.message);
                            }
                            db.prepare('UPDATE guilds SET channel_id = NULL WHERE id = ?').run(guild.id);
                        }
                    });
                }

                // Issue 4: Member slots incohérent avec upgrade
                const expectedSlots = getExpectedMemberSlots(guild.upgrade_level);
                if (guild.member_slots !== expectedSlots) {
                    guildIssues.push({
                        type: 'INCORRECT_SLOTS',
                        message: `Slots incorrects (${guild.member_slots}, attendu: ${expectedSlots})`,
                        fix: () => {
                            db.prepare('UPDATE guilds SET member_slots = ? WHERE id = ?').run(expectedSlots, guild.id);
                        }
                    });
                }

                // Issue 5: Treasury capacity incohérente
                const expectedCapacity = getExpectedTreasuryCapacity(guild.upgrade_level);
                if (guild.treasury_capacity !== expectedCapacity) {
                    guildIssues.push({
                        type: 'INCORRECT_CAPACITY',
                        message: `Capacité trésorerie incorrecte (${guild.treasury_capacity}, attendu: ${expectedCapacity})`,
                        fix: () => {
                            db.prepare('UPDATE guilds SET treasury_capacity = ? WHERE id = ?').run(expectedCapacity, guild.id);
                        }
                    });
                }

                // Issue 6: Treasury > capacity
                if (guild.treasury > guild.treasury_capacity) {
                    guildIssues.push({
                        type: 'TREASURY_OVERFLOW',
                        message: `Trésorerie déborde (${guild.treasury} > ${guild.treasury_capacity})`,
                        fix: () => {
                            db.prepare('UPDATE guilds SET treasury = ? WHERE id = ?').run(guild.treasury_capacity, guild.id);
                        }
                    });
                }

                // Issue 7: Emoji manquant ou invalide
                if (!guild.emoji || guild.emoji.trim() === '') {
                    guildIssues.push({
                        type: 'MISSING_EMOJI',
                        message: `Emoji manquant`,
                        fix: () => {
                            db.prepare('UPDATE guilds SET emoji = ? WHERE id = ?').run('🏰', guild.id);
                        }
                    });
                }

                // Issue 8: Emoji cassé (certains emojis custom Discord)
                if (guild.emoji && guild.emoji.includes('<:') && guild.emoji.includes(':>')) {
                    guildIssues.push({
                        type: 'BROKEN_CUSTOM_EMOJI',
                        message: `Emoji custom Discord détecté (non supporté dans canvas)`,
                        fix: () => {
                            db.prepare('UPDATE guilds SET emoji = ? WHERE id = ?').run('🏰', guild.id);
                        }
                    });
                }

                if (guildIssues.length > 0) {
                    issues.push({
                        guild: guild,
                        issues: guildIssues
                    });
                }
            }

            // Construire le rapport
            let report = dryRun 
                ? `📋 **Rapport de simulation** (aucun changement appliqué)\n\n`
                : `✅ **Migration terminée**\n\n`;

            report += `**Guildes analysées:** ${guilds.length}\n`;
            report += `**Guildes avec problèmes:** ${issues.length}\n\n`;

            if (issues.length === 0) {
                report += `✨ Toutes les guildes sont à jour !`;
            } else {
                // Appliquer les fixes si pas en dry-run
                if (!dryRun) {
                    for (const item of issues) {
                        for (const issue of item.issues) {
                            if (issue.fix) {
                                await issue.fix();
                            }
                        }
                    }
                }

                // Rapport détaillé (max 10 guildes)
                const maxDisplay = 10;
                for (let i = 0; i < Math.min(issues.length, maxDisplay); i++) {
                    const item = issues[i];
                    report += `**${item.guild.name}** (ID: ${item.guild.id})\n`;
                    for (const issue of item.issues) {
                        report += `  • ${issue.message}\n`;
                    }
                    report += '\n';
                }

                if (issues.length > maxDisplay) {
                    report += `... et ${issues.length - maxDisplay} autre(s) guilde(s)\n`;
                }

                // Stats par type d'issue
                const issueTypes = {};
                for (const item of issues) {
                    for (const issue of item.issues) {
                        issueTypes[issue.type] = (issueTypes[issue.type] || 0) + 1;
                    }
                }

                report += `\n**Statistiques:**\n`;
                for (const [type, count] of Object.entries(issueTypes)) {
                    report += `• ${type}: ${count}\n`;
                }
            }

            // Tronquer si trop long
            if (report.length > 1900) {
                report = report.substring(0, 1900) + '...\n\n✅ Migration terminée !';
            }

            await interaction.editReply({
                content: report,
            });

            if (!dryRun && issues.length > 0) {
                logger.warn(
                    `[ADMIN] Migration de ${issues.length} guildes par ${interaction.user.tag} (${interaction.user.id})`
                );
            }
        } catch (error) {
            logger.error('Erreur lors de la migration des guildes:', error);
            await interaction.editReply({
                content: `❌ Erreur : ${error.message || String(error)}`,
            });
        }
    },
};

/**
 * Calcule la capacité de trésorerie attendue selon l'upgrade
 */
function getExpectedTreasuryCapacity(upgradeLevel) {
    const capacities = {
        1: 0,
        2: 750000,
        3: 1500000,
        4: 3500000,
        5: 7500000,
        6: 10000000,
        7: 12500000,
        8: 15000000,
        9: 15000000,
        10: 15000000,
    };
    return capacities[upgradeLevel] || 0;
}

/**
 * Calcule le nombre de slots attendu selon l'upgrade
 */
function getExpectedMemberSlots(upgradeLevel) {
    const slots = {
        1: 5,
        2: 6,
        3: 7,
        4: 8,
        5: 8,
        6: 8,
        7: 9,
        8: 10,
        9: 10,
        10: 11,
    };
    return slots[upgradeLevel] || 5;
}
