const {
  SlashCommandBuilder,
  EmbedBuilder,
  ButtonBuilder,
  ButtonStyle,
  ActionRowBuilder,
  ContainerBuilder,
  MessageFlags,
  TextDisplayBuilder,
  AttachmentBuilder,
  MediaGalleryBuilder,
} = require('discord.js');
const path = require('path');
const db = require('../db');
const pg = require('../services/playerGuilds');
const gm = require('../services/guildMember');
const users = require('../services/users');
const { label, grpRankFromTotal, nextGrade } = require('../reborn/grades');
const { totalToLevelState } = require('../reborn/xpCurve');
const ladder = require('../services/guildLadder');
const { d } = require('../lib/slashDesc');

const { renderGuildProfileV2 } = require(path.join(
  __dirname,
  '..',
  '..',
  '..',
  'niveau',
  'src',
  'utils',
  'canvas-guild-profile-v2',
));

function findGuildOnHub(hubDiscordId, nomOrId) {
  const q = String(nomOrId || '').trim().toLowerCase();
  if (!q) return null;
  const list = pg.listGuildsOnHub(hubDiscordId);
  const byId = list.find((g) => g.id === nomOrId.trim());
  if (byId) return byId;
  return list.find((g) => String(g.name || '').toLowerCase().includes(q)) || null;
}

/** Membres triés (chef en tête) avec pseudo + niveau joueur, pour l'aperçu. */
async function buildMemberRows(interaction, memRows, leaderId) {
  const out = [];
  for (const { user_id } of memRows) {
    const row = users.getUser(user_id);
    let username = row?.username;
    if (!username || username === 'unknown') {
      try {
        username = (await interaction.client.users.fetch(user_id)).username;
      } catch {
        username = 'Joueur';
      }
    }
    out.push({
      user_id,
      username: username || 'Joueur',
      level: row ? totalToLevelState(row.xp_total ?? 0).level : 1,
    });
  }
  out.sort((a, b) => {
    if (a.user_id === leaderId) return -1;
    if (b.user_id === leaderId) return 1;
    return b.level - a.level;
  });
  return out;
}

function getSubLeaderIds(guildId) {
  return db
    .prepare('SELECT user_id FROM player_guild_members WHERE guild_id = ? AND is_sub_leader = 1')
    .all(guildId)
    .map((r) => r.user_id);
}

/** Adapte une guilde REBORN au format attendu par le canvas V5. */
function mapRebornGuildForCanvas(g, { cap, treasury, gxp, grade, next, sep, totalMembers }) {
  const treasuryN = Number(treasury);
  const gxpN = Number(gxp);
  const gradeLabel = label(g.grade || '') || 'Aucun';
  const nextLabel = next ? label(next) : null;
  return {
    id: g.id,
    name: g.name,
    emoji: g.icon_url && !String(g.icon_url).includes('<') ? g.icon_url : '🛡️',
    owner_id: g.leader_id,
    sub_chiefs: getSubLeaderIds(g.id),
    level: g.guild_level || 1,
    member_slots: cap,
    treasury: treasuryN,
    treasury_capacity: Math.max(treasuryN + 1_000_000, 1_500_000),
    upgrade_level: 10,
    total_value: gxpN,
    treasury_multiplier_purchased: 1,
    total_treasury_generated: treasuryN,
    wars_won: 0,
    wars_won_70: 0,
    wars_won_80: 0,
    wars_won_90: 0,
    channel_id: g.salon_channel_id || null,
    joker_guilde_uses: 0,
    created_at: g.created_ms || Date.now(),
    reborn_mode: true,
    reborn_gxp: gxpN,
    reborn_grade_line: `Grade ${gradeLabel}${nextLabel ? ` → ${nextLabel}` : ' (max)'}`,
    reborn_salon_hint: g.salon_channel_id ? 'Actif' : `Non débloqué (grade ${label(pg.SALON_MIN_GRADE)})`,
    reborn_extras: `Anti-séparation: ${sep.protected ? 'oui' : 'non'} · ID \`${g.id}\`${g.description ? ` · ${String(g.description).slice(0, 80)}` : ''}`,
    reborn_footer: 'REBORN · Utilise les boutons pour la liste, les carrières et les quêtes',
  };
}

/**
 * Construit le payload `/profil-guilde` (canvas V5 + boutons REBORN).
 * Réutilisable depuis :
 *  - la commande slash `/profil-guilde`
 *  - le bouton « 🛡️ Guilde » du `/profil` (niveau) intercepté par REBORN
 *
 * Retourne `{ payload, error }`. Toutes les valeurs viennent de la base REBORN
 * (`player_guilds`), pour rester cohérentes avec `/guilde info`.
 */
