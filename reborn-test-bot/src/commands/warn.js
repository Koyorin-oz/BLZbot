const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const passport = require('../services/passport');
const { d } = require('../lib/slashDesc');
const { isOwner } = require('../lib/owners');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('warn')
    .setDescription(d('⚠️', 'Enregistre un avertissement staff (léger → critique).'))
    .setDMPermission(false)
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
          { name: 'Critique (−9 pts) — fautes proches du ban def', value: 'critique' },
        ),
    )
    .addStringOption((o) => o.setName('raison').setDescription('Motif')),
  async execute(interaction) {
    const hub = interaction.guildId;
    if (!hub) return interaction.reply({ content: 'Serveur uniquement.' });
    const admin = interaction.memberPermissions?.has(PermissionFlagsBits.Administrator);
    if (!admin && !isOwner(interaction.user.id)) {
      return interaction.reply({ content: 'Permission refusée.' });
    }
    const t = interaction.options.getUser('membre', true);
    const member = await interaction.guild.members.fetch(t.id).catch(() => null);
    if (!member) {
      return interaction.reply({
        content:
          '❌ Ce **membre** n’est pas sur le serveur (ou introuvable). Ouvre la liste des membres et choisis quelqu’un du salon — pas le bot ni l’application.',
      });
    }
    if (member.user.bot) {
      return interaction.reply({
        content:
          '❌ Un warn ne s’applique qu’à un **compte joueur**. Les bots et l’application ne peuvent pas être warnés.',
      });
    }
    const deg = interaction.options.getString('degre', true);
    const raison = interaction.options.getString('raison') || '';
    const r = passport.addWarn(hub, t.id, interaction.user.id, deg, raison);
    try {
      require('../services/staffAudit').audit(hub, interaction.user.id, t.id, `warn_${deg}`, raison);
    } catch { /* ignore */ }
    return interaction.reply({
      content: `Warn **${deg}** → <@${t.id}> — points de sécu : **${r.newPoints}**`,
    });
  },
};
