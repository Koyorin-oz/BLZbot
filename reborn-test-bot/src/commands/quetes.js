const { SlashCommandBuilder } = require('discord.js');
const { d } = require('../lib/slashDesc');
const { buildQuetesPayload } = require('../lib/quetesPanelUi');
const users = require('../services/users');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('quetes')
    .setDescription(d('🎯', 'Quêtes quotidiennes, hebdomadaires et progression.')),

  async execute(interaction) {
    if (!interaction.guildId) return interaction.reply({ content: 'Serveur uniquement.' });
    users.getOrCreate(interaction.user.id, interaction.user.username);
    await interaction.deferReply();
    const payload = await buildQuetesPayload(interaction.user.id, 0, {
      displayName: interaction.member?.displayName || interaction.user.username,
      avatarUrl: interaction.user.displayAvatarURL({ extension: 'png', size: 256 }),
    });
    return interaction.editReply(payload);
  },
};
