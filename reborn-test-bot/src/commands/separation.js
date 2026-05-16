const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const sep = require('../services/separation');
const pg = require('../services/playerGuilds');
const { d } = require('../lib/slashDesc');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('separation')
    .setDescription('Appel à la séparation (12 h recrutement, puis 48 h guerre GRP).')
    .addSubcommand((sc) => sc.setName('lancer').setDescription('Lancer une séparation (membre de la guilde).'))
    .addSubcommand((sc) =>
      sc
        .setName('rejoindre')
        .setDescription('Rejoindre le camp séparatiste')
        .addStringOption((o) => o.setName('id').setDescription('ID séparation').setRequired(true)),
    )
    .addSubcommand((sc) => sc.setName('statut').setDescription('Séparations actives sur ce serveur')),
  async execute(interaction) {
    const hub = interaction.guildId;
    if (!hub) return interaction.reply({ content: 'Serveur uniquement.' });
    const uid = interaction.user.id;
    const sub = interaction.options.getSubcommand();

    if (sub === 'lancer') {
      const m = pg.getMembershipInHub(uid, hub);
      if (!m) return interaction.reply({ content: 'Tu dois être dans une guilde.' });
      const r = sep.startSeparation(hub, m.guild_id, uid);
      if (!r.ok) return interaction.reply({ content: r.error });
      return interaction.reply({
        content: [
          `⚔️ **Appel à la séparation lancé** — ID **${r.separationId}**`,
          `Phase 1 (recrutement) — fin <t:${Math.floor(r.phase1End / 1000)}:R>`,
          'Si **≥ 25 %** des membres rejoignent ton camp, **48 h de guerre GRP** démarrent.',
          'Le camp gagnant reçoit **+25 % starss** (cap 1M / membre) et **+1 point Temple**.',
          `Pour rejoindre : \`/separation rejoindre id:${r.separationId}\``,
        ].join('\n'),
      });
    }

    if (sub === 'rejoindre') {
      const id = interaction.options.getString('id', true).trim();
      const r = sep.joinSeparationCamp(hub, uid, id);
      if (!r.ok) return interaction.reply({ content: r.error });
      return interaction.reply({ content: '✅ Tu as rejoint le **camp séparatiste**.' });
    }

    if (sub === 'statut') {
      const db = require('../db');
      const rows = db.prepare('SELECT * FROM separations WHERE hub_discord_id = ? AND cancelled = 0').all(hub);
      const active = rows.filter((s) => !s.winner || String(s.winner).length === 0);
      if (!active.length) return interaction.reply({ content: 'Aucune séparation active.' });
      const e = new EmbedBuilder().setTitle('Séparations en cours').setColor(0xe74c3c);
      for (const s of active.slice(0, 8)) {
        let camp = [];
        try { camp = JSON.parse(s.camp_split || '[]'); } catch { camp = []; }
        const total = pg.memberCount(s.guild_id);
        const phaseLbl = s.phase === 1
          ? `Phase 1 — recrutement (fin <t:${Math.floor(s.phase1_end_ms / 1000)}:R>)`
          : `Phase 2 — guerre GRP (fin <t:${Math.floor(s.phase2_end_ms / 1000)}:R>)`;
        const splitInfo = s.phase === 2
          ? `\nGRP camp split snapshot **${BigInt(s.grp_snapshot_a || '0').toLocaleString('fr-FR')}** vs loyal **${BigInt(s.grp_snapshot_b || '0').toLocaleString('fr-FR')}**`
          : '';
        e.addFields({
          name: `ID \`${s.id}\` — ${phaseLbl}`,
          value: `Guilde \`${s.guild_id}\` · camp split : **${camp.length}** / ${total} membre(s)${splitInfo}`,
          inline: false,
        });
      }
      return interaction.reply({ embeds: [e] });
    }
  },
};
