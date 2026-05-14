const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ComponentType,
} = require('discord.js');
const db = require('../db');
const users = require('../services/users');
const playerGuilds = require('../services/playerGuilds');
const rankedRoles = require('../services/rankedRoles');
const ladder = require('../services/guildLadder');
const { label: gradeLabel, grpRankFromTotal } = require('../reborn/grades');

/**
 * Types de classement. Le menu permet de basculer sans relancer la commande.
 */
const TYPES = {
  starss: {
    label: '💸 Starss',
    emoji: '💸',
    color: 0xf1c40f,
    unit: 'starss',
    description: 'Classement par solde de starss courant.',
  },
  niveau: {
    label: '⭐ Niveau (XP)',
    emoji: '⭐',
    color: 0x3498db,
    unit: 'niveau',
    description: 'Classement par niveau XP joueur (XP total en départage).',
  },
  rp: {
    label: '⚔️ Ranked RP',
    emoji: '⚔️',
    color: 0xe74c3c,
    unit: 'RP',
    description: 'Classement par Ranked Points (tier Bronze → Apex).',
  },
  guildes: {
    label: '🏰 Guildes (GRP total)',
    emoji: '🏰',
    color: 0xe67e22,
    unit: 'GRP guilde',
    description: 'Guildes REBORN du serveur, triées par somme des GRP des membres.',
  },
  grp_membres: {
    label: '📊 Joueurs (GRP perso)',
    emoji: '📊',
    color: 0x9b59b6,
    unit: 'GRP',
    description: 'Joueurs du serveur triés par leur total GRP personnel (saison hub).',
  },
};

/** Construit l'embed pour un type donné. Renvoie aussi le rang perso de l'auteur. */
function buildEmbed(type, hub, requesterId) {
  const def = TYPES[type] || TYPES.starss;
  let lines = [];
  let myRankLine = '';

  if (type === 'guildes') {
    const top = ladder.ladderForHub(hub).slice(0, 10);
    if (!top.length) {
      lines = ['*Aucune guilde sur ce serveur.*'];
    } else {
      lines = top.map((g, i) => {
        const star = i < 3 ? ['🥇', '🥈', '🥉'][i] : `**${i + 1}.**`;
        return `${star} **${g.name}** \`${g.id}\` — nv **${g.guild_level}** — grade **${gradeLabel(g.grade || '')}** — **${g.totalGrp.toLocaleString('fr-FR')}** GRP total · ${g.members} membre(s)`;
      });
    }
    const myMembership = playerGuilds.getMembershipInHub(requesterId, hub);
    if (myMembership) {
      const full = ladder.ladderForHub(hub);
      const myIdx = full.findIndex((g) => g.id === myMembership.guild_id);
      if (myIdx >= 0) {
        const me = full[myIdx];
        myRankLine = `\n\n*Ta guilde **${me.name}** : **${me.totalGrp.toLocaleString('fr-FR')}** GRP total — rang **#${myIdx + 1}**.*`;
      }
    }
    return new EmbedBuilder()
      .setTitle(`${def.emoji} Classement — ${def.label}`)
      .setColor(def.color)
      .setDescription(lines.join('\n') + myRankLine)
      .setFooter({ text: `${def.description} · Top 3 = protection anti-séparation (ladder).` });
  }

  if (type === 'grp_membres') {
    const rows = db.prepare('SELECT user_id, grp FROM guild_member_gxp WHERE guild_id = ?').all(hub);
    const sorted = rows
      .map((r) => ({ user_id: r.user_id, grp: users.B(r.grp) }))
      .sort((a, b) => (a.grp < b.grp ? 1 : a.grp > b.grp ? -1 : 0));
    const top = sorted.slice(0, 10);
    lines = top.map((r, i) => {
      const star = i < 3 ? ['🥇', '🥈', '🥉'][i] : `**${i + 1}.**`;
      const rk = grpRankFromTotal(r.grp);
      const rkL = rk ? gradeLabel(rk) : '—';
      return `${star} <@${r.user_id}> — **${r.grp.toLocaleString('fr-FR')}** GRP · palier **${rkL}**`;
    });
    if (!lines.length) lines = ['*Aucune donnée GRP sur ce serveur.*'];
    const myPos = sorted.findIndex((r) => r.user_id === requesterId);
    if (myPos >= 0) {
      const me = sorted[myPos];
      const rk = grpRankFromTotal(me.grp);
      const rkL = rk ? gradeLabel(rk) : '—';
      myRankLine = `\n\n*Ton rang : **#${myPos + 1}** — **${me.grp.toLocaleString('fr-FR')}** GRP · palier **${rkL}**.*`;
    }
    return new EmbedBuilder()
      .setTitle(`${def.emoji} Classement — ${def.label}`)
      .setColor(def.color)
      .setDescription(lines.join('\n') + myRankLine)
      .setFooter({ text: `${def.description} · Saison reset 1er du mois (UTC).` });
  }

  // Classements joueur (starss / niveau / rp)
  let sql;
  if (type === 'starss') {
    sql = `SELECT id, username, CAST(stars AS INTEGER) AS score FROM users ORDER BY CAST(stars AS INTEGER) DESC LIMIT 10`;
  } else if (type === 'niveau') {
    sql = `SELECT id, username, level AS score, xp_total AS xptot FROM users ORDER BY level DESC, xp_total DESC LIMIT 10`;
  } else if (type === 'rp') {
    sql = `SELECT id, username, CAST(points AS INTEGER) AS score FROM users ORDER BY CAST(points AS INTEGER) DESC LIMIT 10`;
  } else {
    sql = `SELECT id, username, CAST(stars AS INTEGER) AS score FROM users ORDER BY CAST(stars AS INTEGER) DESC LIMIT 10`;
  }
  const rowList = db.prepare(sql).all();
  lines = rowList.map((r, i) => {
    const star = i < 3 ? ['🥇', '🥈', '🥉'][i] : `**${i + 1}.**`;
    let extra = '';
    if (type === 'niveau' && r.xptot) extra = ` (XP total ${Number(r.xptot).toLocaleString('fr-FR')})`;
    if (type === 'rp') {
      const tier = rankedRoles.tierForRp(BigInt(r.score || 0));
      const tierDef = rankedRoles.TIER_DEFS.find((t) => t.key === tier);
      extra = ` · **${tierDef?.label || tier}**`;
    }
    return `${star} <@${r.id}> — **${BigInt(r.score || 0).toLocaleString('fr-FR')}** ${def.unit}${extra}`;
  });

  try {
    let countSql;
    let myValSql;
    if (type === 'starss') {
      countSql = `SELECT COUNT(*) AS c FROM users WHERE CAST(stars AS INTEGER) > (SELECT CAST(stars AS INTEGER) FROM users WHERE id = ?)`;
      myValSql = `SELECT CAST(stars AS INTEGER) AS v FROM users WHERE id = ?`;
    } else if (type === 'niveau') {
      countSql = `SELECT COUNT(*) AS c FROM users WHERE (level > (SELECT level FROM users WHERE id = ?)) OR (level = (SELECT level FROM users WHERE id = ?) AND xp_total > (SELECT xp_total FROM users WHERE id = ?))`;
      myValSql = `SELECT level AS v, xp_total AS xptot FROM users WHERE id = ?`;
    } else if (type === 'rp') {
      countSql = `SELECT COUNT(*) AS c FROM users WHERE CAST(points AS INTEGER) > (SELECT CAST(points AS INTEGER) FROM users WHERE id = ?)`;
      myValSql = `SELECT CAST(points AS INTEGER) AS v FROM users WHERE id = ?`;
    }
    let myRank;
    let myVal;
    if (type === 'niveau') {
      myRank = db.prepare(countSql).get(requesterId, requesterId, requesterId).c;
      const m = db.prepare(myValSql).get(requesterId);
      myVal = `${m?.v || 0} (XP ${Number(m?.xptot || 0).toLocaleString('fr-FR')})`;
    } else {
      myRank = db.prepare(countSql).get(requesterId).c;
      const m = db.prepare(myValSql).get(requesterId);
      myVal = BigInt(m?.v || 0).toLocaleString('fr-FR');
    }
    myRankLine = `\n\n*Ton rang : **#${(myRank ?? 0) + 1}** — **${myVal}** ${def.unit}.*`;
  } catch {
    /* ignore */
  }

  return new EmbedBuilder()
    .setTitle(`${def.emoji} Classement — ${def.label}`)
    .setColor(def.color)
    .setDescription((lines.length ? lines.join('\n') : '*Aucune donnée.*') + myRankLine)
    .setFooter({ text: def.description });
}

