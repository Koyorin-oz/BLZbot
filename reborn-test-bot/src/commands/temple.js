const {
  SlashCommandBuilder,
  TextDisplayBuilder,
  ContainerBuilder,
  MessageFlags,
} = require('discord.js');
const temple = require('../services/temple');
const users = require('../services/users');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('temple')
    .setDescription('Temple REBORN : points de réussite (sync + affichage).')
    .addSubcommand((sc) => sc.setName('voir').setDescription('Voir tes points temple (recalcul auto)'))
    .addSubcommand((sc) => sc.setName('sync').setDescription('Recalculer les conditions (serveur actuel)')),
  async execute(interaction) {
    const uid = interaction.user.id;
    users.getOrCreate(uid, interaction.user.username);
    const hub = interaction.guildId || null;
    const sub = interaction.options.getSubcommand();
    const r = temple.sync(uid, hub);
    const u = users.getUser(uid);
    const unlocked = u.temple_unlocked ? '**Temple débloqué** (toutes les branches arbre à 5).' : 'Temple verrouillé — complète les **5** étapes des **5** branches (`/arbre`).';
    const txt = new TextDisplayBuilder().setContent(
      `# Temple\n**Points** : **${r.points}** / 11+\n${unlocked}\n\n**Sources détectées** : ${r.keys.length ? r.keys.map((k) => `\`${k}\``).join(', ') : '—'}\n\n*Défense / séparation / rôle Hacker / index event : à brancher sur les vrais événements Discord.*`,
    );
    const c = new ContainerBuilder().addTextDisplayComponents(txt);
    if (sub === 'sync' || sub === 'voir') {
      return interaction.reply({ components: [c], flags: MessageFlags.IsComponentsV2, ephemeral: true });
    }
  },
};
