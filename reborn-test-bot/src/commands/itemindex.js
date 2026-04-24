const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const idx = require('../services/indexProgress');
const users = require('../services/users');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('itemindex')
    .setDescription('Progression index items (palier 10 % → 100 %).')
    .addSubcommand((sc) =>
      sc
        .setName('voir')
        .setDescription('Voir ton % et les récompenses')
        .addUserOption((o) => o.setName('membre').setDescription('Optionnel')),
    )
    .addSubcommand((sc) =>
      sc
        .setName('definir')
        .setDescription('Définir ton % (test / admin)')
        .addIntegerOption((o) =>
          o.setName('pourcent').setDescription('0–100').setRequired(true).setMinValue(0).setMaxValue(100),
        ),
    )
    .addSubcommand((sc) => sc.setName('reclamer').setDescription('Réclamer la prochaine étape disponible')),
  async execute(interaction, ctx) {
    const uid = interaction.options.getUser('membre')?.id || interaction.user.id;
    if (
      uid !== interaction.user.id &&
      !ctx.isOwner() &&
      !interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)
    ) {
      return interaction.reply({ content: 'Interdit.', ephemeral: true });
    }
    users.getOrCreate(uid, interaction.options.getUser('membre')?.username || interaction.user.username);
    const sub = interaction.options.getSubcommand();

    if (sub === 'voir') {
      const r = idx.getRow(uid);
      const claimed = idx.parseClaimed(r.claimed_json);
      const lines = idx.STEPS.map(
        (s) =>
          `• **${s.pct} %** → +${s.stars.toLocaleString('fr-FR')} starss ${claimed.includes(s.pct) ? '✅' : ''}`,
      );
      const e = new EmbedBuilder()
        .setTitle('Index items')
        .setDescription(`Complétion : **${r.completion_pct} %**\n\n${lines.join('\n')}`)
        .setColor(0x3498db);
      return interaction.reply({ embeds: [e], ephemeral: true });
    }

    if (sub === 'definir') {
      if (!ctx.isOwner() && !interaction.memberPermissions?.has('Administrator')) {
        return interaction.reply({ content: 'Admin / owner.', ephemeral: true });
      }
      const p = interaction.options.getInteger('pourcent', true);
      idx.setCompletion(uid, p);
      return interaction.reply({ content: `Index **${uid}** → **${p} %**`, ephemeral: true });
    }

    if (sub === 'reclamer') {
      const r = idx.claimNext(uid, users);
      if (!r.ok) return interaction.reply({ content: r.error, ephemeral: true });
      return interaction.reply({
        content: `Étape **${r.step.pct} %** : +**${r.step.stars.toLocaleString('fr-FR')}** starss`,
        ephemeral: true,
      });
    }
  },
};
