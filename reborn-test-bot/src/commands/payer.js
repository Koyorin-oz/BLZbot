const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const users = require('../services/users');
const { d } = require('../lib/slashDesc');

function parseAmount(raw) {
  return BigInt(String(raw || '').replace(/\s/g, ''));
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('payer')
    .setDescription(d('💸', 'Transfère des starss à un autre membre.'))
    .addUserOption((o) => o.setName('membre').setDescription('Destinataire').setRequired(true))
    .addStringOption((o) => o.setName('montant').setDescription('Montant entier').setRequired(true)),
  async execute(interaction) {
    const from = interaction.user.id;
    const to = interaction.options.getUser('membre', true);

    const Embed = new EmbedBuilder()
      .setColor('#FFA500')
      .setTitle('💸 Transfert de starss')
      .setFooter({ text: 'BLZbot' })
      .setTimestamp();

    if (to.bot && to.id === interaction.client.user.id) {
      await interaction.reply({ embeds: [Embed.setDescription('❌ Impossible de me donner des starss. (après si tu veux, tu peux en donner à un développeur <:chut:1410392624208023613>)')], flags: MessageFlags.Ephemeral });
      return;
    }

    if (to.bot) {
      await interaction.reply({ embeds: [Embed.setDescription('❌ Impossible de payer un bot.')], flags: MessageFlags.Ephemeral });
      return;
    }
    if (to.id === from) {
      await interaction.reply({ embeds: [Embed.setDescription('❌ Tu ne peux pas te payer toi-même.')], flags: MessageFlags.Ephemeral });
      return;
    }
    let amount;
    try {
      amount = parseAmount(interaction.options.getString('montant', true));
    } catch {
      await interaction.reply({ embeds: [Embed.setDescription('❌ Le montant est invalide.')], flags: MessageFlags.Ephemeral });
      return;
    }
    if (amount <= 0n) {
      await interaction.reply({ embeds: [Embed.setDescription('❌ Le montant doit être **supérieur à 0**.')], flags: MessageFlags.Ephemeral });
      return;
    }
    users.getOrCreate(from, interaction.user.username);
    users.getOrCreate(to.id, to.username);
    if (users.getStars(from) < amount) {
      await interaction.reply({ embeds: [Embed.setDescription('❌ Solde insuffisant.')], flags: MessageFlags.Ephemeral });
      return;
    }
    users.addStars(from, -amount);
    users.addStars(to.id, amount);
    await interaction.reply({
      embeds: [Embed.setDescription(`Tu as donné **${amount.toLocaleString()}** starss à <@${to.id}>.`)],
    });
  },
};
