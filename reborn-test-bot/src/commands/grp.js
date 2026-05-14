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
const { renderGrpVoirCard } = require('../lib/canvasGrp');

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

module.exports = {
  data: new SlashCommandBuilder()
    .setName('grp')
    .setDescription('Carte GRP perso (total, palier, progression). Le top joueurs est dans /classement.')
    .addUserOption((o) =>
      o.setName('membre').setDescription('Voir la carte d’un autre membre').setRequired(false),
    ),
  async execute(interaction) {
    const hub = interaction.guildId;
    if (!hub) return interaction.reply({ content: 'Serveur uniquement.' });
    const season = grpSeason.currentSeasonKey();
    const guildName = interaction.guild.name;
    const target = interaction.options.getUser('membre') || interaction.user;

    await interaction.deferReply();

    try {
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
      const caption = new TextDisplayBuilder().setContent(
        `**GRP** — fiche **${target.displayName || target.username}** · saison \`${season}\`\n*Classement joueurs :* \`/classement\` → **Joueurs (GRP perso)**.`,
      );
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
