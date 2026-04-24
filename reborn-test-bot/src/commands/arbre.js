const {
  SlashCommandBuilder,
  TextDisplayBuilder,
  ContainerBuilder,
  MessageFlags,
} = require('discord.js');
const skillTree = require('../services/skillTree');

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
    .setDescription('Arbre de compétences REBORN (branches doc, achats séquentiels).')
    .addSubcommand((sc) => sc.setName('voir').setDescription('Voir ton arbre et tes points de compétence'))
    .addSubcommand((sc) =>
      sc
        .setName('acheter')
        .setDescription('Acheter la prochaine étape d’une branche (coût = numéro d’étape)')
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

    if (sub === 'voir') {
      const lines = skillTree.BRANCHES.map((b) => {
        const s = skillTree.step(uid, b);
        return `• **${LABEL[b] || b}** : étape **${s}** / 5`;
      });
      const txt = new TextDisplayBuilder().setContent(
        `# Arbre de compétences\n**Points disponibles** : **${sp}**\n\n${lines.join('\n')}\n\n*Les points viennent des montées de niveau (+1 par niveau gagné). Coût étape n = n points.*`,
      );
      const c = new ContainerBuilder().addTextDisplayComponents(txt);
      return interaction.reply({ components: [c], flags: MessageFlags.IsComponentsV2, ephemeral: true });
    }

    const br = interaction.options.getString('branche', true);
    const r = skillTree.buy(uid, br);
    if (!r.ok) {
      const err = new TextDisplayBuilder().setContent(`❌ ${r.error}`);
      return interaction.reply({
        components: [new ContainerBuilder().addTextDisplayComponents(err)],
        flags: MessageFlags.IsComponentsV2,
        ephemeral: true,
      });
    }
    const ok = new TextDisplayBuilder().setContent(
      `✅ **${LABEL[br] || br}** → étape **${r.newStep}** / 5\nPoints restants : **${(users.getUser(uid).skill_points ?? 0)}**`,
    );
    return interaction.reply({
      components: [new ContainerBuilder().addTextDisplayComponents(ok)],
      flags: MessageFlags.IsComponentsV2,
      ephemeral: true,
    });
  },
};