async function buildProfilGuildePayload(interaction, { hub, gRow }) {
  const g = pg.getGuild(gRow.id);
  if (!g || g.hub_discord_id !== hub) {
    return { error: 'Guilde invalide.' };
  }
  const memRows = db
    .prepare('SELECT user_id, joined_ms FROM player_guild_members WHERE guild_id = ? ORDER BY joined_ms')
    .all(g.id);
  const totalMembers = memRows.length;
  const cap = pg.effectiveMemberCap(g);
  const members = await buildMemberRows(interaction, memRows, g.leader_id);

  const treasury = BigInt(g.treasury || '0');
  const gxp = BigInt(g.gxp || '0');
  const grade = label(g.grade || '') || 'Aucun';
  const next = nextGrade(g.grade || '');
  const sep = ladder.antiSepStatus(g.id, hub);

  const owner = await interaction.client.users.fetch(g.leader_id).catch(() => null);
  const canvasGuild = mapRebornGuildForCanvas(g, {
    cap,
    treasury,
    gxp,
    grade,
    next,
    sep,
    totalMembers,
  });
  const canvasMembers = members.map((m) => ({
    user_id: m.user_id,
    username: m.username,
    level: m.level,
    total_value: 0,
  }));

  let png;
  try {
    png = await renderGuildProfileV2({
      guild: canvasGuild,
      members: canvasMembers,
      owner: owner || { username: members.find((m) => m.user_id === g.leader_id)?.username || 'Chef' },
      warInfo: null,
      totalMembers,
    });
  } catch (e) {
    console.error('[profil-guilde canvas]', e?.message || e);
    return { error: 'Impossible de générer le canvas profil guilde.' };
  }

  const file = new AttachmentBuilder(png, { name: 'guild_profile_v2.png' });
  const mediaGallery = new MediaGalleryBuilder().addItems({
    media: { url: 'attachment://guild_profile_v2.png' },
  });
  const container = new ContainerBuilder().addMediaGalleryComponents(mediaGallery);

  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`rb_pg_list_${g.id}`)
      .setLabel('Liste complète')
      .setEmoji('📋')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`rb_pg_careers_${g.id}`)
      .setLabel('Carrières')
      .setEmoji('🎓')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`rb_pg_quests_${g.id}`)
      .setLabel('Quêtes')
      .setEmoji('📜')
      .setStyle(ButtonStyle.Success),
  );

  return {
    payload: {
      embeds: [embed],
      components: [row1],
    },
    g,
  };
}

/**
 * Résout la guilde à afficher quand on appuie sur le bouton « Guilde » du
 * /profil niveau. Le customId fournit l'ID niveau brut → on tente d'abord la
 * version pontée `niv_<id>`, puis fallback sur la membership REBORN.
 */
function resolveGuildForProfilButton(hub, userId, niveauGuildId) {
  const bridgedId = `niv_${niveauGuildId}`;
  let g = pg.getGuild(bridgedId);
  if (g && g.hub_discord_id === hub) return g;
  // fallback : chercher via la membership REBORN sur ce hub
  const m = pg.getMembershipInHub(userId, hub);
  if (m) {
    g = pg.getGuild(m.guild_id);
    if (g && g.hub_discord_id === hub) return g;
  }
  return null;
}

module.exports = {
  buildProfilGuildePayload,
  resolveGuildForProfilButton,
  data: new SlashCommandBuilder()
    .setName('profil-guilde')
    .setDescription(d('🛡️', 'Profil visuel d’une guilde — stats et actions.'))
    .addStringOption((o) =>
      o
        .setName('nom')
        .setDescription('Nom ou ID de la guilde (défaut : la tienne sur ce serveur)')
        .setRequired(false),
    ),
  async execute(interaction) {
    const hub = interaction.guildId;
    if (!hub) {
      return interaction.reply({ content: 'Serveur uniquement.' });
    }
    // Defer FIRST pour éviter le timeout 3s (les lookups guild peuvent être lents
    // à cause du pont niveau au premier appel).
    try {
      if (!interaction.deferred && !interaction.replied) await interaction.deferReply();
    } catch {
      return; // interaction expirée — abandon silencieux
    }
    const uid = interaction.user.id;
    const raw = interaction.options.getString('nom');
    let gRow = null;
    if (raw && raw.trim()) {
      gRow = findGuildOnHub(hub, raw);
      if (!gRow) {
        return interaction.editReply({ content: 'Guilde introuvable sur ce serveur (nom ou ID).' });
      }
    } else {
      const m = pg.getMembershipInHub(uid, hub);
      if (!m) {
        return interaction.editReply({
          content: 'Tu n’es dans aucune guilde **joueur** sur ce serveur. Indique un **nom** ou **ID** (`/guilde liste`).',
        });
      }
      gRow = pg.getGuild(m.guild_id);
    }
    const built = await buildProfilGuildePayload(interaction, { hub, gRow });
    if (built.error) {
      return interaction.editReply({ content: built.error });
    }
    await interaction.editReply(built.payload);
  },
};

