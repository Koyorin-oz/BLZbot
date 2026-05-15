const {
  SlashCommandBuilder,
  EmbedBuilder,
  AttachmentBuilder,
} = require('discord.js');
const cfg = require('../config');
const meta = require('../services/meta');
const users = require('../services/users');
const catalog = require('../reborn/catalog');
const { rollHackerSalon } = require('../reborn/chestLoot');
const { isOwner } = require('../lib/owners');
const { renderHackerLootCard, renderHackerStatusCard, RARITY_HEX } = require('../lib/canvasHacker');

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

module.exports = {
  data: new SlashCommandBuilder()
    .setName('hacker')
    .setDescription('Salon Hacker : loot pondéré en image terminal (cooldown 12 h, rôle si configuré).'),
  async execute(interaction) {
    if (!interaction.guild) {
      const e = new EmbedBuilder()
        .setTitle('Salon Hacker')
        .setColor(0x95a5a6)
        .setDescription('**Serveur uniquement** — lance la commande dans un salon du serveur.');
      return interaction.reply({ embeds: [e] });
    }

    await interaction.deferReply();

    const uid = interaction.user.id;
    users.getOrCreate(uid, interaction.user.username);
    const member = interaction.member;
    const owner = isOwner(uid);

    if (!owner && cfg.hackerRoleId && !hasHackerRole(member)) {
      const buf = renderHackerStatusCard('denied');
      const file = new AttachmentBuilder(buf, { name: 'hacker_denied.png' });
      const roleLine = cfg.hackerRoleId ? `Rôle attendu : <@&${cfg.hackerRoleId}>.` : '';
      const embed = new EmbedBuilder()
        .setTitle('🔐 Accès refusé')
        .setColor(0xe74c3c)
        .setDescription(
          ['Réservé aux membres avec le rôle **Hacker** sur ce serveur.', roleLine, '', '*Owners : test sans rôle.*']
            .filter(Boolean)
            .join('\n'),
        )
        .setImage('attachment://hacker_denied.png');
      return interaction.editReply({ embeds: [embed], files: [file] });
    }

    const key = `hacker_salon_last_${uid}`;
    const last = parseInt(meta.get(key) || '0', 10) || 0;
    const now = Date.now();
    if (!cfg.TEST_NO_LIMITS && now - last < cfg.HACKER_SALON_COOLDOWN_MS) {
      const left = cfg.HACKER_SALON_COOLDOWN_MS - (now - last);
      const buf = renderHackerStatusCard('cooldown', { waitLabel: fmtCooldown(left) });
      const file = new AttachmentBuilder(buf, { name: 'hacker_wait.png' });
      const embed = new EmbedBuilder()
        .setTitle('⏳ Cooldown')
        .setColor(0xf39c12)
        .setDescription(
          `Prochain tirage dans **${fmtCooldown(left)}** (limite **12 h** entre deux injections).`,
        )
        .setImage('attachment://hacker_wait.png');
      return interaction.editReply({ embeds: [embed], files: [file] });
    }

    const loot = rollHackerSalon();
    const itemDef = catalog.getItem(loot.itemId);
    const rarity = itemDef?.rarity || 'Rare';
    users.addInventory(uid, loot.itemId, 1);
    meta.set(key, String(now));

    const buf = renderHackerLootCard({
      guildName: interaction.guild.name,
      itemName: loot.name,
      itemId: loot.itemId,
      rarity,
    });
    const file = new AttachmentBuilder(buf, { name: 'hacker_loot.png' });
    const accentNum = parseInt(String(RARITY_HEX[rarity] || '#2ecc71').replace('#', ''), 16);

    const embed = new EmbedBuilder()
      .setAuthor({ name: 'Salon Hacker', iconURL: interaction.user.displayAvatarURL({ size: 64 }) })
      .setTitle(`💠 ${loot.name}`)
      .setColor(Number.isFinite(accentNum) ? accentNum : 0x2ecc71)
      .setDescription(
        [
          `**Rareté :** ${rarity}`,
          `\`${loot.itemId}\``,
          '',
          'Objet **inject** dans ton inventaire — ouvre `/inventaire`.',
          cfg.hackerRoleId ? `\nRôle pour la prochaine fois : <@&${cfg.hackerRoleId}>.` : '',
        ]
          .filter(Boolean)
          .join('\n'),
      )
      .setImage('attachment://hacker_loot.png')
      .setFooter({ text: 'Loot pondéré hors boutique · RP hack / test inventaire' })
      .setTimestamp();

    return interaction.editReply({ embeds: [embed], files: [file] });
  },
};
