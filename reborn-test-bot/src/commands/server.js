const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder().setName('server').setDescription('Infos serveur (debug).'),
  /**
   * @param {import('discord.js').ChatInputCommandInteraction} interaction
   */
  async execute(interaction) {
    const g = interaction.guild;
    if (!g) {
      await interaction.reply({ content: 'Hors serveur.' });
      return;
    }
    const e = new EmbedBuilder()
      .setTitle(g.name)
      .setThumbnail(g.iconURL({ size: 256 }))
      .addFields(
        { name: 'ID', value: g.id, inline: true },
        { name: 'Membres', value: `${g.memberCount}`, inline: true },
        { name: 'Boost', value: `Niveau ${g.premiumTier}`, inline: true },
      )
      .setTimestamp();
    await interaction.reply({ embeds: [e] });
  },
};
