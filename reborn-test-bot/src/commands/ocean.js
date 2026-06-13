const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const users = require('../services/users');
const eventsSO = require('../services/eventsSO');
const { buildEventPanel } = require('../lib/eventPanel');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ocean')
    .setDescription("Event Océan : profil litres d'eau, index et boutique submergée."),

  async execute(interaction) {
    users.getOrCreate(interaction.user.id, interaction.user.username);
    eventsSO.checkAndClaim(interaction.user.id);
    const payload = buildEventPanel('ocean', interaction.user.id, 'profil');
    return interaction.reply({ ...payload, flags: MessageFlags.Ephemeral });
  },
};
