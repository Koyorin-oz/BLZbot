const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const users = require('../services/users');
const { isOwner } = require('../lib/owners');

function parseAmount(raw) {
  const s = String(raw || '').replace(/\s/g, '');
  if (!s) throw new Error('Montant vide');
  return BigInt(s);
}

function canMod(interaction) {
  const admin = interaction.memberPermissions?.has(PermissionFlagsBits.Administrator);
  return Boolean(admin) || isOwner(interaction.user.id);
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('money')
    .setDescription('Gérer starss / points (admin serveur ou owner app) — aligné BLZbot.')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand((sc) =>
      sc
        .setName('give')
        .setDescription('Donner des starss')
        .addUserOption((o) => o.setName('membre').setDescription('Cible').setRequired(true))
        .addStringOption((o) => o.setName('montant').setDescription('Nombre entier').setRequired(true)),
    )
    .addSubcommand((sc) =>
      sc
        .setName('remove')
        .setDescription('Retirer des starss')
        .addUserOption((o) => o.setName('membre').setDescription('Cible').setRequired(true))
        .addStringOption((o) => o.setName('montant').setDescription('Nombre entier').setRequired(true)),
    )
    .addSubcommand((sc) =>
      sc
        .setName('set')
        .setDescription('Définir starss ou points exactement')
        .addUserOption((o) => o.setName('membre').setDescription('Cible').setRequired(true))
        .addStringOption((o) =>
          o
            .setName('type')
            .setDescription('Type')
            .setRequired(true)
            .addChoices(
              { name: 'Starss', value: 'stars' },
              { name: 'Points', value: 'points' },
            ),
        )
        .addStringOption((o) => o.setName('montant').setDescription('Nombre entier').setRequired(true)),
    ),
  async execute(interaction) {
    if (!canMod(interaction)) {
      await interaction.reply({ content: 'Permission refusée.', ephemeral: true });
      return;
    }
    const sub = interaction.options.getSubcommand();
    const target = interaction.options.getUser('membre', true);
    if (target.bot) {
      await interaction.reply({ content: 'Impossible sur un bot.', ephemeral: true });
      return;
    }
    users.getOrCreate(target.id, target.username);

    try {
      if (sub === 'give') {
        const a = parseAmount(interaction.options.getString('montant', true));
        users.addStars(target.id, a);
        await interaction.reply({
          content: `✅ **+${a.toLocaleString('fr-FR')}** starss pour **${target.username}**.`,
          ephemeral: true,
        });
        return;
      }
      if (sub === 'remove') {
        const a = parseAmount(interaction.options.getString('montant', true));
        users.addStars(target.id, -a);
        await interaction.reply({
          content: `✅ **-${a.toLocaleString('fr-FR')}** starss pour **${target.username}**.`,
          ephemeral: true,
        });
        return;
      }
      const type = interaction.options.getString('type', true);
      const a = parseAmount(interaction.options.getString('montant', true));
      if (a < 0n) {
        await interaction.reply({ content: 'Montant négatif interdit pour set.', ephemeral: true });
        return;
      }
      if (type === 'stars') users.setStars(target.id, a);
      else users.setPoints(target.id, a);
      await interaction.reply({
        content: `✅ **${type === 'stars' ? 'Starss' : 'Points'}** de **${target.username}** → **${a.toLocaleString('fr-FR')}**.`,
        ephemeral: true,
      });
    } catch (e) {
      await interaction.reply({ content: `❌ ${e.message || e}`, ephemeral: true });
    }
  },
};
