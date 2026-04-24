const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const users = require('../services/users');
const passport = require('../services/passport');
const { listWarns } = require('../services/passport');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('passeport')
    .setDescription('Passeport staff / sécu (REBORN).')
    .addUserOption((o) => o.setName('membre').setDescription('Voir le passeport de…')),
  async execute(interaction) {
    const hub = interaction.guildId;
    if (!hub) return interaction.reply({ content: 'Serveur uniquement.', ephemeral: true });
    const target = interaction.options.getUser('membre') || interaction.user;
    users.getOrCreate(target.id, target.username);
    passport.maybeRecoverSecu(target.id);
    const u = users.getUser(target.id);
    const warns = listWarns(hub, target.id, 10);
    const wtxt = warns.length
      ? warns.map((w) => `• −${w.degree} pts — <@${w.mod_id}> — ${w.reason || '—'}`).join('\n')
      : 'Aucun warn enregistré ici.';
    const e = new EmbedBuilder()
      .setTitle(`Passeport — ${target.username}`)
      .addFields(
        { name: 'Points de sécu', value: String(u.secu_points ?? 10), inline: true },
        { name: 'Warns (ce serveur)', value: wtxt.slice(0, 900), inline: false },
      )
      .setFooter({ text: 'Récupération +2 pts / 30 j si perte (auto au prochain affichage).' })
      .setColor(0x95a5a6);
    return interaction.reply({ embeds: [e], ephemeral: true });
  },
};
