const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { d } = require('../lib/slashDesc');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

module.exports = {
  data: new SlashCommandBuilder()
    .setName('give-role')
    .setDescription(d('', 'Donner ou retirer un rôle à tous les membres (admin).'))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
    .addSubcommand((sc) =>
      sc
        .setName('donner')
        .setDescription('Donner un rôle à tous les membres')
        .addRoleOption((o) => o.setName('role').setDescription('Rôle à donner').setRequired(true))
        .addBooleanOption((o) =>
          o.setName('inclure_bots').setDescription('Inclure aussi les bots (défaut : non)').setRequired(false),
        ),
    )
    .addSubcommand((sc) =>
      sc
        .setName('retirer')
        .setDescription('Retirer un rôle de tous les membres')
        .addRoleOption((o) => o.setName('role').setDescription('Rôle à retirer').setRequired(true))
        .addBooleanOption((o) =>
          o.setName('inclure_bots').setDescription('Inclure aussi les bots (défaut : non)').setRequired(false),
        ),
    ),

  async execute(interaction, ctx) {
    if (
      !ctx.isOwner() &&
      !interaction.memberPermissions?.has(PermissionFlagsBits.Administrator) &&
      !interaction.memberPermissions?.has(PermissionFlagsBits.ManageRoles)
    ) {
      return interaction.reply({ content: 'Réservé au staff (gérer les rôles).' });
    }
    const guild = interaction.guild;
    if (!guild) return interaction.reply({ content: 'Sur un serveur uniquement.' });

    const sub = interaction.options.getSubcommand();
    const role = interaction.options.getRole('role', true);
    const includeBots = interaction.options.getBoolean('inclure_bots') || false;

    if (role.managed) {
      return interaction.reply({ content: 'Ce rôle est géré par une intégration et ne peut pas être attribué manuellement.' });
    }
    if (role.id === guild.id) {
      return interaction.reply({ content: 'Impossible de modifier le rôle @everyone.' });
    }

    const me = guild.members.me;
    if (!me?.permissions.has(PermissionFlagsBits.ManageRoles)) {
      return interaction.reply({ content: 'Il me manque la permission **Gérer les rôles**.' });
    }
    if (role.position >= me.roles.highest.position) {
      return interaction.reply({ content: `Le rôle ${role} est au-dessus (ou au même niveau) que mon rôle le plus haut. Place mon rôle plus haut dans la hiérarchie.` });
    }

    await interaction.deferReply();

    let members;
    try {
      members = await guild.members.fetch();
    } catch (e) {
      return interaction.editReply({ content: `Impossible de récupérer les membres : \`${e?.message || e}\`` });
    }

    let targets = members;
    if (!includeBots) targets = targets.filter((m) => !m.user.bot);

    const give = sub === 'donner';
    targets = targets.filter((m) =>
      give ? !m.roles.cache.has(role.id) : m.roles.cache.has(role.id),
    );

    const total = targets.size;
    if (total === 0) {
      return interaction.editReply({
        content: give
          ? `Tous les membres ciblés ont déjà ${role}.`
          : `Aucun membre ciblé ne possède ${role}.`,
      });
    }

    await interaction.editReply({
      content: `${give ? 'Attribution' : 'Retrait'} de ${role} pour **${total}** membre(s)…`,
    });

    let done = 0;
    let failed = 0;
    for (const member of targets.values()) {
      try {
        if (give) await member.roles.add(role, 'give-role donner');
        else await member.roles.remove(role, 'give-role retirer');
        done += 1;
      } catch {
        failed += 1;
      }
      await sleep(300);
    }

    const summary = `${give ? 'Ajout' : 'Retrait'} terminé pour ${role} : **${done}** OK${failed ? ` · **${failed}** échec(s)` : ''} sur **${total}**.`;
    try {
      await interaction.editReply({ content: summary });
    } catch {
      await interaction.followUp({ content: summary }).catch(() => {});
    }
  },
};
