const {
  SlashCommandBuilder,
  AttachmentBuilder,
  ContainerBuilder,
  MediaGalleryBuilder,
  TextDisplayBuilder,
  MessageFlags,
} = require('discord.js');
const gm = require('../services/guildMember');
const grpSeason = require('../services/grpSeason');
const { grpRankFromTotal, label, GRP_RANK_KEYS, GRP_THRESHOLDS } = require('../reborn/grades');
const db = require('../db');
const users = require('../services/users');
const { renderGrpVoirCard, renderGrpLeaderboardCard } = require('../lib/canvasGrp');

function nextGrpStep(grpTotal) {
  const curKey = grpRankFromTotal(grpTotal);
  const idx = curKey ? GRP_RANK_KEYS.indexOf(curKey) : -1;
  if (idx < 0) {
    const need = GRP_THRESHOLDS[0];
    const left = need > grpTotal ? need - grpTotal : 0n;
    return {
      line: `Prochain palier **${label(GRP_RANK_KEYS[0])}** — il manque **${left.toLocaleString('fr-FR')}** GRP (seuil **${need.toLocaleString('fr-FR')}**).`,
    };
  }
  if (idx >= GRP_RANK_KEYS.length - 1) {
    return { line: 'Tu es au **dernier** palier GRP (**Star**).' };
  }
  const nextIdx = idx + 1;
  const need = GRP_THRESHOLDS[nextIdx];
  const left = need > grpTotal ? need - grpTotal : 0n;
  return {
    line: `Prochain palier **${label(GRP_RANK_KEYS[nextIdx])}** — il manque **${left.toLocaleString('fr-FR')}** GRP (seuil **${need.toLocaleString('fr-FR')}**).`,
  };
}

function buildCaption(displayName, sub) {
  const t =
    sub === 'voir'
      ? `**GRP** — fiche **${displayName}** · saison **${grpSeason.currentSeasonKey()}**`
      : `**GRP** — top serveur · saison **${grpSeason.currentSeasonKey()}**`;
  return new TextDisplayBuilder().setContent(t);
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('grp')
    .setDescription('Saison GRP + ton rang / total sur ce serveur (carte canvas).')
    .addSubcommand((sc) =>
      sc
        .setName('voir')
        .setDescription('Carte GRP : total, palier, progression, pics')
        .addUserOption((o) => o.setName('membre').setDescription('Voir un autre membre').setRequired(false)),
    )
    .addSubcommand((sc) => sc.setName('classement').setDescription('Top 15 GRP du serveur (canvas)')),
  async execute(interaction) {
    const hub = interaction.guildId;
    if (!hub) return interaction.reply({ content: 'Serveur uniquement.' });
    const sub = interaction.options.getSubcommand();
    const season = grpSeason.currentSeasonKey();
    const guildName = interaction.guild.name;

    await interaction.deferReply();

    try {
      if (sub === 'voir') {
        const target = interaction.options.getUser('membre') || interaction.user;
        const { grp } = gm.getMemberRow(hub, target.id);
        const rank = grpRankFromTotal(grp);
        const peaks = db
          .prepare(
            'SELECT rank_key FROM user_grp_peaks WHERE hub_discord_id = ? AND user_id = ? AND season_key = ? ORDER BY rank_key',
          )
          .all(hub, target.id, season);
        const peakTxt = peaks.length
          ? peaks.map((p) => label(p.rank_key)).join(' · ')
          : 'aucun pic cette saison';
        const { line: nextLine } = nextGrpStep(grp);
        const buf = await renderGrpVoirCard({
          displayName: target.displayName || target.username,
          avatarUrl: target.displayAvatarURL({ extension: 'png', size: 256 }),
          guildName,
          season,
          grp,
          rankKey: rank || '',
          rankLabel: rank ? label(rank) : '—',
          peaksLine: peakTxt,
          nextLine,
          GRP_RANK_KEYS,
          GRP_THRESHOLDS,
        });
        const name = 'grp_voir.png';
        const file = new AttachmentBuilder(buf, { name });
        const gallery = new MediaGalleryBuilder().addItems({ media: { url: `attachment://${name}` } });
        const caption = buildCaption(target.displayName || target.username, 'voir');
        const container = new ContainerBuilder()
          .addMediaGalleryComponents(gallery)
          .addTextDisplayComponents(caption);
        return interaction.editReply({
          files: [file],
          components: [container],
          flags: MessageFlags.IsComponentsV2,
        });
      }

      const rows = db.prepare('SELECT user_id, grp FROM guild_member_gxp WHERE guild_id = ?').all(hub);
      const sorted = rows
        .map((r) => ({ user_id: r.user_id, grp: users.B(r.grp) }))
        .sort((a, b) => (a.grp < b.grp ? 1 : a.grp > b.grp ? -1 : 0))
        .slice(0, 15);

      const enriched = await Promise.all(
        sorted.map(async (r, i) => {
          let username = 'Joueur';
          try {
            const u = await interaction.client.users.fetch(r.user_id);
            username = u.username;
          } catch {
            /* ignore */
          }
          const rk = grpRankFromTotal(r.grp);
          return {
            rank: i + 1,
            username,
            grp: r.grp,
            rankLabel: rk ? label(rk) : '—',
          };
        }),
      );

      const buf = await renderGrpLeaderboardCard({
        guildName,
        season,
        rows: enriched,
      });
      const name = 'grp_top.png';
      const file = new AttachmentBuilder(buf, { name });
      const gallery = new MediaGalleryBuilder().addItems({ media: { url: `attachment://${name}` } });
      const caption = buildCaption(interaction.user.displayName || interaction.user.username, 'classement');
      const container = new ContainerBuilder()
        .addMediaGalleryComponents(gallery)
        .addTextDisplayComponents(caption);
      return interaction.editReply({
        files: [file],
        components: [container],
        flags: MessageFlags.IsComponentsV2,
      });
    } catch (e) {
      console.error('[grp canvas]', e);
      return interaction.editReply({
        content: `Impossible de générer la carte GRP. \`${e?.message || e}\``,
      });
    }
  },
};
