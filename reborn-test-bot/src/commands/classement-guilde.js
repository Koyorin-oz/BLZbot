const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ComponentType,
} = require('discord.js');
const users = require('../services/users');
const playerGuilds = require('../services/playerGuilds');
const ladder = require('../services/guildLadder');

function escGuildName(name) {
  return String(name || 'Sans nom').replace(/\\/g, '\\\\').replace(/\*/g, '\\*');
}

/** Préfixe visuel : image Discord si URL valide, sinon emoji guilde. */
function guildVisualPrefix(iconUrl, fallbackEmoji) {
  const u = String(iconUrl || '').trim();
  if (/^https?:\/\//i.test(u) && u.length < 2048) return `![](${u})`;
  return `${fallbackEmoji} `;
}

function formatGuildLine(rankToken, iconUrl, name, valueStr, unit, fallbackEmoji) {
  const vis = guildVisualPrefix(iconUrl, fallbackEmoji);
  const hasImg = vis.startsWith('![');
  const afterRank = hasImg ? `${vis}` : `${vis}`;
  return `${rankToken} ${afterRank}**${escGuildName(name)}** — **${valueStr}** ${unit}`;
}

const TYPES = {
  grp: {
    label: '🏰 GRP guilde',
    emoji: '🏰',
    color: 0xe67e22,
    unit: 'GRP total',
    description: 'Guildes triées par somme des GRP des membres (table membre ↔ guilde).',
  },
  starss: {
    label: '💸 Starss (membres)',
    emoji: '💸',
    color: 0xf1c40f,
    unit: 'starss',
    description: 'Somme des starss de tous les membres de chaque guilde.',
  },
  niveau: {
    label: '⭐ XP total (membres)',
    emoji: '⭐',
    color: 0x3498db,
    unit: 'XP',
    description: 'Somme de l’XP total des membres (puissance globale de la guilde).',
  },
  rp: {
    label: '⚔️ Ranked RP (membres)',
    emoji: '⚔️',
    color: 0xe74c3c,
    unit: 'RP',
    description: 'Somme des Ranked Points des membres de chaque guilde.',
  },
};

function buildEmbed(type, hub, requesterId) {
  const def = TYPES[type] || TYPES.grp;
  let lines = [];
  let myRankLine = '';

  if (type === 'grp') {
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
      .setTitle(`${def.emoji} Classement guildes — ${def.label}`)
      .setColor(def.color)
      .setDescription(lines.join('\n') + myRankLine)
      .setFooter({ text: `${def.description} · Top 3 = protection anti-séparation (ladder).` });
  }

  const metric = type === 'starss' ? 'starss' : type === 'rp' ? 'rp' : 'niveau';
  const full = ladder.memberAggLadderForHub(hub, metric);
  const top = full.slice(0, 10);
  if (!top.length) {
    lines = ['*Aucune guilde avec membres sur ce serveur.*'];
  } else {
    lines = top.map((g, i) => {
      const star = i < 3 ? ['🥇', '🥈', '🥉'][i] : `**${i + 1}.**`;
      const scoreStr = g.score.toLocaleString('fr-FR');
      return `${star} **${g.name}** \`${g.id}\` — **${scoreStr}** ${def.unit} · ${g.members} membre(s)`;
    });
  }

  const myMembership = playerGuilds.getMembershipInHub(requesterId, hub);
  if (myMembership) {
    const myIdx = full.findIndex((g) => g.id === myMembership.guild_id);
    if (myIdx >= 0) {
      const me = full[myIdx];
      const scoreStr = me.score.toLocaleString('fr-FR');
      myRankLine = `\n\n*Ta guilde **${me.name}** : **${scoreStr}** ${def.unit} — rang **#${myIdx + 1}**.*`;
    }
  }

  return new EmbedBuilder()
    .setTitle(`${def.emoji} Classement guildes — ${def.label}`)
    .setColor(def.color)
    .setDescription(lines.join('\n') + myRankLine)
    .setFooter({ text: def.description });
}

function buildSelect(currentType) {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('rb_classement_guilde_type')
      .setPlaceholder('Changer de classement guilde')
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
    .setName('classement-guilde')
    .setDescription('Classements des guildes : GRP, starss, XP membres, RP ranked.')
    .addStringOption((o) =>
      o
        .setName('type')
        .setDescription('Vue affichée en premier (défaut : GRP guilde).')
        .setRequired(false)
        .addChoices(
          { name: '🏰 GRP guilde', value: 'grp' },
          { name: '💸 Starss (somme membres)', value: 'starss' },
          { name: '⭐ XP total (somme membres)', value: 'niveau' },
          { name: '⚔️ Ranked RP (somme membres)', value: 'rp' },
        ),
    ),

  async execute(interaction) {
    const hub = interaction.guildId;
    if (!hub) return interaction.reply({ content: 'Sur un serveur uniquement.' });
    users.getOrCreate(interaction.user.id, interaction.user.username);
    let currentType = interaction.options.getString('type') || 'grp';
    if (currentType === 'guildes') currentType = 'grp';
    if (!TYPES[currentType]) currentType = 'grp';
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
          content: "Seul l'auteur peut changer le type. Lance `/classement-guilde` pour le tien.",
          ephemeral: true,
        });
      }
      if (i.customId !== 'rb_classement_guilde_type') return;
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
