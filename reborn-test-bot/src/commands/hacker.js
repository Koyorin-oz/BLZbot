const {
  SlashCommandBuilder,
  AttachmentBuilder,
  ContainerBuilder,
  MediaGalleryBuilder,
  SeparatorBuilder,
  TextDisplayBuilder,
  MessageFlags,
  SeparatorSpacingSize,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionFlagsBits,
} = require('discord.js');
const cfg = require('../config');
const { resolveChannelIdForGuild } = require('../services/hackerAccess');
const meta = require('../services/meta');
const users = require('../services/users');
const catalog = require('../reborn/catalog');
const { rollHackerSalon } = require('../reborn/chestLoot');
const { isOwner } = require('../lib/owners');
const { hasHackerSalonAccess } = require('../services/hackerAccess');
const { renderHackerLootCard, renderHackerStatusCard } = require('../lib/canvasHacker');
const { d } = require('../lib/slashDesc');
const { deferReplyEphemeral, replyEphemeral, v2Ephemeral } = require('../lib/ephemeral');

const HACKER_SALON_BUTTON_ID = 'rb:hacker:claim';

/** Couleur d’accent du container V2 (proche rareté). */
const RARITY_ACCENT = {
  Commun: 0x94a3b8,
  Rare: 0x38bdf8,
  Epique: 0xc084fc,
  Légendaire: 0xfb923c,
  Mythique: 0xf87171,
  Goatesque: 0x2dd4bf,
  Staresque: 0xfacc15,
};

function hasHackerRole(member, userId) {
  if (hasHackerSalonAccess(userId, member)) return true;
  if (!cfg.hackerRoleId) return false;
  if (!member || !member.roles) return false;
  return member.roles.cache.has(cfg.hackerRoleId);
}

/** Pas de cooldown 12 h : owners app, proprio du serveur, permission Administrateur. */
function bypassHackerCooldown(interaction, userId) {
  if (isOwner(userId)) return true;
  const g = interaction.guild;
  if (g && g.ownerId === userId) return true;
  if (interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) return true;
  return false;
}

function fmtCooldown(ms) {
  if (ms <= 0) return 'bientôt';
  const h = Math.floor(ms / 3_600_000);
  const m = Math.ceil((ms % 3_600_000) / 60_000);
  if (h > 0) return `~${h} h ${m} min`;
  return `~${m} min`;
}

function buildLootContainer(_interaction, { fileName, loot, rarity }) {
  const accent = RARITY_ACCENT[rarity] ?? 0xf59e0b;
  const head = new TextDisplayBuilder().setContent(
    `-# **${loot.name}** · \`${loot.itemId}\` · *${rarity}*`,
  );
  const sep = new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(false);
  const gallery = new MediaGalleryBuilder().addItems({ media: { url: `attachment://${fileName}` } });
  return new ContainerBuilder()
    .setAccentColor(accent)
    .addTextDisplayComponents(head)
    .addSeparatorComponents(sep)
    .addMediaGalleryComponents(gallery);
}

function buildStatusContainer(_interaction, kind, extra, fileName) {
  const accent = kind === 'denied' ? 0xf87171 : 0xfbbf24;
  const head =
    kind === 'denied'
      ? new TextDisplayBuilder().setContent(
          cfg.hackerRoleId
            ? `-# **Accès refusé** · <@&${cfg.hackerRoleId}>`
            : `-# **Accès refusé**`,
        )
      : new TextDisplayBuilder().setContent(`-# **Cooldown** · ${extra.waitLabel}`);
  const sep = new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(false);
  const gallery = new MediaGalleryBuilder().addItems({ media: { url: `attachment://${fileName}` } });
  return new ContainerBuilder()
    .setAccentColor(accent)
    .addTextDisplayComponents(head)
    .addSeparatorComponents(sep)
    .addMediaGalleryComponents(gallery);
}

async function v2Edit(interaction, { fileName, buffer, container }) {
  const file = new AttachmentBuilder(buffer, { name: fileName });
  return interaction.editReply({
    files: [file],
    components: [container],
    flags: v2Ephemeral(),
  });
}

/**
 * même logique que l’ancien `/hacker`, déclenchée par le bouton du panneau.
 */
