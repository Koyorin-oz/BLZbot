const {
  SlashCommandBuilder,
  AttachmentBuilder,
  ContainerBuilder,
  MediaGalleryBuilder,
  SectionBuilder,
  SeparatorBuilder,
  TextDisplayBuilder,
  ThumbnailBuilder,
  MessageFlags,
  SeparatorSpacingSize,
} = require('discord.js');
const cfg = require('../config');
const meta = require('../services/meta');
const users = require('../services/users');
const catalog = require('../reborn/catalog');
const { rollHackerSalon } = require('../reborn/chestLoot');
const { isOwner } = require('../lib/owners');
const { renderHackerLootCard, renderHackerStatusCard } = require('../lib/canvasHacker');

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

function hasHackerRole(member) {
  if (!cfg.hackerRoleId) return true;
  if (!member || !member.roles) return false;
  return member.roles.cache.has(cfg.hackerRoleId);
}

function fmtCooldown(ms) {
  if (ms <= 0) return 'bientôt';
  const h = Math.floor(ms / 3_600_000);
  const m = Math.ceil((ms % 3_600_000) / 60_000);
  if (h > 0) return `~${h} h ${m} min`;
  return `~${m} min`;
}

function buildLootContainer(interaction, { fileName, loot, rarity }) {
  const accent = RARITY_ACCENT[rarity] ?? 0xf59e0b;
  const thumbUrl = interaction.user.displayAvatarURL({ extension: 'png', size: 128 });

  const gallery = new MediaGalleryBuilder().addItems({ media: { url: `attachment://${fileName}` } });
  const sepAfterImg = new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Large).setDivider(true);

  const mainBlock = new TextDisplayBuilder().setContent(
    [
      `## ${loot.name}`,
      `-# *${rarity}* · **Salon Hacker**`,
      '',
      '**Détails du drop**',
      `- Identifiant · \`${loot.itemId}\``,
      '- Statut · **`+1` en inventaire**',
      `- Serveur · ${interaction.guild.name}`,
    ].join('\n'),
      );

  const section = new SectionBuilder()
    .setThumbnailAccessory(
      new ThumbnailBuilder().setURL(thumbUrl).setDescription(`${interaction.user.username} · drop`),
    )
    .addTextDisplayComponents(mainBlock);

  const sepMid = new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true);

  const nextLines = [
    '### Et maintenant ?',
    '- **`/inventaire`** — tout ton butin et les quantités',
    '- Loot **pondéré** (hors boutique) — idéal **RP / tests**',
    '- **Cooldown 12 h** entre deux récompenses sur ce salon',
  ];
  if (cfg.hackerRoleId) {
    nextLines.push(`- Prochaine utilisation · rôle <@&${cfg.hackerRoleId}>`);
  }

  const footerBlock = new TextDisplayBuilder().setContent(nextLines.join('\n'));

  return new ContainerBuilder()
    .setAccentColor(accent)
    .addMediaGalleryComponents(gallery)
    .addSeparatorComponents(sepAfterImg)
    .addSectionComponents(section)
    .addSeparatorComponents(sepMid)
    .addTextDisplayComponents(footerBlock);
}

function buildStatusContainer(interaction, kind, extra, fileName) {
  const accent = kind === 'denied' ? 0xf87171 : 0xfbbf24;
  const thumbUrl = interaction.user.displayAvatarURL({ extension: 'png', size: 128 });

  const gallery = new MediaGalleryBuilder().addItems({ media: { url: `attachment://${fileName}` } });
  const sep = new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Large).setDivider(true);

  const title = kind === 'denied' ? '## Accès refusé' : '## Cooldown actif';
  const body =
    kind === 'denied'
      ? [
          title,
          '',
          'Ce salon est **réservé** aux membres avec le rôle **Hacker**.',
          cfg.hackerRoleId ? `\n> Rôle requis · <@&${cfg.hackerRoleId}>` : '',
          '\n*Les **owners** du bot peuvent tester sans rôle.*',
        ]
          .filter(Boolean)
          .join('\n')
      : [
          title,
          '',
          `Patience : prochain tirage **${extra.waitLabel}**`,
          '\n> Limite **12 h** entre deux récompenses.',
        ].join('\n');

  const section = new SectionBuilder()
    .setThumbnailAccessory(
      new ThumbnailBuilder()
        .setURL(thumbUrl)
        .setDescription(kind === 'denied' ? 'Verrou' : 'Horloge'),
    )
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(body));

  return new ContainerBuilder()
    .setAccentColor(accent)
    .addMediaGalleryComponents(gallery)
    .addSeparatorComponents(sep)
    .addSectionComponents(section);
}

async function v2Edit(interaction, { fileName, buffer, container }) {
  const file = new AttachmentBuilder(buffer, { name: fileName });
  return interaction.editReply({
    files: [file],
    components: [container],
    flags: MessageFlags.IsComponentsV2,
  });
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('hacker')
    .setDescription('Salon Hacker : carte + panneau détaillé (Components V2).'),
  async execute(interaction) {
    if (!interaction.guild) {
      const container = new ContainerBuilder()
        .setAccentColor(0x64748b)
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent(
            [
              '## Salon Hacker',
              '',
              '**Serveur uniquement** — lance la commande dans un salon du serveur.',
            ].join('\n'),
          ),
        );
      return interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    }

    await interaction.deferReply();

    const uid = interaction.user.id;
    users.getOrCreate(uid, interaction.user.username);
    const member = interaction.member;
    const owner = isOwner(uid);

    if (!owner && cfg.hackerRoleId && !hasHackerRole(member)) {
      const buf = await renderHackerStatusCard('denied');
      const fileName = 'hacker_denied.png';
      const container = buildStatusContainer(interaction, 'denied', {}, fileName);
      return v2Edit(interaction, { fileName, buffer: buf, container });
    }

    const key = `hacker_salon_last_${uid}`;
    const last = parseInt(meta.get(key) || '0', 10) || 0;
    const now = Date.now();
    if (!cfg.TEST_NO_LIMITS && now - last < cfg.HACKER_SALON_COOLDOWN_MS) {
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

    const buf = await renderHackerLootCard({
      guildName: interaction.guild.name,
      itemName: loot.name,
      itemId: loot.itemId,
      rarity,
    });
    const fileName = 'hacker_loot.png';
    const container = buildLootContainer(interaction, { fileName, loot, rarity });
    return v2Edit(interaction, { fileName, buffer: buf, container });
  },
};
