const {
  SlashCommandBuilder,
  ContainerBuilder,
  TextDisplayBuilder,
  MessageFlags,
} = require('discord.js');
const users = require('../services/users');
const gm = require('../services/guildMember');
const pg = require('../services/playerGuilds');
const { label } = require('../reborn/grades');
const {
  STARSS_PER_MESSAGE,
  STARSS_PER_VOICE_MINUTE,
  XP_PER_MESSAGE,
  XP_PER_VOICE_MINUTE,
} = require('../reborn/constants');
const rankedRp = require('../services/rankedRp');
const { totalToLevelState } = require('../reborn/xpCurve');
const { d } = require('../lib/slashDesc');

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
    .setDescription('Consulte ton solde starss, points, XP et ta progression de guilde.')
  async execute(interaction) {
    const uid = interaction.user.id;
    users.getOrCreate(uid, interaction.user.username);
    const u = users.getUser(uid);
    const xpTot = u.xp_total ?? 0;
    const xpSt = totalToLevelState(xpTot);
    const rp = users.getPoints(uid);
    const rpRates = rankedRp.ratesForPoints(rp);
    const gId = interaction.guildId;
    let gxp = 0n;
    let grp = 0n;
    let pgLines = ['*Pas de guilde REBORN sur ce serveur.*'];
    if (gId) {
      const row = gm.getMemberRow(gId, uid);
      gxp = row.gxp;
      grp = row.grp;
      const m = pg.getMembershipInHub(uid, gId);
      if (m) {
        const g = pg.getGuild(m.guild_id);
        pgLines = [
          `**${g.name}**`,
          `**Grade** : ${label(g.grade || '')}`,
          `**GXP guilde** : ${BigInt(g.gxp || '0').toLocaleString('fr-FR')}`,
        ];
      }
    }

    const wallet = new TextDisplayBuilder().setContent(
      [
        `# Solde — ${interaction.user.username}`,
        '',
        `**Starss** : **${fmt(u.stars)}**`,
        `**RP (ranked)** : **${fmt(u.points)}**`,
        `**Monnaie d’événement** : **${fmt(u.event_currency || '0')}**`,
      ].join('\n'),
    );
    const xpBlock = new TextDisplayBuilder().setContent(
      [
        '## Niveau & RP',
        `**Niveau** : **${xpSt.level}** — **${xpSt.xpInto}** XP dans le palier (total **${xpTot}** XP)`,
        `**Gains RP** (palier actuel) : **${rpRates.msg}** / msg · **${rpRates.vocMin}** / min voc`,
        `**GXP (hub)** : **${fmt(gxp)}**`,
        `**GRP (hub)** : **${fmt(grp)}**`,
      ].join('\n'),
    );
    const guildBlock = new TextDisplayBuilder().setContent(
      ['## Guilde REBORN', ...pgLines].join('\n'),
    );
    const boosts = new TextDisplayBuilder().setContent(
      [
        '## Boosts actifs',
        `XP ×2 : **${fmtMs(u.xp_boost_ms)}**`,
        `GXP ×2 : **${fmtMs(u.gxp_boost_ms)}**`,
        `Starss ×2 : **${fmtMs(u.starss_boost_ms)}**`,
      ].join('\n'),
    );
    const passive = new TextDisplayBuilder().setContent(
      [
        '## Gains de base (hors boosts)',
        `**${STARSS_PER_MESSAGE}** starss / msg · **${STARSS_PER_VOICE_MINUTE}** starss / min voc`,
        `**${XP_PER_MESSAGE}** XP / msg · **${XP_PER_VOICE_MINUTE}** XP / min voc`,
      ].join('\n'),
    );
    const c = new ContainerBuilder().addTextDisplayComponents(
      wallet,
      xpBlock,
      guildBlock,
      boosts,
      passive,
    );
    await interaction.reply({ components: [c], flags: MessageFlags.IsComponentsV2 });
  },
};
