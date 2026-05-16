const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { d } = require('../lib/slashDesc');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('reborn-ref')
    .setDescription('Aperçu des commandes et modules disponibles sur ce serveur.'),
  async execute(interaction) {
    const embed = new EmbedBuilder()
      .setTitle('Guide des commandes')
      .setColor(0x9b59b6)
      .setDescription(
        [
          '**Économie** — `/solde`, `/payer`, `/daily` ; gains message et vocal ; boosts.',
          '**Boutique** — `/boutique` (slots du jour, coffres, boosts).',
          '**Guilde** — `/guilde`, `/profil-guilde`, focus, trésorerie, grades.',
          '**Progression** — `/arbre`, `/quetes`, `/ranked`, `/itemindex`, `/temple`.',
          '**Classements** — `/classement`, `/classement-guilde`, `/grp`.',
          '**Événements** — `/event`, `/echange`, `/separation`.',
          '**Collection** — `/trophees`, `/inventaire`, salon `/salon-hacker`.',
          '**Administration** — `/admin-roles`, `/admin-economie`, `/admin-focus`, `/passeport`, `/warn`.',
        ].join('\n'),
      );
    await interaction.reply({ embeds: [embed] });
  },
};
