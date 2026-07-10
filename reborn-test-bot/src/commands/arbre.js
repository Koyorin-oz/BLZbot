const {
  SlashCommandBuilder,
  TextDisplayBuilder,
  ContainerBuilder,
  MessageFlags,
} = require('discord.js');
const skillTree = require('../services/skillTree');
const { d } = require('../lib/slashDesc');
const { buildArbreContainer } = require('../services/panelComponents');
const { deferReplyEphemeral, replyEphemeral, v2Ephemeral } = require('../lib/ephemeral');

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
  marchand: 'Reset boutique, ×2 contenu coffres, rotation midi, Coffre légendaire gratuit, -30 % prix — **pour briser la banque**.',
  duelliste: '+RP %, +RP/msg, +RP/min voc — **pour grimper le ladder ranked**.',
  conquerant: '+10 % monnaie d\'event, +30 % défense, -20 % coffres event, spawner gratuit — **pour dominer les événements**.',
  maitre: 'Toutes les voies maîtrisées — accès au **Temple** + statut **Maître**.',
  initie: 'Pas encore de classe — débloque un palier 5/5 dans une branche pour t\'éveiller.',
};

module.exports = {
  data: new SlashCommandBuilder()
    .setName('arbre')
    .setDescription(d('🌳', 'Arbre de compétences — paliers, classes et branches.'))
    .addSubcommand((sc) =>
      sc.setName('voir').setDescription(d('👁️', 'Affiche ton arbre (canvas) et les paliers.')),
    )
    .addSubcommand((sc) =>
      sc
        .setName('acheter')
        .setDescription(d('⬆️', 'Achète le prochain palier d’une branche.'))
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
    .addSubcommand((sc) => sc.setName('classe').setDescription(d('🎓', 'Affiche tes classes débloquées.')))
    .addSubcommand((sc) =>
      sc
        .setName('separatiste')
        .setDescription(d('⚔️', 'Branche séparatiste — paliers et séparations.'))
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

    if (sub === 'classe') {
      const classes = skillTree.playerClasses(uid);
      const lines = ['# 🎓 Tes classes', ''];
      for (const c of classes) {
        const perk = CLASS_PERKS[c.id] || '';
        lines.push(`${c.icon} **${c.name}** — ${perk}`);
      }
      lines.push('');
      lines.push(
        '*Une classe se débloque dès qu’une **branche atteint 5/5**. Maîtrise les **5** branches et tu deviens **Maître des voies**.*',
      );
      const td = new TextDisplayBuilder().setContent(lines.join('\n'));
      return interaction.reply({
        components: [new ContainerBuilder().addTextDisplayComponents(td)],
        flags: MessageFlags.IsComponentsV2,
      });
    }

    if (sub === 'separatiste') {
      const action = interaction.options.getString('action', true);
      if (action === 'voir') {
        const cur = skillTree.separatistStep(uid);
        const pts = skillTree.separatistPoints(uid);
        const td = new TextDisplayBuilder().setContent(
          [
            '# 🗡️ Branche séparatiste',
            `Palier actuel : **${cur}** / 5 · points dispo : **${pts}**`,
            '',
            'Effets cumulés :',
            '• **1/5** — +5 % GRP perso pendant les phases 2',
            '• **2/5** — -10 % perte starss en cas de défaite split',
            '• **3/5** — +10 % récompense de victoire séparatiste (cumul +25 %)',
            '• **4/5** — -10 % cooldown perso `/separation lancer`',
            '• **5/5** — *ULTIME* : ×2 starss-victoire séparatiste',
            '',
            '*Gagne **1 point séparatiste** par séparation gagnée côté split.*',
          ].join('\n'),
        );
        return interaction.reply({
          components: [new ContainerBuilder().addTextDisplayComponents(td)],
          flags: MessageFlags.IsComponentsV2,
        });
      }
      // action === 'acheter'
      const r = skillTree.buySeparatistStep(uid);
      if (!r.ok) {
        const err = new TextDisplayBuilder().setContent(`❌ ${r.error}`);
        return interaction.reply({
          components: [new ContainerBuilder().addTextDisplayComponents(err)],
          flags: MessageFlags.IsComponentsV2,
        });
      }
      const td = new TextDisplayBuilder().setContent(
        `✅ Branche **séparatiste** → **${r.newStep}** / 5\nPoints restants : **${skillTree.separatistPoints(uid)}**`,
      );
      return interaction.reply({
        components: [new ContainerBuilder().addTextDisplayComponents(td)],
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
