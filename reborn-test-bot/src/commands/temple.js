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
const { d } = require('../lib/slashDesc');

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
    .setDescription(d('🏛️', 'Temple — points, sync et classement Roi/Légende.'))
    .addSubcommand((sc) => sc.setName('voir').setDescription(d('👁️', 'Points + statut (recalcul auto)')))
    .addSubcommand((sc) => sc.setName('sync').setDescription(d('🔄', 'Forcer le recalcul (serveur actuel)')))
    .addSubcommand((sc) =>
      sc.setName('classement').setDescription(d('👑', 'Classement Roi & Légende du Temple.')),
    ),
  async execute(interaction) {
    // Défère immédiatement (canvas + fetch peuvent dépasser 3 s -> 10062).
    await interaction.deferReply();
    const sub = interaction.options.getSubcommand();
    if (sub === 'classement') {
      const TOTAL = temple.TEMPLE_KEY_TOTAL;
      const roiMin = temple.CLASSEMENT_ROI_MIN_KEYS;
      const legMin = temple.CLASSEMENT_LEGENDE_MIN_KEYS;
      const legMax = temple.CLASSEMENT_LEGENDE_MAX_KEYS;
      const c = temple.classement(20);
      const fmtRow = (row, rank) => {
        const star = rank <= 3 ? '👑' : rank <= 10 ? '🌟' : '✦';
        return `${star} **${rank}.** <@${row.id}> — **${row.temple_points}**/${TOTAL}${row.temple_unlocked ? ' · 🔥 ouvert' : ''}`;
      };
      const lines = [];
      lines.push('# ⛩️ Classement Temple');
      lines.push(
        `👑 **Rois du Temple** (≥ **${roiMin}** clés sur **${TOTAL}** max) — l’élite avec la majorité des voies.`,
      );
      if (c.kings.length) {
        c.kings.slice(0, 10).forEach((r, i) => lines.push(fmtRow(r, i + 1)));
      } else {
        lines.push('*Aucun Roi sacré pour l’instant.*');
      }
      lines.push('');
      lines.push(
        `🌟 **Légendes** (**${legMin}**–**${legMax}** clés) — progression forte, pas encore au palier Roi.`,
      );
      if (c.legends.length) {
        c.legends.slice(0, 10).forEach((r, i) => lines.push(fmtRow(r, i + 1)));
      } else {
        lines.push('*Aucune entrée dans cette tranche pour l’instant.*');
      }
      const { EmbedBuilder } = require('discord.js');
      const e = new EmbedBuilder()
        .setTitle('⛩️ Classement Temple')
        .setColor(0xc0392b)
        .setDescription(lines.join('\n').slice(0, 4000));
      return interaction.editReply({ embeds: [e] });
    }
    const uid = interaction.user.id;
    users.getOrCreate(uid, interaction.user.username);
    const hub = interaction.guildId || null;
    const r = temple.sync(uid, hub);
    if (hub) {
      const tdr = require('../services/templeDiscordRoles');
      tdr.syncTempleRolesForUser(interaction.client, hub, uid).catch(() => {});
    }
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
      const st = temple.statusFor(uid, hub);
      const contentLines = ['# ⛩️ Temple'];
      if (u.temple_unlocked) {
        contentLines.push(`🔥 **Temple ouvert** — ${have}/${TOTAL_KEYS} clés.`);
        for (const s of st.sources) {
          contentLines.push(`${st.keys.has(s.id) ? '🟢' : '⬜'} ${s.name}`);
        }
      } else {
        const bar = st.sources.map((s) => (st.keys.has(s.id) ? '🟢' : '🔒')).join(' ');
        contentLines.push(`🔒 **Temple scellé** — ${have}/${TOTAL_KEYS} clés.`);
        contentLines.push(bar);
      }
      const t = new TextDisplayBuilder().setContent(contentLines.join('\n'));
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
