const {
  SlashCommandBuilder,
  EmbedBuilder,
  PermissionFlagsBits,
  AttachmentBuilder,
} = require('discord.js');
const idx = require('../services/indexProgress');
const users = require('../services/users');
const indexRoles = require('../services/indexRoles');
const { renderIndexCard } = require('../lib/canvasIndex');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('itemindex')
    .setDescription('Progression index items (palier 10 % → 100 %) + matrice bonus.')
    .addSubcommand((sc) =>
      sc
        .setName('voir')
        .setDescription('Panneau index (image : paliers, jauge, bonus, objectifs)')
        .addUserOption((o) => o.setName('membre').setDescription('Optionnel')),
    )
    .addSubcommand((sc) =>
      sc
        .setName('definir')
        .setDescription('Définir le pourcentage d’index (administrateurs).')
        .addIntegerOption((o) =>
          o.setName('pourcent').setDescription('0–100').setRequired(true).setMinValue(0).setMaxValue(100),
        ),
    )
    .addSubcommand((sc) => sc.setName('reclamer').setDescription('Réclamer la prochaine étape disponible'))
    .addSubcommand((sc) =>
      sc.setName('matrice').setDescription('Vue combinée Index × Ranked × Guilde (bonus actifs).'),
    ),
  async execute(interaction, ctx) {
    const uid = interaction.options.getUser('membre')?.id || interaction.user.id;
    const memberUser = interaction.options.getUser('membre') || interaction.user;
    if (
      uid !== interaction.user.id &&
      !ctx.isOwner() &&
      !interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)
    ) {
      return interaction.reply({ content: 'Interdit.' });
    }
    users.getOrCreate(uid, memberUser.username);
    const sub = interaction.options.getSubcommand();

    if (sub === 'voir') {
      await interaction.deferReply();
      const r = idx.getRow(uid);
      const claimed = idx.parseClaimed(r.claimed_json);
      const pct = r.completion_pct || 0;
      const displayName = interaction.guild?.members?.cache?.get(uid)?.displayName || memberUser.username;
      const avatarUrl = memberUser.displayAvatarURL({ extension: 'png', size: 256 });

      const buf = await renderIndexCard({
        displayName,
        avatarUrl,
        completionPct: pct,
        steps: idx.STEPS,
        claimed,
      });
      const file = new AttachmentBuilder(buf, { name: 'index_catalogue.png' });
      return interaction.editReply({ files: [file] });
    }

    if (sub === 'definir') {
      if (!ctx.isOwner() && !interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
        return interaction.reply({ content: 'Admin / owner.' });
      }
      const p = interaction.options.getInteger('pourcent', true);
      idx.setCompletion(uid, p);
      if (interaction.guildId) {
        indexRoles
          .syncIndexFullRole(interaction.client, interaction.guildId, uid)
          .catch(() => {
            /* best-effort */
          });
      }
      return interaction.reply({ content: `Index **${uid}** → **${p} %**` });
    }

    if (sub === 'reclamer') {
      const r = idx.claimNext(uid, users);
      if (!r.ok) return interaction.reply({ content: r.error });
      if (interaction.guildId) {
        indexRoles
          .syncIndexFullRole(interaction.client, interaction.guildId, uid)
          .catch(() => {
            /* best-effort */
          });
      }
      const chest = (r.step.chests || [])
        .map((c) => `+**${c.qty || 1}** \`${c.id}\``)
        .join(' ');
      const extra = [chest, r.step.roleNote].filter(Boolean).join(' ');
      const claimEmbed = new EmbedBuilder()
        .setTitle('🎁 Palier réclamé')
        .setColor(0x2ecc71)
        .setDescription(
          [
            `Étape **${r.step.pct} %** validée.`,
            '',
            `+**${r.step.stars.toLocaleString('fr-FR')}** ⭐ starss`,
            extra ? `\n${extra}` : '',
          ].join('\n'),
        )
        .setFooter({ text: '/itemindex voir pour la carte à jour' });
      return interaction.reply({ embeds: [claimEmbed] });
    }

    if (sub === 'matrice') {
      const matrix = require('../services/itemMatrix');
      const m = matrix.summary(uid, interaction.guildId || null);
      const thumb = interaction.user.displayAvatarURL({ extension: 'png', size: 128 });
      const indexBonusList = m.index.bonuses.length
        ? m.index.bonuses.map((b) => `**${b.pct}%** · ${b.label}`).join('\n')
        : '_Atteins **10 %** pour activer le premier bonus (+1 % XP)._';

      const rankedLines = [
        `RP **${m.ranked.rp.toLocaleString('fr-FR')}**`,
        `Multi arbre **+${(m.ranked.pctBp - 10000) / 100}%**`,
      ];
      if (m.ranked.flatMsg > 0n || m.ranked.flatVoc > 0n) {
        rankedLines.push(`Bonus plats · msg **+${m.ranked.flatMsg}** · voc **+${m.ranked.flatVoc}**/min`);
      }
      if (m.ranked.perks.length) rankedLines.push(`*${m.ranked.perks.join(' · ')}*`);

      const guildeBlock = m.guilde
        ? [
            `${m.guilde.name} · nv **${m.guilde.level}** · **${m.guilde.gradeLabel}**${
              m.guilde.antiSeparation ? ' · 🛡️ anti-séparation' : ''
            }`,
            `Trésor **${m.guilde.treasury.toLocaleString('fr-FR')}** ⭐ · ton GRP **${m.guilde.memberGrp.toLocaleString(
              'fr-FR',
            )}**`,
          ].join('\n')
        : "*Pas de guilde — `/guilde creer` ou `/guilde rejoindre`*";

      const classesLine =
        m.classes.length > 0
          ? m.classes.map((c) => `${c.icon} **${c.name}**`).join(' · ')
          : '_Aucune classe — progresse dans `/arbre`._';

      const matriceEmbed = new EmbedBuilder()
        .setAuthor({ name: 'Matrice de bonus', iconURL: thumb })
        .setTitle('🧭 Index × Ranked × Guilde')
        .setColor(0x8e44ad)
        .setDescription(
          'Récap des **bonus cumulés** : chaque pilier amplifie l’économie et la progression (index, arbre ranked, guilde).',
        )
        .addFields(
          {
            name: `📊 Index — ${m.index.pct} %`,
            value: indexBonusList.slice(0, 1024),
            inline: true,
          },
          {
            name: `⚔️ Ranked — ${m.ranked.label}`,
            value: rankedLines.join('\n').slice(0, 1024),
            inline: true,
          },
          { name: '\u200b', value: '\u200b', inline: false },
          {
            name: '🛡️ Guilde',
            value: guildeBlock.slice(0, 1024),
            inline: true,
          },
          {
            name: '⛩️ Classes (arbre)',
            value: classesLine.slice(0, 1024),
            inline: true,
          },
        )
        .setFooter({ text: '/itemindex voir · carte paliers  ·  /ranked voir' })
        .setTimestamp();

      return interaction.reply({ embeds: [matriceEmbed] });
    }
  },
};
