const { SlashCommandBuilder } = require('discord.js');
const wallet = require('../lib/wallet-store');

function fmtStarss(s) {
  try {
    return BigInt(s).toLocaleString('fr-FR');
  } catch {
    return s;
  }
}

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
        content: `**${u.tag}** — **${fmtStarss(bal)}** starss (test)`,
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
      try {
        wallet.setBalance(mem.id, BigInt(raw.replace(/\s/g, '')));
      } catch (err) {
        await interaction.reply({ content: `Montant invalide: ${err?.message || err}`, ephemeral: true });
        return;
      }
      await interaction.reply({
        content: `Solde **${mem.tag}** → **${fmtStarss(wallet.getBalance(mem.id))}** starss`,
        ephemeral: true,
      });
      return;
    }
    if (sub === 'add') {
      const raw = interaction.options.getString('delta', true);
      try {
        wallet.addBalance(mem.id, BigInt(raw.replace(/\s/g, '')));
      } catch (err) {
        await interaction.reply({ content: `Delta invalide: ${err?.message || err}`, ephemeral: true });
        return;
      }
      await interaction.reply({
        content: `**${mem.tag}** — nouveau solde **${fmtStarss(wallet.getBalance(mem.id))}** starss`,
        ephemeral: true,
      });
    }
  },
};
