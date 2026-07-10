const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { buildBoutiquePayload } = require('../lib/shopV2Ui');
const { d } = require('../lib/slashDesc');
const { deferReplyEphemeral } = require('../lib/ephemeral');

module.exports = {
  data: new SlashCommandBuilder().setName('boutique').setDescription(d('🛒', 'Boutique du jour — items, coffres et boosts.')),
  /**
   * @param {import('discord.js').ChatInputCommandInteraction} interaction
   */
  async execute(interaction) {
    await deferReplyEphemeral(interaction);
    const p = await buildBoutiquePayload(interaction.user.id, interaction.user.username);
    return interaction.editReply({
      files: p.files,
      components: p.components,
      flags: p.flags,
    });
  },
};