function buildSelect(currentType) {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('rb_classement_type')
      .setPlaceholder('Changer de classement')
      .addOptions(
        Object.entries(TYPES).map(([key, d]) => ({
          label: d.label,
          description: d.description.slice(0, 100),
          value: key,
          default: key === currentType,
        })),
      ),
  );
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('classement')
    .setDescription('Classements : Starss, XP, Ranked RP, guildes GRP, joueurs GRP.')
    .addStringOption((o) =>
      o
        .setName('type')
        .setDescription('Vue affichée en premier (défaut : Starss).')
        .setRequired(false)
        .addChoices(
          { name: '💸 Starss', value: 'starss' },
          { name: '⭐ Niveau XP', value: 'niveau' },
          { name: '⚔️ Ranked RP', value: 'rp' },
          { name: '🏰 Guildes (GRP total)', value: 'guildes' },
          { name: '📊 Joueurs (GRP perso)', value: 'grp_membres' },
        ),
    ),

  async execute(interaction) {
    const hub = interaction.guildId;
    if (!hub) return interaction.reply({ content: 'Sur un serveur uniquement.' });
    users.getOrCreate(interaction.user.id, interaction.user.username);
    let currentType = interaction.options.getString('type') || 'starss';
    if (currentType === 'grp') currentType = 'guildes';
    if (!TYPES[currentType]) currentType = 'starss';
    const embed = buildEmbed(currentType, hub, interaction.user.id);
    await interaction.reply({ embeds: [embed], components: [buildSelect(currentType)] });
    const msg = await interaction.fetchReply();

    const collector = msg.createMessageComponentCollector({
      componentType: ComponentType.StringSelect,
      time: 5 * 60 * 1000,
    });

    collector.on('collect', async (i) => {
      if (i.user.id !== interaction.user.id) {
        return i.reply({
          content: "Seul l'auteur du classement peut changer le type. Lance `/classement` pour le tien.",
          ephemeral: true,
        });
      }
      if (i.customId !== 'rb_classement_type') return;
      currentType = i.values[0];
      const e2 = buildEmbed(currentType, hub, interaction.user.id);
      await i.update({ embeds: [e2], components: [buildSelect(currentType)] });
    });

    collector.on('end', async () => {
      try {
        await msg.edit({ components: [] });
      } catch {
        /* ignore */
      }
    });
  },
};
