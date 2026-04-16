const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { PROFILE_PREVIEW_BUILD } = require('../../utils/canvas-profile-variants');
const { handleCommandError } = require('../../utils/error-handler');
const { renderProfileFichePreviewFromInteraction } = require('../../utils/render-profile-fiche-preview-interaction');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('testprofil')
        .setDescription('Aperçu fiches BLZ : Fiche 1 (2×3) ou Fiche 2 (fond identique à /profil, 1024×381).')
        .addStringOption((opt) =>
            opt
                .setName('style')
                .setDescription('Fiche 1 (2×3) ou Fiche 2 (même fond que /profile)')
                .setRequired(true)
                .addChoices(
                    { name: 'Fiche 1 — colonne + grille 2×3 (sauvegardée)', value: 'fiche_1' },
                    { name: 'Fiche 2 — fond /profile (1024×381)', value: 'fiche_2' }
                )
        )
        .addUserOption((opt) =>
            opt.setName('membre').setDescription('Membre à prévisualiser (défaut : vous)').setRequired(false)
        ),

    async execute(interaction) {
        try {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });

            const variant = interaction.options.getString('style', true);
            const result = await renderProfileFichePreviewFromInteraction(interaction, variant, {
                attachmentPrefix: 'testprofil',
            });
            if (result.error) {
                return interaction.editReply({ content: result.error });
            }

            const { file, meta, variant: resolved } = result;
            const hint = meta ? `**${meta.label}** — _${meta.hint}_` : resolved;

            return interaction.editReply({
                content:
                    `🧪 ${hint}\n` +
                    `_build ${PROFILE_PREVIEW_BUILD}_ · La commande \`/profile\` officielle est inchangée.`,
                files: [file],
            });
        } catch (error) {
            await handleCommandError(interaction, error, interaction.client);
        }
    },
};
