const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const passport = require('../services/passport');
const { isOwner } = require('../lib/owners');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('warn')
    .setDescription('Poser un warn (léger / moyen / fort) — admin ou owner app.')
    .addUserOption((o) => o.setName('membre').setDescription('Cible').setRequired(true))
    .addStringOption((o) =>
      o
        .setName('degre')
        .setDescription('Gravité')
        .setRequired(true)
        .addChoices(
          { name: 'Léger (−1 pt)', value: 'leger' },
          { name: 'Moyen (−2 pts)', value: 'moyen' },
          { name: 'Fort (−5 pts)', value: 'fort' },
        ),
    )
    .addStringOption((o) => o.setName('raison').setDescription('Motif')),
  async execute(interaction) {
    const hub = interaction.guildId;
    if (!hub) return interaction.reply({ content: 'Serveur uniquement.', ephemeral: true });
    const admin = interaction.memberPermissions?.has(PermissionFlagsBits.Administrator);
    if (!admin && !isOwner(interaction.user.id)) {
      return interaction.reply({ content: 'Permission refusée.', ephemeral: true });
    }
    const t = interaction.options.getUser('membre', true);
    if (t.bot) return interaction.reply({ content: 'Pas sur un bot.', ephemeral: true });
    const deg = interaction.options.getString('degre', true);
    const raison = interaction.options.getString('raison') || '';
    const r = passport.addWarn(hub, t.id, interaction.user.id, deg, raison);
    return interaction.reply({
      content: `Warn **${deg}** → <@${t.id}> — points de sécu : **${r.newPoints}**`,
      ephemeral: true,
    });
  },
};
