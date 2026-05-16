const { SlashCommandBuilder } = require('discord.js');
const trade = require('../services/trade');
const { d } = require('../lib/slashDesc');

function replyRefus(interaction, text) {
  const msg = text.startsWith('❌') ? text : `❌ ${text}`;
  return interaction.reply({ content: msg });
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('echange')
    .setDescription(d('🔁', 'Échange starss + objets (écart max 40 %).'))
    .addSubcommand((sc) =>
      sc
        .setName('proposer')
        .setDescription('Proposer un échange')
        .addUserOption((o) => o.setName('vers').setDescription('Destinataire').setRequired(true))
        .addStringOption((o) =>
          o
            .setName('starss_envoyes')
            .setDescription('Starss que tu proposes au destinataire')
            .setRequired(true),
        )
        .addStringOption((o) =>
          o
            .setName('starss_recus')
            .setDescription('Starss que tu demandes au destinataire')
            .setRequired(true),
        )
        .addStringOption((o) =>
          o
            .setName('objets_envoyes')
            .setDescription('Optionnel : ex. corail:2,xp_boost:1')
            .setRequired(false),
        )
        .addStringOption((o) =>
          o
            .setName('objets_recus')
            .setDescription('Optionnel : items demandés au destinataire (même format)')
            .setRequired(false),
        )
        .addStringOption((o) =>
          o
            .setName('monnaie_evenement_envoyee')
            .setDescription('Monnaie d’événement que tu donnes (entier ; 1 = 5 valeur)')
            .setRequired(false),
        )
        .addStringOption((o) =>
          o
            .setName('monnaie_evenement_recue')
            .setDescription('Monnaie d’événement demandée au destinataire')
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
    if (!hub) return interaction.reply({ content: 'Serveur uniquement.' });
    const sub = interaction.options.getSubcommand();
    if (sub === 'proposer') {
      const to = interaction.options.getUser('vers', true);
      if (to.id === interaction.user.id || to.bot) {
        return replyRefus(interaction, 'Destinataire invalide (choisis un autre membre, pas un bot).');
      }
      let a;
      let b;
      try {
        a = BigInt(interaction.options.getString('starss_envoyes', true).replace(/\s/g, ''));
        b = BigInt(interaction.options.getString('starss_recus', true).replace(/\s/g, ''));
      } catch {
        return replyRefus(interaction, 'Montants de starss invalides (utilise des nombres entiers).');
      }
      let fromItems = [];
      let toItems = [];
      try {
        const rawA = interaction.options.getString('objets_envoyes');
        const rawB = interaction.options.getString('objets_recus');
        if (rawA) fromItems = trade.parseItemsSpec(rawA);
        if (rawB) toItems = trade.parseItemsSpec(rawB);
      } catch (e) {
        return replyRefus(interaction, e.message || String(e));
      }
      let fe = 0n;
      let te = 0n;
      try {
        const rawFe = interaction.options.getString('monnaie_evenement_envoyee');
        const rawTe = interaction.options.getString('monnaie_evenement_recue');
        if (rawFe) fe = BigInt(rawFe.replace(/\s/g, ''));
        if (rawTe) te = BigInt(rawTe.replace(/\s/g, ''));
      } catch {
        return replyRefus(interaction, 'Montants de monnaie d’événement invalides.');
      }
      const r = trade.createTrade(hub, interaction.user.id, to.id, a, b, fromItems, toItems, fe, te);
      if (!r.ok) return replyRefus(interaction, r.error);
      return interaction.reply({
        content: `✅ Trade **${r.tradeId}** créé. ${to}, utilise \`/echange accepter\` avec l’ID **${r.tradeId}**.`,
        ephemeral: false,
      });
    }
    if (sub === 'accepter') {
      const id = interaction.options.getString('trade_id', true).trim();
      const r = trade.acceptTrade(id, interaction.user.id);
      if (!r.ok) return replyRefus(interaction, r.error);
      return interaction.reply({ content: '✅ Échange accepté.' });
    }
  },
};
