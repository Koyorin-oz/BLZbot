const path = require('path');
const {
  SlashCommandBuilder,
  AttachmentBuilder,
  ContainerBuilder,
  MediaGalleryBuilder,
  TextDisplayBuilder,
  MessageFlags,
} = require('discord.js');
const temple = require('../services/temple');
const users = require('../services/users');

const RENDER = path.join(__dirname, '..', '..', '..', 'niveau', 'src', 'utils', 'canvas-skill-tree-reborn');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('temple')
    .setDescription('Points « temple » (carte canvas + rappel texte).')
    .addSubcommand((sc) => sc.setName('voir').setDescription('Points + statut (recalcul auto)'))
    .addSubcommand((sc) => sc.setName('sync').setDescription('Forcer le recalcul (serveur actuel)')),
  async execute(interaction) {
    // Défère immédiatement (canvas + fetch peuvent dépasser 3 s -> 10062).
    await interaction.deferReply();
    const uid = interaction.user.id;
    users.getOrCreate(uid, interaction.user.username);
    const hub = interaction.guildId || null;
    const r = temple.sync(uid, hub);
    const u = users.getUser(uid);

    let buf;
    try {
      const { renderTemplePng } = require(RENDER);
      buf = await renderTemplePng({
        points: r.points,
        keys: r.keys,
        templeUnlocked: Boolean(u.temple_unlocked),
      });
    } catch (e) {
      console.error('[temple canvas]', e);
    }

    if (buf) {
      const file = new AttachmentBuilder(buf, { name: 'temple_reborn.png' });
      const TOTAL_KEYS = 6;
      const have = r.keys.length;
      const t = new TextDisplayBuilder().setContent(
        [
          '# ⛩️ Temple',
          'Le **Temple** est le **sanctuaire des élus** — il rassemble les **6 plus grandes réussites** du serveur.',
          'Quand tu décroches **les 6 clés**, le temple **s’ouvre pour toi** et tu rejoins le cercle très fermé de ceux qui ont **tout maxé**.',
          '',
          '**Comment l’ouvrir ?** Réunis ces 6 sceaux :',
          '• `Maître des Voies` — 5/5 sur **toutes** les branches de `/arbre`',
          '• `Étoile Pourpre` — atteindre **100 000 RP**',
          '• `Cœur de Diamant` — détenir le **Diamant** (unique serveur)',
          '• `Codex Complet` — index de complétion à **100 %**',
          '• `Bannière Étoilée` — appartenir à une **guilde rang Star**',
          '• `Astre de Guilde` — accumuler **200 000 GRP**',
          '',
          u.temple_unlocked
            ? `**Statut** : 🔥 **Temple ouvert** — toutes les voies maîtrisées (${have}/${TOTAL_KEYS}).`
            : `**Statut** : 🔒 *Temple scellé* — **${have}/${TOTAL_KEYS}** clés réunies, continue à grimper.`,
        ].join('\n'),
      );
      const c = new ContainerBuilder();
      c.addMediaGalleryComponents(
        new MediaGalleryBuilder().addItems({ media: { url: 'attachment://temple_reborn.png' } }),
      );
      c.addTextDisplayComponents(t);
      return interaction.editReply({
        files: [file],
        components: [c],
        flags: MessageFlags.IsComponentsV2,
      });
    }

    const unlocked = u.temple_unlocked
      ? '**Temple débloqué** : les **5** branches de l’arbre sont complètes (5/5 chacune).'
      : '**Temple verrouillé** : termine **tous** les paliers des **5** branches (`/arbre`) pour l’ouvrir.';
    const { EmbedBuilder } = require('discord.js');
    const embed = new EmbedBuilder()
      .setColor(0x5b21b6)
      .setTitle('⛩️ Temple REBORN — points de réussite (texte)')
      .setDescription(
        [
          'Même sémantique que d’habitude, sans image (module **canvas** indisponible).',
          'Le **temple** compte des **réussites lourdes** — pas la monnaie du quotidien.',
        ].join('\n'),
      )
      .addFields(
        { name: 'Tes points', value: `**${r.points}**`, inline: true },
        { name: 'Statut', value: unlocked, inline: false },
        { name: 'Clés (sync)', value: r.keys.length ? r.keys.map((k) => `\`${k}\``).join(', ') : '—', inline: false },
      );
    return interaction.editReply({ embeds: [embed] });
  },
};
