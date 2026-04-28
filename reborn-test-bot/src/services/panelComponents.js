const path = require('path');
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
const { buildPassportTextV2 } = require('../lib/passportV2Ui');
const pick = require('../lib/componentPickCache');
const { buildBoutiquePayload, buildInventairePayload } = require('../lib/shopV2Ui');
const { buildQuetesPayload } = require('../lib/quetesPanelUi');
const { handlePurchase } = require('./purchase');
const users = require('./users');
const skillTree = require('./skillTree');
const passport = require('./passport');
const quests = require('./quests');
const db = require('../db');

const CANVAS_SK = path.join(
  __dirname,
  '..',
  '..',
  '..',
  'niveau',
  'src',
  'utils',
  'canvas-skill-tree-reborn',
);
const CANVAS_PASS = path.join(
  __dirname,
  '..',
  '..',
  '..',
  'niveau',
  'src',
  'utils',
  'canvas-passport-staff-style',
);

const BR_LABEL = { quest: 'Quête', guild: 'Guilde', shop: 'Boutique', ranked: 'Ranked', event: 'Événement' };

function partsFromShopValue(v) {
  if (!v) return null;
  const [a, b] = v.split(':');
  if (a === 's') return ['rb', 's', b];
  if (a === 'c') return ['rb', 'c', b];
  if (a === 'b') return ['rb', 'b', b];
  return null;
}

const TREE_LAYOUTS = ['star', 'demi'];
function normalizeLayout(layout) {
  return TREE_LAYOUTS.includes(layout) ? layout : 'star';
}

/** Contexte (pseudo + avatar) pour le rendu canvas des quêtes. */
function qCtx(interaction) {
  return {
    displayName: interaction.member?.displayName || interaction.user?.username || 'Joueur',
    avatarUrl: interaction.user?.displayAvatarURL?.({ extension: 'png', size: 256 }) || null,
  };
}

async function tryRenderTreePng(userId, displayName, avatarUrl, layout = 'star') {
  try {
    const { renderSkillTreePng } = require(CANVAS_SK);
    const steps = {};
    for (const b of skillTree.BRANCHES) steps[b] = skillTree.step(userId, b);
    const u = users.getUser(userId);
    return await renderSkillTreePng({
      displayName: displayName || 'Joueur',
      points: u?.skill_points ?? 0,
      steps,
      avatarUrl: avatarUrl || null,
      layout: normalizeLayout(layout),
    });
  } catch (e) {
    console.error('[arbre canvas]', e?.message || e);
    return null;
  }
}

/**
 * @param {string} userId
 * @param {string} displayName
 * @param {string} avatarUrl
 * @param {'star' | 'demi'} [layout]
 */
async function buildArbreContainer(userId, displayName, avatarUrl, layout = 'star') {
  const lay = normalizeLayout(layout);
  const buf = await tryRenderTreePng(userId, displayName, avatarUrl, lay);
  if (!buf) return null;
  const file = new AttachmentBuilder(buf, { name: 'arbre_reborn.png' });
  const c = new ContainerBuilder();
  c.addMediaGalleryComponents(
    new MediaGalleryBuilder().addItems({ media: { url: 'attachment://arbre_reborn.png' } }),
  );
  const u = users.getUser(userId);
  c.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      [
        '# Arbre de compétences',
        `**Points** : **${u?.skill_points ?? 0}** — chaque palier coûte **n** points (n = n° de palier).`,
        'Choisis une **branche** puis **Débloquer** (ou utilise \`/arbre acheter\`).',
      ].join('\n'),
    ),
  );
  const options = skillTree.BRANCHES.map((b) => {
    const s = skillTree.step(userId, b);
    return {
      label: (BR_LABEL[b] || b).slice(0, 100),
      value: b,
      description: `Paliers ${s} / 5`.slice(0, 100),
    };
  });
  const select = new StringSelectMenuBuilder()
    .setCustomId('rb:tree:sel')
    .setPlaceholder('Branche (prochain achat)')
    .addOptions(options);

  const row0 = new ActionRowBuilder().addComponents(select);
  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`rb:tree:go:${lay}`)
      .setLabel('Débloquer')
      .setStyle(ButtonStyle.Success)
      .setEmoji('✨'),
    new ButtonBuilder()
      .setCustomId(`rb:tree:re:${lay}`)
      .setLabel('Rafraîchir')
      .setStyle(ButtonStyle.Secondary)
      .setEmoji('🔄'),
  );
  c.addActionRowComponents(row0, row1);
  return { file, container: c, flags: MessageFlags.IsComponentsV2 };
}

