const path = require('node:path');
const {
  AttachmentBuilder,
  ContainerBuilder,
  MediaGalleryBuilder,
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
const { renderQuetesRebornPng } = require('./canvasQuetesReborn');

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const NIVEAU_QUESTS_PER_PAGE = 5;

/** Chargement « tolérant » des modules niveau pour la page archives. */
function loadNiveauQuests() {
  try {
    const utilsBase = path.join(__dirname, '..', '..', '..', 'niveau', 'src', 'utils');
    const dbQuests = require(path.join(utilsBase, 'db-quests'));
    const { QUESTS } = require(path.join(utilsBase, 'quests'));
    const { renderQuestsCardFiche2 } = require(path.join(utilsBase, 'canvas-fiche2-quests-trophies'));
    return { getAllUserQuests: dbQuests.getAllUserQuests, QUESTS, renderQuestsCardFiche2 };
  } catch (e) {
    console.warn('[quetesPanel] niveau quests indisponibles:', e?.message || e);
    return null;
  }
}

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

/** Compte le nombre total de pages archives (niveau) en attente pour ce user. */
function countNiveauPages(userId) {
  const niveau = loadNiveauQuests();
  if (!niveau) return 0;
  try {
    const userQuestsData = niveau.getAllUserQuests(userId) || [];
    let pending = 0;
    for (const questId in niveau.QUESTS) {
      const qInfo = niveau.QUESTS[questId];
      if (!qInfo) continue;
      const userProgress = userQuestsData.find((q) => q.quest_id === questId);
      if (!userProgress || !userProgress.completed) pending += 1;
    }
    return Math.ceil(pending / NIVEAU_QUESTS_PER_PAGE) || 0;
  } catch {
    return 0;
  }
}

/** Récupère la liste paginée de quêtes archives (niveau) au format attendu par le canvas. */
function getNiveauPageQuests(userId, page) {
  const niveau = loadNiveauQuests();
  if (!niveau) return null;
  try {
    const userQuestsData = niveau.getAllUserQuests(userId) || [];
    const pending = [];
    for (const questId in niveau.QUESTS) {
      const qInfo = niveau.QUESTS[questId];
      if (!qInfo) continue;
      const userProgress = userQuestsData.find((q) => q.quest_id === questId);
      if (!userProgress || !userProgress.completed) {
        pending.push({
          name: qInfo.name || 'Quête',
          description: qInfo.description || '',
          progress: userProgress?.progress || 0,
          goal: qInfo.goal,
          rarity: qInfo.rarity || 'Commune',
          isNumeric: typeof qInfo.goal === 'number',
        });
      }
    }
    const totalPages = Math.ceil(pending.length / NIVEAU_QUESTS_PER_PAGE) || 1;
    const p = Math.max(0, Math.min(page, totalPages - 1));
    return {
      quests: pending.slice(p * NIVEAU_QUESTS_PER_PAGE, (p + 1) * NIVEAU_QUESTS_PER_PAGE),
      totalPages,
      page: p,
      renderQuestsCardFiche2: niveau.renderQuestsCardFiche2,
    };
  } catch (e) {
    console.warn('[quetesPanel] niveau page KO:', e?.message || e);
    return null;
  }
}

// ─── Page 0 : REBORN ────────────────────────────────────────────────────────
async function buildRebornPage(userId, niveauPages, ctx = {}) {
  const s = quests.summary(userId);
  const c = new ContainerBuilder();

  const dailyDone = s.daily_claimed;
  const weeklyDone = s.weekly_claimed;
  const sp = spawnerStatus(userId);

  // Fiche canvas REBORN
  let canvasFile = null;
  try {
    const buf = await renderQuetesRebornPng({
      displayName: ctx.displayName || 'Joueur',
      avatarUrl: ctx.avatarUrl || null,
      summary: s,
      spawner: sp,
    });
    canvasFile = new AttachmentBuilder(buf, { name: 'quetes_reborn.png' });
    c.addMediaGalleryComponents(
      new MediaGalleryBuilder().addItems({ media: { url: 'attachment://quetes_reborn.png' } }),
    );
  } catch (e) {
    console.warn('[quetesPanel] canvas REBORN KO:', e?.message || e);
    // Fallback texte si le canvas ne tourne pas
    const dailyLine = dailyDone
      ? `🌅 **Quête quotidienne** — ✅ Validée · **+${s.daily_reward.toLocaleString('fr-FR')}** starss`
      : `🌅 **Quête quotidienne** — \`${bar(s.msgs_today, s.daily_target)}\` **${s.msgs_today}/${s.daily_target}** msg · récompense **${s.daily_reward.toLocaleString('fr-FR')}** starss *(auto)*`;
    const weeklyLine = weeklyDone
      ? `📅 **Quête hebdo** — ✅ Validée · **+${s.weekly_reward.toLocaleString('fr-FR')}** starss`
      : `📅 **Quête hebdo** — \`${bar(s.week_points, s.weekly_target)}\` **${s.week_points}/${s.weekly_target}** msg · récompense **${s.weekly_reward.toLocaleString('fr-FR')}** starss *(auto)*`;
    const selLine = `🎲 **Quête à choix** — ${s.selection_line}`;
    c.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        ['# 🎯 Quêtes — REBORN', '', dailyLine, weeklyLine, selLine].join('\n'),
      ),
    );
  }

  const rows = [];

  if (!s.selection_id || /terminée/i.test(s.selection_line)) {
    rows.push(
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId('rb:q:pick')
          .setPlaceholder('Choisir une quête à choix (semaine)')
          .addOptions([
            { label: 'Chasse — 20 messages cette semaine', value: 'chasse_messages', description: 'Récompense auto à 20 msg' },
            { label: 'Offrir 1× corail (réclamation manuelle)', value: 'offre_corail', description: 'Bouton « Réclamer » apparaîtra' },
          ]),
      ),
    );
  }

  // Boutons d'action (skip / claim corail / spawner) + Rafraîchir
  const actionRow = new ActionRowBuilder();
  let actionCount = 0;
  if (s.skips_left > 0 && !dailyDone) {
    actionRow.addComponents(
      new ButtonBuilder().setCustomId('rb:q:skip:d').setLabel('Skip daily (-1)').setStyle(ButtonStyle.Secondary).setEmoji('⏭️'),
    );
    actionCount += 1;
  }
  if (s.skips_left > 0 && !weeklyDone) {
    actionRow.addComponents(
      new ButtonBuilder().setCustomId('rb:q:skip:w').setLabel('Skip hebdo (-1)').setStyle(ButtonStyle.Secondary).setEmoji('⏭️'),
    );
    actionCount += 1;
  }
  if (s.selection_id === 'offre_corail' && !/terminée/i.test(s.selection_line)) {
    actionRow.addComponents(
      new ButtonBuilder().setCustomId('rb:q:sel_claim').setLabel('Réclamer (-1× corail)').setStyle(ButtonStyle.Success).setEmoji('📜'),
    );
    actionCount += 1;
  }
  if (sp.available) {
    actionRow.addComponents(
      new ButtonBuilder().setCustomId('rb:q:spawner').setLabel('Event Spawner').setStyle(ButtonStyle.Success).setEmoji('🎁'),
    );
    actionCount += 1;
  }
  actionRow.addComponents(
    new ButtonBuilder().setCustomId('rb:q:re').setLabel('Rafraîchir').setStyle(ButtonStyle.Secondary).setEmoji('🔄'),
  );
  actionCount += 1;
  if (actionCount > 0) rows.push(actionRow);

  // Pagination — bouton "Anciennes quêtes →" si présentes
  const totalPages = 1 + niveauPages;
  if (niveauPages > 0) {
    rows.push(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('rb:q:page:1').setLabel(`Anciennes quêtes (1/${niveauPages})`).setStyle(ButtonStyle.Primary).setEmoji('📜'),
      ),
    );
  }

  if (rows.length) c.addActionRowComponents(...rows);
  const files = canvasFile ? [canvasFile] : [];
  return { components: [c], flags: MessageFlags.IsComponentsV2, files, totalPages };
}

