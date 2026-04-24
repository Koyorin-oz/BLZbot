const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const db = require('../db');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('guilde')
    .setDescription('Stats GXP/GRP agrégées sur ce serveur (somme des membres trackés).'),
  async execute(interaction) {
    const gid = interaction.guildId;
    if (!gid) {
      await interaction.reply({ content: 'Utilisable sur un serveur.', ephemeral: true });
      return;
    }
    const rows = db.prepare('SELECT gxp, grp FROM guild_member_gxp WHERE guild_id = ?').all(gid);
    let sumG = 0n;
    let sumR = 0n;
    for (const r of rows) {
      try {
        sumG += BigInt(r.gxp || '0');
        sumR += BigInt(r.grp || '0');
      } catch {
        /* ignore */
      }
    }
    const embed = new EmbedBuilder()
      .setTitle(`Guilde / serveur ${interaction.guild?.name || gid}`)
      .setDescription(
        `Membres avec activité trackée : **${rows.length}**\n` +
          `**GXP** totale (somme) : **${sumG.toLocaleString('fr-FR')}**\n` +
          `**GRP** totale (somme) : **${sumR.toLocaleString('fr-FR')}**\n\n` +
          '_Niveau de guilde, trésorerie, grades, séparation : à brancher._',
      )
      .setColor(0x1abc9c);
    await interaction.reply({ embeds: [embed], ephemeral: true });
  },
};
