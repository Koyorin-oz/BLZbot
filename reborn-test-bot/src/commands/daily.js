const path = require('node:path');
const {
  SlashCommandBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  ActionRowBuilder,
  ComponentType,
} = require('discord.js');
const users = require('../services/users');
const { getItem } = require('../reborn/catalog');
const meta = require('../services/meta');
const cfg = require('../config');
const { totalToLevelState, T_START, MAX_LEVEL } = require('../reborn/xpCurve');

const { renderDailyCard } = require(path.join(
  __dirname,
  '..',
  '..',
  '..',
  'niveau',
  'src',
  'utils',
  'canvas-daily',
));

const DAY_MS = 24 * 60 * 60 * 1000;

/** Même texte d’appui que le canvas (MAJ REBORN / sandbox). */
const REBORN_MAJ_LINE =
  'REBORN : coffres doc, double daily, arbre de compétences — bot de test';

function msToTime(ms) {
  const seconds = Math.floor((ms / 1000) % 60)
    .toString()
    .padStart(2, '0');
  const minutes = Math.floor((ms / (1000 * 60)) % 60)
    .toString()
    .padStart(2, '0');
  const hours = Math.floor((ms / (1000 * 60 * 60)) % 24).toString();
  if (parseInt(hours, 10) > 0) return `${hours}h ${minutes}m ${seconds}s`;
  if (parseInt(minutes, 10) > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

function sameCalendarDay(d, ref) {
  return (
    d.getFullYear() === ref.getFullYear() && d.getMonth() === ref.getMonth() && d.getDate() === ref.getDate()
  );
}

function pruneDoubleRolls(userId) {
  const key = `ddailyroll:${userId}`;
  let arr = [];
  try {
    arr = JSON.parse(meta.get(key) || '[]');
  } catch {
    arr = [];
  }
  const now = Date.now();
  arr = arr.filter((t) => typeof t === 'number' && now - t < DAY_MS);
  meta.set(key, JSON.stringify(arr));
  return arr;
}

function pushDoubleRoll(userId) {
  const arr = pruneDoubleRolls(userId);
  arr.push(Date.now());
  meta.set(`ddailyroll:${userId}`, JSON.stringify(arr));
}

const rewards = [
  { name: '10 000 Starss', chance: 0.3, type: 'stars', amount: 10000 },
  { name: '500 EXP', chance: 0.3, type: 'xp', amount: 500 },
  { name: '500 RP', chance: 0.2, type: 'points', amount: 500 },
  { name: '25 000 Starss', chance: 0.1, type: 'stars', amount: 25000 },
  { name: 'Coffre au trésor', chance: 0.09, type: 'item', itemId: 'coffre_classique' },
  { name: 'Méga coffre au trésor', chance: 0.01, type: 'item', itemId: 'coffre_catl' },
];

function getRandomReward() {
  const rand = Math.random();
  let cumulative = 0;
  for (const reward of rewards) {
    cumulative += reward.chance;
    if (rand < cumulative) return reward;
  }
  return rewards[0];
}

function invQty(userId, itemId) {
  const rows = users.getInventory(userId);
  const row = rows.find((r) => r.item_id === itemId);
  return row ? row.qty : 0;
}

/** Objet `user` attendu par `renderDailyCard` (stars, level, xp, xp_needed). */
function buildCanvasUser(u) {
  if (!u) return null;
  const sb = users.B(u.stars);
  let stars = Number(sb);
  if (!Number.isFinite(stars)) stars = 0;
  const t = u.xp_total ?? 0;
  const st = totalToLevelState(t);
  const lv = st.level;
  let xpNeeded = 1;
  if (lv < MAX_LEVEL) {
    xpNeeded = T_START[lv + 1] - T_START[lv];
  }
  return {
    stars,
    level: lv,
    xp: st.xpInto,
    xp_needed: Math.max(1, xpNeeded),
  };
}

/**
 * @returns {{ rewardName: string, rewardType: string, rewardAmount: number | null, rewardEmoji: string }}
 */
function applyRandomReward(userId) {
  const reward = getRandomReward();
  let rewardName = reward.name;
  let rewardType = reward.type;
  let rewardAmount = reward.type === 'item' ? null : reward.amount;
  let rewardEmoji = '✅';

  switch (reward.type) {
    case 'stars': {
      const base = BigInt(reward.amount);
      const amount = users.applyStarssMultiplier(userId, base);
      users.addStars(userId, amount);
      rewardName = reward.name;
      rewardType = 'stars';
      rewardAmount = Number(amount);
      rewardEmoji = '⭐';
      break;
    }
    case 'xp':
      users.addXp(userId, reward.amount);
      rewardName = reward.name;
      rewardType = 'xp';
      rewardAmount = reward.amount;
      rewardEmoji = '🚀';
      break;
    case 'points':
      users.addPoints(userId, BigInt(reward.amount));
      rewardName = reward.name;
      rewardType = 'points';
      rewardAmount = reward.amount;
      rewardEmoji = '🏆';
      break;
    case 'item': {
      users.addInventory(userId, reward.itemId, 1);
      const def = getItem(reward.itemId);
      rewardName = def?.name || reward.name;
      rewardType = 'item';
      rewardAmount = null;
      rewardEmoji = '🎁';
      break;
    }
    default:
      break;
  }
  return { rewardName, rewardType, rewardAmount, rewardEmoji };
}

function buildCloseRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('daily_close').setLabel('Fermer').setStyle(ButtonStyle.Secondary),
  );
}

