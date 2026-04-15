const {
    SlashCommandBuilder,
    PermissionFlagsBits,
    MessageFlags,
    ButtonBuilder,
    ButtonStyle,
    ActionRowBuilder,
    ComponentType,
} = require('discord.js');
const logger = require('../../utils/logger');
const { resetDailyLastClaimedForUserIds } = require('../../utils/db-users');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('reset-daily-membres')
        .setDescription('Reset le cooldown /daily pour tous les humains du serveur (profils en base).')
        .setDMPermission(false)
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    async execute(interaction) {
        if (!interaction.inGuild()) {
            await interaction.reply({
                content: 'Cette commande doit être utilisée dans un serveur.',
                flags: MessageFlags.Ephemeral,
            });
            return;
        }

        const confirmButton = new ButtonBuilder()
            .setCustomId('confirm_reset_daily_membres')
            .setLabel('Oui, reset /daily pour tout le monde')
            .setStyle(ButtonStyle.Danger);

        const cancelButton = new ButtonBuilder()
            .setCustomId('cancel_reset_daily_membres')
            .setLabel('Annuler')
            .setStyle(ButtonStyle.Secondary);

        const row = new ActionRowBuilder().addComponents(confirmButton, cancelButton);

        const response = await interaction.reply({
            content:
                '⚠️ **Reset du /daily (membres du serveur)**\n\n' +
                'Tous les **membres humains** de **ce serveur** pourront refaire `/daily` tout de suite ' +
                '(champ `daily_last_claimed` remis à 0 pour les profils déjà en base).\n\n' +
                'Les comptes absents de la base ne sont pas créés automatiquement.\n\n' +
                'Confirmer ?',
            components: [row],
            flags: MessageFlags.Ephemeral,
        });

        const collector = response.createMessageComponentCollector({
            componentType: ComponentType.Button,
            time: 60 * 1000,
        });

        collector.on('collect', async (i) => {
            if (i.user.id !== interaction.user.id) {
                await i.reply({
                    content: 'Seul l’administrateur qui a lancé la commande peut confirmer.',
                    flags: MessageFlags.Ephemeral,
                });
                return;
            }

            if (i.customId === 'confirm_reset_daily_membres') {
                try {
                    await i.update({
                        content: '⏳ Réinitialisation du /daily pour les membres…',
                        components: [],
                    });

                    const guild = interaction.guild;
                    await guild.members.fetch().catch(() => null);

                    const userIds = guild.members.cache
                        .filter((m) => !m.user.bot)
                        .map((m) => m.id);

                    const updatedRows = resetDailyLastClaimedForUserIds(userIds);

                    await i.editReply({
                        content:
                            `✅ **Daily réinitialisé.**\n\n` +
                            `• Membres humains (cache) : **${userIds.length}**\n` +
                            `• Lignes \`users\` mises à jour (\`daily_last_claimed = 0\`) : **${updatedRows}**`,
                        components: [],
                    });
                    logger.warn(
                        `[reset-daily-membres] Par ${interaction.user.tag} (${interaction.user.id}) guild=${guild.id} members=${userIds.length} rows=${updatedRows}`
                    );
                } catch (error) {
                    logger.error('reset-daily-membres:', error);
                    await i.editReply({
                        content: `❌ Erreur : ${error.message || String(error)}`,
                        components: [],
                    });
                }
            } else if (i.customId === 'cancel_reset_daily_membres') {
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
