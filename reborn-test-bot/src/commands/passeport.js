const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const users = require('../services/users');
const passport = require('../services/passport');
const { isOwner } = require('../lib/owners');

function canStaff(interaction) {
  const admin = interaction.memberPermissions?.has(PermissionFlagsBits.Administrator);
  return Boolean(admin) || isOwner(interaction.user.id);
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('passeport')
    .setDescription('Passeport staff / sécu (REBORN).')
    .addSubcommand((sc) =>
      sc
        .setName('voir')
        .setDescription('Afficher le passeport')
        .addUserOption((o) => o.setName('membre').setDescription('Cible').setRequired(false)),
    )
    .addSubcommand((sc) =>
      sc
        .setName('maj_staff')
        .setDescription('Mettre à jour tests mod / candidature (admin ou owner)')
        .addUserOption((o) => o.setName('membre').setDescription('Cible').setRequired(true))
        .addIntegerOption((o) =>
          o.setName('score_tests').setDescription('Score tests mod (0–100, optionnel)').setMinValue(0).setMaxValue(100),
        )
        .addStringOption((o) =>
          o
            .setName('candidature')
            .setDescription('Statut candidature staff (optionnel)')
            .addChoices(
              { name: 'Aucune', value: 'aucune' },
              { name: 'En attente', value: 'en_attente' },
              { name: 'Acceptée', value: 'acceptee' },
              { name: 'Refusée', value: 'refusee' },
            ),
        ),
    ),
  async execute(interaction) {
    const hub = interaction.guildId;
    if (!hub) return interaction.reply({ content: 'Serveur uniquement.', ephemeral: true });
    const sub = interaction.options.getSubcommand();

    if (sub === 'maj_staff') {
      if (!canStaff(interaction)) {
        return interaction.reply({ content: 'Permission refusée.', ephemeral: true });
      }
      const target = interaction.options.getUser('membre', true);
      if (target.bot) return interaction.reply({ content: 'Impossible sur un bot.', ephemeral: true });
      users.getOrCreate(target.id, target.username);
      const score = interaction.options.getInteger('score_tests');
      const cand = interaction.options.getString('candidature');
      if (score == null && !cand) {
        return interaction.reply({ content: 'Indique au moins **score_tests** ou **candidature**.', ephemeral: true });
      }
      if (score != null) users.setModTestsScore(target.id, score);
      if (cand) users.setCandidatureStatus(target.id, cand);
      return interaction.reply({ content: `Passeport staff mis à jour pour **${target.username}**.`, ephemeral: true });
    }

    const target = interaction.options.getUser('membre') || interaction.user;
    users.getOrCreate(target.id, target.username);
    passport.maybeRecoverSecu(target.id);
    const u = users.getUser(target.id);
    const warns = passport.listWarns(hub, target.id, 10);
    const wtxt = warns.length
      ? warns.map((w) => `• −${w.degree} pts — <@${w.mod_id}> — ${w.reason || '—'}`).join('\n')
      : 'Aucun warn enregistré ici.';
    const e = new EmbedBuilder()
      .setTitle(`Passeport — ${target.username}`)
      .addFields(
        { name: 'Points de sécu', value: String(u.secu_points ?? 10), inline: true },
        { name: 'Tests mod (score)', value: String(u.mod_tests_score ?? 0), inline: true },
        { name: 'Candidature staff', value: String(u.candidature_status ?? 'aucune'), inline: true },
        { name: 'Warns (ce serveur)', value: wtxt.slice(0, 900), inline: false },
      )
      .setFooter({ text: 'Récupération +2 pts / 30 j si perte (auto au prochain affichage).' })
      .setColor(0x95a5a6);
    return interaction.reply({ embeds: [e], ephemeral: true });
  },
};
