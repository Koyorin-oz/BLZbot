const { SlashCommandBuilder } = require('discord.js');
const quests = require('../services/quests');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('quete')
    .setDescription('Quêtes journalières / hebdomadaires (messages sur le serveur).')
    .addSubcommand((sc) => sc.setName('voir').setDescription('Progression actuelle'))
    .addSubcommand((sc) => sc.setName('quotidienne').setDescription('Réclamer la récompense du jour'))
    .addSubcommand((sc) => sc.setName('hebdo').setDescription('Réclamer la récompense hebdomadaire')),
  async execute(interaction) {
    if (!interaction.guildId) return interaction.reply({ content: 'Serveur uniquement.', ephemeral: true });
    const sub = interaction.options.getSubcommand();
    const uid = interaction.user.id;
    if (sub === 'voir') {
      const s = quests.summary(uid);
      return interaction.reply({
        content:
          `**Aujourd’hui** : **${s.msgs_today}** / ${s.daily_target} messages — récompense **${s.daily_reward.toLocaleString('fr-FR')}** starss (${s.daily_claimed ? 'déjà pris' : 'disponible si objectif atteint'})\n` +
          `**Semaine** : **${s.week_points}** / ${s.weekly_target} pts — **${s.weekly_reward.toLocaleString('fr-FR')}** starss (${s.weekly_claimed ? 'déjà pris' : 'disponible si objectif atteint'})\n` +
          `Messages (total suivi) : **${s.lifetime_msgs}**`,
        ephemeral: true,
      });
    }
    if (sub === 'quotidienne') {
      const r = quests.claimDaily(uid);
      if (!r.ok) return interaction.reply({ content: r.error, ephemeral: true });
      return interaction.reply({
        content: `Récompense quotidienne : **+${r.reward.toLocaleString('fr-FR')}** starss.`,
        ephemeral: true,
      });
    }
    if (sub === 'hebdo') {
      const r = quests.claimWeekly(uid);
      if (!r.ok) return interaction.reply({ content: r.error, ephemeral: true });
      return interaction.reply({
        content: `Récompense hebdo : **+${r.reward.toLocaleString('fr-FR')}** starss.`,
        ephemeral: true,
      });
    }
  },
};
