const {
  ContainerBuilder,
  TextDisplayBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  MessageFlags,
} = require('discord.js');
const quests = require('../services/quests');
const skillTree = require('../services/skillTree');
const users = require('../services/users');

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

function bar(cur, target) {
  const c = Math.max(0, Math.min(target, cur));
  const filled = Math.round((c / Math.max(1, target)) * 10);
  return '█'.repeat(filled) + '░'.repeat(10 - filled);
}

function spawnerStatus(userId) {
  if (!skillTree.weeklyEventSpawnerEntitled(userId)) {
    return { available: false, locked: true, msLeft: 0 };
  }
  const u = users.getUser(userId);
  const last = u?.last_event_spawner_claim_ms || 0;
  const left = WEEK_MS - (Date.now() - last);
  return { available: left <= 0, locked: false, msLeft: Math.max(0, left) };
}

function fmtTimeLeft(ms) {
  if (ms <= 0) return 'maintenant';
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  if (h > 0) return `${h}h${String(m).padStart(2, '0')}`;
  return `${m} min`;
}

/**
 * Construit le payload Components V2 pour `/quetes`.
 * @param {string} userId
 * @returns {{ components: any[], flags: number }}
 */
function buildQuetesPayload(userId) {
  const s = quests.summary(userId);
  const c = new ContainerBuilder();

  const dailyDone = s.daily_claimed;
  const weeklyDone = s.weekly_claimed;

  const dailyLine = dailyDone
    ? `🌅 **Quête quotidienne** — ✅ Validée · **+${s.daily_reward.toLocaleString('fr-FR')}** starss`
    : `🌅 **Quête quotidienne** — \`${bar(s.msgs_today, s.daily_target)}\` **${s.msgs_today}/${s.daily_target}** msg · récompense **${s.daily_reward.toLocaleString('fr-FR')}** starss *(auto)*`;

  const weeklyLine = weeklyDone
    ? `📅 **Quête hebdo** — ✅ Validée · **+${s.weekly_reward.toLocaleString('fr-FR')}** starss`
    : `📅 **Quête hebdo** — \`${bar(s.week_points, s.weekly_target)}\` **${s.week_points}/${s.weekly_target}** msg · récompense **${s.weekly_reward.toLocaleString('fr-FR')}** starss *(auto)*`;

  const selLine = `🎲 **Quête à choix** — ${s.selection_line}`;

  const bonusLine =
    `✨ **Arbre quête** : récompenses ×${s.reward_mult} · skips **${s.skips_left}/${s.skips_total}** · slots **${s.selection_slots}**`;

  const sp = spawnerStatus(userId);
  let spawnerLine;
  if (sp.locked) {
    spawnerLine = '🔒 *Event Spawner hebdo : débloqué au palier 5 Événement.*';
  } else if (sp.available) {
    spawnerLine = '🎁 **Event Spawner hebdo : disponible !**';
  } else {
    spawnerLine = `🎁 *Event Spawner — prochain claim dans **${fmtTimeLeft(sp.msLeft)}**.*`;
  }

  c.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      [
        '# 🎯 Quêtes',
        '*Les récompenses tombent **automatiquement** dès le seuil atteint.*',
        '',
        dailyLine,
        weeklyLine,
        selLine,
        '',
        bonusLine,
        spawnerLine,
      ].join('\n'),
    ),
  );

  // --- Boutons d'action ---
  const rows = [];

  // Sélecteur de quête à choix (visible si pas de selection active OU déjà réclamée)
  if (!s.selection_id || /terminée/i.test(s.selection_line)) {
    const sel = new StringSelectMenuBuilder()
      .setCustomId('rb:q:pick')
      .setPlaceholder('Choisir une quête à choix (semaine)')
      .addOptions([
        { label: 'Chasse — 20 messages cette semaine', value: 'chasse_messages', description: 'Récompense auto à 20 msg' },
        { label: 'Offrir 1× corail (réclamation manuelle)', value: 'offre_corail', description: 'Bouton « Réclamer » apparaîtra' },
      ]);
    rows.push(new ActionRowBuilder().addComponents(sel));
  }

  // Boutons : skip daily / hebdo / claim corail / spawner / refresh
  const buttonRow = new ActionRowBuilder();
  let buttons = 0;

  if (s.skips_left > 0 && !dailyDone) {
    buttonRow.addComponents(
      new ButtonBuilder()
        .setCustomId('rb:q:skip:d')
        .setLabel(`Skip daily (-1)`)
        .setStyle(ButtonStyle.Secondary)
        .setEmoji('⏭️'),
    );
    buttons += 1;
  }
  if (s.skips_left > 0 && !weeklyDone) {
    buttonRow.addComponents(
      new ButtonBuilder()
        .setCustomId('rb:q:skip:w')
        .setLabel(`Skip hebdo (-1)`)
        .setStyle(ButtonStyle.Secondary)
        .setEmoji('⏭️'),
    );
    buttons += 1;
  }
  // Bouton "Réclamer corail" si selection item active et pas réclamée
  if (s.selection_id === 'offre_corail' && !/terminée/i.test(s.selection_line)) {
    buttonRow.addComponents(
      new ButtonBuilder()
        .setCustomId('rb:q:sel_claim')
        .setLabel('Réclamer (-1× corail)')
        .setStyle(ButtonStyle.Success)
        .setEmoji('📜'),
    );
    buttons += 1;
  }
  if (sp.available) {
    buttonRow.addComponents(
      new ButtonBuilder()
        .setCustomId('rb:q:spawner')
        .setLabel('Event Spawner hebdo')
        .setStyle(ButtonStyle.Success)
        .setEmoji('🎁'),
    );
    buttons += 1;
  }
  buttonRow.addComponents(
    new ButtonBuilder()
      .setCustomId('rb:q:re')
      .setLabel('Rafraîchir')
      .setStyle(ButtonStyle.Secondary)
      .setEmoji('🔄'),
  );
  buttons += 1;

  if (buttons > 0) rows.push(buttonRow);

  if (rows.length) c.addActionRowComponents(...rows);

  return { components: [c], flags: MessageFlags.IsComponentsV2 };
}

module.exports = { buildQuetesPayload };
