const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
} = require('discord.js');
const db = require('../db');
const C = require('../reborn/constants');
const economyState = require('../services/economyState');
const { d } = require('../lib/slashDesc');

/**
 * Audit + simulation économie (commande staff).
 *
 * `audit` : récap textuel de toutes les **sources** et **sinks** + état réel
 *           (total de starss en circulation, top 5 holders, RP total).
 * `simu`  : simulation grossière d'inflation pour N joueurs sur D jours en
 *           supposant un nombre moyen de messages / minutes voc.
 */
module.exports = {
  data: new SlashCommandBuilder()
    .setName('admin-economie')
    .setDescription(d('📊', 'Audit et simulation de l’économie du serveur (admin).'))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand((sc) =>
      sc.setName('audit').setDescription('État courant + récap sources/sinks.'),
    )
    .addSubcommand((sc) =>
      sc
        .setName('simu')
        .setDescription("Simuler l'inflation pour N joueurs × D jours.")
        .addIntegerOption((o) =>
          o.setName('joueurs').setDescription('Nombre de joueurs actifs').setRequired(true).setMinValue(1).setMaxValue(10000),
        )
        .addIntegerOption((o) =>
          o.setName('jours').setDescription('Durée en jours').setRequired(true).setMinValue(1).setMaxValue(365),
        )
        .addIntegerOption((o) =>
          o.setName('msg_par_jour').setDescription('Messages moyens / joueur / jour (def 30)').setRequired(false).setMinValue(0).setMaxValue(1000),
        )
        .addIntegerOption((o) =>
          o.setName('voc_par_jour').setDescription('Minutes de voc / joueur / jour (def 30)').setRequired(false).setMinValue(0).setMaxValue(1440),
        ),
    ),

  async execute(interaction, ctx) {
    if (
      !ctx.isOwner() &&
      !interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)
    ) {
      return interaction.reply({ content: '❌ Réservé aux administrateurs.' });
    }
    const sub = interaction.options.getSubcommand();
    if (sub === 'audit') {
      const total = db.prepare("SELECT COALESCE(SUM(CAST(stars AS INTEGER)), 0) AS s FROM users").get();
      const totalRp = db.prepare("SELECT COALESCE(SUM(CAST(points AS INTEGER)), 0) AS s FROM users").get();
      const topStars = db
        .prepare("SELECT id, username, stars FROM users ORDER BY CAST(stars AS INTEGER) DESC LIMIT 5")
        .all();
      const topRp = db
        .prepare("SELECT id, username, points FROM users ORDER BY CAST(points AS INTEGER) DESC LIMIT 5")
        .all();
      const totalGrp = db.prepare("SELECT COALESCE(SUM(CAST(grp AS INTEGER)), 0) AS s FROM guild_member_gxp").get();
      const totalTreasury = db.prepare("SELECT COALESCE(SUM(CAST(treasury AS INTEGER)), 0) AS s FROM player_guilds").get();

      const sources = [
        `• **Messages** : +${C.STARSS_PER_MESSAGE} starss / msg`,
        `• **Voc** : +${C.STARSS_PER_VOICE_MINUTE} starss / min`,
        `• **Daily** : 10k–25k starss + boost (1× / jour)`,
        `• **Quêtes** : daily 25k · hebdo 150k · choix (40k–250k)`,
        `• **Coffres** : Classique (25k–120k) · Meilleur (200k+) · Légendaire (400k+) · Starss (jusqu'à 5M + Diamant)`,
        `• **Séparation gagnée** : +25 % starss du joueur (cap 1M, +bonus séparatiste)`,
        `• **Paliers Index** : 10k → 2M starss + coffres`,
        `• **Paliers Ranked** : 25k → 10M starss + items (12 paliers)`,
        `• **Paliers GRP guilde** : 50k → 5M starss × tous les membres`,
      ];
      const sinks = [
        `• **Boutique slots** : prix par rareté (10k–10M)`,
        `• **Coffres** : 100k / 500k / 1M / 3M starss`,
        `• **Boost ×2** : 30k starss (1h)`,
        `• **Focus guilde** : 500k starss + CD 7 j`,
        `• **Grade guilde** : 200k → 20M starss + items`,
        `• **Crystal** : convertit en +500k starss (sink modéré)`,
      ];

      const fmtTopStars = topStars
        .map((r, i) => `**${i + 1}.** <@${r.id}> — ${BigInt(r.stars || '0').toLocaleString('fr-FR')}`)
        .join('\n') || '*Aucune donnée.*';
      const fmtTopRp = topRp
        .map((r, i) => `**${i + 1}.** <@${r.id}> — ${BigInt(r.points || '0').toLocaleString('fr-FR')}`)
        .join('\n') || '*Aucune donnée.*';

      const e = new EmbedBuilder()
        .setTitle('📊 Audit économie REBORN')
        .setColor(0x2ecc71)
        .addFields(
          {
            name: 'État courant',
            value: [
              `Starss en circulation : **${BigInt(total.s).toLocaleString('fr-FR')}**`,
              `RP total joueur : **${BigInt(totalRp.s).toLocaleString('fr-FR')}**`,
              `GRP total guilde : **${BigInt(totalGrp.s).toLocaleString('fr-FR')}**`,
              `Trésoreries de guilde : **${BigInt(totalTreasury.s).toLocaleString('fr-FR')}**`,
            ].join('\n'),
            inline: false,
          },
          { name: '🟢 Sources', value: sources.join('\n').slice(0, 1024), inline: false },
          { name: '🔴 Sinks', value: sinks.join('\n').slice(0, 1024), inline: false },
          { name: 'Top 5 Starss', value: fmtTopStars.slice(0, 1024), inline: true },
          { name: 'Top 5 RP', value: fmtTopRp.slice(0, 1024), inline: true },
        );
      return interaction.reply({ embeds: [e] });
    }

    if (sub === 'simu') {
      const players = interaction.options.getInteger('joueurs', true);
      const days = interaction.options.getInteger('jours', true);
      const mpd = interaction.options.getInteger('msg_par_jour') ?? 30;
      const vpd = interaction.options.getInteger('voc_par_jour') ?? 30;

      // Sources moyennes / joueur / jour
      const dailyStars = BigInt(C.STARSS_PER_MESSAGE) * BigInt(mpd)
        + BigInt(C.STARSS_PER_VOICE_MINUTE) * BigInt(vpd)
        + 17_500n; // moyenne pondérée daily (10k×0.3 + 500×0 + 0×0 + 25k×0.1 + ~7k coffres)
      const totalStars = dailyStars * BigInt(days) * BigInt(players);

      // Sinks moyens / joueur / jour : on suppose 1 boutique full + 1 coffre / jour
      const dailySinks = 30_000n /*boost*/
        + 100_000n /*coffre classique*/
        + 50_000n; /*items boutique low*/
      const totalSinks = dailySinks * BigInt(days) * BigInt(players);

      const netInflation = totalStars - totalSinks;
      const inflPctVsExisting = (() => {
        const cur = BigInt(db.prepare("SELECT COALESCE(SUM(CAST(stars AS INTEGER)), 0) AS s FROM users").get().s) || 1n;
        return Number((netInflation * 100n) / (cur > 0n ? cur : 1n));
      })();

      const e = new EmbedBuilder()
        .setTitle(`🧮 Simulation économie — ${players} joueurs × ${days} j`)
        .setColor(0x9b59b6)
        .addFields(
          { name: 'Hypothèses', value: `Messages/jour : **${mpd}** · Minutes voc/jour : **${vpd}**`, inline: false },
          {
            name: 'Brut',
            value: [
              `Sources cumulées : **${totalStars.toLocaleString('fr-FR')}** starss`,
              `Sinks cumulés    : **${totalSinks.toLocaleString('fr-FR')}** starss`,
              `Net (inflation)  : **${netInflation.toLocaleString('fr-FR')}** starss`,
            ].join('\n'),
            inline: false,
          },
          {
            name: 'Comparaison',
            value: `Inflation vs masse monétaire actuelle : **${inflPctVsExisting > 1000 ? '>1000' : inflPctVsExisting}%**`,
            inline: false,
          },
        )
        .setFooter({ text: 'Heuristique grossière. Ajuste msg_par_jour / voc_par_jour pour affiner.' });
      return interaction.reply({ embeds: [e] });
    }
  },
};
