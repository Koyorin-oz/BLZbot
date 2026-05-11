const {
  SlashCommandBuilder,
  ContainerBuilder,
  TextDisplayBuilder,
  MessageFlags,
} = require('discord.js');
const users = require('../services/users');
const rankedRoles = require('../services/rankedRoles');
const rankedMilestones = require('../services/rankedMilestones');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ranked')
    .setDescription('Ranked RP : tier, RP courant, paliers et récompenses.')
    .addSubcommand((sc) =>
      sc
        .setName('voir')
        .setDescription('Voir ton tier ranked et les bonus actifs.')
        .addUserOption((o) => o.setName('membre').setDescription('Voir un autre joueur').setRequired(false)),
    )
    .addSubcommand((sc) =>
      sc.setName('paliers').setDescription("Liste des 12 paliers de récompense (étapes 3 → 12)."),
    )
    .addSubcommand((sc) =>
      sc
        .setName('reclamer')
        .setDescription('Réclamer tous les paliers franchis non encore pris.'),
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const target = interaction.options.getUser('membre') || interaction.user;
    const uid = target.id;
    users.getOrCreate(uid, target.username);

    if (sub === 'voir') {
      const rp = users.getPoints(uid);
      const tier = rankedRoles.tierForRp(rp);
      const def = rankedRoles.TIER_DEFS.find((t) => t.key === tier);
      const body = new TextDisplayBuilder().setContent(
        [
          `# Ranked RP — ${target.username}`,
          '',
          `**Tier** : **${def?.label || tier}**`,
          `**RP** : **${rp.toLocaleString('fr-FR')}**`,
          '',
          '**Comment progresser ?** Messages texte et **vocal** font monter le RP.',
          '**Inactivité** : après **24 h** sans activité, une **décrépitude** retire du RP chaque jour.',
        ].join('\n'),
      );
      const c = new ContainerBuilder().addTextDisplayComponents(body);
      return interaction.reply({ components: [c], flags: MessageFlags.IsComponentsV2 });
    }

    if (sub === 'paliers') {
      const list = rankedMilestones.summary(uid);
      const lines = list.map((m) => {
        const items = (m.items || [])
          .map((it) => `${it.qty > 1 ? `${it.qty}× ` : ''}\`${it.id}\``)
          .join(', ');
        const status = m.claimed ? '✅' : m.reached ? '◆' : '○';
        return `${status} **${m.rp.toLocaleString('fr-FR')} RP** — ${m.label} : +${m.stars.toLocaleString('fr-FR')} starss${items ? ` · ${items}` : ''}`;
      });
      const body = new TextDisplayBuilder().setContent(
        ['# Paliers ranked', '', lines.join('\n')].join('\n'),
      );
      const c = new ContainerBuilder().addTextDisplayComponents(body);
      return interaction.reply({ components: [c], flags: MessageFlags.IsComponentsV2 });
    }

    if (sub === 'reclamer') {
      const got = rankedMilestones.checkAndClaim(interaction.user.id);
      if (got.length === 0) {
        return interaction.reply({ content: 'Aucun palier nouveau à réclamer.' });
      }
      const lines = got.map(
        (g) =>
          `• **${g.label}** : +${g.stars.toLocaleString('fr-FR')} starss${g.items.length ? ` · ${g.items.map((i) => `${i.qty}× ${i.id}`).join(', ')}` : ''}`,
      );
      return interaction.reply({
        content: `🏆 **${got.length}** palier(s) réclamé(s) :\n${lines.join('\n')}`,
      });
    }
  },
};
