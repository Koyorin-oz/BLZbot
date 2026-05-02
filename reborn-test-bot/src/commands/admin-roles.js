const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
} = require('discord.js');
const rankedRoles = require('../services/rankedRoles');
const indexRoles = require('../services/indexRoles');

/**
 * Commande staff `/admin-roles` :
 *  - `creer-ranked`         : crée les rôles Bronze → Apex (skip ceux déjà créés)
 *  - `creer-index-full`     : crée le rôle « Pipelette ultime »
 *  - `definir-ranked`       : associe manuellement un rôle existant à un tier
 *  - `definir-index-full`   : associe manuellement un rôle existant à l'index 100 %
 *  - `voir`                 : liste la configuration actuelle
 *  - `resync`               : force la resynchronisation pour un membre
 */
module.exports = {
  data: new SlashCommandBuilder()
    .setName('admin-roles')
    .setDescription("Gestion des rôles Discord (Ranked RP, Index 100 %).")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand((sc) =>
      sc.setName('creer-ranked').setDescription('Crée les rôles Bronze → Apex sur ce serveur.'),
    )
    .addSubcommand((sc) =>
      sc
        .setName('creer-index-full')
        .setDescription("Crée le rôle « Pipelette ultime » (100 % d'index)."),
    )
    .addSubcommand((sc) =>
      sc
        .setName('definir-ranked')
        .setDescription('Associe un rôle existant à un tier ranked.')
        .addStringOption((o) =>
          o
            .setName('tier')
            .setDescription('Tier ranked')
            .setRequired(true)
            .addChoices(
              ...rankedRoles.TIER_DEFS.map((t) => ({ name: t.label, value: t.key })),
            ),
        )
        .addRoleOption((o) =>
          o.setName('role').setDescription('Rôle Discord à utiliser').setRequired(true),
        ),
    )
    .addSubcommand((sc) =>
      sc
        .setName('definir-index-full')
        .setDescription("Associe un rôle existant à l'index 100 %.")
        .addRoleOption((o) =>
          o.setName('role').setDescription('Rôle Discord à utiliser').setRequired(true),
        ),
    )
    .addSubcommand((sc) =>
      sc.setName('voir').setDescription('Voir la configuration actuelle des rôles.'),
    )
    .addSubcommand((sc) =>
      sc
        .setName('resync')
        .setDescription("Forcer la resynchronisation des rôles d'un membre.")
        .addUserOption((o) =>
          o.setName('membre').setDescription('Membre à resync').setRequired(true),
        ),
    ),

  async execute(interaction, ctx) {
    if (
      !ctx.isOwner() &&
      !interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)
    ) {
      return interaction.reply({ content: '❌ Réservé aux administrateurs.' });
    }
    const hub = interaction.guildId;
    if (!hub) return interaction.reply({ content: 'Sur un serveur uniquement.' });
    const sub = interaction.options.getSubcommand();
    const guild = interaction.guild;

    if (sub === 'creer-ranked') {
      await interaction.deferReply();
      const created = [];
      const skipped = [];
      const failed = [];
      for (const t of rankedRoles.TIER_DEFS) {
        const existing = rankedRoles.getRoleIdForTier(hub, t.key);
        if (existing && guild.roles.cache.get(existing)) {
          skipped.push(`${t.label} → <@&${existing}>`);
          continue;
        }
        try {
          const role = await guild.roles.create({
            name: `Ranked · ${t.label}`,
            color: t.color,
            mentionable: false,
            reason: 'Création automatique des rôles Ranked RP',
          });
          rankedRoles.setRoleIdForTier(hub, t.key, role.id);
          created.push(`${t.label} → <@&${role.id}>`);
        } catch (e) {
          failed.push(`${t.label} : \`${e?.message || e}\``);
        }
      }
      const lines = [];
      if (created.length) lines.push(`✅ **Créés** : ${created.join(' · ')}`);
      if (skipped.length) lines.push(`⏭️ **Déjà existants** : ${skipped.join(' · ')}`);
      if (failed.length) lines.push(`❌ **Échecs** : ${failed.join('\n')}`);
      lines.push('');
      lines.push(
        "*Astuce : place les rôles ci-dessus **en dessous** du rôle du bot pour que l'auto-assignation marche.*",
      );
      return interaction.editReply({ content: lines.join('\n') });
    }

    if (sub === 'creer-index-full') {
      await interaction.deferReply();
      const existing = indexRoles.getIndexFullRoleId(hub);
      if (existing && guild.roles.cache.get(existing)) {
        return interaction.editReply({
          content: `⏭️ Déjà configuré : <@&${existing}>`,
        });
      }
      try {
        const role = await guild.roles.create({
          name: 'Pipelette ultime',
          color: 0xf39c12,
          mentionable: false,
          reason: "Création du rôle Index 100 %",
        });
        indexRoles.setIndexFullRoleId(hub, role.id);
        return interaction.editReply({
          content: `✅ Rôle créé : <@&${role.id}> (attribué automatiquement à 100 % d'index).`,
        });
      } catch (e) {
        return interaction.editReply({ content: `❌ Échec : \`${e?.message || e}\`` });
      }
    }

    if (sub === 'definir-ranked') {
      const tier = interaction.options.getString('tier', true);
      const role = interaction.options.getRole('role', true);
      rankedRoles.setRoleIdForTier(hub, tier, role.id);
      return interaction.reply({
        content: `✅ Tier **${tier}** → ${role}`,
      });
    }

    if (sub === 'definir-index-full') {
      const role = interaction.options.getRole('role', true);
      indexRoles.setIndexFullRoleId(hub, role.id);
      return interaction.reply({ content: `✅ Index 100 % → ${role}` });
    }

    if (sub === 'voir') {
      const list = rankedRoles.listConfiguredRoles(hub);
      const lines = list.map((t) =>
        t.roleId ? `• **${t.label}** → <@&${t.roleId}>` : `• **${t.label}** → *non configuré*`,
      );
      const idxRole = indexRoles.getIndexFullRoleId(hub);
      lines.push('');
      lines.push(idxRole ? `📚 **Index 100 %** → <@&${idxRole}>` : '📚 **Index 100 %** → *non configuré*');
      const e = new EmbedBuilder()
        .setTitle('🛡️ Rôles Discord — configuration')
        .setColor(0x3498db)
        .setDescription(lines.join('\n'));
      return interaction.reply({ embeds: [e] });
    }

    if (sub === 'resync') {
      const target = interaction.options.getUser('membre', true);
      rankedRoles.resetCacheFor(target.id);
      const r1 = await rankedRoles.syncRankRoleForUser(interaction.client, hub, target.id);
      const r2 = await indexRoles.syncIndexFullRole(interaction.client, hub, target.id);
      return interaction.reply({
        content: `Resync ${target} : ranked **${r1.tier || '?'}** ${r1.changed ? '(modifié)' : ''} · index ${r2.changed ? '(modifié)' : '(rien)'}${r1.error ? ` · err: \`${r1.error}\`` : ''}`,
      });
    }
  },
};
