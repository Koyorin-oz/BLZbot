const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { d } = require('../lib/slashDesc');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

module.exports = {
  data: new SlashCommandBuilder()
    .setName('dm-all')
    .setDescription(d('', 'Envoyer un message privé à tous les membres du serveur (admin).'))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption((o) =>
      o.setName('message').setDescription('Le message à envoyer en DM').setRequired(true),
    )
    .addRoleOption((o) =>
      o.setName('role').setDescription('Limiter aux membres ayant ce rôle (optionnel)').setRequired(false),
    ),

  async execute(interaction, ctx) {
    if (
      !ctx.isOwner() &&
      !interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)
    ) {
      return interaction.reply({ content: 'Réservé aux administrateurs.' });
    }
    const guild = interaction.guild;
    if (!guild) return interaction.reply({ content: 'Sur un serveur uniquement.' });

    const content = interaction.options.getString('message', true);
    const role = interaction.options.getRole('role');

    await interaction.deferReply();

    let members;
    try {
      members = await guild.members.fetch();
    } catch (e) {
      return interaction.editReply({ content: `Impossible de récupérer les membres : \`${e?.message || e}\`` });
    }

    let targets = members.filter((m) => !m.user.bot);
    if (role) targets = targets.filter((m) => m.roles.cache.has(role.id));

    const total = targets.size;
    if (total === 0) return interaction.editReply({ content: 'Aucun membre ciblé.' });

    await interaction.editReply({ content: `Envoi en cours à **${total}** membre(s)…` });

    let sent = 0;
    let failed = 0;
    for (const member of targets.values()) {
      try {
        await member.send({ content });
        sent += 1;
      } catch {
        failed += 1;
      }
      await sleep(350);
    }

    const summary = `DM terminé : **${sent}** envoyé(s)${failed ? ` · **${failed}** échec(s) (DM fermés ou bloqués)` : ''} sur **${total}** ciblé(s).`;
    try {
      await interaction.editReply({ content: summary });
    } catch {
      await interaction.followUp({ content: summary }).catch(() => {});
    }
  },
};
