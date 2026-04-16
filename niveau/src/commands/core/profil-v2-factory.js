const { SlashCommandBuilder } = require('discord.js');
const { PROFILE_PREVIEW_BUILD } = require('../../utils/canvas-profile-variants');
const { handleCommandError } = require('../../utils/error-handler');
const { renderProfileFichePreviewFromInteraction } = require('../../utils/render-profile-fiche-preview-interaction');

/**
 * @param {string} commandName Nom slash Discord (ex. profil-v2, profil)
 * @param {string} description
 * @param {string} attachmentPrefix Préfixe du fichier PNG joint
 */
function buildProfilV2Slash(commandName, description, attachmentPrefix) {
    return {
        data: new SlashCommandBuilder()
            .setName(commandName)
            .setDescription(description)
            .addUserOption((opt) =>
                opt.setName('membre').setDescription('Membre à afficher (défaut : vous)').setRequired(false)
            ),

        async execute(interaction) {
            try {
                await interaction.deferReply();

                const result = await renderProfileFichePreviewFromInteraction(interaction, 'fiche_2', {
                    attachmentPrefix,
                });
                if (result.error) {
                    return interaction.editReply({ content: result.error });
                }

                const { file, meta } = result;
                const hint = meta ? `**${meta.label}** — _${meta.hint}_` : 'fiche_2';

                return interaction.editReply({
                    content: `${hint}\n_build ${PROFILE_PREVIEW_BUILD}_`,
                    files: [file],
                });
            } catch (error) {
                await handleCommandError(interaction, error, interaction.client);
            }
        },
    };
}

module.exports = { buildProfilV2Slash };
