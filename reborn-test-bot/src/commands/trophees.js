const {
  SlashCommandBuilder,
  ContainerBuilder,
  TextDisplayBuilder,
  MessageFlags,
} = require('discord.js');
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
    .addSubcommand((sc) =>
      sc.setName('tirage').setDescription('Tirage 1×/24h : tente de débloquer un trophée pondéré (biais sur les critères déjà remplis).'),
    ),
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
    const total = trophies.DEFS.length;
    const done = trophies.DEFS.filter((t) => unlocked.has(t.id));
    const pending = trophies.DEFS.filter((t) => !unlocked.has(t.id));

    const fmtList = (arr, title) => {
      if (!arr.length) return `*${title} : aucun.*`;
      const lines = arr.map((t) => {
        const emoji = TIER_EMOJI[t.tier || 'commun'] || '⚪';
        const mark = unlocked.has(t.id) ? '✅' : '○';
        return `${mark} ${emoji} **${t.name}** — ${t.desc}`;
      });
      return `**${title}**\n${lines.join('\n')}`;
    };

    const intro = new TextDisplayBuilder().setContent(
      [
        '# Trophées',
        `**${unlocked.size}** / **${total}** débloqués`,
        '',
        '*Les critères se vérifient tout seuls ; `/trophees verifier` force une passe.*',
        '*`/trophees tirage`* : 1× / 24 h pour tenter d’en débloquer un au hasard.',
      ].join('\n'),
    );
    const linesDone = done.map((t) => {
      const emoji = TIER_EMOJI[t.tier || 'commun'] || '⚪';
      return `✅ ${emoji} **${t.name}** — ${t.desc}`;
    });
    const linesTodo = pending.map((t) => {
      const emoji = TIER_EMOJI[t.tier || 'commun'] || '⚪';
      return `○ ${emoji} **${t.name}** — ${t.desc}`;
    });
    const blocDone = new TextDisplayBuilder().setContent(
      linesDone.length ? `**Obtenus**\n${linesDone.join('\n')}`.slice(0, 3800) : '**Obtenus** — *aucun pour l’instant.*',
    );
    const blocTodo = new TextDisplayBuilder().setContent(
      linesTodo.length ? `**À débloquer**\n${linesTodo.join('\n')}`.slice(0, 3800) : '**À débloquer** — *tout est complété.*',
    );
    const c = new ContainerBuilder().addTextDisplayComponents(intro, blocDone, blocTodo);
    return interaction.reply({ components: [c], flags: MessageFlags.IsComponentsV2 });
  },
};
