const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('purge')
    .setDescription('Supprime jusqu’à N messages récents (owner app ; batches Discord).')
    .addIntegerOption((o) =>
      o
        .setName('nombre')
        .setDescription('1 à 1000 (paquets de 100 ; messages de moins de 14 j)')
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(1000),
    ),
  /**
   * @param {import('discord.js').ChatInputCommandInteraction} interaction
   * @param {{ isOwner: () => boolean }} ctx
   */
  async execute(interaction, ctx) {
    if (!ctx.isOwner()) {
      await interaction.reply({ content: 'Réservé au propriétaire de l’app / REBORN_TEST_OWNER_IDS.' });
      return;
    }
    const ch = interaction.channel;
    if (!ch || !ch.isTextBased() || ch.isDMBased()) {
      await interaction.reply({ content: 'Utilisable dans un salon texte du serveur.' });
      return;
    }
    const me = interaction.guild?.members.me;
    if (!me?.permissionsIn(ch).has(PermissionFlagsBits.ManageMessages)) {
      await interaction.reply({ content: 'Le bot a besoin de **Gérer les messages**.' });
      return;
    }
    let remaining = interaction.options.getInteger('nombre', true);
    await interaction.deferReply({ });
    let deleted = 0;
    while (remaining > 0) {
      const batch = Math.min(remaining, 100);
      const msgs = await ch.messages.fetch({ limit: batch });
      if (msgs.size === 0) break;
      const twoWeeks = Date.now() - 14 * 24 * 60 * 60 * 1000;
      const fresh = msgs.filter((m) => m.createdTimestamp > twoWeeks && !m.pinned);
      if (fresh.size === 0) break;
      await ch.bulkDelete(fresh, true).catch(() => null);
      deleted += fresh.size;
      remaining -= fresh.size;
      if (fresh.size < batch) break;
    }
    await interaction.editReply({ content: `Supprimé (tentative) : **${deleted}** message(s).` });
  },
};
