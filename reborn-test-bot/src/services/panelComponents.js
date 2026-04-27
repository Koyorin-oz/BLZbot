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
const { handlePurchase } = require('./purchase');
const users = require('./users');
const skillTree = require('./skillTree');
const passport = require('./passport');

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

async function tryRenderTreePng(userId, displayName) {
  try {
    const { renderSkillTreePng } = require(CANVAS_SK);
    const steps = {};
    for (const b of skillTree.BRANCHES) steps[b] = skillTree.step(userId, b);
    const u = users.getUser(userId);
    return await renderSkillTreePng({
      displayName: displayName || 'Joueur',
      points: u?.skill_points ?? 0,
      steps,
    });
  } catch (e) {
    console.error('[arbre canvas]', e?.message || e);
    return null;
  }
}

/**
 * @param {string} userId
 * @param {import('discord.js').ContainerBuilder} [base] — si fourni, on y ajoute galerie + texte (déjà partial)
 */
async function buildArbreContainer(userId, displayName) {
  const buf = await tryRenderTreePng(userId, displayName);
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
      .setCustomId('rb:tree:go')
      .setLabel('Débloquer')
      .setStyle(ButtonStyle.Success)
      .setEmoji('✨'),
    new ButtonBuilder()
      .setCustomId('rb:tree:re')
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
    return;
  }

  if (!interaction.isButton()) return;

  if (interaction.customId === 'rb:shop:go') {
    const v = pick.get(interaction.user.id, interaction.message.id);
    const parts = partsFromShopValue(v);
    if (!parts) {
      return interaction.reply({
        content: 'Choisis d’abord un article dans le **menu**.',
        ephemeral: true,
      });
    }
    return handlePurchase(interaction, parts);
  }

  if (interaction.customId === 'rb:shop:re') {
    await interaction.deferUpdate();
    const p = await buildBoutiquePayload(interaction.user.id, interaction.user.username);
    return interaction.editReply({ files: p.files, components: p.components, flags: p.flags });
  }

  if (interaction.customId === 'rb:inv:re') {
    await interaction.deferUpdate();
    const p = await buildInventairePayload(interaction.user.id, interaction.user.username);
    return interaction.editReply({ files: p.files, components: p.components, flags: p.flags });
  }

  if (interaction.customId === 'rb:tree:go') {
    const br = pick.get(interaction.user.id, interaction.message.id);
    if (!br || !skillTree.BRANCHES.includes(br)) {
      return interaction.reply({ content: 'Sélectionne une **branche** dans le menu déroulant.', ephemeral: true });
    }
    const uid = interaction.user.id;
    const r = skillTree.buy(uid, br);
    if (!r.ok) return interaction.reply({ content: `❌ ${r.error}`, ephemeral: true });
    const b = await buildArbreContainer(uid, interaction.user.username);
    if (!b) {
      return interaction.reply({
        content: `✅ **${BR_LABEL[br] || br}** → **${r.newStep}** / 5 (canvas indisponible)`,
        ephemeral: true,
      });
    }
    await interaction.deferUpdate();
    return interaction.editReply({
      files: [b.file],
      components: [b.container],
      flags: b.flags,
    });
  }

  if (interaction.customId === 'rb:tree:re') {
    await interaction.deferUpdate();
    const b = await buildArbreContainer(interaction.user.id, interaction.user.username);
    if (!b) {
      return interaction.followUp({ content: 'Génération image indisponible (canvas).', ephemeral: true });
    }
    return interaction.editReply({ files: [b.file], components: [b.container], flags: b.flags });
  }

  const pm = interaction.customId.match(/^rb:ps:(card|txt):(\d+)$/);
  if (pm) {
    if (!interaction.guild) {
      return interaction.reply({ content: 'Serveur uniquement.', ephemeral: true });
    }
    const kind = pm[1];
    const viewId = pm[2];
    const hub = /** @type {string} */ (interaction.guildId);
    users.getOrCreate(viewId, 'u');
    passport.maybeRecoverSecu(viewId);
    const u = users.getUser(viewId);
    const targetUser = await interaction.client.users.fetch(viewId);
    if (kind === 'card') {
      let buf;
      try {
        const { renderPassportCardPng } = require(CANVAS_SK);
        const warns = passport.listWarns(hub, viewId, 8);
        const wtxt = warns.length
          ? warns.map((w) => `• −${w.degree} <@${w.mod_id}> — ${(w.reason || '—').slice(0, 32)}`)
          : ['(aucun)'];
        buf = await renderPassportCardPng({
          displayName: targetUser.username,
          secu: String(u.secu_points ?? 10),
          modScore: String(u.mod_tests_score ?? 0),
          candidature: String(u.candidature_status ?? 'aucune'),
          warnsBlock: wtxt.join('\n'),
        });
      } catch (e) {
        console.error('[passeport card]', e);
        return interaction.reply({ content: 'Canvas indisponible (module `canvas` / binaire).', ephemeral: true });
      }
      const f = new AttachmentBuilder(buf, { name: 'passeport_reborn.png' });
      const c = new ContainerBuilder();
      c.addMediaGalleryComponents(
        new MediaGalleryBuilder().addItems({ media: { url: 'attachment://passeport_reborn.png' } }),
      );
      c.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          '### Passeport — **vue carte**\n*Arrière-plan : même \`blz_bg\` que le profil BLZ.*',
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
      await interaction.deferUpdate();
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
