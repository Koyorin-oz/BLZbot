const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const users = require('../services/users');
const passport = require('../services/passport');
const { isOwner } = require('../lib/owners');
const { buildPassportTextV2 } = require('../lib/passportV2Ui');

function canStaff(interaction) {
  const admin = interaction.memberPermissions?.has(PermissionFlagsBits.Administrator);
  return Boolean(admin) || isOwner(interaction.user.id);
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('passeport')
    .setDescription('Passeport staff / sécu (fiche + vue canvas).')
    .addSubcommand((sc) =>
      sc
        .setName('voir')
        .setDescription('Afficher le passeport (composants v2)')
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
    const warns = passport.listWarns(hub, target.id, 20);
    const wlines = warns.length
      ? warns.map((w) => `−${w.degree} <@${w.mod_id}> — ${(w.reason || '—').slice(0, 80)}`)
      : [];
    const p = buildPassportTextV2({ target, u, hub, wlines });
    return interaction.reply({ ...p, flags: p.flags | MessageFlags.Ephemeral });
  },
};
