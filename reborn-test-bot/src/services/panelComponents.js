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
const pick = require('../lib/componentPickCache');
const { buildBoutiquePayload, buildInventairePayload } = require('../lib/shopV2Ui');
const { handlePurchase } = require('./purchase');
const users = require('./users');
const skillTree = require('./skillTree');
const passport = require('./passport');

const RENDER_TREE = path.join(
  __dirname,
  '..',
  '..',
  '..',
  'niveau',
  'src',
  'utils',
  'canvas-skill-tree-reborn',
);

const RENDER_PASS = path.join(
  __dirname,
  '..',
  '..',
  '..',
  'niveau',
  'src',
  'utils',
  'canvas-skill-tree-reborn',
);

const LABEL = { quest: 'Quête', guild: 'Guilde', shop: 'Boutique', ranked: 'Ranked', event: 'Événement' };

function partsFromShopValue(v) {
  if (!v) return null;
  const [a, b] = v.split(':');
  if (a === 's') return ['rb', 's', b];
  if (a === 'c') return ['rb', 'c', b];
  if (a === 'b') return ['rb', 'b', b];
  return null;
}

/**
 * @param {import('discord.js').Interaction} interaction
 */
async function handlePanelInteraction(interaction) {
  if (interaction.isStringSelectMenu()) {
    if (interaction.customId === 'rb:shop:sel') {
      const v = interaction.values[0];
      pick.set(interaction.user.id, interaction.message.id, v);
      await interaction.deferUpdate();
      return;
    }
    if (interaction.customId === 'rb:inv:sel') {
      pick.set(interaction.user.id, interaction.message.id, interaction.values[0]);
      await interaction.deferUpdate();
      return;
    }
    if (interaction.customId === 'rb:tree:sel') {
      pick.set(interaction.user.id, interaction.message.id, interaction.values[0]);
      await interaction.deferUpdate();
      return;
    }
  }

  if (!interaction.isButton()) return;

  if (interaction.customId === 'rb:shop:go') {
    const v = pick.get(interaction.user.id, interaction.message.id);
    const parts = partsFromShopValue(v);
    if (!parts) {
      return interaction.reply({
        content: 'Choisis d’abord un article dans le **menu déroulant**.',
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
      return interaction.reply({
        content: 'Choisis une **branche** dans le menu avant de débloquer.',
        ephemeral: true,
      });
    }
    const uid = interaction.user.id;
    const r = skillTree.buy(uid, br);
    if (!r.ok) {
      return interaction.reply({ content: `❌ ${r.error}`, ephemeral: true });
    }
    const buf = await tryRenderTree(uid, interaction);
    if (!buf) {
      return interaction.reply({
        content: `✅ **${LABEL[br] || br}** → étape **${r.newStep}** / 5 · Points restants : **${(users.getUser(uid).skill_points ?? 0)}**`,
        ephemeral: true,
      });
    }
    const file = new AttachmentBuilder(buf, { name: 'arbre_reborn.png' });
    const c = makeTreeContainer(
      `✅ **${LABEL[br] || br}** — palier **${r.newStep}** / 5 — points : **${users.getUser(uid).skill_points ?? 0}**`,
    );
    await interaction.deferUpdate();
    return interaction.editReply({
      files: [file],
      components: [c],
      flags: MessageFlags.IsComponentsV2,
    });
  }

  if (interaction.customId === 'rb:tree:re') {
    const buf = await tryRenderTree(interaction.user.id, interaction);
    if (!buf) {
      return interaction.reply({ content: 'Génération image indisponible (canvas / niveau).', ephemeral: true });
    }
    const file = new AttachmentBuilder(buf, { name: 'arbre_reborn.png' });
    const c = makeTreeContainer('**Arbre mis à jour.**');
    await interaction.deferUpdate();
    return interaction.editReply({
      files: [file],
      components: [c],
      flags: MessageFlags.IsComponentsV2,
    });
  }

  if (interaction.customId === 'rb:ps:card') {
    if (!interaction.guild) {
      return interaction.reply({ content: 'Serveur uniquement.', flags: 64 /* Ephemeral in v2 */ });
    }
    const uid = interaction.user.id;
    if (await ensurePassportTargetMatch(interaction)) {
      return interaction
        .reply({ content: 'Cette fiche n’est plus active.', flags: 64 })
        .catch(() => {});
    }
    const hub = interaction.guildId;
    users.getOrCreate(uid, interaction.user.username);
    passport.maybeRecoverSecu(uid);
    const u = users.getUser(uid);
    const targetUser = await interaction.client.users.fetch(uid);
    const warns = passport.listWarns(hub, uid, 8);
    const wtxt = warns.length
      ? warns.map((w) => `• −${w.degree} — <@${w.mod_id}> — ${(w.reason || '—').slice(0, 40)}`)
      : ['Aucun.'];
    let buf;
    try {
      const { renderPassportCardPng } = require(RENDER_PASS);
      buf = await renderPassportCardPng({
        displayName: targetUser.username,
        secu: String(u.secu_points ?? 10),
        modScore: String(u.mod_tests_score ?? 0),
        candidature: String(u.candidature_status ?? 'aucune'),
        warnsBlock: wtxt.join('\n'),
      });
    } catch (e) {
      console.error('[passeport canvas]', e);
      return interaction.reply({ content: 'Échec canvas passeport (vérifie le module `canvas`).', ephemeral: true });
    }
    const file = new AttachmentBuilder(buf, { name: 'passeport_reborn.png' });
    const c = new ContainerBuilder();
    c.addMediaGalleryComponents(
      new MediaGalleryBuilder().addItems({ media: { url: 'attachment://passeport_reborn.png' } }),
    );
    const td = new TextDisplayBuilder().setContent(
      '### Passeport (vue carte)\n*Même bannière que le profil — stats staff / sécu*',
    );
    c.addTextDisplayComponents(td);
    c.addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('rb:ps:txt')
          .setLabel('Fiche texte')
          .setStyle(ButtonStyle.Secondary)
          .setEmoji('📋'),
      ),
    );
    await interaction.deferUpdate();
    return interaction.editReply({
      files: [file],
      components: [c],
      flags: MessageFlags.IsComponentsV2,
    });
  }

  if (interaction.customId === 'rb:ps:txt') {
    if (!interaction.guild) {
      return interaction.reply({ content: 'Serveur uniquement.', flags: 64 });
    }
    const uid = interaction.user.id;
    if (await ensurePassportTargetMatch(interaction)) return;
    const p = buildPassportTextV2(
      await interaction.client.users.fetch(uid).catch(() => null),
      interaction,
    );
    if (!p) {
      return interaction.reply({ content: 'Erreur fiche texte.', ephemeral: true });
    }
    await interaction.deferUpdate();
    return interaction.editReply({
      files: p.files,
      components: p.components,
      flags: p.flags,
    });
  }
}

async function ensurePassportTargetMatch() {
  return false;
}

function makeTreeContainer(sub) {
  const t = new TextDisplayBuilder().setContent(`# Arbre de compétences\n${sub}`);
  const c = new ContainerBuilder().addTextDisplayComponents(t);
  c.addMediaGalleryComponents(
    new MediaGalleryBuilder().addItems({ media: { url: 'attachment://arbre_reborn.png' } }),
  );
  c.addTextDisplayComponents(
    new TextDisplayBuilder().setContent('Branche (menu) puis **Débloquer** (coût = numéro de palier).'),
  );
  return addArbreSelectRows(c, interaction) ? c : c; // will fix
}

/** @param {import('discord.js').ContainerBuilder} c */
let _badRef = null;

function addArbreSelectRows(container) {
  const { BRANCHES } = skillTree;
  const sel = new StringSelectMenuBuilder()
    .setCustomId('rb:tree:sel')
    .setPlaceholder('Branche à débloquer');
  const options = [];
  for (const b of BRANCHES) {
    const s = skillTree.step(
      (typeof _uidRef !== 'undefined' ? _uidRef : '0') || '0',
      b,
    );
  }
  return true;
}