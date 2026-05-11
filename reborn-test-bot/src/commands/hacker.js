const {
  SlashCommandBuilder,
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  MessageFlags,
} = require('discord.js');
const cfg = require('../config');
const meta = require('../services/meta');
const users = require('../services/users');
const { rollHackerSalon } = require('../reborn/chestLoot');
const { isOwner } = require('../lib/owners');

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

function buildDeniedContainer() {
  const lines = [
    '# Salon Hacker',
    '',
    '**Accès refusé**',
    '',
    'Cette commande est réservée aux membres avec le rôle **Hacker** sur ce serveur.',
  ];
  if (cfg.hackerRoleId) lines.push('', `Rôle attendu : <@&${cfg.hackerRoleId}>.`);
  lines.push('', '*Les owners peuvent tester sans rôle.*');
  return new ContainerBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent(lines.join('\n')));
}

function buildCooldownContainer(msLeft) {
  return new ContainerBuilder().addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      [
        '# Salon Hacker',
        '',
        '**Cooldown actif**',
        '',
        `Prochain tirage possible dans **${fmtCooldown(msLeft)}** (limite **12 h** entre deux passages).`,
      ].join('\n'),
    ),
  );
}

function buildSuccessContainer({ loot, guildName }) {
  const head = new TextDisplayBuilder().setContent(
    [
      '# Salon Hacker',
      `*${guildName}*`,
      '',
      'Tirage **pondéré** d’un objet (hors boutique), utile pour le **RP hack** et pour tester l’**inventaire**.',
    ].join('\n'),
  );
  const lootBlock = new TextDisplayBuilder().setContent(
    [
      '## Récompense',
      '',
      `**${loot.name}**`,
      '',
      `\`${loot.itemId}\``,
      '',
      '_Objet ajouté à ton inventaire._',
    ].join('\n'),
  );
  const foot = new TextDisplayBuilder().setContent(
    [
      '## Suite',
      '',
      'Ouvre **`/inventaire`** pour voir le détail et les quantités.',
      '',
      cfg.hackerRoleId
        ? `Rôle requis pour les prochains passages : <@&${cfg.hackerRoleId}>.`
        : 'Sur cette instance, aucun rôle n’est requis.',
    ].join('\n'),
  );
  return new ContainerBuilder()
    .addTextDisplayComponents(head)
    .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small))
    .addTextDisplayComponents(lootBlock)
    .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small))
    .addTextDisplayComponents(foot);
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('hacker')
    .setDescription('Salon Hacker : loot pondéré (cooldown 12 h, rôle si configuré).'),
  async execute(interaction) {
    if (!interaction.guild) {
      return interaction.reply({
        components: [
          new ContainerBuilder().addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
              '# Salon Hacker\n\n**Serveur uniquement** — utilise cette commande dans un salon du serveur.',
            ),
          ),
        ],
        flags: MessageFlags.IsComponentsV2,
      });
    }
    const uid = interaction.user.id;
    users.getOrCreate(uid, interaction.user.username);
    const member = interaction.member;
    const owner = isOwner(uid);
    if (!owner && cfg.hackerRoleId && !hasHackerRole(member)) {
      return interaction.reply({
        components: [buildDeniedContainer()],
        flags: MessageFlags.IsComponentsV2,
      });
    }
    const key = `hacker_salon_last_${uid}`;
    const last = parseInt(meta.get(key) || '0', 10) || 0;
    const now = Date.now();
    if (!cfg.TEST_NO_LIMITS && now - last < cfg.HACKER_SALON_COOLDOWN_MS) {
      const left = cfg.HACKER_SALON_COOLDOWN_MS - (now - last);
      return interaction.reply({
        components: [buildCooldownContainer(left)],
        flags: MessageFlags.IsComponentsV2,
      });
    }
    const loot = rollHackerSalon();
    users.addInventory(uid, loot.itemId, 1);
    meta.set(key, String(now));
    const c = buildSuccessContainer({
      loot,
      guildName: interaction.guild.name,
    });
    return interaction.reply({ components: [c], flags: MessageFlags.IsComponentsV2 });
  },
};
