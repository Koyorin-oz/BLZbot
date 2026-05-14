const {
  SlashCommandBuilder,
  AttachmentBuilder,
  ContainerBuilder,
  MediaGalleryBuilder,
  TextDisplayBuilder,
  MessageFlags,
  EmbedBuilder,
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
    .setDescription('Carte GRP perso ou classement joueurs GRP du serveur.')
    .addStringOption((o) =>
      o
        .setName('action')
        .setDescription('Par défaut : carte GRP.')
        .setRequired(false)
        .addChoices(
          { name: 'Carte GRP', value: 'carte' },
          { name: 'Classement joueurs (GRP)', value: 'classement' },
        ),
    )
    .addUserOption((o) =>
      o.setName('membre').setDescription('Voir la carte d’un autre membre').setRequired(false),
    ),
  async execute(interaction) {
    const hub = interaction.guildId;
    if (!hub) return interaction.reply({ content: 'Serveur uniquement.' });
    const season = grpSeason.currentSeasonKey();
    const guildName = interaction.guild.name;
    const target = interaction.options.getUser('membre') || interaction.user;

    if (interaction.options.getString('action') === 'classement') {
      await interaction.deferReply();
      const rows = db.prepare('SELECT user_id, grp FROM guild_member_gxp WHERE guild_id = ?').all(hub);
      const sorted = rows
        .map((r) => ({ user_id: r.user_id, grp: users.B(r.grp) }))
        .sort((a, b) => (a.grp < b.grp ? 1 : a.grp > b.grp ? -1 : 0));
      const top = sorted.slice(0, 10);
      const lines = top.map((r, i) => {
        const star = i < 3 ? ['🥇', '🥈', '🥉'][i] : `**${i + 1}.**`;
        const rk = grpRankFromTotal(r.grp);
        const rkL = rk ? label(rk) : '—';
        return `${star} <@${r.user_id}> — **${r.grp.toLocaleString('fr-FR')}** GRP · palier **${rkL}**`;
      });
      let desc = lines.length ? lines.join('\n') : '*Aucune donnée GRP sur ce serveur.*';
      const myPos = sorted.findIndex((r) => r.user_id === interaction.user.id);
      if (myPos >= 0) {
        const me = sorted[myPos];
        const rk = grpRankFromTotal(me.grp);
        const rkL = rk ? label(rk) : '—';
        desc += `\n\n*Ton rang : **#${myPos + 1}** — **${me.grp.toLocaleString('fr-FR')}** GRP · palier **${rkL}**.*`;
      }
      const embed = new EmbedBuilder()
        .setTitle('📊 Classement joueurs — GRP (serveur)')
        .setColor(0x9b59b6)
        .setDescription(desc)
        .setFooter({ text: 'Saison reset 1er du mois (UTC). · Guildes : /classement-guilde' });
      return interaction.editReply({ embeds: [embed] });
    }

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
