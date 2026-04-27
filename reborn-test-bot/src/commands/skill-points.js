const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const users = require('../services/users');
const skillTree = require('../services/skillTree');
const db = require('../db');
const { isOwner } = require('../lib/owners');

function canMod(interaction) {
  const admin = interaction.memberPermissions?.has(PermissionFlagsBits.Administrator);
  return Boolean(admin) || isOwner(interaction.user.id);
}

function getSp(userId) {
  const u = users.getUser(userId);
  return u?.skill_points ?? 0;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('skill-points')
    .setDescription('Gérer les points de compétence (admin serveur ou owner app).')
    .addSubcommand((sc) =>
      sc
        .setName('give')
        .setDescription('Ajouter des points de compétence')
        .addUserOption((o) => o.setName('membre').setDescription('Cible').setRequired(true))
        .addIntegerOption((o) =>
          o.setName('montant').setDescription('Nombre à ajouter').setRequired(true).setMinValue(1).setMaxValue(10000),
        ),
    )
    .addSubcommand((sc) =>
      sc
        .setName('remove')
        .setDescription('Retirer des points de compétence (plancher 0)')
        .addUserOption((o) => o.setName('membre').setDescription('Cible').setRequired(true))
        .addIntegerOption((o) =>
          o.setName('montant').setDescription('Nombre à retirer').setRequired(true).setMinValue(1).setMaxValue(10000),
        ),
    )
    .addSubcommand((sc) =>
      sc
        .setName('set')
        .setDescription('Définir le solde exact de points de compétence')
        .addUserOption((o) => o.setName('membre').setDescription('Cible').setRequired(true))
        .addIntegerOption((o) =>
          o.setName('montant').setDescription('Solde exact').setRequired(true).setMinValue(0).setMaxValue(10000),
        ),
    )
    .addSubcommand((sc) =>
      sc
        .setName('voir')
        .setDescription('Lire les points & paliers actuels d’un membre (admin)')
        .addUserOption((o) => o.setName('membre').setDescription('Cible').setRequired(true)),
    )
    .addSubcommand((sc) =>
      sc
        .setName('reset-arbre')
        .setDescription('Remettre toutes les branches à 0 (les points dépensés ne sont pas remboursés)')
        .addUserOption((o) => o.setName('membre').setDescription('Cible').setRequired(true)),
    ),
  async execute(interaction) {
    if (!canMod(interaction)) {
      return interaction.reply({ content: 'Permission refusée.', ephemeral: true });
    }
    const sub = interaction.options.getSubcommand();
    const target = interaction.options.getUser('membre', true);
    if (target.bot) {
      return interaction.reply({ content: 'Impossible sur un bot.', ephemeral: true });
    }
    users.getOrCreate(target.id, target.username);

    try {
      if (sub === 'give') {
        const n = interaction.options.getInteger('montant', true);
        db.prepare('UPDATE users SET skill_points = COALESCE(skill_points, 0) + ? WHERE id = ?').run(n, target.id);
        return interaction.reply({
          content: `✅ **+${n}** point(s) de compétence pour **${target.username}** (total : **${getSp(target.id)}**).`,
          ephemeral: true,
        });
      }
      if (sub === 'remove') {
        const n = interaction.options.getInteger('montant', true);
        const cur = getSp(target.id);
        const next = Math.max(0, cur - n);
        db.prepare('UPDATE users SET skill_points = ? WHERE id = ?').run(next, target.id);
        return interaction.reply({
          content: `✅ **−${n}** point(s) de compétence pour **${target.username}** (total : **${next}**).`,
          ephemeral: true,
        });
      }
      if (sub === 'set') {
        const n = interaction.options.getInteger('montant', true);
        db.prepare('UPDATE users SET skill_points = ? WHERE id = ?').run(n, target.id);
        return interaction.reply({
          content: `✅ Points de compétence de **${target.username}** → **${n}**.`,
          ephemeral: true,
        });
      }
      if (sub === 'voir') {
        const sp = getSp(target.id);
        const lines = skillTree.BRANCHES.map((b) => {
          const s = skillTree.step(target.id, b);
          const label = { quest: 'Quête', guild: 'Guilde', shop: 'Boutique', ranked: 'Ranked', event: 'Événement' }[b] || b;
          return `• **${label}** : **${s} / 5**`;
        });
        return interaction.reply({
          content: [
            `🪪 **${target.username}** — points & arbre`,
            `Points dispo : **${sp}**`,
            ...lines,
          ].join('\n'),
          ephemeral: true,
        });
      }
      if (sub === 'reset-arbre') {
        skillTree.saveTree(target.id, {});
        skillTree.syncTempleUnlock(target.id);
        return interaction.reply({
          content:
            `✅ Arbre de **${target.username}** réinitialisé (toutes branches à 0/5). ` +
            'Le temple a été resynchronisé. *Note : les points dépensés ne sont pas remboursés ; utilise `set` ou `give` pour rééquilibrer.*',
          ephemeral: true,
        });
      }
    } catch (e) {
      return interaction.reply({ content: `❌ ${e.message || e}`, ephemeral: true });
    }
  },
};
