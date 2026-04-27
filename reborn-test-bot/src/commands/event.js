const { SlashCommandBuilder } = require('discord.js');
const users = require('../services/users');
const skillTree = require('../services/skillTree');
const db = require('../db');

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

module.exports = {
  data: new SlashCommandBuilder()
    .setName('event')
    .setDescription('Bonus liés à l’arbre Événement.')
    .addSubcommand((sc) =>
      sc.setName('spawner').setDescription('Réclamer ton Event Spawner hebdomadaire (arbre événement palier 5).'),
    ),
  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const uid = interaction.user.id;
    users.getOrCreate(uid, interaction.user.username);

    if (sub === 'spawner') {
      if (!skillTree.weeklyEventSpawnerEntitled(uid)) {
        return interaction.reply({
          content:
            'Réservé au **palier 5 Événement** dans `/arbre`. Continue de monter l’arbre événement pour le débloquer.',
        });
      }
      const u = users.getUser(uid);
      const last = u?.last_event_spawner_claim_ms || 0;
      const now = Date.now();
      if (now - last < WEEK_MS) {
        const remaining = WEEK_MS - (now - last);
        const h = Math.floor(remaining / 3_600_000);
        const m = Math.floor((remaining % 3_600_000) / 60_000);
        return interaction.reply({
          content: `Déjà réclamé cette semaine — reviens dans **${h}h${String(m).padStart(2, '0')}**.`,
        });
      }
      db.prepare('UPDATE users SET last_event_spawner_claim_ms = ? WHERE id = ?').run(now, uid);
      users.addInventory(uid, 'event_spawner', 1);
      return interaction.reply({
        content: '🎁 **Event Spawner** ajouté à ton inventaire (1× cette semaine).',
      });
    }
  },
};
