const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const temple = require('../services/temple');
const users = require('../services/users');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('temple')
    .setDescription('Points « temple » (réussite) — regroupe des accomplissements REBORN.')
    .addSubcommand((sc) => sc.setName('voir').setDescription('Points + statut (recalcul auto)'))
    .addSubcommand((sc) => sc.setName('sync').setDescription('Forcer le recalcul (serveur actuel)')),
  async execute(interaction) {
    const uid = interaction.user.id;
    users.getOrCreate(uid, interaction.user.username);
    const hub = interaction.guildId || null;
    const u = users.getUser(uid);
    const r = temple.sync(uid, hub);
    const unlocked = u.temple_unlocked
      ? '**Temple débloqué** : les **5** branches de l’arbre sont complètes (5/5 chacune).'
      : '**Temple verrouillé** : termine **tous** les paliers des **5** branches (`/arbre`) pour l’ouvrir.';

    const embed = new EmbedBuilder()
      .setColor(0x5b21b6)
      .setTitle('⛩️ Temple REBORN — points de réussite')
      .setDescription(
        [
          '**En bref** : le **temple** est un **compteur de “points de réussite**” (objectifs lourds) **distinct** de l’XP / Starss. Il sert de **paliers de fin de progression** (style “tout a été maîtrisé”) plutôt que de la monnaie du quotidien.',
          '',
          'Tant que le temple est **verrouillé**, tu peux quand même **gagner** des points listés par la sandbox ; le **déblocage** “temple” est une **étape de prestige** (arbre 5×5).',
        ].join('\n'),
      )
      .addFields(
        { name: 'Tes points', value: `**${r.points}** (sources partielles en test)`, inline: true },
        { name: 'Statut', value: unlocked, inline: false },
        { name: 'Clés comptées (ce sync)', value: r.keys.length ? r.keys.map((k) => `\`${k}\``).join(', ') : '—', inline: false },
        {
          name: 'Défense / séparations / Hacker / index event',
          value: 'En prod, d’**autres** sources alimenteraient le temple ; ici c’est un **aperçu** de la logique.',
          inline: false,
        },
      )
      .setFooter({ text: 'REBORN sandbox — /temple sync recalcule les conditions sur ce serveur' });

    return interaction.reply({ embeds: [embed], ephemeral: true });
  },
};
