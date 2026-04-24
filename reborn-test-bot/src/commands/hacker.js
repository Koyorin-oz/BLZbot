const { SlashCommandBuilder } = require('discord.js');
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
    .setDescription('Salon Hacker : tirage d’item pondéré (cooldown 12 h, rôle requis si configuré).'),
  async execute(interaction) {
    if (!interaction.guild) return interaction.reply({ content: 'Serveur uniquement.', ephemeral: true });
    const uid = interaction.user.id;
    users.getOrCreate(uid, interaction.user.username);
    const member = interaction.member;
    const owner = isOwner(uid);
    if (!owner && cfg.hackerRoleId && !hasHackerRole(member)) {
      return interaction.reply({
        content: 'Tu n’as pas le rôle **Hacker** (ou demande à un admin de définir `REBORN_HACKER_ROLE_ID`). Les owners bypass.',
        ephemeral: true,
      });
    }
    const key = `hacker_salon_last_${uid}`;
    const last = parseInt(meta.get(key) || '0', 10) || 0;
    const now = Date.now();
    if (!cfg.TEST_NO_LIMITS && now - last < cfg.HACKER_SALON_COOLDOWN_MS) {
      const left = Math.ceil((cfg.HACKER_SALON_COOLDOWN_MS - (now - last)) / 3600000);
      return interaction.reply({ content: `Cooldown salon : encore ~**${left}** h.`, ephemeral: true });
    }
    const loot = rollHackerSalon();
    users.addInventory(uid, loot.itemId, 1);
    meta.set(key, String(now));
    return interaction.reply({
      content: `Salon **Hacker** — tu reçois : **${loot.name}** (\`${loot.itemId}\`).`,
      ephemeral: true,
    });
  },
};
