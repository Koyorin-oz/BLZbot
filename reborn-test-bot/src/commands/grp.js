const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const gm = require('../services/guildMember');
const grpSeason = require('../services/grpSeason');
const { grpRankFromTotal } = require('../reborn/grades');
const db = require('../db');
const users = require('../services/users');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('grp')
    .setDescription('Saison GRP (reset mensuel UTC) + ton rang et ton total sur ce serveur.')
    .addSubcommand((sc) =>
      sc
        .setName('voir')
        .setDescription('Ton GRP / rang et la saison en cours')
        .addUserOption((o) => o.setName('membre').setDescription('Voir un autre membre').setRequired(false)),
    )
    .addSubcommand((sc) => sc.setName('classement').setDescription('Top 15 GRP du serveur (approx.)')),
  async execute(interaction) {
    const hub = interaction.guildId;
    if (!hub) return interaction.reply({ content: 'Serveur uniquement.' });
    const sub = interaction.options.getSubcommand();
    const season = grpSeason.currentSeasonKey();

    if (sub === 'voir') {
      const target = interaction.options.getUser('membre') || interaction.user;
      const { grp } = gm.getMemberRow(hub, target.id);
      const rank = grpRankFromTotal(grp);
      const peaks = db
        .prepare(
          'SELECT rank_key FROM user_grp_peaks WHERE hub_discord_id = ? AND user_id = ? AND season_key = ? ORDER BY rank_key',
        )
        .all(hub, target.id, season);
      const peakTxt = peaks.length ? peaks.map((p) => p.rank_key).join(', ') : 'aucun pic cette saison';
      const e = new EmbedBuilder()
        .setTitle(`GRP — ${target.username}`)
        .setDescription(
          `Saison **${season}** (reset mensuel auto)\nTotal GRP : **${grp.toLocaleString('fr-FR')}**\nRang actuel : **${rank || 'aucun'}**\nPics enregistrés : ${peakTxt}`,
        )
        .setColor(0x3498db);
      return interaction.reply({ embeds: [e] });
    }

    if (sub === 'classement') {
      const rows = db.prepare('SELECT user_id, grp FROM guild_member_gxp WHERE guild_id = ?').all(hub);
      const sorted = rows
        .map((r) => ({ user_id: r.user_id, grp: users.B(r.grp) }))
        .sort((a, b) => (a.grp < b.grp ? 1 : a.grp > b.grp ? -1 : 0))
        .slice(0, 15);
      const lines = sorted.map((r, i) => {
        const rk = grpRankFromTotal(r.grp);
        return `**${i + 1}.** <@${r.user_id}> — **${r.grp.toLocaleString('fr-FR')}** GRP (${rk || '—'})`;
      });
      const e = new EmbedBuilder()
        .setTitle(`Top GRP — saison ${season}`)
        .setDescription(lines.length ? lines.join('\n') : 'Aucune donnée.')
        .setFooter({ text: 'Classement calculé en mémoire (test-bot).' })
        .setColor(0x1abc9c);
      return interaction.reply({ embeds: [e] });
    }
  },
};
