const {
    SlashCommandBuilder,
    PermissionFlagsBits,
    ButtonBuilder,
    ButtonStyle,
    ActionRowBuilder,
    ComponentType,
} = require('discord.js');
const { getAllGuilds, updateGuildUpgrade } = require('../../utils/db-guilds');
const db = require('../../database/database');
const logger = require('../../utils/logger');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('guilde-fix-all')
        .setDescription('Répare toutes les guildes avec des données incohérentes (Admin)')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    async execute(interaction) {
        const confirmButton = new ButtonBuilder()
            .setCustomId('confirm_fix_all')
            .setLabel('OUI, RÉPARER TOUTES LES GUILDES')
            .setStyle(ButtonStyle.Danger);

        const cancelButton = new ButtonBuilder()
            .setCustomId('cancel_fix_all')
            .setLabel('Annuler')
            .setStyle(ButtonStyle.Secondary);

        const row = new ActionRowBuilder().addComponents(confirmButton, cancelButton);

        const response = await interaction.reply({
            content:
                '⚠️ **Réparation des guildes**\n\n' +
                'Cette commande va :\n' +
                '• Corriger les salons privés créés avec un mauvais upgrade\n' +
                '• Supprimer les salons des guildes < Upgrade 5\n' +
                '• Fixer les données incohérentes (treasury, slots, etc.)\n' +
                '• Nettoyer les anciennes guildes mal configurées\n\n' +
                '**Cette action peut modifier plusieurs guildes.** Continuer ?',
            components: [row],
            flags: 64,
        });

        const collector = response.createMessageComponentCollector({
            componentType: ComponentType.Button,
            time: 60 * 1000,
        });

        collector.on('collect', async (i) => {
            if (i.user.id !== interaction.user.id) {
                await i.reply({
                    content: 'Seul l\'administrateur qui a lancé la commande peut confirmer.',
                    flags: 64,
                });
                return;
            }

            if (i.customId === 'confirm_fix_all') {
                try {
                    await i.update({
                        content: '⏳ Réparation des guildes en cours...',
                        components: [],
                    });

                    const guilds = getAllGuilds();
                    let fixedCount = 0;
                    let channelsRemoved = 0;
                    const fixes = [];

                    for (const guild of guilds) {
                        const guildFixes = [];
                        let needsUpdate = false;

                        // Fix 1: Salon privé sans upgrade 5+
                        if (guild.channel_id && guild.upgrade_level < 5) {
                            try {
                                const channel = await interaction.guild.channels
                                    .fetch(guild.channel_id)
                                    .catch(() => null);
                                if (channel) {
                                    await channel.delete('Guilde < Upgrade 5');
                                    channelsRemoved++;
                                    guildFixes.push('Salon supprimé (< Upgrade 5)');
                                }
                                db.prepare('UPDATE guilds SET channel_id = NULL WHERE id = ?').run(guild.id);
                                needsUpdate = true;
                            } catch (err) {
                                logger.warn(`Impossible de supprimer le salon de ${guild.name}:`, err.message);
                            }
                        }

                        // Fix 2: Treasury capacity incorrecte
                        const expectedCapacity = getExpectedTreasuryCapacity(guild.upgrade_level);
                        if (guild.treasury_capacity !== expectedCapacity) {
                            db.prepare('UPDATE guilds SET treasury_capacity = ? WHERE id = ?').run(
                                expectedCapacity,
                                guild.id
                            );
                            guildFixes.push(
                                `Treasury capacity: ${guild.treasury_capacity} → ${expectedCapacity}`
                            );
                            needsUpdate = true;
                        }

                        // Fix 3: Member slots incorrects
                        const expectedSlots = getExpectedMemberSlots(guild.upgrade_level);
                        if (guild.member_slots !== expectedSlots) {
                            db.prepare('UPDATE guilds SET member_slots = ? WHERE id = ?').run(
                                expectedSlots,
                                guild.id
                            );
                            guildFixes.push(`Slots: ${guild.member_slots} → ${expectedSlots}`);
                            needsUpdate = true;
                        }

                        // Fix 4: Treasury > capacity
                        if (guild.treasury > guild.treasury_capacity) {
                            db.prepare('UPDATE guilds SET treasury = ? WHERE id = ?').run(
                                guild.treasury_capacity,
                                guild.id
                            );
                            guildFixes.push(
                                `Treasury réduit: ${guild.treasury} → ${guild.treasury_capacity}`
                            );
                            needsUpdate = true;
                        }

                        // Fix 5: Upgrade level > 10
                        if (guild.upgrade_level > 10) {
                            db.prepare('UPDATE guilds SET upgrade_level = 10 WHERE id = ?').run(guild.id);
                            guildFixes.push(`Upgrade level: ${guild.upgrade_level} → 10`);
                            needsUpdate = true;
                        }

                        if (needsUpdate) {
                            fixedCount++;
                            fixes.push(`**${guild.name}** (ID: ${guild.id})\n${guildFixes.map(f => `  • ${f}`).join('\n')}`);
                        }
                    }

                    let responseText =
                        `✅ **Réparation terminée !**\n\n` +
                        `• Guildes analysées : **${guilds.length}**\n` +
                        `• Guildes réparées : **${fixedCount}**\n` +
                        `• Salons supprimés : **${channelsRemoved}**\n\n`;

                    if (fixes.length > 0) {
                        responseText += `**Corrections appliquées :**\n${fixes.slice(0, 10).join('\n\n')}`;
                        if (fixes.length > 10) {
                            responseText += `\n\n... et ${fixes.length - 10} autre(s) guilde(s)`;
                        }
                    } else {
                        responseText += `Aucune correction nécessaire.`;
                    }

                    // Tronquer si trop long
                    if (responseText.length > 1900) {
                        responseText = responseText.substring(0, 1900) + '...\n\n✅ Réparation terminée !';
                    }

                    await i.editReply({
                        content: responseText,
                        components: [],
                    });

                    logger.warn(
                        `[ADMIN] Réparation de ${fixedCount} guildes par ${interaction.user.tag} (${interaction.user.id})`
                    );
                } catch (error) {
                    logger.error('Erreur lors de la réparation des guildes:', error);
                    await i.editReply({
                        content: `❌ Erreur : ${error.message || String(error)}`,
                        components: [],
                    });
                }
            } else if (i.customId === 'cancel_fix_all') {
                await i.update({ content: '❌ Annulé.', components: [] });
            }
            collector.stop();
        });

        collector.on('end', (_c, reason) => {
            if (reason === 'time') {
                interaction
                    .editReply({ content: '⏰ Délai dépassé — annulé.', components: [] })
                    .catch(() => {});
            }
        });
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
    // Base: 3 slots
    // +1 à upgrade 2, 3, 4, 7, 8, 10
    const slots = {
        1: 3,
        2: 4,
        3: 5,
        4: 6,
        5: 6,
        6: 6,
        7: 7,
        8: 8,
        9: 8,
        10: 9,
    };
    return slots[upgradeLevel] || 3;
}
