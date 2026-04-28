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

/** Description de chaque classe (pour `/arbre classe`). */
const CLASS_PERKS = {
  aventurier: 'Plus de quêtes (+slot), skips, double claim — **pour explorer le serveur**.',
  suzerain: '+1/+2 membres guilde, +10 % GXP, +10 % GRP, +20 % GRP loyaliste — **pour bâtir une dynastie**.',
  marchand: 'Reset boutique, ×2 contenu coffres, rotation midi, CATL gratuit, -30 % prix — **pour briser la banque**.',
  duelliste: '+RP %, +RP/msg, +RP/min voc — **pour grimper le ladder ranked**.',
  conquerant: '+10 % monnaie d\'event, +30 % défense, -20 % coffres event, spawner gratuit — **pour dominer les événements**.',
  maitre: 'Toutes les voies maîtrisées — accès au **Temple** + statut **Maître**.',
  initie: 'Pas encore de classe — débloque un palier 5/5 dans une branche pour t\'éveiller.',
};

module.exports = {
  data: new SlashCommandBuilder()
    .setName('arbre')
    .setDescription('Arbre de compétences (canvas + menu) ou achat par / sous-commande.')
    .addSubcommand((sc) =>
      sc.setName('voir').setDescription('Image arbre (demi-cercle, avatar au centre) + Débloquer'),
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
    )
    .addSubcommand((sc) => sc.setName('classe').setDescription('Voir ta/tes classe(s) joueur (issue de l’arbre).'))
    .addSubcommand((sc) =>
      sc
        .setName('separatiste')
        .setDescription('Branche séparatiste (5 paliers, 1 point gagné par séparation gagnée).')
        .addStringOption((o) =>
          o
            .setName('action')
            .setDescription('Action')
            .setRequired(true)
            .addChoices(
              { name: 'Voir', value: 'voir' },
              { name: 'Acheter le prochain palier', value: 'acheter' },
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
      // Le rendu canvas + fetch de l’avatar Discord peut dépasser les 3 s.
      // On défère immédiatement pour éviter `Unknown interaction` (10062).
      await interaction.deferReply();
      const b = await buildArbreContainer(
        uid,
        interaction.member?.displayName || interaction.user.username,
        interaction.user.displayAvatarURL({ extension: 'png', size: 128 }),
        'demi',
      );
      if (b) {
        return interaction.editReply({
          files: [b.file],
          components: [b.container],
          flags: b.flags,
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
      return interaction.editReply({
        components: [c],
        flags: MessageFlags.IsComponentsV2,
      });
    }

    const br = interaction.options.getString('branche', true);
    const r = skillTree.buy(uid, br);
    if (!r.ok) {
      const err = new TextDisplayBuilder().setContent(`❌ ${r.error}`);
      return interaction.reply({
        components: [new ContainerBuilder().addTextDisplayComponents(err)],
        flags: MessageFlags.IsComponentsV2,
      });
    }
    const ok = new TextDisplayBuilder().setContent(
      `✅ **${LABEL[br] || br}** → **${r.newStep}** / 5\nPoints restants : **${(users.getUser(uid).skill_points ?? 0)}**`,
    );
    return interaction.reply({
      components: [new ContainerBuilder().addTextDisplayComponents(ok)],
      flags: MessageFlags.IsComponentsV2,
    });
  },
};
