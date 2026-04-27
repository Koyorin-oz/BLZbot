const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const trophies = require('../services/trophies');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('trophees')
    .setDescription('Trophées REBORN (déblocage auto + liste).')
    .addSubcommand((sc) => sc.setName('voir').setDescription('Tes trophées et critères'))
    .addSubcommand((sc) => sc.setName('verifier').setDescription('Revérifier les critères maintenant')),
  async execute(interaction) {
    const uid = interaction.user.id;
    const hub = interaction.guildId;
    const sub = interaction.options.getSubcommand();
    if (sub === 'verifier') {
      const newly = trophies.evaluate(uid, hub);
      const extra = newly.length ? `\nNouveau(x) : **${newly.join('**, **')}**` : '\nAucun nouveau trophée.';
      return interaction.reply({ content: `Vérification terminée.${extra}` });
    }
    trophies.evaluate(uid, hub);
    const unlocked = new Set(trophies.listUnlocked(uid).map((r) => r.trophy_id));
    const lines = trophies.DEFS.map((t) => {
      const ok = unlocked.has(t.id) ? '✅' : '⬜';
      return `${ok} **${t.name}** — ${t.desc}`;
    });
    const e = new EmbedBuilder()
      .setTitle('Trophées')
      .setDescription(lines.join('\n').slice(0, 3900))
      .setColor(0xf1c40f);
    return interaction.reply({ embeds: [e] });
  },
};
