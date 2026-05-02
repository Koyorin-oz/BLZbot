const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const idx = require('../services/indexProgress');
const users = require('../services/users');
const indexRoles = require('../services/indexRoles');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('itemindex')
    .setDescription('Progression index items (palier 10 % → 100 %).')
    .addSubcommand((sc) =>
      sc
        .setName('voir')
        .setDescription('Voir ton % et les récompenses')
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
    if (
      uid !== interaction.user.id &&
      !ctx.isOwner() &&
      !interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)
    ) {
      return interaction.reply({ content: 'Interdit.' });
    }
    users.getOrCreate(uid, interaction.options.getUser('membre')?.username || interaction.user.username);
    const sub = interaction.options.getSubcommand();

    if (sub === 'voir') {
      const r = idx.getRow(uid);
      const claimed = idx.parseClaimed(r.claimed_json);
      const lines = idx.STEPS.map((s) => {
        const chest = (s.chests || []).map((c) => `${c.qty > 1 ? `${c.qty}× ` : ''}\`${c.id}\``).join(', ');
        const chestPart = chest ? ` + ${chest}` : '';
        const rolePart = s.roleNote ? ` + ${s.roleNote}` : '';
        return `• **${s.pct} %** → +${s.stars.toLocaleString('fr-FR')} starss${chestPart}${rolePart} ${claimed.includes(s.pct) ? '✅' : ''}`;
      });
      const e = new EmbedBuilder()
        .setTitle('Index items')
        .setDescription(`Complétion : **${r.completion_pct} %**\n\n${lines.join('\n')}`)
        .setColor(0x3498db);
      return interaction.reply({ embeds: [e] });
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
          .catch(() => { /* best-effort */ });
      }
      return interaction.reply({ content: `Index **${uid}** → **${p} %**` });
    }

    if (sub === 'reclamer') {
      const r = idx.claimNext(uid, users);
      if (!r.ok) return interaction.reply({ content: r.error });
      const chest = (r.step.chests || [])
        .map((c) => `+**${c.qty || 1}** \`${c.id}\``)
        .join(' ');
      const extra = [chest, r.step.roleNote].filter(Boolean).join(' ');
      return interaction.reply({
        content: `Étape **${r.step.pct} %** : +**${r.step.stars.toLocaleString('fr-FR')}** starss${extra ? ` · ${extra}` : ''}`,
      });
    }

    if (sub === 'matrice') {
      const matrix = require('../services/itemMatrix');
      const m = matrix.summary(uid, interaction.guildId || null);
      const lines = [];
      lines.push('# 🧭 Matrice — Index × Ranked × Guilde');
      lines.push('');
      lines.push('## 📚 Index items');
      lines.push(`Complétion : **${m.index.pct} %**`);
      if (m.index.bonuses.length) {
        lines.push(`Bonus actifs : ${m.index.bonuses.map((b) => `**${b.label}**`).join(' · ')}`);
      } else {
        lines.push('*Aucun bonus encore — atteins **10 %** pour démarrer.*');
      }
      lines.push('');
      lines.push('## ⚔️ Ranked RP');
      lines.push(
        `Tier : **${m.ranked.label}** · RP **${m.ranked.rp.toLocaleString('fr-FR')}** · multiplicateur arbre **+${(m.ranked.pctBp - 10000) / 100}%**`,
      );
      if (m.ranked.flatMsg > 0n || m.ranked.flatVoc > 0n) {
        lines.push(
          `Flats : +**${m.ranked.flatMsg}** RP/msg · +**${m.ranked.flatVoc}** RP/min voc`,
        );
      }
      lines.push(`Perks : ${m.ranked.perks.map((p) => `*${p}*`).join(' · ')}`);
      lines.push('');
      lines.push('## 🛡️ Guilde');
      if (m.guilde) {
        lines.push(
          `**${m.guilde.name}** — niveau **${m.guilde.level}** — grade **${m.guilde.gradeLabel}**${m.guilde.antiSeparation ? ' · 🛡️ anti-séparation' : ''}`,
        );
        lines.push(
          `Trésorerie **${m.guilde.treasury.toLocaleString('fr-FR')}** · Tes **GRP ${m.guilde.memberGrp.toLocaleString('fr-FR')}** · GXP perso **${m.guilde.memberGxp.toLocaleString('fr-FR')}**`,
        );
      } else {
        lines.push('*Tu n’es dans aucune guilde sur ce serveur — `/guilde creer` ou `/guilde rejoindre`.*');
      }
      lines.push('');
      lines.push('## ⛩️ Classes (arbre)');
      lines.push(m.classes.map((c) => `${c.icon} **${c.name}**`).join(' · '));
      const e = new EmbedBuilder()
        .setTitle('🧭 Matrice — Index × Ranked × Guilde')
        .setColor(0x9b59b6)
        .setDescription(lines.join('\n').slice(0, 4000));
      return interaction.reply({ embeds: [e] });
    }
  },
};
