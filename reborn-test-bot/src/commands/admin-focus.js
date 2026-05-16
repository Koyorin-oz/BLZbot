const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
} = require('discord.js');
const playerGuilds = require('../services/playerGuilds');
const focusAudit = require('../services/focusAudit');
const { d } = require('../lib/slashDesc');

/**
 * Outils staff pour la modération du Focus de guilde :
 *  - `desactiver <guild_id>` : empêche la guilde d'attaquer ou d'être attaquée
 *  - `reactiver <guild_id>`  : annule la désactivation
 *  - `reset-cd <guild_id>`   : remet le cooldown 7j à zéro
 *  - `historique <guild_id>` : affiche les 10 derniers focus impliquant la guilde
 */
module.exports = {
  data: new SlashCommandBuilder()
    .setName('admin-focus')
    .setDescription('Modération des Focus de guilde (admin).')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand((sc) =>
      sc
        .setName('desactiver')
        .setDescription("Désactiver le focus pour une guilde abusive.")
        .addStringOption((o) =>
          o.setName('guild_id').setDescription('Identifiant de la guilde').setRequired(true),
        ),
    )
    .addSubcommand((sc) =>
      sc
        .setName('reactiver')
        .setDescription('Réactiver le focus pour une guilde.')
        .addStringOption((o) =>
          o.setName('guild_id').setDescription('Identifiant de la guilde').setRequired(true),
        ),
    )
    .addSubcommand((sc) =>
      sc
        .setName('reset-cd')
        .setDescription('Réinitialiser le cooldown focus 7 j.')
        .addStringOption((o) =>
          o.setName('guild_id').setDescription('Identifiant de la guilde').setRequired(true),
        ),
    )
    .addSubcommand((sc) =>
      sc
        .setName('historique')
        .setDescription('Voir les 10 derniers focus impliquant cette guilde.')
        .addStringOption((o) =>
          o.setName('guild_id').setDescription('Identifiant de la guilde').setRequired(true),
        ),
    ),

  async execute(interaction, ctx) {
    if (
      !ctx.isOwner() &&
      !interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)
    ) {
      return interaction.reply({ content: '❌ Réservé aux administrateurs.' });
    }
    const sub = interaction.options.getSubcommand();
    const gid = interaction.options.getString('guild_id', true).trim();

    if (sub === 'desactiver') {
      const r = playerGuilds.setFocusDisabled(gid, true);
      if (!r.ok) return interaction.reply({ content: r.error });
      return interaction.reply({ content: `🚫 Focus **désactivé** pour la guilde \`${gid}\`.` });
    }
    if (sub === 'reactiver') {
      const r = playerGuilds.setFocusDisabled(gid, false);
      if (!r.ok) return interaction.reply({ content: r.error });
      return interaction.reply({ content: `✅ Focus **réactivé** pour la guilde \`${gid}\`.` });
    }
    if (sub === 'reset-cd') {
      const r = playerGuilds.resetFocusCooldown(gid);
      if (!r.ok) return interaction.reply({ content: r.error });
      return interaction.reply({ content: `⏱️ Cooldown focus **réinitialisé** pour \`${gid}\`.` });
    }
    if (sub === 'historique') {
      const h = focusAudit.focusHistoryForGuild(gid);
      const g = playerGuilds.getGuild(gid);
      const lines = h.recent.map((r) => {
        const dir = r.mod_id === gid ? '➡️ attaquant' : '⬅️ ciblé';
        return `<t:${Math.floor(r.created_ms / 1000)}:R> · ${dir} · ${r.details || ''}`;
      });
      const e = new EmbedBuilder()
        .setTitle(`📜 Historique Focus — ${g?.name || gid}`)
        .setColor(0xe67e22)
        .setDescription(
          `Total focus enregistrés : **${h.total}**\n\n${lines.length ? lines.join('\n') : '*Aucun focus enregistré.*'}`,
        );
      return interaction.reply({ embeds: [e] });
    }
  },
};