async function handleHackerSalonButton(interaction) {
  if (!interaction.guild) {
    return replyEphemeral(interaction, { content: 'Utilise ce bouton dans un salon du serveur.' });
  }

  await deferReplyEphemeral(interaction);

  const uid = interaction.user.id;
  users.getOrCreate(uid, interaction.user.username);
  const member = interaction.member;
  const owner = isOwner(uid);

  if (!owner && !hasHackerRole(member, uid)) {
    const buf = await renderHackerStatusCard('denied');
    const fileName = 'hacker_denied.png';
    const container = buildStatusContainer(interaction, 'denied', {}, fileName);
    return v2Edit(interaction, { fileName, buffer: buf, container });
  }

  const key = `hacker_salon_last_${uid}`;
  const last = parseInt(meta.get(key) || '0', 10) || 0;
  const now = Date.now();
  const skipCooldown = cfg.TEST_NO_LIMITS || bypassHackerCooldown(interaction, uid);
  if (!skipCooldown && now - last < cfg.HACKER_SALON_COOLDOWN_MS) {
    const left = cfg.HACKER_SALON_COOLDOWN_MS - (now - last);
    const buf = await renderHackerStatusCard('cooldown', { waitLabel: fmtCooldown(left) });
    const fileName = 'hacker_wait.png';
    const container = buildStatusContainer(interaction, 'cooldown', { waitLabel: fmtCooldown(left) }, fileName);
    return v2Edit(interaction, { fileName, buffer: buf, container });
  }

  const loot = rollHackerSalon();
  const itemDef = catalog.getItem(loot.itemId);
  const rarity = itemDef?.rarity || 'Rare';
  users.addInventory(uid, loot.itemId, 1);
  meta.set(key, String(now));
  try {
    const eventRoles = require('../services/eventRoles');
    eventRoles.queueEventRoleSync(uid);
  } catch {
    /* ignore */
  }

  const buf = await renderHackerLootCard({
    guildName: interaction.guild.name,
    itemName: loot.name,
    itemId: loot.itemId,
    rarity,
  });
  const fileName = 'hacker_loot.png';
  const container = buildLootContainer(interaction, { fileName, loot, rarity });
  return v2Edit(interaction, { fileName, buffer: buf, container });
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('salon-hacker')
    .setDescription(d('🔒', 'Publie le panneau Salon Hacker (loot toutes les 12 h).'))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  HACKER_SALON_BUTTON_ID,
  handleHackerSalonButton,
  async execute(interaction) {
    if (!interaction.guild) {
      return interaction.reply({
        content: 'Utilise cette commande sur un serveur.',
        ephemeral: true,
      });
    }
    const canPost =
      isOwner(interaction.user.id) ||
      Boolean(interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild));
    if (!canPost) {
      return interaction.reply({
        content:
          'Permission **Gérer le serveur** requise pour poster le panneau (owners du bot exclus).',
        ephemeral: true,
      });
    }

    const hub = interaction.guildId;
    const hackerCh = hub ? resolveChannelIdForGuild(hub) : null;
    let salonLine = '';
    if (hackerCh && hub) {
      const ch = await interaction.client.channels.fetch(hackerCh).catch(() => null);
      if (ch?.guildId === hub) salonLine = `Salon : <#${hackerCh}>`;
      else if (ch?.name) salonLine = `Salon secret : **#${ch.name}**`;
    }

    const embed = new EmbedBuilder()
      .setColor(0x7c2d12)
      .setTitle('🔒 Salon Secret Hackeur')
      .setDescription(
        [
          'En tant que **Hackeur**, tu peux récupérer un **item aléatoire** toutes les **12 heures** !',
          '',
          salonLine,
          '',
          'Clique sur le bouton ci-dessous pour récupérer ton item.',
          '',
          '*Tu ne peux réclamer qu’**une fois** toutes les 12 heures.*',
        ]
          .filter(Boolean)
          .join('\n'),
      );

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(HACKER_SALON_BUTTON_ID)
        .setLabel('Récupérer mon item')
        .setStyle(ButtonStyle.Primary),
    );

    await interaction.reply({ embeds: [embed], components: [row] });
  },
};