async function sendDailyCanvasReply(interaction, pngBuffer) {
  const file = new AttachmentBuilder(pngBuffer, { name: 'daily.png' });
  const message = await interaction.editReply({
    files: [file],
    components: [buildCloseRow()],
  });

  const collector = message.createMessageComponentCollector({
    componentType: ComponentType.Button,
    time: 5 * 60 * 1000,
  });

  collector.on('collect', async (i) => {
    if (i.user.id !== interaction.user.id) {
      return i.reply({ content: "Seul l'auteur de la commande peut utiliser ce bouton." });
    }
    if (i.customId === 'daily_close') {
      try {
        await i.update({ components: [] });
      } catch {
        /* ignore */
      }
      collector.stop();
    }
  });
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('daily')
    .setDescription('Réclame ta récompense journalière (carte canvas, comme le bot principal).'),

  async execute(interaction) {
    await interaction.deferReply();

    const userId = interaction.user.id;
    users.getOrCreate(userId, interaction.user.username);

    const now = new Date();
    const midnightLocal = new Date(now);
    midnightLocal.setHours(0, 0, 0, 0);

    const u = users.getUser(userId);
    const lastMs = u?.daily_last_ms || 0;
    const canClaim = !lastMs || lastMs === 0;

    let lastClaimedMidnight = null;
    if (!canClaim) {
      const lastClaimedDate = new Date(lastMs);
      lastClaimedMidnight = new Date(lastClaimedDate);
      lastClaimedMidnight.setHours(0, 0, 0, 0);
    }

    const naturalOk = canClaim || (lastClaimedMidnight && lastClaimedMidnight < midnightLocal);
    const claimedToday = Boolean(lastMs && sameCalendarDay(new Date(lastMs), now));

    const tryDouble =
      !naturalOk &&
      claimedToday &&
      invQty(userId, 'double_daily') > 0 &&
      (cfg.TEST_NO_LIMITS || pruneDoubleRolls(userId).length < 3);

    const member = await interaction.guild?.members.fetch(userId).catch(() => null);
    const displayName = member?.displayName || interaction.user.username;
    const highestRoleName =
      member?.roles.highest?.name !== '@everyone' ? member?.roles.highest?.name : 'Membre';
    const avatarURL = member?.displayAvatarURL({ extension: 'png', size: 256 });

    if (naturalOk || tryDouble) {
      if (tryDouble) {
        if (!users.takeInventory(userId, 'double_daily', 1)) {
          const tomorrowMidnight = new Date(midnightLocal);
          tomorrowMidnight.setDate(tomorrowMidnight.getDate() + 1);
          const remainingTime = msToTime(tomorrowMidnight.getTime() - now.getTime());
          const uRow = users.getUser(userId);
          const userForCard = buildCanvasUser(uRow);
          let png;
          try {
            png = await renderDailyCard({
              user: userForCard,
              username: interaction.user.username,
              displayName,
              highestRoleName,
              avatarURL,
              remainingTime,
              doubleDailyCount: invQty(userId, 'double_daily'),
              isSuccess: false,
              footerBrand: 'REBORN test',
            });
          } catch {
            return interaction.editReply({
              content: `⏳ **Prochain daily** : **${remainingTime}** · *Double Daily* indisponible (objet / limite 24h).`,
            });
          }
          return sendDailyCanvasReply(interaction, png);
        }
        pushDoubleRoll(userId);
      }

      const { rewardName, rewardType, rewardAmount, rewardEmoji } = applyRandomReward(userId);
      if (naturalOk) users.setDailyLastMs(userId, Date.now());

      const uAfter = users.getUser(userId);
      const userForCard = buildCanvasUser(uAfter);

      let png;
      try {
        png = await Promise.race([
          renderDailyCard({
            user: userForCard,
            username: interaction.user.username,
            displayName,
            highestRoleName,
            avatarURL,
            rewardName,
            rewardType,
            rewardAmount,
            rewardEmoji,
            isSuccess: true,
            footerBrand: 'REBORN test',
            rebornMajLine: REBORN_MAJ_LINE,
          }),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 15000)),
        ]);
      } catch {
        return interaction.editReply({
          content: `## ${rewardEmoji} Daily\n**${rewardName}**\n\nSolde : **${users
            .getStars(userId)
            .toLocaleString('fr-FR')}** starss`,
        });
      }

      return sendDailyCanvasReply(interaction, png);
    }

    const tomorrowMidnight = new Date(midnightLocal);
    tomorrowMidnight.setDate(tomorrowMidnight.getDate() + 1);
    const remainingTime = msToTime(tomorrowMidnight.getTime() - now.getTime());
    const ddc = invQty(userId, 'double_daily');
    const uRow = users.getUser(userId);
    const userForCard = buildCanvasUser(uRow);

    let png;
    try {
      png = await Promise.race([
        renderDailyCard({
          user: userForCard,
          username: interaction.user.username,
          displayName,
          highestRoleName,
          avatarURL,
          remainingTime,
          doubleDailyCount: ddc,
          isSuccess: false,
          footerBrand: 'REBORN test',
        }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 15000)),
      ]);
    } catch {
      return interaction.editReply({
        content: `⏳ **Prochain daily** : **${remainingTime}**${ddc > 0 ? ` · *Double daily* : **${ddc}**` : ''}`,
      });
    }

    return sendDailyCanvasReply(interaction, png);
  },
};
