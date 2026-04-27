const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { buildBoutiquePayload } = require('../lib/shopV2Ui');

module.exports = {
  data: new SlashCommandBuilder().setName('boutique').setDescription('Boutique REBORN (Components v2 + menu).'),
  /**
   * @param {import('discord.js').ChatInputCommandInteraction} interaction
   */
  async execute(interaction) {
    await interaction.deferReply();
    const p = await buildBoutiquePayload(interaction.user.id, interaction.user.username);
    return interaction.editReply({
      files: p.files,
      components: p.components,
      flags: p.flags,
    });
  },
};
