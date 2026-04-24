const { SlashCommandBuilder } = require('discord.js');
const wallet = require('../lib/wallet-store');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('wallet')
    .setDescription('Starss de test (JSON local, pas de plafond).')
    .addSubcommand((s) =>
      s.setName('voir').setDescription('Affiche ton solde (ou celui d’un membre).').addUserOption((o) => o.setName('membre').setDescription('Optionnel')),
    )
    .addSubcommand((s) =>
      s
        .setName('set')
        .setDescription('Définit le solde exact (owner app).')
        .addUserOption((o) => o.setName('membre').setDescription('Cible').setRequired(true))
        .addStringOption((o) =>
          o.setName('montant').setDescription('Entier, peut être très grand').setRequired(true),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName('add')
        .setDescription('Ajoute au solde (owner app).')
        .addUserOption((o) => o.setName('membre').setDescription('Cible').setRequired(true))
        .addStringOption((o) =>
          o.setName('delta').setDescription('Peut être négatif').setRequired(true),
        ),
    ),
  /**
   * @param {import('discord.js').ChatInputCommandInteraction} interaction
   * @param {{ isOwner: () => boolean }} ctx
   */
  async execute(interaction, ctx) {
    const sub = interaction.options.getSubcommand();
    if (sub === 'voir') {
      const u = interaction.options.getUser('membre') || interaction.user;
      const bal = wallet.getBalance(u.id);
      await interaction.reply({
        content: `**${u.tag}** — **${bal.toLocaleString('fr-FR')}** starss (test)`,
        ephemeral: true,
      });
      return;
    }
    if (!ctx.isOwner()) {
      await interaction.reply({ content: 'Réservé au propriétaire de l’app / REBORN_TEST_OWNER_IDS.', ephemeral: true });
      return;
    }
    const mem = interaction.options.getUser('membre', true);
    if (sub === 'set') {
      const raw = interaction.options.getString('montant', true);
      const n = BigInt(raw.replace(/\s/g, ''));
      wallet.setBalance(mem.id, n);
      await interaction.reply({
        content: `Solde **${mem.tag}** → **${wallet.getBalance(mem.id).toLocaleString('fr-FR')}** starss`,
        ephemeral: true,
      });
      return;
    }
    if (sub === 'add') {
      const raw = interaction.options.getString('delta', true);
      const n = BigInt(raw.replace(/\s/g, ''));
      wallet.addBalance(mem.id, n);
      await interaction.reply({
        content: `**${mem.tag}** — nouveau solde **${wallet.getBalance(mem.id).toLocaleString('fr-FR')}** starss`,
        ephemeral: true,
      });
    }
  },
};
