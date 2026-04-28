const path = require('path');
const {
  SlashCommandBuilder,
  AttachmentBuilder,
  ContainerBuilder,
  MediaGalleryBuilder,
  TextDisplayBuilder,
  MessageFlags,
  Routes,
} = require('discord.js');
const temple = require('../services/temple');
const users = require('../services/users');

const RENDER = path.join(__dirname, '..', '..', '..', 'niveau', 'src', 'utils', 'canvas-skill-tree-reborn');

/**
 * Récupère l'URL de la PP du serveur principal BLZ même si le bot n'y est pas membre.
 * Ordre des tentatives :
 *   1. Cache local des guildes (bot membre).
 *   2. `client.guilds.fetch(id)` (bot membre).
 *   3. `GET /guilds/:id/preview` (fonctionne pour les serveurs lurkables/community).
 * Renvoie null si aucune source ne permet d'obtenir l'icône.
 */
async function fetchMainGuildIconUrl(client, guildId) {
  try {
    const cached = client.guilds.cache.get(guildId);
    if (cached?.iconURL) {
      const u = cached.iconURL({ extension: 'png', size: 256 });
      if (u) return u;
    }
  } catch { /* ignore */ }

  try {
    const g = await client.guilds.fetch(guildId);
    const u = g?.iconURL?.({ extension: 'png', size: 256 });
    if (u) return u;
  } catch { /* le bot n'est pas membre — on tente l'API preview ci-dessous */ }

  try {
    const preview = await client.rest.get(Routes.guildPreview(guildId));
    if (preview?.icon) {
      const ext = String(preview.icon).startsWith('a_') ? 'gif' : 'png';
      return `https://cdn.discordapp.com/icons/${guildId}/${preview.icon}.${ext}?size=256`;
    }
  } catch (e) {
    console.warn('[temple] guildPreview KO', guildId, e?.message || e);
  }

  return null;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('temple')
    .setDescription('Points « temple » (carte canvas + rappel texte).')
    .addSubcommand((sc) => sc.setName('voir').setDescription('Points + statut (recalcul auto)'))
    .addSubcommand((sc) => sc.setName('sync').setDescription('Forcer le recalcul (serveur actuel)'))
    .addSubcommand((sc) =>
      sc.setName('classement').setDescription('Classement Roi & Légende du Temple.'),
    ),
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
      // PP du serveur principal BLZ — toujours `1097110036192448656` (override possible via BLZ_MAIN_GUILD_ID).
      const MAIN_GUILD_ID = String(process.env.BLZ_MAIN_GUILD_ID || '1097110036192448656').trim();
      const guildIconUrl = await fetchMainGuildIconUrl(interaction.client, MAIN_GUILD_ID);
      buf = await renderTemplePng({
        points: r.points,
        keys: r.keys,
        templeUnlocked: Boolean(u.temple_unlocked),
        guildIconUrl,
      });
    } catch (e) {
      console.error('[temple canvas]', e);
    }

    if (buf) {
      const file = new AttachmentBuilder(buf, { name: 'temple_reborn.png' });
      const TOTAL_KEYS = temple.SOURCE_DEFS.length;
      const have = r.keys.length;
      const sourcesView = temple.publicLines(uid, hub);
      const t = new TextDisplayBuilder().setContent(
        [
          '# ⛩️ Temple',
          'Le **Temple** est le **sanctuaire des élus** — il rassemble les **plus grandes réussites** du serveur.',
          `Quand tu décroches **les ${TOTAL_KEYS} clés**, le temple **s’ouvre pour toi** et tu rejoins le cercle très fermé de ceux qui ont **tout maxé**.`,
          '',
          u.temple_unlocked
            ? `**Statut** : 🔥 **Temple ouvert** — toutes les voies maîtrisées (${have}/${TOTAL_KEYS}).`
            : `**Statut** : 🔒 *Temple scellé* — **${have}/${TOTAL_KEYS}** clés réunies. *Détails masqués jusqu’à l’ouverture.*`,
          '',
          ...sourcesView.lines,
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
