const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const users = require('../services/users');
const eventsSO = require('../services/eventsSO');
const { buildEventPanel } = require('../lib/eventPanel');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('space')
    .setDescription("Event Espace : profil météorites, index et boutique stellaire."),

  async execute(interaction) {
    users.getOrCreate(interaction.user.id, interaction.user.username);
    eventsSO.checkAndClaim(interaction.user.id);
    const payload = buildEventPanel('space', interaction.user.id, 'profil');
    return interaction.reply({ ...payload, flags: MessageFlags.Ephemeral });
  },
};
