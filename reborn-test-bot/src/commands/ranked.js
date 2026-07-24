const {
  SlashCommandBuilder,
  ContainerBuilder,
  TextDisplayBuilder,
  MessageFlags,
} = require('discord.js');
const users = require('../services/users');
const rankedRoles = require('../services/rankedRoles');
const rankedMilestones = require('../services/rankedMilestones');
const { d } = require('../lib/slashDesc');
const { replyEphemeral, v2Ephemeral } = require('../lib/ephemeral');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ranked')
    .setDescription(d('🏆', 'Ranked RP — tier, paliers et récompenses.'))
    .addSubcommand((sc) =>
      sc
        .setName('voir')
        .setDescription(d('📊', 'Voir ton tier ranked et les bonus actifs.'))
        .addUserOption((o) => o.setName('membre').setDescription('Voir un autre joueur').setRequired(false)),
    )
    .addSubcommand((sc) =>
      sc.setName('paliers').setDescription(d('🎖️', 'Liste des 12 paliers de récompense.')),
    )
    .addSubcommand((sc) =>
      sc
        .setName('reclamer')
        .setDescription(d('🎁', 'Réclamer les paliers franchis non encore pris.')),
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const target = interaction.options.getUser('membre') || interaction.user;
    const uid = target.id;
    users.getOrCreate(uid, target.username);

    if (sub === 'voir') {
      const rp = users.getPoints(uid);
      const rank = rankedRoles.rankForRp(rp);
      const next = rankedRoles.nextRank(rp);
      const nextLine = next
        ? `**Rang suivant** : **${next.label}** à **${next.threshold.toLocaleString('fr-FR')} RP** (encore ${(next.threshold - rp).toLocaleString('fr-FR')} RP).`
        : '**Rang max atteint** — tu es **Star**.';
      const body = new TextDisplayBuilder().setContent(
        [
          `# Ranked RP — ${target.username}`,
          '',
          `**Rang** : **${rank.label}**`,
          `**RP** : **${rp.toLocaleString('fr-FR')}**`,
          nextLine,
          '',
          '**Comment progresser ?** Messages texte et **vocal** font monter le RP.',
          '**Inactivité** : après **24 h** sans activité, une **décrépitude** retire du RP chaque jour (à partir de 50k RP).',
        ].join('\n'),
      );
      const c = new ContainerBuilder().addTextDisplayComponents(body);
      return replyEphemeral(interaction, { components: [c], flags: v2Ephemeral() });
    }

    if (sub === 'paliers') {
      const list = rankedMilestones.summary(uid);
      const lines = list.map((m) => {
        const items = (m.items || [])
          .map((it) => `${it.qty > 1 ? `${it.qty}× ` : ''}\`${it.id}\``)
          .join(', ');
        const status = m.claimed ? '✅' : m.reached ? '❎' : '🔴';
        return `${status} **${m.rp.toLocaleString('fr-FR')} RP** — ${m.label} : +${m.stars.toLocaleString('fr-FR')} starss${items ? ` · ${items}` : ''}`;
      });
      const body = new TextDisplayBuilder().setContent(
        ['# Paliers ranked', '', lines.join('\n')].join('\n'),
      );
      const c = new ContainerBuilder().addTextDisplayComponents(body);
      return replyEphemeral(interaction, { components: [c], flags: v2Ephemeral() });
    }

    if (sub === 'reclamer') {
      const got = rankedMilestones.checkAndClaim(interaction.user.id);
      if (got.length === 0) {
        return replyEphemeral(interaction, { content: 'Aucun palier nouveau à réclamer.' });
      }
      const lines = got.map(
        (g) =>
          `• **${g.label}** : +${g.stars.toLocaleString('fr-FR')} starss${g.items.length ? ` · ${g.items.map((i) => `${i.qty}× ${i.id}`).join(', ')}` : ''}`,
      );
      return replyEphemeral(interaction, {
        content: `🏆 **${got.length}** palier(s) réclamé(s) :\n${lines.join('\n')}`,
      });
    }
  },
};
