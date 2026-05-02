const path = require('path');
const {
  SlashCommandBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  ActionRowBuilder,
  ContainerBuilder,
  MediaGalleryBuilder,
  MessageFlags,
  TextDisplayBuilder,
} = require('discord.js');
const db = require('../db');
const pg = require('../services/playerGuilds');
const gm = require('../services/guildMember');
const users = require('../services/users');
const { label, grpRankFromTotal } = require('../reborn/grades');
const { totalToLevelState } = require('../reborn/xpCurve');

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

function safeNumBig(s) {
  try {
    return Number(BigInt(s || '0'));
  } catch {
    return 0;
  }
}

/**
 * Si la guilde est pontée (`niv_*`), retourne les données niveau authoritatives
 * (gxp, member_slots, treasury, upgrade_level, wars, treasury_capacity…).
 * Sinon retourne null → on utilisera les données REBORN.
 */
function fetchNiveauOriginal(rebornGuildId) {
  if (!String(rebornGuildId || '').startsWith('niv_')) return null;
  const niveauId = Number(String(rebornGuildId).slice(4));
  if (!Number.isFinite(niveauId) || niveauId <= 0) return null;
  try {
    const niv = require(path.join(__dirname, '..', '..', '..', 'niveau', 'src', 'utils', 'db-guilds'));
    const g = typeof niv.getGuildById === 'function' ? niv.getGuildById(niveauId) : null;
    return g || null;
  } catch {
    return null;
  }
}

/** Objet « guilde » compatible avec `renderGuildProfileV2` + champs REBORN optionnels canvas. */
function buildCanvasGuildViewModel(g, totalMembers) {
  const nivG = fetchNiveauOriginal(g.id);
  // Champs niveau (autorité) avec fallback sur REBORN si pas de pont.
  const treasuryNum = nivG ? Number(nivG.treasury || 0) : safeNumBig(g.treasury);
  const gxpNum = nivG ? Number(nivG.level || 0) : safeNumBig(g.gxp);
  const upgradeLevel = nivG ? Number(nivG.upgrade_level || 1) : 10;
  const treasuryCap = nivG && Number(nivG.treasury_capacity) > 0
    ? Number(nivG.treasury_capacity)
    : Math.max(treasuryNum * 2, 5_000_000);
  const memberSlots = nivG ? Number(nivG.member_slots || g.member_cap || 5) : (g.member_cap || 5);
  const warsWon = nivG ? Number(nivG.wars_won || 0) : 0;
  const warsWon70 = nivG ? Number(nivG.wars_won_70 || 0) : 0;
  const warsWon80 = nivG ? Number(nivG.wars_won_80 || 0) : 0;
  const warsWon90 = nivG ? Number(nivG.wars_won_90 || 0) : 0;
  const totalTreasuryGen = nivG ? Number(nivG.total_treasury_generated || 0) : treasuryNum;
  const channelId = nivG?.channel_id || g.salon_channel_id || null;
  const jokerUses = nivG ? Number(nivG.joker_guilde_uses || 0) : 0;
  const emoji = nivG?.emoji || '🛡️';
  const createdAt = nivG?.created_at || g.created_ms;
  let subChiefs = [];
  if (nivG?.sub_chiefs) {
    if (Array.isArray(nivG.sub_chiefs)) subChiefs = nivG.sub_chiefs;
    else if (typeof nivG.sub_chiefs === 'string') {
      try { subChiefs = JSON.parse(nivG.sub_chiefs) || []; } catch { subChiefs = []; }
    }
  }
  const treasuryMult = nivG ? Number(nivG.treasury_multiplier_purchased || 1) : 1;

  // Total value cohérent avec /profil bouton Guilde (basé sur niveau/users.total_value).
  let totalValue = treasuryNum + (gxpNum * 1000); // approximation
  if (nivG) {
    // Reproduit la formule niveau : addition des total_value des membres.
    try {
      const niv = require(path.join(__dirname, '..', '..', '..', 'niveau', 'src', 'utils', 'db-guilds'));
      if (typeof niv.getGuildMembersWithDetails === 'function') {
        const list = niv.getGuildMembersWithDetails(Number(String(g.id).slice(4)));
        totalValue = list.reduce((s, m) => s + Number(m.total_value || 0), 0);
      }
    } catch { /* ignore */ }
  }

  return {
    id: g.id,
    name: g.name || nivG?.name || 'Guilde',
    owner_id: g.leader_id || nivG?.owner_id,
    emoji,
    member_slots: memberSlots,
    member_cap: memberSlots,
    total_value: totalValue,
    upgrade_level: upgradeLevel,
    level: nivG ? Number(nivG.level || 1) : (g.guild_level || 1),
    treasury: treasuryNum,
    treasury_capacity: treasuryCap,
    treasury_multiplier_purchased: treasuryMult,
    total_treasury_generated: totalTreasuryGen,
    wars_won: warsWon,
    wars_won_70: warsWon70,
    wars_won_80: warsWon80,
    wars_won_90: warsWon90,
    channel_id: channelId,
    joker_guilde_uses: jokerUses,
    sub_chiefs: subChiefs,
    created_at: createdAt,
    reborn_extras: '',
    reborn_footer: '',
  };
}

