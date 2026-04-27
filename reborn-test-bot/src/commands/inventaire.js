const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { buildInventairePayload } = require('../lib/shopV2Ui');

module.exports = {
  data: new SlashCommandBuilder().setName('inventaire').setDescription('Inventaire (même bannière que le profil + menu).'),
  /**
   * @param {import('discord.js').ChatInputCommandInteraction} interaction
   */
  async execute(interaction) {
    await interaction.deferReply();
    const p = await buildInventairePayload(interaction.user.id, interaction.user.username);
    return interaction.editReply({
      files: p.files,
      components: p.components,
      flags: p.flags,
    });
  },
};
