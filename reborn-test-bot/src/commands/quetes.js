const { SlashCommandBuilder } = require('discord.js');
const { d } = require('../lib/slashDesc');
const { buildQuetesPayload } = require('../lib/quetesPanelUi');
const users = require('../services/users');
const { deferReplyEphemeral, replyEphemeral } = require('../lib/ephemeral');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('quetes')
    .setDescription(d('🎯', 'Quêtes quotidiennes, hebdomadaires et progression.')),

  async execute(interaction) {
    if (!interaction.guildId) return replyEphemeral(interaction, { content: 'Serveur uniquement.' });
    users.getOrCreate(interaction.user.id, interaction.user.username);
    await deferReplyEphemeral(interaction);
    const payload = await buildQuetesPayload(interaction.user.id, 0, {
      displayName: interaction.member?.displayName || interaction.user.username,
      avatarUrl: interaction.user.displayAvatarURL({ extension: 'png', size: 256 }),
    });
    return interaction.editReply(payload);
  },
};
