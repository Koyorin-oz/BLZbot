const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const sep = require('../services/separation');
const pg = require('../services/playerGuilds');

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
        content: `Séparation lancée — ID **${r.separationId}**\nPhase 1 fin <t:${Math.floor(r.phase1End / 1000)}:R>`,
        
      });
    }

    if (sub === 'rejoindre') {
      const id = interaction.options.getString('id', true).trim();
      const r = sep.joinSeparationCamp(hub, uid, id);
      if (!r.ok) return interaction.reply({ content: r.error });
      return interaction.reply({ content: 'Tu as rejoint le camp séparatiste.' });
    }

    if (sub === 'statut') {
      const db = require('../db');
      const rows = db.prepare('SELECT * FROM separations WHERE hub_discord_id = ? AND cancelled = 0').all(hub);
      const active = rows.filter((s) => !s.winner || String(s.winner).length === 0);
      if (!active.length) return interaction.reply({ content: 'Aucune séparation active.' });
      const e = new EmbedBuilder().setTitle('Séparations').setColor(0xe74c3c);
      for (const s of active.slice(0, 8)) {
        let camp = [];
        try {
          camp = JSON.parse(s.camp_split || '[]');
        } catch {
          camp = [];
        }
        e.addFields({
          name: `ID \`${s.id}\` — phase ${s.phase}`,
          value: `Guilde \`${s.guild_id}\` · camp : **${camp.length}** membre(s)`,
          inline: false,
        });
      }
      return interaction.reply({ embeds: [e] });
    }
  },
};
