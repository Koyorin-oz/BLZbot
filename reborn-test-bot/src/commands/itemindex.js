const {
  SlashCommandBuilder,
  EmbedBuilder,
  PermissionFlagsBits,
  AttachmentBuilder,
} = require('discord.js');
const idx = require('../services/indexProgress');
const users = require('../services/users');
const indexRoles = require('../services/indexRoles');
const { INDEX_BONUSES } = require('../services/itemMatrix');
const { renderIndexCard } = require('../lib/canvasIndex');

function unicodeBar(pct, width = 18) {
  const f = Math.round((Math.min(100, Math.max(0, pct)) / 100) * width);
  return `${'█'.repeat(f)}${'░'.repeat(width - f)}`;
}

function indexEmbedColor(pct) {
  if (pct >= 100) return 0x2ecc71;
  if (pct >= 70) return 0x3498db;
  if (pct >= 40) return 0x9b59b6;
  if (pct >= 20) return 0xe67e22;
  return 0x5d6d7e;
}

function nextMilestone(pct, claimed) {
  const claimable = idx.STEPS.find((s) => !claimed.includes(s.pct) && pct >= s.pct);
  if (claimable) {
    return {
      title: '🎁 Palier prêt',
      text: `Tu peux réclamer **${claimable.pct} %** — \`/itemindex reclamer\``,
    };
  }
  const upcoming = idx.STEPS.find((s) => pct < s.pct);
  if (upcoming) {
    return {
      title: '🎯 Prochain objectif',
      text: `**${upcoming.pct} %** du catalogue — encore **${upcoming.pct - pct} %**`,
    };
  }
  return {
    title: '✨ Catalogue',
    text: '**100 %** atteint — vérifie les paliers non réclamés si besoin.',
  };
}

function activeIndexBonuses(pct) {
  return INDEX_BONUSES.filter((b) => pct >= b.pct);
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('itemindex')
    .setDescription('Progression index items (palier 10 % → 100 %) + matrice bonus.')
    .addSubcommand((sc) =>
      sc
        .setName('voir')
        .setDescription('Vue détaillée + jauge (image) et récap embed')
        .addUserOption((o) => o.setName('membre').setDescription('Optionnel')),
    )
    .addSubcommand((sc) =>
      sc
        .setName('definir')
        .setDescription('Définir ton % (test / admin)')
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

      const milestone = nextMilestone(pct, claimed);
      const bonuses = activeIndexBonuses(pct);
      const bonusLine = bonuses.length
        ? bonuses.map((b) => `${b.pct}% → *${b.label}*`).join('\n')
        : '*Aucun bonus encore — atteins **10 %** pour le premier (+1 % XP).*';

      const embed = new EmbedBuilder()
        .setAuthor({ name: displayName, iconURL: avatarUrl })
        .setTitle('📚 Index catalogue REBORN')
        .setColor(indexEmbedColor(pct))
        .setDescription(
          [
            `${unicodeBar(pct)} **${pct} %**`,
            '',
            '_L’**index** mesure ta complétion du **catalogue d’objets** : paliers 10 → 100 % donnent starss, coffres et bonus permanents (voir matrice)._',
          ].join('\n'),
        )
        .addFields(
          { name: milestone.title, value: milestone.text, inline: false },
          {
            name: '⚡ Bonus index déjà actifs',
            value: bonusLine.slice(0, 1024),
            inline: false,
          },
          {
            name: '🔭 Aller plus loin',
            value: '`/itemindex matrice` — cumul **Index × Ranked × Guilde**\n`/itemindex reclamer` — récupère la prochaine récompense',
            inline: false,
          },
        )
        .setImage('attachment://index_catalogue.png')
        .setFooter({ text: 'Carte = paliers & récompenses · Embed = récap bonus & objectifs' })
        .setTimestamp();

      return interaction.editReply({ embeds: [embed], files: [file] });
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

      const rankedExtra = [];
      rankedExtra.push(
        `${unicodeBar(Math.min(100, Number((m.ranked.rp * 100n) / 100000n)))} *échelle indicative*`,
      );
      if (m.ranked.flatMsg > 0n || m.ranked.flatVoc > 0n) {
        rankedExtra.push(`Flats RP · msg **+${m.ranked.flatMsg}** · voc **+${m.ranked.flatVoc}**/min`);
      }

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
        .setAuthor({ name: 'Matrice REBORN', iconURL: thumb })
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
            value: [
              `RP **${m.ranked.rp.toLocaleString('fr-FR')}**`,
              `Multi arbre **+${(m.ranked.pctBp - 10000) / 100}%**`,
              rankedExtra.join('\n'),
              m.ranked.perks.length ? `\n*${m.ranked.perks.join(' · ')}*` : '',
            ]
              .join('\n')
              .slice(0, 1024),
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
