const { SlashCommandBuilder } = require('discord.js');
const users = require('../services/users');

function parseAmount(raw) {
  return BigInt(String(raw || '').replace(/\s/g, ''));
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('payer')
    .setDescription('Transférer des starss à un membre (comme sur BLZbot).')
    .addUserOption((o) => o.setName('membre').setDescription('Destinataire').setRequired(true))
    .addStringOption((o) => o.setName('montant').setDescription('Montant entier').setRequired(true)),
  async execute(interaction) {
    const from = interaction.user.id;
    const to = interaction.options.getUser('membre', true);
    if (to.bot) {
      await interaction.reply({ content: 'Impossible vers un bot.' });
      return;
    }
    if (to.id === from) {
      await interaction.reply({ content: 'Tu ne peux pas te payer toi-même.' });
      return;
    }
    let amount;
    try {
      amount = parseAmount(interaction.options.getString('montant', true));
    } catch {
      await interaction.reply({ content: 'Montant invalide.' });
      return;
    }
    if (amount <= 0n) {
      await interaction.reply({ content: 'Montant doit être > 0.' });
      return;
    }
    users.getOrCreate(from, interaction.user.username);
    users.getOrCreate(to.id, to.username);
    if (users.getStars(from) < amount) {
      await interaction.reply({ content: 'Solde insuffisant.' });
      return;
    }
    users.addStars(from, -amount);
    users.addStars(to.id, amount);
    await interaction.reply({
      content: `Tu as donné **${amount.toLocaleString('fr-FR')}** starss à **${to.username}**.`,
    });
  },
};
