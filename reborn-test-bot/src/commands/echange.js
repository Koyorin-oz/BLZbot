const { SlashCommandBuilder } = require('discord.js');
const trade = require('../services/trade');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('echange')
    .setDescription('Échange starss entre joueurs (règle 40 % de valeur max).')
    .addSubcommand((sc) =>
      sc
        .setName('proposer')
        .setDescription('Proposer un échange')
        .addUserOption((o) => o.setName('vers').setDescription('Destinataire').setRequired(true))
        .addStringOption((o) => o.setName('tu_donnes').setDescription('Starss que tu donnes').setRequired(true))
        .addStringOption((o) => o.setName('tu_recois').setDescription('Starss que tu reçois').setRequired(true))
        .addStringOption((o) =>
          o
            .setName('objets_donnes')
            .setDescription('Optionnel : ex. corail:2,xp_boost:1')
            .setRequired(false),
        )
        .addStringOption((o) =>
          o
            .setName('objets_recus')
            .setDescription('Optionnel : items demandés au destinataire (même format)')
            .setRequired(false),
        ),
    )
    .addSubcommand((sc) =>
      sc
        .setName('accepter')
        .setDescription('Accepter un trade en attente')
        .addStringOption((o) => o.setName('trade_id').setDescription('ID du trade').setRequired(true)),
    ),
  async execute(interaction) {
    const hub = interaction.guildId;
    if (!hub) return interaction.reply({ content: 'Serveur uniquement.', ephemeral: true });
    const sub = interaction.options.getSubcommand();
    if (sub === 'proposer') {
      const to = interaction.options.getUser('vers', true);
      if (to.id === interaction.user.id || to.bot) {
        return interaction.reply({ content: 'Destinataire invalide.', ephemeral: true });
      }
      let a;
      let b;
      try {
        a = BigInt(interaction.options.getString('tu_donnes', true).replace(/\s/g, ''));
        b = BigInt(interaction.options.getString('tu_recois', true).replace(/\s/g, ''));
      } catch {
        return interaction.reply({ content: 'Montants invalides.', ephemeral: true });
      }
      let fromItems = [];
      let toItems = [];
      try {
        const rawA = interaction.options.getString('objets_donnes');
        const rawB = interaction.options.getString('objets_recus');
        if (rawA) fromItems = trade.parseItemsSpec(rawA);
        if (rawB) toItems = trade.parseItemsSpec(rawB);
      } catch (e) {
        return interaction.reply({ content: e.message || String(e), ephemeral: true });
      }
      const r = trade.createTrade(hub, interaction.user.id, to.id, a, b, fromItems, toItems);
      if (!r.ok) return interaction.reply({ content: r.error, ephemeral: true });
      return interaction.reply({
        content: `Trade **${r.tradeId}** créé. ${to}, utilise \`/echange accepter\` avec l’ID **${r.tradeId}**.`,
        ephemeral: false,
      });
    }
    if (sub === 'accepter') {
      const id = interaction.options.getString('trade_id', true).trim();
      const r = trade.acceptTrade(id, interaction.user.id);
      if (!r.ok) return interaction.reply({ content: r.error, ephemeral: true });
      return interaction.reply({ content: 'Échange accepté.', ephemeral: true });
    }
  },
};
