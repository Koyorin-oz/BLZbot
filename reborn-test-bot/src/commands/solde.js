const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const users = require('../services/users');
const gm = require('../services/guildMember');
const pg = require('../services/playerGuilds');
const { label } = require('../reborn/grades');
const { STARSS_PER_MESSAGE, STARSS_PER_VOICE_MINUTE } = require('../reborn/constants');

function fmt(n) {
  try {
    return BigInt(n).toLocaleString('fr-FR');
  } catch {
    return String(n);
  }
}

function fmtMs(ms) {
  if (!ms || ms <= Date.now()) return '—';
  const s = Math.max(0, Math.floor((ms - Date.now()) / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h}h ${m}m`;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('solde')
    .setDescription('Voir ton solde starss / points / XP et progression guilde (test).'),
  async execute(interaction) {
    const uid = interaction.user.id;
    users.getOrCreate(uid, interaction.user.username);
    const u = users.getUser(uid);
    const gId = interaction.guildId;
    let gxp = 0n;
    let grp = 0n;
    let pgLine = '—';
    if (gId) {
      const row = gm.getMemberRow(gId, uid);
      gxp = row.gxp;
      grp = row.grp;
      const m = pg.getMembershipInHub(uid, gId);
      if (m) {
        const g = pg.getGuild(m.guild_id);
        pgLine = `**${g.name}** · grade **${label(g.grade || '')}** · GXP guilde **${BigInt(g.gxp || '0').toLocaleString('fr-FR')}**`;
      }
    }
    const embed = new EmbedBuilder()
      .setTitle(`💰 ${interaction.user.username}`)
      .setColor(0xf1c40f)
      .addFields(
        { name: 'Starss', value: fmt(u.stars), inline: true },
        { name: 'Points', value: fmt(u.points), inline: true },
        { name: 'Niveau / XP', value: `Nv **${u.level}** · **${u.xp}** XP`, inline: true },
        { name: 'GXP (ce serveur)', value: fmt(gxp), inline: true },
        { name: 'GRP (ce serveur)', value: fmt(grp), inline: true },
        { name: 'Guilde REBORN', value: pgLine, inline: false },
        {
          name: 'Boosts actifs',
          value: `XP ×2 : ${fmtMs(u.xp_boost_ms)}\nGXP ×2 : ${fmtMs(u.gxp_boost_ms)}\nStarss ×2 : ${fmtMs(u.starss_boost_ms)}`,
          inline: false,
        },
        {
          name: 'Gains passifs (doc REBORN)',
          value: `**${STARSS_PER_MESSAGE}** starss / msg · **${STARSS_PER_VOICE_MINUTE}** starss / min voc (hors boosts).`,
          inline: false,
        },
      );
    await interaction.reply({ embeds: [embed], ephemeral: true });
  },
};
