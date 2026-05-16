const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const pg = require('../services/playerGuilds');
const { d } = require('../lib/slashDesc');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('admin-creer-guilde')
    .setDescription(d('🛡️', 'Crée une guilde joueur sans exigence de niveau (admin).'))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption((o) => o.setName('nom').setDescription('Nom de la guilde').setRequired(true))
    .addUserOption((o) =>
      o
        .setName('chef')
        .setDescription('Membre qui devient chef (défaut : toi)')
        .setRequired(false),
    ),
  async execute(interaction) {
    if (!interaction.guildId) {
      return interaction.reply({ content: 'Sur un serveur uniquement.' });
    }
    if (!interaction.member?.permissions.has(PermissionFlagsBits.Administrator)) {
      return interaction.reply({ content: 'Permission **Administrateur** requise.' });
    }
    const nom = interaction.options.getString('nom', true);
    const leader = interaction.options.getUser('chef') ?? interaction.user;
    const r = pg.createGuild(
      interaction.guildId,
      leader.id,
      leader.username,
      nom,
      { bypassLevel: true },
    );
    if (!r.ok) {
      return interaction.reply({ content: r.error });
    }
    const leaderLine = leader.id === interaction.user.id ? 'Toi' : `${leader} (${leader.tag})`;
    const embed = new EmbedBuilder()
      .setTitle('Guilde créée (admin)')
      .setColor(0x2ecc71)
      .setDescription(
        'Création **sans exigence de niveau** — la guilde est enregistrée sur ce hub REBORN.',
      )
      .addFields(
        { name: 'Nom', value: nom.slice(0, 256), inline: true },
        { name: 'ID guilde', value: `\`${r.guildId}\``, inline: true },
        { name: 'Chef', value: leaderLine, inline: false },
      );
    return interaction.reply({ embeds: [embed] });
  },
};
