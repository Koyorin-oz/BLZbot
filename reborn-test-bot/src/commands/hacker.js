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
        '# Salon Hacker',
        '**À quoi ça sert ?**',
        'Une fois toutes les **12 h** (cooldown), tu tires **un objet** au hasard (probabilités pondérées). C’est pensé pour le **RP hack / exploit** et pour tester l’**inventaire** sans passer par la boutique.',
        '',
        '**Comment l’utiliser ?**',
        '1. Vérifie que tu as le **rôle Hacker** si le staff l’a activé sur ce serveur.',
        '2. Lance `/hacker` et attends la fin du cooldown si besoin.',
        '3. Regarde ton loot dans `/inventaire`.',
        '',
        `**Récompense du tirage** : **${loot.name}** · \`${loot.itemId}\``,
        '',
        cfg.hackerRoleId
          ? `**Rôle requis** : <@&${cfg.hackerRoleId}> *(les owners contournent les limites de test).*`
          : '*Aucun rôle requis sur cette instance (config).*',
      ].join('\n'),
    );
    const c = new ContainerBuilder().addTextDisplayComponents(body);
    return interaction.reply({ components: [c], flags: MessageFlags.IsComponentsV2 });
  },
};
