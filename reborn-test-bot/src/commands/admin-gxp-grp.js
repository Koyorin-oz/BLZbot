const {
  SlashCommandBuilder,
  PermissionFlagsBits,
} = require('discord.js');
const gm = require('../services/guildMember');
const playerGuilds = require('../services/playerGuilds');
const grpSeason = require('../services/grpSeason');
const { grpRankFromTotal, label } = require('../reborn/grades');
const { isOwner } = require('../lib/owners');
const { d } = require('../lib/slashDesc');

function parseAmount(raw) {
  const s = String(raw || '').replace(/\s/g, '');
  if (!s) throw new Error('Montant vide');
  return BigInt(s);
}

function canMod(interaction) {
  const admin = interaction.memberPermissions?.has(PermissionFlagsBits.Administrator);
  return Boolean(admin) || isOwner(interaction.user.id);
}

function fmtRank(grp) {
  const rk = grpRankFromTotal(grp);
  return rk ? label(rk) : '—';
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('admin-gxp-grp')
    .setDescription(d('🏰', 'Donner ou définir GXP / GRP (admin).'))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand((sc) =>
      sc
        .setName('donner-gxp')
        .setDescription('Ajouter du GXP membre (+ GXP guilde si le membre est dans une guilde).')
        .addUserOption((o) => o.setName('membre').setDescription('Joueur cible').setRequired(true))
        .addStringOption((o) => o.setName('montant').setDescription('Nombre entier').setRequired(true)),
    )
    .addSubcommand((sc) =>
      sc
        .setName('definir-gxp')
        .setDescription('Définir le GXP membre exact (serveur).')
        .addUserOption((o) => o.setName('membre').setDescription('Joueur cible').setRequired(true))
        .addStringOption((o) => o.setName('montant').setDescription('Nombre entier').setRequired(true)),
    )
    .addSubcommand((sc) =>
      sc
        .setName('donner-grp')
        .setDescription('Ajouter du GRP à un membre (serveur).')
        .addUserOption((o) => o.setName('membre').setDescription('Joueur cible').setRequired(true))
        .addStringOption((o) => o.setName('montant').setDescription('Nombre entier').setRequired(true)),
    )
    .addSubcommand((sc) =>
      sc
        .setName('definir-grp')
        .setDescription('Définir le GRP exact d’un membre (serveur).')
        .addUserOption((o) => o.setName('membre').setDescription('Joueur cible').setRequired(true))
        .addStringOption((o) => o.setName('montant').setDescription('Nombre entier').setRequired(true)),
    )
    .addSubcommand((sc) =>
      sc
        .setName('donner-guilde')
        .setDescription('Ajouter du GXP à une guilde joueur (player_guilds).')
        .addStringOption((o) =>
          o.setName('guilde_id').setDescription('ID guilde (ex. niv_12) — visible sur /profil-guilde').setRequired(true),
        )
        .addStringOption((o) => o.setName('montant').setDescription('Nombre entier').setRequired(true)),
    )
    .addSubcommand((sc) =>
      sc
        .setName('definir-guilde')
        .setDescription('Définir le GXP exact d’une guilde joueur.')
        .addStringOption((o) =>
          o.setName('guilde_id').setDescription('ID guilde (ex. niv_12)').setRequired(true),
        )
        .addStringOption((o) => o.setName('montant').setDescription('Nombre entier').setRequired(true)),
    ),

  async execute(interaction, ctx) {
    if (!canMod(interaction) && !ctx?.isOwner?.()) {
      return interaction.reply({ content: '❌ Réservé aux administrateurs.' });
    }

    const hub = interaction.guildId;
    if (!hub) return interaction.reply({ content: 'Serveur uniquement.' });

    const sub = interaction.options.getSubcommand();

    try {
      if (sub === 'donner-gxp' || sub === 'definir-gxp') {
        const target = interaction.options.getUser('membre', true);
        if (target.bot) return interaction.reply({ content: 'Impossible sur un bot.' });
        const amount = parseAmount(interaction.options.getString('montant', true));
        if (sub === 'donner-gxp' && amount <= 0n) {
          return interaction.reply({ content: 'Montant invalide (doit être > 0).' });
        }

        if (sub === 'donner-gxp') {
          gm.addGxp(hub, target.id, amount);
          playerGuilds.addGxpFromMemberActivity(hub, target.id, amount);
        } else {
          gm.setGxp(hub, target.id, amount);
        }

        const after = gm.getMemberRow(hub, target.id);
        const membership = playerGuilds.getMembershipInHub(target.id, hub);
        let extra = '';
        if (membership) {
          const g = playerGuilds.getGuild(membership.guild_id);
          if (g) {
            extra = `\n• **GXP guilde** (${g.name}) : **${playerGuilds.B(g.gxp).toLocaleString('fr-FR')}** · nv **${g.guild_level}**`;
          }
        }

        return interaction.reply({
          content:
            `✅ GXP membre de **${target.username}** → **${after.gxp.toLocaleString('fr-FR')}**` +
            (sub === 'donner-gxp' ? ` (**+${amount.toLocaleString('fr-FR')}**)` : '') +
            extra,
        });
      }

      if (sub === 'donner-grp' || sub === 'definir-grp') {
        const target = interaction.options.getUser('membre', true);
        if (target.bot) return interaction.reply({ content: 'Impossible sur un bot.' });
        const amount = parseAmount(interaction.options.getString('montant', true));
        if (sub === 'donner-grp' && amount <= 0n) {
          return interaction.reply({ content: 'Montant invalide (doit être > 0).' });
        }

        if (sub === 'donner-grp') {
          gm.addGrp(hub, target.id, amount);
        } else {
          gm.setGrp(hub, target.id, amount);
        }

        grpSeason.maybeResetMonthlyGrp(hub);
        const after = gm.getMemberRow(hub, target.id);
        grpSeason.recordGrpPeaksIfNeeded(hub, target.id, after.grp);

        return interaction.reply({
          content:
            `✅ GRP de **${target.username}** → **${after.grp.toLocaleString('fr-FR')}**` +
            (sub === 'donner-grp' ? ` (**+${amount.toLocaleString('fr-FR')}**)` : '') +
            `\n• Palier : **${fmtRank(after.grp)}** · saison \`${grpSeason.currentSeasonKey()}\``,
        });
      }

      const guildId = interaction.options.getString('guilde_id', true).trim();
      const amount = parseAmount(interaction.options.getString('montant', true));
      const gBefore = playerGuilds.getGuild(guildId);
      if (!gBefore) {
        return interaction.reply({ content: `❌ Guilde introuvable : \`${guildId}\`` });
      }
      if (gBefore.hub_discord_id !== hub) {
        return interaction.reply({ content: '❌ Cette guilde n’appartient pas à ce serveur.' });
      }

      if (sub === 'donner-guilde') {
        if (amount <= 0n) return interaction.reply({ content: 'Montant invalide (doit être > 0).' });
        playerGuilds.addGuildGxp(guildId, amount);
      } else {
        const r = playerGuilds.setGuildGxp(guildId, amount);
        if (!r.ok) return interaction.reply({ content: `❌ ${r.error}` });
      }

      const gAfter = playerGuilds.getGuild(guildId);
      const gxp = playerGuilds.B(gAfter.gxp);
      return interaction.reply({
        content:
          `✅ **${gAfter.name}** (\`${guildId}\`)\n` +
          `• **GXP guilde** : **${gxp.toLocaleString('fr-FR')}**` +
          (sub === 'donner-guilde' ? ` (**+${amount.toLocaleString('fr-FR')}**)` : '') +
          `\n• **Niveau guilde** : **${gAfter.guild_level}** · cap membres **${gAfter.member_cap}**`,
      });
    } catch (e) {
      return interaction.reply({ content: `❌ ${e.message || e}` });
    }
  },
};