/**
 * @param {import('discord.js').Interaction} interaction
 */
async function handlePanelInteraction(interaction) {
  if (interaction.isStringSelectMenu()) {
    if (interaction.customId === 'rb:shop:sel') {
      pick.set(interaction.user.id, interaction.message.id, interaction.values[0]);
      return interaction.deferUpdate();
    }
    if (interaction.customId === 'rb:inv:sel') {
      pick.set(interaction.user.id, interaction.message.id, interaction.values[0]);
      return interaction.deferUpdate();
    }
    if (interaction.customId === 'rb:tree:sel') {
      pick.set(interaction.user.id, interaction.message.id, interaction.values[0]);
      return interaction.deferUpdate();
    }
    if (interaction.customId === 'rb:q:pick') {
      const r = quests.pickSelection(interaction.user.id, interaction.values[0]);
      if (!r.ok) return interaction.reply({ content: `❌ ${r.error}` });
      await interaction.deferUpdate();
      const p = await buildQuetesPayload(interaction.user.id, 0, qCtx(interaction));
      return interaction.editReply(p);
    }
    return;
  }

  if (!interaction.isButton()) return;

  if (interaction.customId === 'rb:shop:go') {
    const v = pick.get(interaction.user.id, interaction.message.id);
    const parts = partsFromShopValue(v);
    if (!parts) {
      return interaction.reply({
        content: 'Choisis d’abord un article dans le **menu**.',
      });
    }
    return handlePurchase(interaction, parts);
  }

  if (interaction.customId === 'rb:shop:re') {
    await interaction.deferUpdate();
    const p = await buildBoutiquePayload(interaction.user.id, interaction.user.username);
    return interaction.editReply({ files: p.files, components: p.components, flags: p.flags });
  }

  if (interaction.customId === 'rb:shop:reset') {
    const shopExtras = require('./shopExtras');
    const r = shopExtras.useShopReset(interaction.user.id);
    if (!r.ok) return interaction.reply({ content: `❌ ${r.error}` });
    await interaction.deferUpdate();
    const p = await buildBoutiquePayload(interaction.user.id, interaction.user.username);
    return interaction.editReply({ files: p.files, components: p.components, flags: p.flags });
  }

  if (interaction.customId === 'rb:shop:claim_catl') {
    const shopExtras = require('./shopExtras');
    const r = shopExtras.claimGuaranteedCatl(interaction.user.id);
    if (!r.ok) return interaction.reply({ content: `❌ ${r.error}` });
    await interaction.deferUpdate();
    const p = await buildBoutiquePayload(interaction.user.id, interaction.user.username);
    await interaction.editReply({ files: p.files, components: p.components, flags: p.flags });
    return interaction.followUp({
      content: '🎁 **CATL gratuit ajouté à ton inventaire** — ouvre-le via `/inventaire` ou rachètes-en plus tard.',
    });
  }

  if (interaction.customId === 'rb:inv:re') {
    await interaction.deferUpdate();
    const p = await buildInventairePayload(interaction.user.id, interaction.user.username);
    return interaction.editReply({ files: p.files, components: p.components, flags: p.flags });
  }

  if (interaction.customId === 'rb:inv:use') {
    const v = pick.get(interaction.user.id, interaction.message.id);
    if (!v || !v.startsWith('i:')) {
      return interaction.reply({ content: 'Sélectionne d’abord un item dans le menu.' });
    }
    const itemId = v.slice(2);
    const itemEffects = require('./itemEffects');
    const r = await itemEffects.useItem(interaction.user.id, itemId);
    if (!r.ok) return interaction.reply({ content: `❌ ${r.error}` });
    await interaction.deferUpdate();
    const p = await buildInventairePayload(interaction.user.id, interaction.user.username);
    await interaction.editReply({ files: p.files, components: p.components, flags: p.flags });
    return interaction.followUp({ content: r.message || '✅ Item utilisé.' });
  }

  // ─── Panel Quêtes ──────────────────────────────────────────────────────────
  if (interaction.customId === 'rb:q:re') {
    await interaction.deferUpdate();
    const p = await buildQuetesPayload(interaction.user.id, 0, qCtx(interaction));
    return interaction.editReply(p);
  }
  const pageMatch = interaction.customId.match(/^rb:q:page:(\d+)$/);
  if (pageMatch) {
    await interaction.deferUpdate();
    const pageIdx = parseInt(pageMatch[1], 10) || 0;
    const p = await buildQuetesPayload(interaction.user.id, pageIdx, qCtx(interaction));
    return interaction.editReply(p);
  }
  if (interaction.customId === 'rb:q:skip:d') {
    const r = quests.skipDaily(interaction.user.id);
    if (!r.ok) return interaction.reply({ content: `❌ ${r.error}` });
    await interaction.deferUpdate();
    const p = await buildQuetesPayload(interaction.user.id, 0, qCtx(interaction));
    return interaction.editReply(p);
  }
  if (interaction.customId === 'rb:q:skip:w') {
    const r = quests.skipWeekly(interaction.user.id);
    if (!r.ok) return interaction.reply({ content: `❌ ${r.error}` });
    await interaction.deferUpdate();
    const p = await buildQuetesPayload(interaction.user.id, 0, qCtx(interaction));
    return interaction.editReply(p);
  }
  if (interaction.customId === 'rb:q:sel_claim') {
    const r = quests.claimSelection(interaction.user.id);
    if (!r.ok) return interaction.reply({ content: `❌ ${r.error}` });
    await interaction.deferUpdate();
    const p = await buildQuetesPayload(interaction.user.id, 0, qCtx(interaction));
    return interaction.editReply(p);
  }
  if (interaction.customId === 'rb:q:spawner') {
    const uid = interaction.user.id;
    if (!skillTree.weeklyEventSpawnerEntitled(uid)) {
      return interaction.reply({ content: '❌ Réservé au palier 5 Événement (`/arbre`).' });
    }
    const u = users.getUser(uid);
    const last = u?.last_event_spawner_claim_ms || 0;
    const now = Date.now();
    const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
    if (now - last < WEEK_MS) {
      return interaction.reply({ content: '❌ Déjà réclamé cette semaine.' });
    }
    db.prepare('UPDATE users SET last_event_spawner_claim_ms = ? WHERE id = ?').run(now, uid);
    users.addInventory(uid, 'event_spawner', 1);
    await interaction.deferUpdate();
    const p = await buildQuetesPayload(uid, 0, qCtx(interaction));
    return interaction.editReply(p);
  }

  const goMatch = interaction.customId.match(/^rb:tree:go(?::(\w+))?$/);
  if (goMatch) {
    const lay = normalizeLayout(goMatch[1]);
    const br = pick.get(interaction.user.id, interaction.message.id);
    if (!br || !skillTree.BRANCHES.includes(br)) {
      return interaction.reply({ content: 'Sélectionne une **branche** dans le menu déroulant.' });
    }
    const uid = interaction.user.id;
    const r = skillTree.buy(uid, br);
    if (!r.ok) return interaction.reply({ content: `❌ ${r.error}` });
    // Défère AVANT le rendu canvas + avatar fetch (sinon token expire en 3 s -> 10062).
    await interaction.deferUpdate();
    const b = await buildArbreContainer(
      uid,
      interaction.member?.displayName || interaction.user.username,
      interaction.user.displayAvatarURL({ extension: 'png', size: 128 }),
      lay,
    );
    if (!b) {
      return interaction.followUp({
        content: `✅ **${BR_LABEL[br] || br}** → **${r.newStep}** / 5 (canvas indisponible)`,
      });
    }
    return interaction.editReply({
      files: [b.file],
      components: [b.container],
      flags: b.flags,
    });
  }

  const reMatch = interaction.customId.match(/^rb:tree:re(?::(\w+))?$/);
  if (reMatch) {
    const lay = normalizeLayout(reMatch[1]);
    await interaction.deferUpdate();
    const b = await buildArbreContainer(
      interaction.user.id,
      interaction.member?.displayName || interaction.user.username,
      interaction.user.displayAvatarURL({ extension: 'png', size: 128 }),
      lay,
    );
    if (!b) {
      return interaction.followUp({ content: 'Génération image indisponible (canvas).' });
    }
    return interaction.editReply({ files: [b.file], components: [b.container], flags: b.flags });
  }

  const pm = interaction.customId.match(/^rb:ps:(card|txt):(\d+)$/);
  if (pm) {
    if (!interaction.guild) {
      return interaction.reply({ content: 'Serveur uniquement.' });
    }
    const kind = pm[1];
    const viewId = pm[2];
    const hub = /** @type {string} */ (interaction.guildId);
    users.getOrCreate(viewId, 'u');
    passport.maybeRecoverSecu(viewId);
    const u = users.getUser(viewId);
    const targetUser = await interaction.client.users.fetch(viewId);
    if (kind === 'card') {
      // Défère AVANT le canvas (rendu + fetch avatar peuvent dépasser 3 s).
      await interaction.deferUpdate();
      let buf;
      try {
        const { renderPassportCardStaffStyle } = require(CANVAS_PASS);
        const warns = passport.listWarns(hub, viewId, 8);
        const targetMember = await interaction.guild.members.fetch(viewId).catch(() => null);
        buf = await renderPassportCardStaffStyle({
          member: targetMember,
          displayName: targetMember?.displayName || targetUser.username,
          secuPoints: u.secu_points ?? 10,
          modScore: u.mod_tests_score ?? 0,
          candidature: u.candidature_status ?? 'aucune',
          warns: warns.map((w) => ({
            degree: w.degree,
            modId: w.mod_id,
            reason: w.reason,
          })),
        });
      } catch (e) {
        console.error('[passeport card]', e);
        return interaction.followUp({ content: 'Canvas indisponible (module `canvas` / binaire).' });
      }
      const f = new AttachmentBuilder(buf, { name: 'passeport_reborn.png' });
      const c = new ContainerBuilder();
      c.addMediaGalleryComponents(
        new MediaGalleryBuilder().addItems({ media: { url: 'attachment://passeport_reborn.png' } }),
      );
      c.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          '### Passeport — **vue carte**\n*Mise en page type \`/profil-staff\` (fond \`profile.png\` modération ou \`blz_bg\`).*',
        ),
      );
      c.addActionRowComponents(
        new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`rb:ps:txt:${viewId}`)
            .setLabel('Retour fiche texte')
            .setStyle(ButtonStyle.Secondary)
            .setEmoji('📄'),
        ),
      );
      return interaction.editReply({ files: [f], components: [c], flags: MessageFlags.IsComponentsV2 });
    }
    if (kind === 'txt') {
      const warns = passport.listWarns(hub, viewId, 20);
      const wlines = warns.length
        ? warns.map((w) => `−${w.degree} <@${w.mod_id}> — ${(w.reason || '—').slice(0, 80)}`)
        : [];
      const p = buildPassportTextV2({ target: targetUser, u, hub, wlines });
      await interaction.deferUpdate();
      return interaction.editReply(p);
    }
  }
}

module.exports = { handlePanelInteraction, tryRenderTreePng, buildArbreContainer };
