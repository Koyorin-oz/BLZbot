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
  if (h > 0) return `~**${h}** h **${m}** min`;
  return `~**${m}** min`;
}

function buildDeniedContainer() {
  const t = new TextDisplayBuilder().setContent(
    [
      '# 🔒 Salon Hacker',
      '',
      '🚫 **Accès refusé**',
      '',
      'Il te faut le rôle **Hacker** sur ce serveur pour ouvrir le salon.',
      cfg.hackerRoleId ? `\n🎫 Rôle attendu : <@&${cfg.hackerRoleId}>` : '',
      '\n👑 *Les owners peuvent toujours tester sans rôle.*',
    ].join('\n'),
  );
  return new ContainerBuilder().addTextDisplayComponents(t);
}

function buildCooldownContainer(msLeft) {
  const t = new TextDisplayBuilder().setContent(
    [
      '# ⏳ Salon Hacker',
      '',
      '🧊 **Patience, hacker…**',
      '',
      `Le salon reprend dans **${fmtCooldown(msLeft)}**.`,
      '\n_💡 Un passage = un tirage d’objet. Reviens après le cooldown._',
    ].join('\n'),
  );
  return new ContainerBuilder().addTextDisplayComponents(t);
}

function buildSuccessContainer({ loot, guildName }) {
  const head = new TextDisplayBuilder().setContent(
    [
      '# 🕶️ **Salon Hacker**',
      `📡 *${guildName}*`,
      '',
      '> ✨ *Backdoor ouverte — un paquet vient de tomber.*',
    ].join('\n'),
  );
  const pitch = new TextDisplayBuilder().setContent(
    [
      '## 🎯 C’est quoi ?',
      '',
      '🎲 **Loot surprise** — probas **pondérées** (pas la boutique).',
      '⏱️ **Cooldown 12 h** entre deux tirages.',
      '🎭 Pensé pour le **RP hack / exploit**.',
      '🎒 Idéal pour remplir **`/inventaire`** en mode test.',
    ].join('\n'),
  );
  const lootBlock = new TextDisplayBuilder().setContent(
    [
      '## 🎁 **Ton drop**',
      '',
      `### ${loot.name}`,
      '',
      `🆔 \`${loot.itemId}\``,
      '',
      '✅ *Objet ajouté à ton inventaire.*',
    ].join('\n'),
  );
  const foot = new TextDisplayBuilder().setContent(
    [
      '## 📋 Suite',
      '',
      '👉 Fais **`/inventaire`** pour voir la pile.',
      '',
      cfg.hackerRoleId
        ? `🔐 **Accès salon** — rôle <@&${cfg.hackerRoleId}> requis pour la prochaine fois.`
        : '🌐 **Accès** — aucun rôle requis sur cette instance.',
    ].join('\n'),
  );
  return new ContainerBuilder()
    .addTextDisplayComponents(head)
    .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small))
    .addTextDisplayComponents(pitch)
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
            new TextDisplayBuilder().setContent('# 🕶️ Salon Hacker\n\n⚠️ **Serveur uniquement** — utilise cette commande dans un salon du serveur.'),
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
