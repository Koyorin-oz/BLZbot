const path = require('node:path');
const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  AttachmentBuilder,
} = require('discord.js');
const users = require('../services/users');
const passport = require('../services/passport');
const { isOwner } = require('../lib/owners');

const CANVAS_PASS = path.join(
  __dirname,
  '..',
  '..',
  '..',
  'niveau',
  'src',
  'utils',
  'canvas-passport-staff-style',
);

function canStaff(interaction) {
  const admin = interaction.memberPermissions?.has(PermissionFlagsBits.Administrator);
  return Boolean(admin) || isOwner(interaction.user.id);
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('passeport')
    .setDescription('Passeport staff / sécu (carte canvas).')
    .addSubcommand((sc) =>
      sc
        .setName('voir')
        .setDescription('Afficher la carte passeport (canvas)')
        .addUserOption((o) => o.setName('membre').setDescription('Cible').setRequired(false)),
    )
    .addSubcommand((sc) =>
      sc
        .setName('maj_staff')
        .setDescription('Mettre à jour tests mod / candidature (admin ou owner)')
        .addUserOption((o) => o.setName('membre').setDescription('Cible').setRequired(true))
        .addIntegerOption((o) =>
          o
            .setName('score_tests')
            .setDescription('Score tests mod (0–100, optionnel)')
            .setMinValue(0)
            .setMaxValue(100),
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
    if (!hub) return interaction.reply({ content: 'Serveur uniquement.' });
    const sub = interaction.options.getSubcommand();

    if (sub === 'maj_staff') {
      if (!canStaff(interaction)) {
        return interaction.reply({ content: 'Permission refusée.' });
      }
      const target = interaction.options.getUser('membre', true);
      if (target.bot) return interaction.reply({ content: 'Impossible sur un bot.' });
      users.getOrCreate(target.id, target.username);
      const score = interaction.options.getInteger('score_tests');
      const cand = interaction.options.getString('candidature');
      if (score == null && !cand) {
        return interaction.reply({
          content: 'Indique au moins **score_tests** ou **candidature**.',
          
        });
      }
      if (score != null) users.setModTestsScore(target.id, score);
      if (cand) users.setCandidatureStatus(target.id, cand);
      return interaction.reply({
        content: `Passeport staff mis à jour pour **${target.username}**.`,
        
      });
    }

    const target = interaction.options.getUser('membre') || interaction.user;
    users.getOrCreate(target.id, target.username);
    passport.maybeRecoverSecu(target.id);
    const u = users.getUser(target.id);
    const warns = passport.listWarns(hub, target.id, 8);

    await interaction.deferReply({ });

    let buf;
    try {
      const { renderPassportCardStaffStyle } = require(CANVAS_PASS);
      const targetMember = await interaction.guild.members.fetch(target.id).catch(() => null);
      buf = await renderPassportCardStaffStyle({
        member: targetMember,
        displayName: targetMember?.displayName || target.username,
        secuPoints: u.secu_points ?? 10,
        modScore: u.mod_tests_score ?? 0,
        candidature: u.candidature_status ?? 'aucune',
        warns: warns.map((w) => ({ degree: w.degree, modId: w.mod_id, reason: w.reason })),
      });
    } catch (e) {
      console.error('[passeport canvas]', e);
      return interaction.editReply({
        content:
          `🪪 **Passeport — ${target.username}**\n` +
          `Sécu : \`${u.secu_points ?? 10}\` · Tests : \`${u.mod_tests_score ?? 0}/100\` · Candidature : \`${u.candidature_status ?? 'aucune'}\`\n` +
          `Warns : **${warns.length}**\n` +
          '*(canvas indisponible)*',
      });
    }

    const file = new AttachmentBuilder(buf, { name: 'passeport_reborn.png' });
    return interaction.editReply({ files: [file] });
  },
};