// ─── Pages 1+ : Archives niveau (canvas) ────────────────────────────────────
async function buildNiveauPage(userId, niveauPageIdx) {
  const data = getNiveauPageQuests(userId, niveauPageIdx - 1);
  if (!data) return null;
  let buf = null;
  try {
    buf = await data.renderQuestsCardFiche2({ quests: data.quests });
  } catch (e) {
    console.warn('[quetesPanel] canvas archives KO:', e?.message || e);
  }
  const c = new ContainerBuilder();
  if (buf) {
    c.addMediaGalleryComponents(
      new MediaGalleryBuilder().addItems({ media: { url: 'attachment://quetes_archives.png' } }),
    );
  } else {
    const lines = data.quests.length
      ? data.quests.map((q) => `• **${q.name}** — ${q.progress}/${q.goal}`)
      : ['*Aucune quête archive en attente.*'];
    c.addTextDisplayComponents(new TextDisplayBuilder().setContent(['## 📜 Anciennes quêtes', ...lines].join('\n')));
  }
  c.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(`📜 *Anciennes quêtes — page **${niveauPageIdx}** / **${data.totalPages}***`),
  );

  const navRow = new ActionRowBuilder();
  navRow.addComponents(
    new ButtonBuilder().setCustomId('rb:q:page:0').setLabel('REBORN').setStyle(ButtonStyle.Secondary).setEmoji('🎯'),
  );
  if (niveauPageIdx > 1) {
    navRow.addComponents(
      new ButtonBuilder()
        .setCustomId(`rb:q:page:${niveauPageIdx - 1}`)
        .setLabel('← Préc.')
        .setStyle(ButtonStyle.Secondary),
    );
  }
  if (niveauPageIdx < data.totalPages) {
    navRow.addComponents(
      new ButtonBuilder()
        .setCustomId(`rb:q:page:${niveauPageIdx + 1}`)
        .setLabel('Suiv. →')
        .setStyle(ButtonStyle.Secondary),
    );
  }
  navRow.addComponents(
    new ButtonBuilder().setCustomId(`rb:q:page:${niveauPageIdx}`).setLabel('Rafraîchir').setStyle(ButtonStyle.Secondary).setEmoji('🔄'),
  );
  c.addActionRowComponents(navRow);

  const files = buf ? [new AttachmentBuilder(buf, { name: 'quetes_archives.png' })] : [];
  return { components: [c], flags: MessageFlags.IsComponentsV2, files };
}

/**
 * Construit le payload Components V2 pour `/quetes`.
 * @param {string} userId
 * @param {number} [page] - 0 = REBORN, ≥1 = archives niveau (paginées)
 */
async function buildQuetesPayload(userId, page = 0) {
  const niveauPages = countNiveauPages(userId);
  if (page <= 0) {
    return buildRebornPage(userId, niveauPages);
  }
  const built = await buildNiveauPage(userId, page);
  if (!built) return buildRebornPage(userId, niveauPages);
  return built;
}

module.exports = { buildQuetesPayload };
