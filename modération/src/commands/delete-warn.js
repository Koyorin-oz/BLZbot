const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { denyUnlessCanMod } = require('../utils/mod-access');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('delete-warn')
        .setDescription('Supprimer un avertissement par son ID.')
        .setDefaultMemberPermissions(null)
        .addIntegerOption((option) =>
            option.setName('warn_id').setDescription('ID du warn (visible dans /modlog)').setRequired(true),
        )
        .toJSON(),

    async execute(interaction, { dbManager }) {
        const denied = denyUnlessCanMod(interaction, PermissionFlagsBits.ModerateMembers);
        if (denied) return interaction.reply(denied);

        const warnId = interaction.options.getInteger('warn_id');
        const dbSanctions = dbManager.getSanctionsDb();

        dbSanctions.run(
            'UPDATE sanctions SET active = 0 WHERE id = ? AND type = \'Warn\'',
            [warnId],
            function (err) {
                if (err) {
                    console.error('delete-warn:', err);
                    return interaction.reply({
                        content: '❌ Erreur lors de la suppression du warn.',
                        flags: 64,
                    });
                }
                if (this.changes === 0) {
                    return interaction.reply({
                        content: `❌ Aucun warn trouvé avec l'ID ${warnId}.`,
                        flags: 64,
                    });
                }
                interaction.reply({
                    content: `✅ Warn #${warnId} supprimé.`,
                    flags: 64,
                });
            },
        );
    },
};
