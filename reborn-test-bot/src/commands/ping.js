const { SlashCommandBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder().setName('ping').setDescription('Latence WebSocket + REST (aucun cooldown).'),
  /**
   * @param {import('discord.js').ChatInputCommandInteraction} interaction
   */
  async execute(interaction) {
    const ws = interaction.client.ws.ping;
    const t0 = Date.now();
    await interaction.reply({ content: 'Mesure…' });
    const rest = Date.now() - t0;
    await interaction.editReply({ content: `Pong — WS: **${ws}** ms · REST (edit): **${rest}** ms` });
  },
};
