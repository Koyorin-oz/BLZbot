const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('reborn-ref')
    .setDescription('État du bot de test REBORN + rappel des specs.'),
  async execute(interaction) {
    const embed = new EmbedBuilder()
      .setTitle('REBORN — bot de test')
      .setColor(0x9b59b6)
      .setDescription(
        [
          '**Implémenté sur ce bot**',
          '• Starss / points / XP (SQLite `data/reborn.sqlite`)',
          '• Gains passifs : **15** starss/msg · **40**/min voc (×2 starss si boost)',
          '• **GXP** + **GRP** par membre et par serveur (messages + voc)',
          '• **Boutique** : 5 slots / jour (UTC), coffres, boosts ×2 (1 h)',
          '• Commandes : `/solde` `/money` `/payer` `/boutique` `/inventaire` `/daily`',
          '',
          '**À venir (grosse MAJ)**',
          '• Trésorerie guilde, grades, ranked reset mensuel, séparation, trades 40 %, index items, quêtes…',
        ].join('\n'),
      );
    await interaction.reply({ embeds: [embed], ephemeral: true });
  },
};
