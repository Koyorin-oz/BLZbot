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
      const t = new TextDisplayBuilder().setContent(
        [
          '# ⛩️ Temple — **vue carte**',
          'Lecture rapide : **gros objectifs** & prestige (hors Starss/XP du jour). Synchronisé sur ce **sync**.',
          u.temple_unlocked
            ? '**État** : *débloqué* (5×5 sur toutes les branches de l’arbre).'
            : '**État** : *verrouillé* — remplis les **5** paliers de chaque **branche** (`/arbre`).',
        ].join('\n'),
      );
      const c = new ContainerBuilder();
      c.addMediaGalleryComponents(
        new MediaGalleryBuilder().addItems({ media: { url: 'attachment://temple_reborn.png' } }),
      );
      c.addTextDisplayComponents(t);
      c.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          '**Détail des clés** (dernier recalcul) : ' +
            (r.keys.length ? r.keys.map((k) => `\`${k}\``).join(', ') : '—') +
            '\n\n*En production, d’autres événements alimentent aussi le temple.*',
        ),
      );
      return interaction.reply({
        files: [file],
        components: [c],
        flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
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
    return interaction.reply({ embeds: [embed], ephemeral: true });
  },
};
