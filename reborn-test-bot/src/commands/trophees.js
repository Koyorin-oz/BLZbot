const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const trophies = require('../services/trophies');

const TIER_EMOJI = {
  commun: '⚪',
  rare: '🔵',
  epique: '🟣',
  mythique: '🔴',
  goatesque: '🟠',
  staresque: '⭐',
};

module.exports = {
  data: new SlashCommandBuilder()
    .setName('trophees')
    .setDescription('Trophées REBORN (déblocage auto + liste + tirage 24 h).')
    .addSubcommand((sc) => sc.setName('voir').setDescription('Tes trophées et critères'))
    .addSubcommand((sc) => sc.setName('verifier').setDescription('Revérifier les critères maintenant'))
    .addSubcommand((sc) => sc.setName('tirage').setDescription('Tirage 1×/24h : tente de débloquer un trophée pondéré (biais sur les critères déjà remplis).')),
  async execute(interaction) {
    const uid = interaction.user.id;
    const hub = interaction.guildId;
    const sub = interaction.options.getSubcommand();
    if (sub === 'verifier') {
      const newly = trophies.evaluate(uid, hub);
      const extra = newly.length ? `\nNouveau(x) : **${newly.join('**, **')}**` : '\nAucun nouveau trophée.';
      return interaction.reply({ content: `Vérification terminée.${extra}` });
    }
    if (sub === 'tirage') {
      const r = trophies.lottery(uid, hub);
      if (!r.ok) return interaction.reply({ content: `❌ ${r.error}` });
      const lines = [
        `🎰 **Tirage trophée** — ${TIER_EMOJI[r.tier] || '⚪'} **${r.name}** *(${r.tier})*`,
        `Récompense : **${r.reward.toLocaleString('fr-FR')}** starss`,
      ];
      if (r.templeBonus) lines.push(`✨ Bonus : **+${r.templeBonus}** point(s) Temple`);
      return interaction.reply({ content: lines.join('\n') });
    }
    trophies.evaluate(uid, hub);
    const unlocked = new Set(trophies.listUnlocked(uid).map((r) => r.trophy_id));
    const lines = trophies.DEFS.map((t) => {
      const ok = unlocked.has(t.id) ? '✅' : '⬜';
      const emoji = TIER_EMOJI[t.tier || 'commun'] || '⚪';
      return `${ok} ${emoji} **${t.name}** — ${t.desc}`;
    });
    const total = trophies.DEFS.length;
    const e = new EmbedBuilder()
      .setTitle(`Trophées — ${unlocked.size} / ${total}`)
      .setDescription(lines.join('\n').slice(0, 3900))
      .setColor(0xf1c40f)
      .setFooter({ text: '🎰 /trophees tirage — 1×/24h pour tenter d’en débloquer un.' });
    return interaction.reply({ embeds: [e] });
  },
};
