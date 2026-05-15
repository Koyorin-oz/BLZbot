const {
  SlashCommandBuilder,
  AttachmentBuilder,
  ContainerBuilder,
  MediaGalleryBuilder,
  TextDisplayBuilder,
  MessageFlags,
} = require('discord.js');
const cfg = require('../config');
const meta = require('../services/meta');
const users = require('../services/users');
const catalog = require('../reborn/catalog');
const { rollHackerSalon } = require('../reborn/chestLoot');
const { isOwner } = require('../lib/owners');
const { renderHackerLootCard, renderHackerStatusCard, RARITY_RING } = require('../lib/canvasHacker');

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

function v2Reply(interaction, { fileName, buffer, textLines }) {
  const file = new AttachmentBuilder(buffer, { name: fileName });
  const gallery = new MediaGalleryBuilder().addItems({ media: { url: `attachment://${fileName}` } });
  const caption = new TextDisplayBuilder().setContent(textLines.filter(Boolean).join('\n'));
  const container = new ContainerBuilder()
    .addMediaGalleryComponents(gallery)
    .addTextDisplayComponents(caption);
  return interaction.editReply({
    files: [file],
    components: [container],
    flags: MessageFlags.IsComponentsV2,
  });
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('hacker')
    .setDescription('Salon Hacker : carte loot (Components V2 · cooldown 12 h, rôle si configuré).'),
  async execute(interaction) {
    if (!interaction.guild) {
      const container = new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          '### Salon Hacker\n\n**Serveur uniquement** — utilise cette commande dans un salon du serveur.',
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
      const roleLine = cfg.hackerRoleId ? `Rôle requis : <@&${cfg.hackerRoleId}>.` : '';
      return v2Reply(interaction, {
        fileName: 'hacker_denied.png',
        buffer: buf,
        textLines: [
          '### Accès refusé',
          '',
          'Réservé aux membres avec le rôle **Hacker** sur ce serveur.',
          roleLine,
          '',
          '*Owners : déjà autorisés sans rôle.*',
        ],
      });
    }

    const key = `hacker_salon_last_${uid}`;
    const last = parseInt(meta.get(key) || '0', 10) || 0;
    const now = Date.now();
    if (!cfg.TEST_NO_LIMITS && now - last < cfg.HACKER_SALON_COOLDOWN_MS) {
      const left = cfg.HACKER_SALON_COOLDOWN_MS - (now - last);
      const buf = await renderHackerStatusCard('cooldown', { waitLabel: fmtCooldown(left) });
      return v2Reply(interaction, {
        fileName: 'hacker_wait.png',
        buffer: buf,
        textLines: [
          '### Cooldown',
          '',
          `Prochain tirage dans **${fmtCooldown(left)}** (limite **12 h** entre deux récompenses).`,
        ],
      });
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

    const lines = [
      '### Salon Hacker',
      `**${loot.name}** · *${rarity}*`,
      `\`${loot.itemId}\``,
      '',
      'Objet **ajouté** à ton inventaire — `/inventaire`.',
    ];
    if (cfg.hackerRoleId) lines.push('', `Pour les prochains passages : rôle <@&${cfg.hackerRoleId}>.`);

    return v2Reply(interaction, {
      fileName: 'hacker_loot.png',
      buffer: buf,
      textLines: lines,
    });
  },
};
