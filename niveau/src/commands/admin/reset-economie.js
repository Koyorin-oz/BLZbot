const {
    SlashCommandBuilder,
    PermissionFlagsBits,
    ButtonBuilder,
    ButtonStyle,
    ActionRowBuilder,
    ComponentType,
} = require('discord.js');
const logger = require('../../utils/logger');
const { resetServerEconomy } = require('../../utils/reset-server-economy');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('reset-economie')
        .setDescription(
            'Remet à zéro l’économie du serveur (starss, RP, XP, inventaire, quêtes, trésoreries de guildes…).'
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    async execute(interaction) {
        const confirmButton = new ButtonBuilder()
            .setCustomId('confirm_economy_reset')
            .setLabel('OUI, RÉINITIALISER L’ÉCONOMIE')
            .setStyle(ButtonStyle.Danger);

        const cancelButton = new ButtonBuilder()
            .setCustomId('cancel_economy_reset')
            .setLabel('Annuler')
            .setStyle(ButtonStyle.Secondary);

        const row = new ActionRowBuilder().addComponents(confirmButton, cancelButton);

        const response = await interaction.reply({
            content:
                '⚠️ **Réinitialisation économique**\n\n' +
                'Seront remis à **zéro** (ou supprimés) :\n' +
                '• **Starss**, **RP / points**, **parts ranked**, **XP** & niveau (retour niveau 1)\n' +
                '• **Inventaire**, **progression de quêtes**, **battle pass**, **historique de gains**\n' +
                '• **Boutique** (achats, daily shop), **prêts**, **puits / marketplace**, **trophées** (`user_trophies`)\n' +
                '• **Trésorerie et boosts d’achat de guilde** (les guildes et leurs membres restent)\n\n' +
                '**Ne sont pas** touchés : noms Discord, **paramètres de notif**, **VIP**, **badges** (`user_badges`), **Halloween** (base séparée).\n\n' +
                'Cette action est **irréversible**. Confirmer ?',
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
                    content: 'Seul l’administrateur qui a lancé la commande peut confirmer.',
                    flags: 64,
                });
                return;
            }

            if (i.customId === 'confirm_economy_reset') {
                try {
                    await i.update({
                        content: '⏳ Réinitialisation de l’économie en cours…',
                        components: [],
                    });
                    const stats = resetServerEconomy();
                    const extra = Object.entries(stats.deleted)
                        .map(([k, v]) => `• \`${k}\` : ${v} ligne(s)`)
                        .join('\n');
                    await i.editReply({
                        content:
                            `✅ **Économie réinitialisée.**\n\n` +
                            `• Profils mis à jour : **${stats.usersReset}**\n` +
                            `• Lignes guildes (trésorerie / boosts) : **${stats.guildsReset}**\n` +
                            (extra ? `\nTables nettoyées :\n${extra}` : ''),
                        components: [],
                    });
                    logger.warn(
                        `[reset-economie] Par ${interaction.user.tag} (${interaction.user.id}) — users=${stats.usersReset} guildRows=${stats.guildsReset}`
                    );
                } catch (error) {
                    logger.error('reset-economie:', error);
                    await i.editReply({
                        content: `❌ Erreur : ${error.message || String(error)}`,
                        components: [],
                    });
                }
            } else if (i.customId === 'cancel_economy_reset') {
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