async function buildMemberRowsForCanvas(interaction, memRows, leaderId) {
  const out = [];
  for (const { user_id } of memRows) {
    const row = users.getUser(user_id);
    let username = row?.username;
    if (!username || username === 'unknown') {
      try {
        const du = await interaction.client.users.fetch(user_id);
        username = du.username;
      } catch {
        username = 'Joueur';
      }
    }
    const stars = Number(users.getStars(user_id));
    const pts = Number(users.getPoints(user_id));
    out.push({
      user_id,
      username: username || 'Joueur',
      total_value: stars + pts,
    });
  }
  out.sort((a, b) => {
    if (a.user_id === leaderId) return -1;
    if (b.user_id === leaderId) return 1;
    return 0;
  });
  return out;
}

/**
 * Construit le payload `/profil-guilde` (canvas + boutons) pour un (hub, guild).
 * Réutilisable depuis :
 *  - la commande slash `/profil-guilde`
 *  - le bouton « 🛡️ Guilde » du `/profil` (niveau) intercepté par REBORN
 *
 * Retourne `{ payload, error }`. Si `error` est défini, c'est un message à
 * afficher au lieu du canvas.
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
  const members = await buildMemberRowsForCanvas(interaction, memRows, g.leader_id);
  const owner = await interaction.client.users.fetch(g.leader_id).catch(() => ({ username: 'Chef' }));
  const canvasGuild = buildCanvasGuildViewModel(g, totalMembers);

  let png;
  try {
    png = await renderGuildProfileV2({
      guild: canvasGuild,
      members: members.slice(0, 10),
      owner: owner || { username: 'Chef' },
      warInfo: null,
      totalMembers,
    });
  } catch (e) {
    console.error('[profil-guilde REBORN] canvas', e);
    return { error: `Impossible de générer l'image (canvas). \`${e?.message || e}\`` };
  }

  const file = new AttachmentBuilder(png, { name: 'guild_profile_reborn.png' });
  const mediaGallery = new MediaGalleryBuilder().addItems({
    media: { url: 'attachment://guild_profile_reborn.png' },
  });
  const container = new ContainerBuilder().addMediaGalleryComponents(mediaGallery);

  // Bandeau REBORN : grade, anti-séparation, focus.
  let antiSep = { protected: false, reason: '' };
  try {
    const ladder = require('../services/guildLadder');
    antiSep = ladder.antiSepStatus(g.id, hub);
  } catch { /* ignore */ }
  const focusDis = !!g.focus_disabled;
  const sepLine = antiSep.protected
    ? `🛡️ **Anti-séparation : oui** *(${antiSep.reason})*`
    : '⚔️ Anti-séparation : non';
  const focusLine = focusDis
    ? '🚫 Focus **désactivé** (admin)'
    : '🎯 Focus disponible (CD 7 j)';
  const reborn = new TextDisplayBuilder().setContent(
    [
      `**Grade REBORN** : ${label(g.grade || '')}`,
      sepLine,
      focusLine,
    ].join(' · '),
  );
  container.addTextDisplayComponents(reborn);

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
  container.addActionRowComponents(row1);

  return {
    payload: {
      files: [file],
      components: [container],
      flags: MessageFlags.IsComponentsV2,
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
    .setDescription("Affiche les informations d'une guilde (canvas BLZbot + champs REBORN).")
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