/**
 * Handler global pour les boutons rb_pg_list_/careers_/quests_ rendus dans le
 * canvas /profil-guilde (qu'il vienne de la slash command ou du bouton Guilde
 * du /profil niveau).
 */
async function handleRebornGuildButton(i) {
  const gid = i.customId.split('_').pop();
  const gFresh = pg.getGuild(gid);
  if (!gFresh || gFresh.hub_discord_id !== i.guildId) {
    return i.reply({ content: 'Guilde invalide.' }).catch(() => {});
  }
  if (i.customId.startsWith('rb_pg_list_')) {
    if (!i.deferred && !i.replied) await i.deferUpdate();
    const rows = db
      .prepare('SELECT user_id, joined_ms FROM player_guild_members WHERE guild_id = ? ORDER BY joined_ms')
      .all(gFresh.id);
    const lines = [];
    for (let idx = 0; idx < rows.length; idx++) {
      const { user_id } = rows[idx];
      const mark = user_id === gFresh.leader_id ? '👑' : '👤';
      const urow = users.getUser(user_id);
      let un = urow?.username;
      if (!un || un === 'unknown') {
        try {
          un = (await i.client.users.fetch(user_id)).username;
        } catch {
          un = '?';
        }
      }
      const st = users.getUser(user_id);
      const lv = st ? totalToLevelState(st.xp_total ?? 0).level : 1;
      lines.push(`${idx + 1}. ${mark} **${un}** — nv ${lv}`);
    }
    const listText = new TextDisplayBuilder().setContent(
      `# 📋 Membres — ${gFresh.name}\n${lines.join('\n') || 'Aucun.'}\n\n*Total : **${rows.length}** / **${gFresh.member_cap}***`,
    );
    await i.followUp({
      components: [new ContainerBuilder().addTextDisplayComponents(listText)],
      flags: MessageFlags.IsComponentsV2,
    });
  } else if (i.customId.startsWith('rb_pg_careers_')) {
    if (!i.deferred && !i.replied) await i.deferUpdate();
    const hub = i.guildId;
    const nMem = db.prepare('SELECT COUNT(*) AS c FROM player_guild_members WHERE guild_id = ?').get(gFresh.id).c;
    const { grp } = gm.getMemberRow(hub, gFresh.leader_id);
    const rk = grpRankFromTotal(grp);
    const treasuryB = BigInt(gFresh.treasury || '0');
    const gxpB = BigInt(gFresh.gxp || '0');
    const statsText = [
      `# 🎓 Carrières & progression — ${gFresh.name}`,
      '### REBORN (guilde joueur)',
      `• **ID** \`${gFresh.id}\` · **Grade** ${label(gFresh.grade || '') || '—'}`,
      `• **GXP (guilde)** ${gxpB.toLocaleString('fr-FR')} · **Trésorerie** ${treasuryB.toLocaleString('fr-FR')} starss`,
      `• **Niveau guilde** ${gFresh.guild_level} · **Membres** ${nMem} / **${gFresh.member_cap}**`,
      `• **Anti-séparation** : ${gFresh.anti_separation ? 'oui' : 'non'} · Dernier focus (ms) : \`${gFresh.last_focus_ms || 0}\``,
      `• **GRP chef** (indicatif serveur) : ${rk || '—'}`,
    ].join('\n');
    const td = new TextDisplayBuilder().setContent(statsText);
    await i.followUp({
      components: [new ContainerBuilder().addTextDisplayComponents(td)],
      flags: MessageFlags.IsComponentsV2,
    });
  } else if (i.customId.startsWith('rb_pg_quests_')) {
    if (!i.deferred && !i.replied) await i.deferUpdate();
    const questText = new TextDisplayBuilder().setContent(
      [
        `# 📜 Quêtes — ${gFresh.name}`,
        '• **REBORN** : pas de « quêtes de guilde » spécifiques sur ce build.',
        '• **Quêtes perso** : `/quetes` (panneau unifié).',
      ].join('\n'),
    );
    await i.followUp({
      components: [new ContainerBuilder().addTextDisplayComponents(questText)],
      flags: MessageFlags.IsComponentsV2,
    });
  }
}

module.exports.handleRebornGuildButton = handleRebornGuildButton;
