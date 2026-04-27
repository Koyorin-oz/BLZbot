const path = require('path');
const {
  SlashCommandBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  ActionRowBuilder,
  ComponentType,
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

/** Objet « guilde » compatible avec `renderGuildProfileV2` + champs REBORN optionnels canvas. */
function buildCanvasGuildViewModel(g, totalMembers) {
  const treasuryN = safeNumBig(g.treasury);
  const gxpN = safeNumBig(g.gxp);
  const cap = Math.max(treasuryN * 2, 5_000_000);
  const gradeLbl = label(g.grade || '') || '—';
  return {
    id: g.id,
    name: g.name || 'Guilde',
    owner_id: g.leader_id,
    emoji: '🛡️',
    member_slots: g.member_cap || 5,
    member_cap: g.member_cap || 5,
    total_value: gxpN + treasuryN,
    upgrade_level: 10,
    level: g.guild_level || 1,
    treasury: treasuryN,
    treasury_capacity: cap,
    treasury_multiplier_purchased: 1,
    total_treasury_generated: treasuryN,
    wars_won: 0,
    wars_won_70: 0,
    wars_won_80: 0,
    wars_won_90: 0,
    channel_id: null,
    joker_guilde_uses: 0,
    sub_chiefs: [],
    created_at: g.created_ms,
    reborn_extras: `REBORN · Grade ${gradeLbl} · GXP ${BigInt(g.gxp || '0').toLocaleString('fr-FR')} · Anti-séparation ${g.anti_separation ? 'oui' : 'non'}`,
    reborn_footer:
      '💡 REBORN — boutons : liste complète des membres · stats guilde (GXP, trésorerie, GRP chef…)',
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

module.exports = {
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
    const uid = interaction.user.id;
    const raw = interaction.options.getString('nom');
    let gRow = null;
    if (raw && raw.trim()) {
      gRow = findGuildOnHub(hub, raw);
      if (!gRow) {
        return interaction.reply({ content: 'Guilde introuvable sur ce serveur (nom ou ID).' });
      }
    } else {
      const m = pg.getMembershipInHub(uid, hub);
      if (!m) {
        return interaction.reply({
          content: 'Tu n’es dans aucune guilde **joueur** sur ce serveur. Indique un **nom** ou **ID** (`/guilde liste`).',
          
        });
      }
      gRow = pg.getGuild(m.guild_id);
    }
    const g = pg.getGuild(gRow.id);
    if (!g || g.hub_discord_id !== hub) {
      return interaction.reply({ content: 'Guilde invalide.' });
    }

    await interaction.deferReply();

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
      const err = new TextDisplayBuilder().setContent(
        `❌ Impossible de générer l’image (canvas). Vérifie \`canvas\` à la racine du repo (\`npm install\`).\n\`${e?.message || e}\``,
      );
      return interaction.editReply({
        components: [new ContainerBuilder().addTextDisplayComponents(err)],
        flags: MessageFlags.IsComponentsV2,
      });
    }

    const file = new AttachmentBuilder(png, { name: 'guild_profile_reborn.png' });
    const mediaGallery = new MediaGalleryBuilder().addItems({
      media: { url: 'attachment://guild_profile_reborn.png' },
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
    container.addActionRowComponents(row1);

    await interaction.editReply({
      files: [file],
      components: [container],
      flags: MessageFlags.IsComponentsV2,
    });

    const message = await interaction.fetchReply();
    const collector = message.createMessageComponentCollector({
      componentType: ComponentType.Button,
      time: 10 * 60 * 1000,
      filter: (i) => i.user.id === interaction.user.id,
    });

    collector.on('collect', async (i) => {
      try {
        const gid = i.customId.split('_').pop();
        const gFresh = pg.getGuild(gid);
        if (!gFresh || gFresh.hub_discord_id !== i.guildId) {
          return i.reply({ content: 'Guilde invalide.' });
        }
        if (i.customId.startsWith('rb_pg_list_')) {
          await i.deferUpdate();
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
          await i.deferUpdate();
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
            '',
            '### Équivalences affichage BLZbot (image)',
            'Valeur 💎, upgrade, trésor et guerres sur le **canvas** reprennent la mise en forme du bot principal ; les chiffres sont **dérivés** des données REBORN + membres (stars/points) pour l’icône valeur membre.',
          ].join('\n');
          const td = new TextDisplayBuilder().setContent(statsText);
          await i.followUp({
            components: [new ContainerBuilder().addTextDisplayComponents(td)],
            flags: MessageFlags.IsComponentsV2,
            
          });
        } else if (i.customId.startsWith('rb_pg_quests_')) {
          await i.deferUpdate();
          const questText = new TextDisplayBuilder().setContent(
            [
              `# 📜 Quêtes — ${gFresh.name}`,
              '• **REBORN** : pas de « quêtes de guilde » type BLZ (table dédiée) sur ce build.',
              '• **Quêtes perso** : \`/quete\` (sandbox).',
              '• *Les pastilles guerre / salon du canvas sont des rappels visuels (données hub principal non liées ici).*',
            ].join('\n'),
          );
          await i.followUp({
            components: [new ContainerBuilder().addTextDisplayComponents(questText)],
            flags: MessageFlags.IsComponentsV2,
            
          });
        }
      } catch (err) {
        console.error('[profil-guilde button]', err);
        await i.reply({ content: '❌ Erreur.' }).catch(() => {});
      }
    });
  },
};
