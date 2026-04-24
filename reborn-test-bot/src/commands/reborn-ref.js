const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('reborn-ref')
    .setDescription('Récap modules REBORN sur ce bot de test (pas BLZbot prod).'),
  async execute(interaction) {
    const embed = new EmbedBuilder()
      .setTitle('REBORN — bot de test')
      .setColor(0x9b59b6)
      .setDescription(
        [
          '**Économie** — starss / points / XP, gains 15/msg & 40/min voc, boosts, daily.',
          '**Boutique** — 5 slots/j (UTC), coffres, achats boutons.',
          '**Guilde joueur** — `/guilde` créer/rejoindre/trésorerie/grades/focus (GRP cible).',
          '**GRP** — reset mensuel auto (clé mois UTC) + pics pour grades.',
          '**Séparation** — `/separation` + tick 60s (12h → 48h guerre GRP).',
          '**Échanges** — `/echange` règle 40 % (starss).',
          '**Index** — `/itemindex` paliers 10→100 %.',
          '**Staff** — `/passeport`, `/warn` (points sécu).',
          '',
          '_Tout est local à `reborn-test-bot` + SQLite `data/reborn.sqlite`._',
        ].join('\n'),
      );
    await interaction.reply({ embeds: [embed], ephemeral: true });
  },
};
