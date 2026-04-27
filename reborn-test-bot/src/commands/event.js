const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const events = require('../services/events');
const { isOwner } = require('../lib/owners');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('event')
    .setDescription('Événements serveur (REBORN). Bonus arbre Événement actifs : currency, défense, coffres.')
    .addSubcommand((sc) =>
      sc
        .setName('lancer')
        .setDescription('[Owner] Lancer un événement')
        .addStringOption((o) =>
          o
            .setName('type')
            .setDescription('Type')
            .setRequired(true)
            .addChoices(
              { name: 'Chasse aux étoiles (24h)', value: 'chasse' },
              { name: 'Raid Cosmique (12h)', value: 'raid' },
              { name: 'Marathon Stellaire (48h)', value: 'marathon' },
            ),
        ),
    )
    .addSubcommand((sc) =>
      sc
        .setName('contribuer')
        .setDescription('Ajouter un score à un event en cours')
        .addStringOption((o) => o.setName('cle').setDescription('Clé event').setRequired(true))
        .addIntegerOption((o) => o.setName('score').setDescription('Score à ajouter').setRequired(true).setMinValue(1)),
    )
    .addSubcommand((sc) =>
      sc
        .setName('classement')
        .setDescription('Top 10 d\'un event')
        .addStringOption((o) => o.setName('cle').setDescription('Clé event').setRequired(true)),
    )
    .addSubcommand((sc) => sc.setName('actifs').setDescription('Voir les événements actifs'))
    .addSubcommand((sc) =>
      sc
        .setName('cloturer')
        .setDescription('[Owner] Clôturer un événement et distribuer les récompenses')
        .addStringOption((o) => o.setName('cle').setDescription('Clé event').setRequired(true)),
    ),
  async execute(interaction) {
    const hub = interaction.guildId;
    if (!hub) return interaction.reply({ content: 'Serveur uniquement.' });
    const sub = interaction.options.getSubcommand();
    const uid = interaction.user.id;

    if (sub === 'lancer') {
      if (!isOwner(uid)) return interaction.reply({ content: '❌ Owner uniquement.' });
      const t = interaction.options.getString('type', true);
      const r = events.startEvent(hub, t);
      if (!r.ok) return interaction.reply({ content: `❌ ${r.error}` });
      return interaction.reply({
        content: `🎉 **${r.name}** lancé. Clé : \`${r.key}\` — fin <t:${Math.floor(r.endsMs / 1000)}:R>.\nUtilise \`/event contribuer cle:${r.key} score:<n>\``,
      });
    }

    if (sub === 'contribuer') {
      const k = interaction.options.getString('cle', true);
      const score = interaction.options.getInteger('score', true);
      const r = events.contribute(hub, k, uid, score);
      if (!r.ok) return interaction.reply({ content: `❌ ${r.error}` });
      return interaction.reply({
        content: `+**${r.gained.toLocaleString('fr-FR')}** points (bonus arbre inclus). Voir \`/event classement cle:${k}\`.`,
      });
    }

    if (sub === 'classement') {
      const k = interaction.options.getString('cle', true);
      const top = events.leaderboard(hub, k, 10);
      if (!top.length) return interaction.reply({ content: 'Aucune participation pour cet event.' });
      const e = new EmbedBuilder()
        .setTitle(`Classement event — ${k}`)
        .setColor(0x9b59b6)
        .setDescription(top.map((r, i) => `**${i + 1}.** <@${r.user_id}> — **${Number(r.score).toLocaleString('fr-FR')}** pts`).join('\n'));
      return interaction.reply({ embeds: [e] });
    }

    if (sub === 'actifs') {
      const list = events.activeEvents(hub);
      if (!list.length) return interaction.reply({ content: 'Aucun event actif.' });
      const lines = list.map((e) => {
        let m = {};
        try { m = JSON.parse(e.meta_json || '{}'); } catch { /* ignore */ }
        return `• **${m.name || e.event_key}** — clé \`${e.event_key}\` — fin <t:${Math.floor(e.ends_ms / 1000)}:R>`;
      });
      return interaction.reply({ content: lines.join('\n') });
    }

    if (sub === 'cloturer') {
      if (!isOwner(uid)) return interaction.reply({ content: '❌ Owner uniquement.' });
      const k = interaction.options.getString('cle', true);
      const r = events.endEvent(hub, k);
      if (!r.ok) return interaction.reply({ content: `❌ ${r.error}` });
      if (!r.top.length) return interaction.reply({ content: '🏁 Event clôturé — aucun participant.' });
      const lines = r.top.map((row, i) => `**${i + 1}.** <@${row.user_id}> — **${Number(row.score).toLocaleString('fr-FR')}** pts`);
      return interaction.reply({
        content: [
          '🏁 **Event clôturé** — récompenses distribuées (1M/500k/250k/100k/50k).',
          `🏆 Champion : <@${r.winnerId}> — clé Temple **event_champion** acquise.`,
          ...lines,
        ].join('\n'),
      });
    }
  },
};
