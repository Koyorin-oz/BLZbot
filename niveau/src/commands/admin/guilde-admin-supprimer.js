const {
    SlashCommandBuilder,
    PermissionFlagsBits,
    ButtonBuilder,
    ButtonStyle,
    ActionRowBuilder,
    ComponentType,
} = require('discord.js');
const { getGuildById, dissolveGuild, getGuildMembersWithDetails } = require('../../utils/db-guilds');
const logger = require('../../utils/logger');
const roleConfig = require('../../config/role.config.json');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('guilde-admin-supprimer')
        .setDescription('Supprime définitivement une guilde (Admin uniquement)')
        .addIntegerOption((option) =>
            option
                .setName('guilde-id')
                .setDescription('L\'ID de la guilde à supprimer')
                .setRequired(true)
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    async execute(interaction) {
        const guildId = interaction.options.getInteger('guilde-id');

        // Vérifier que la guilde existe
        const guild = getGuildById(guildId);
        if (!guild) {
            return interaction.reply({
                content: `❌ Aucune guilde trouvée avec l'ID **${guildId}**.`,
                flags: 64,
            });
        }

        // Récupérer les informations de la guilde
        const members = getGuildMembersWithDetails(guildId);
        const memberCount = members.length;

        // Boutons de confirmation
        const confirmButton = new ButtonBuilder()
            .setCustomId('confirm_delete_guild')
            .setLabel('OUI, SUPPRIMER LA GUILDE')
            .setStyle(ButtonStyle.Danger);

        const cancelButton = new ButtonBuilder()
            .setCustomId('cancel_delete_guild')
            .setLabel('Annuler')
            .setStyle(ButtonStyle.Secondary);

        const row = new ActionRowBuilder().addComponents(confirmButton, cancelButton);

        const response = await interaction.reply({
            content:
                `⚠️ **SUPPRESSION DE GUILDE**\n\n` +
                `Vous êtes sur le point de supprimer définitivement :\n\n` +
                `${guild.emoji} **${guild.name}** (ID: ${guildId})\n` +
                `• Niveau : **${guild.level}**\n` +
                `• Membres : **${memberCount}**\n` +
                `• Chef : <@${guild.owner_id}>\n` +
                `• Trésorerie : **${guild.treasury || 0}** starss\n\n` +
                `**Cette action va :**\n` +
                `✗ Supprimer la guilde de la base de données\n` +
                `✗ Retirer tous les membres (**${memberCount}** personne(s))\n` +
                `✗ Supprimer le salon privé (si existant)\n` +
                `✗ Supprimer toutes les guerres et déclarations en cours\n` +
                `✗ Supprimer la progression des quêtes de guilde\n` +
                `✗ Retirer le rôle "Créateur de Guilde" au chef\n\n` +
                `⚠️ **Cette action est IRRÉVERSIBLE !**\n\n` +
                `Confirmer la suppression ?`,
            components: [row],
            flags: 64,
        });

        const collector = response.createMessageComponentCollector({
            componentType: ComponentType.Button,
            time: 60 * 1000, // 60 secondes
        });

        collector.on('collect', async (i) => {
            if (i.user.id !== interaction.user.id) {
                await i.reply({
                    content: 'Seul l\'administrateur qui a lancé la commande peut confirmer.',
                    flags: 64,
                });
                return;
            }

            if (i.customId === 'confirm_delete_guild') {
                try {
                    await i.update({
                        content: '⏳ Suppression de la guilde en cours...',
                        components: [],
                    });

                    const discordGuild = interaction.guild;

                    // Supprimer le salon privé si existant
                    if (guild.channel_id) {
                        try {
                            const channel = await discordGuild.channels
                                .fetch(guild.channel_id)
                                .catch(() => null);
                            if (channel) {
                                await channel.delete('Guilde supprimée par admin');
                                logger.info(
                                    `Salon ${guild.channel_id} supprimé (guilde ${guild.name})`
                                );
                            }
                        } catch (error) {
                            logger.warn(
                                `Impossible de supprimer le salon ${guild.channel_id}:`,
                                error.message
                            );
                        }
                    }

                    // Retirer le rôle "Créateur de Guilde" au chef
                    try {
                        const ownerMember = await discordGuild.members
                            .fetch(guild.owner_id)
                            .catch(() => null);
                        const creatorRole = discordGuild.roles.cache.find(
                            (r) => r.name === roleConfig.questRewardRoles.guildCreator
                        );
                        if (ownerMember && creatorRole) {
                            await ownerMember.roles.remove(creatorRole);
                            logger.info(
                                `Rôle "Créateur de Guilde" retiré à ${guild.owner_id}`
                            );
                        }
                    } catch (error) {
                        logger.warn(
                            `Impossible de retirer le rôle Créateur de Guilde:`,
                            error.message
                        );
                    }

                    // Notifier tous les membres de la dissolution
                    for (const member of members) {
                        try {
                            const user = await interaction.client.users
                                .fetch(member.id)
                                .catch(() => null);
                            if (user) {
                                await user
                                    .send(
                                        `🔔 La guilde **${guild.name}** a été supprimée par un administrateur du serveur.`
                                    )
                                    .catch(() => {});
                            }
                        } catch (err) {
                            // Ignore les erreurs d'envoi de MP
                        }
                    }

                    // Dissoudre la guilde (supprime de la DB et nettoie tout)
                    dissolveGuild(guildId);

                    await i.editReply({
                        content:
                            `✅ **Guilde supprimée avec succès !**\n\n` +
                            `${guild.emoji} **${guild.name}** (ID: ${guildId})\n` +
                            `• ${memberCount} membre(s) ont été retirés\n` +
                            `• Salon privé supprimé (si existant)\n` +
                            `• Toutes les données associées ont été nettoyées\n\n` +
                            `Action effectuée par : ${interaction.user.tag}`,
                        components: [],
                    });

                    logger.warn(
                        `[ADMIN] Guilde "${guild.name}" (ID: ${guildId}) supprimée par ${interaction.user.tag} (${interaction.user.id})`
                    );
                } catch (error) {
                    logger.error('Erreur lors de la suppression de la guilde:', error);
                    await i.editReply({
                        content: `❌ Erreur lors de la suppression : ${error.message || String(error)}`,
                        components: [],
                    });
                }
            } else if (i.customId === 'cancel_delete_guild') {
                await i.update({
                    content: '❌ Suppression annulée. La guilde n\'a pas été modifiée.',
                    components: [],
                });
            }
            collector.stop();
        });

        collector.on('end', (_c, reason) => {
            if (reason === 'time') {
                interaction
                    .editReply({
                        content: '⏰ Délai dépassé — suppression annulée.',
                        components: [],
                    })
                    .catch(() => {});
            }
        });
    },
};
