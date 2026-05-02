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
const { label: gradeLabel } = require('../reborn/grades');

/**
 * Définitions des classements supportés. La même commande change de type via
 * un menu déroulant (5 minutes d'écoute), ce qui évite à l'utilisateur de
 * relancer `/classement` pour chaque vue.
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
  grp: {
    label: '🛡️ GRP guildes',
    emoji: '🛡️',
    color: 0x9b59b6,
    unit: 'GRP',
    description: 'Classement des guildes du serveur par GRP total (saison en cours).',
  },
};

/** Construit l'embed pour un type donné. Renvoie aussi le rang perso de l'auteur. */
function buildEmbed(type, hub, requesterId) {
  const def = TYPES[type] || TYPES.starss;
  let lines = [];
  let myRankLine = '';

  if (type === 'grp') {
    const guilds = playerGuilds.listGuildsOnHub(hub);
    const enriched = guilds
      .map((g) => {
        const grp = db
          .prepare(
            'SELECT COALESCE(SUM(CAST(grp AS INTEGER)), 0) AS s FROM guild_member_gxp WHERE guild_id = ?',
          )
          .get(g.id).s;
        const members = db
          .prepare('SELECT COUNT(*) AS c FROM player_guild_members WHERE guild_id = ?')
          .get(g.id).c;
        return { id: g.id, name: g.name, grade: g.grade || '', level: g.guild_level || 1, score: BigInt(grp), members };
      })
      .sort((a, b) => (a.score > b.score ? -1 : a.score < b.score ? 1 : 0));
    lines = enriched.slice(0, 10).map((g, i) => {
      const star = i < 3 ? ['🥇', '🥈', '🥉'][i] : `**${i + 1}.**`;
      return `${star} **${g.name}** — **${g.score.toLocaleString('fr-FR')}** GRP · grade ${gradeLabel(g.grade)} · nv ${g.level} · ${g.members} membre(s)`;
    });
    const myMembership = playerGuilds.getMembershipInHub(requesterId, hub);
    if (myMembership) {
      const myIdx = enriched.findIndex((g) => g.id === myMembership.guild_id);
      if (myIdx >= 0) {
        const me = enriched[myIdx];
        myRankLine = `\n\n*Ta guilde **${me.name}** : **${me.score.toLocaleString('fr-FR')}** GRP — rang **#${myIdx + 1}**.*`;
      }
    }
    return new EmbedBuilder()
      .setTitle(`${def.emoji} Classement — ${def.label}`)
      .setColor(def.color)
      .setDescription(
        (lines.length ? lines.join('\n') : '*Aucune guilde sur ce serveur.*') + myRankLine,
      )
      .setFooter({ text: `${def.description} · Saison reset 1er du mois.` });
  }

  // Classements joueur (starss / niveau / rp) — même schéma : top 10 + ton rang.
  let sql;
  let scoreCol = 'score';
  if (type === 'starss') {
    sql = `SELECT id, username, CAST(stars AS INTEGER) AS score FROM users ORDER BY CAST(stars AS INTEGER) DESC LIMIT 10`;
  } else if (type === 'niveau') {
    sql = `SELECT id, username, level AS score, xp_total AS xptot FROM users ORDER BY level DESC, xp_total DESC LIMIT 10`;
  } else if (type === 'rp') {
    sql = `SELECT id, username, CAST(points AS INTEGER) AS score FROM users ORDER BY CAST(points AS INTEGER) DESC LIMIT 10`;
  }
  const rows = db.prepare(sql).all();
  lines = rows.map((r, i) => {
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

  // Rang perso (calcul brut sans LIMIT pour trouver la position exacte).
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
    /* ignore — rang perso est best-effort */
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
        Object.entries(TYPES).map(([key, def]) => ({
          label: def.label,
          description: def.description.slice(0, 100),
          value: key,
          default: key === currentType,
        })),
      ),
  );
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('classement')
    .setDescription('Classements REBORN : Starss, Niveau XP, Ranked RP, GRP guildes.')
    .addStringOption((o) =>
      o
        .setName('type')
        .setDescription('Type de classement à afficher en premier (par défaut : Starss).')
        .setRequired(false)
        .addChoices(
          { name: '💸 Starss', value: 'starss' },
          { name: '⭐ Niveau XP', value: 'niveau' },
          { name: '⚔️ Ranked RP', value: 'rp' },
          { name: '🛡️ GRP guildes', value: 'grp' },
        ),
    ),

  async execute(interaction) {
    const hub = interaction.guildId;
    if (!hub) return interaction.reply({ content: 'Sur un serveur uniquement.' });
    // S'assure que l'auteur a une entrée DB pour que « ton rang » ne dise pas « #1 — 0 ».
    users.getOrCreate(interaction.user.id, interaction.user.username);
    let currentType = interaction.options.getString('type') || 'starss';
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
