const { SlashCommandBuilder, ContainerBuilder, TextDisplayBuilder, MessageFlags } = require('discord.js');
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

module.exports = {
  data: new SlashCommandBuilder()
    .setName('hacker')
    .setDescription('Salon Hacker : loot pondéré (cooldown 12 h, rôle si configuré).'),
  async execute(interaction) {
    if (!interaction.guild) return interaction.reply({ content: 'Serveur uniquement.' });
    const uid = interaction.user.id;
    users.getOrCreate(uid, interaction.user.username);
    const member = interaction.member;
    const owner = isOwner(uid);
    if (!owner && cfg.hackerRoleId && !hasHackerRole(member)) {
      return interaction.reply({
        content: 'Tu n’as pas le rôle **Hacker** (ou `REBORN_HACKER_ROLE_ID`). Les owners outrepassent.',
        
      });
    }
    const key = `hacker_salon_last_${uid}`;
    const last = parseInt(meta.get(key) || '0', 10) || 0;
    const now = Date.now();
    if (!cfg.TEST_NO_LIMITS && now - last < cfg.HACKER_SALON_COOLDOWN_MS) {
      const left = Math.ceil((cfg.HACKER_SALON_COOLDOWN_MS - (now - last)) / 3600000);
      return interaction.reply({ content: `Salon Hacker : cooldown **~${left} h** restante.` });
    }
    const loot = rollHackerSalon();
    users.addInventory(uid, loot.itemId, 1);
    meta.set(key, String(now));
    const body = new TextDisplayBuilder().setContent(
      [
        '# 🕶️ Salon **Hacker**',
        '**Qu’est-ce que c’est ?** Un **tirage d’item** (pondéré) lié à l’**univers hack / exploit** côté RP : utile pour les tests d’inventaire et le flux loot **sans** casser l’économie classique.',
        '',
        `**Tu reçois** : **${loot.name}** · \`${loot.itemId}\``,
        '» Vérifie \`/inventaire\` pour l’**empilement** · Cooldown **12 h** (sauf owner / sandbox).',
        cfg.hackerRoleId ? `» Rôle requis : <@&${cfg.hackerRoleId}>.` : '» Aucun rôle requis (sandbox).',
      ].join('\n'),
    );
    const c = new ContainerBuilder().addTextDisplayComponents(body);
    return interaction.reply({ components: [c], flags: MessageFlags.IsComponentsV2 });
  },
};
