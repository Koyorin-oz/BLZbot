const {
  SlashCommandBuilder,
  TextDisplayBuilder,
  ContainerBuilder,
  MessageFlags,
} = require('discord.js');
const skillTree = require('../services/skillTree');
const { buildArbreContainer } = require('../services/panelComponents');

const LABEL = {
  quest: 'Quête',
  guild: 'Guilde',
  shop: 'Boutique',
  ranked: 'Ranked',
  event: 'Événement',
};

module.exports = {
  data: new SlashCommandBuilder()
    .setName('arbre')
    .setDescription('Arbre de compétences (canvas + menu) ou achat par / sous-commande.')
    .addSubcommand((sc) => sc.setName('voir').setDescription('Image arbre (étoile, racine au centre) + Débloquer'))
    .addSubcommand((sc) =>
      sc.setName('voir2').setDescription('Image arbre (demi-cercle, racine dorée en bas) + Débloquer'),
    )
    .addSubcommand((sc) =>
      sc
        .setName('acheter')
        .setDescription('Acheter le prochain palier d’une branche')
        .addStringOption((o) =>
          o
            .setName('branche')
            .setDescription('Branche')
            .setRequired(true)
            .addChoices(
              { name: 'Quête', value: 'quest' },
              { name: 'Guilde', value: 'guild' },
              { name: 'Boutique', value: 'shop' },
              { name: 'Ranked', value: 'ranked' },
              { name: 'Événement', value: 'event' },
            ),
        ),
    ),
  async execute(interaction) {
    const uid = interaction.user.id;
    const users = require('../services/users');
    users.getOrCreate(uid, interaction.user.username);
    const sub = interaction.options.getSubcommand();
    const u = users.getUser(uid);
    const sp = u.skill_points ?? 0;

    if (sub === 'voir' || sub === 'voir2') {
      const layout = sub === 'voir2' ? 'demi' : 'star';
      const b = await buildArbreContainer(
        uid,
        interaction.member?.displayName || interaction.user.username,
        interaction.user.displayAvatarURL({ extension: 'png', size: 128 }),
        layout,
      );
      if (b) {
        return interaction.reply({
          files: [b.file],
          components: [b.container],
          flags: b.flags | MessageFlags.Ephemeral,
        });
      }
      const lines = skillTree.BRANCHES.map((b) => {
        const s = skillTree.step(uid, b);
        return `• **${LABEL[b] || b}** : **${s}** / 5`;
      });
      const txt = new TextDisplayBuilder().setContent(
        [
          '# Arbre (texte, canvas indisponible)',
          `**Points** : **${sp}**`,
          ...lines,
          'Installe le module `canvas` (binaire) ou utilise Node avec binaire précompilé pour l’image.',
        ].join('\n'),
      );
      const c = new ContainerBuilder().addTextDisplayComponents(txt);
      return interaction.reply({
        components: [c],
        flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
      });
    }

    const br = interaction.options.getString('branche', true);
    const r = skillTree.buy(uid, br);
    if (!r.ok) {
      const err = new TextDisplayBuilder().setContent(`❌ ${r.error}`);
      return interaction.reply({
        components: [new ContainerBuilder().addTextDisplayComponents(err)],
        flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
      });
    }
    const ok = new TextDisplayBuilder().setContent(
      `✅ **${LABEL[br] || br}** → **${r.newStep}** / 5\nPoints restants : **${(users.getUser(uid).skill_points ?? 0)}**`,
    );
    return interaction.reply({
      components: [new ContainerBuilder().addTextDisplayComponents(ok)],
      flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
    });
  },
};
