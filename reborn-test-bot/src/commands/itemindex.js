const {
  SlashCommandBuilder,
  EmbedBuilder,
  PermissionFlagsBits,
  AttachmentBuilder,
} = require('discord.js');
const idx = require('../services/indexProgress');
const indexCollection = require('../services/indexCollection');
const indexRoles = require('../services/indexRoles');
const catalog = require('../reborn/catalog');
const { renderIndexCard } = require('../lib/canvasIndex');
const { d } = require('../lib/slashDesc');

function formatStepLine(step) {
  const parts = [`+${step.stars.toLocaleString('fr-FR')} ★`];
  for (const c of step.chests || []) {
    const name = catalog.getItem(c.id)?.name || c.id;
    parts.push(`${c.qty > 1 ? `${c.qty}× ` : ''}${name}`);
  }
  if (step.pct === 100) {
    parts.push('Rôle **Pipelette ultime** (si le serveur l’a configuré)');
  }
  return `**${step.pct} %** — ${parts.join(' · ')}`;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('itemindex')
    .setDescription(d('📚', 'Catalogue d’items — progression et paliers auto.'))
    .addUserOption((o) =>
      o.setName('membre').setDescription('Voir le catalogue d’un autre joueur (modération)').setRequired(false),
    ),
  async execute(interaction, ctx) {
    const uid = interaction.options.getUser('membre')?.id || interaction.user.id;
    const memberUser = interaction.options.getUser('membre') || interaction.user;
    if (
      uid !== interaction.user.id &&
      !ctx.isOwner() &&
      !interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)
    ) {
      return interaction.reply({ content: 'Tu ne peux consulter que ton propre catalogue.' });
    }

    await interaction.deferReply();
    const users = require('../services/users');
    users.getOrCreate(uid, memberUser.username);

    const sync = indexCollection.syncProgress(uid);
    if (interaction.guildId) {
      indexRoles.syncIndexFullRole(interaction.client, interaction.guildId, uid).catch(() => {});
    }

    const r = idx.getRow(uid);
    const claimed = idx.parseClaimed(r.claimed_json);
    const pct = r.completion_pct || 0;
    const displayName = interaction.guild?.members?.cache?.get(uid)?.displayName || memberUser.username;
    const avatarUrl = memberUser.displayAvatarURL({ extension: 'png', size: 256 });

    const buf = await renderIndexCard({
      displayName,
      avatarUrl,
      completionPct: pct,
      steps: idx.STEPS,
      claimed,
    });
    const file = new AttachmentBuilder(buf, { name: 'index_catalogue.png' });

    const payload = { files: [file] };
    if (sync.grant.newly.length) {
      const lines = sync.grant.newly.map(formatStepLine);
      const embed = new EmbedBuilder()
        .setColor(0x2ecc71)
        .setTitle('🎁 Paliers crédités automatiquement')
        .setDescription(
          [
            `Collection **${sync.owned}/${sync.total}** items · **${pct} %**`,
            '',
            ...lines,
            '',
            pct >= 100
              ? '**Index complet** — bonus permanents actifs + rôle Pipelette ultime si configuré.'
              : '_Les prochains paliers se valident dès que tu obtiens les items manquants._',
          ].join('\n'),
        );
      payload.embeds = [embed];
    }

    return interaction.editReply(payload);
  },
};
