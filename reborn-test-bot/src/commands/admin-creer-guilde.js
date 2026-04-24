const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const pg = require('../services/playerGuilds');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('admin-creer-guilde')
    .setDescription('Crée une guilde joueur sans exigence de niveau (réservé aux administrateurs Discord).')
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
      return interaction.reply({ content: 'Sur un serveur uniquement.', flags: MessageFlags.Ephemeral });
    }
    if (!interaction.member?.permissions.has(PermissionFlagsBits.Administrator)) {
      return interaction.reply({ content: 'Permission **Administrateur** requise.', flags: MessageFlags.Ephemeral });
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
      return interaction.reply({ content: r.error, flags: MessageFlags.Ephemeral });
    }
    const leaderLine = leader.id === interaction.user.id ? 'Toi' : `${leader} (${leader.tag})`;
    return interaction.reply({
      content: `Guilde **${nom.slice(0, 80)}** créée — ID \`${r.guildId}\` · chef : ${leaderLine}.`,
      flags: MessageFlags.Ephemeral,
    });
  },
};
