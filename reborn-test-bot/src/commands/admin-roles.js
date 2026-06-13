const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
} = require('discord.js');
const rankedRoles = require('../services/rankedRoles');
const indexRoles = require('../services/indexRoles');
const templeDiscordRoles = require('../services/templeDiscordRoles');
const { d } = require('../lib/slashDesc');

/**
 * Commande staff `/admin-roles` :
 *  - `creer-ranked`         : crée les rôles Bronze → Apex (skip ceux déjà créés)
 *  - `creer-index-full`     : crée le rôle « Pipelette ultime »
 *  - `creer-temple`         : crée les rôles Temple Roi / Légende (seuils doc)
 *  - `definir-ranked`       : associe manuellement un rôle existant à un tier
 *  - `definir-index-full`   : associe manuellement un rôle existant à l'index 100 %
 *  - `definir-temple-roi` / `definir-temple-legende` : lier rôles Discord classement Temple
 *  - `voir`                 : liste la configuration actuelle
 *  - `resync`               : force la resynchronisation pour un membre
 */
module.exports = {
  data: new SlashCommandBuilder()
    .setName('admin-roles')
    .setDescription(d('⚙️', 'Gestion des rôles Discord (Ranked, Index 100 %, Temple).'))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand((sc) =>
      sc.setName('creer-ranked').setDescription(d('🏅', 'Crée les rôles Vide → Star (échelle gdoc) sur ce serveur.')),
    )
    .addSubcommand((sc) =>
      sc
        .setName('creer-index-full')
        .setDescription(d('📦', "Crée le rôle « Pipelette ultime » (index 100 %).")),
    )
    .addSubcommand((sc) =>
      sc
        .setName('creer-temple')
        .setDescription(d('🏛️', 'Crée les rôles Temple — Roi et Légende.')),
    )
    .addSubcommand((sc) =>
      sc
        .setName('definir-ranked')
        .setDescription(d('🔗', 'Associe un rôle existant à un rang ranked (clé : ex. bronze_1, star).'))
        .addStringOption((o) =>
          o
            .setName('tier')
            .setDescription('Clé du rang (voir /admin-roles voir). Ex : plastique_1, or_2, legendaire, star.')
            .setRequired(true)
            .setAutocomplete(true),
        )
        .addRoleOption((o) =>
          o.setName('role').setDescription('Rôle Discord à utiliser').setRequired(true),
        ),
    )
    .addSubcommand((sc) =>
      sc
        .setName('definir-index-full')
        .setDescription(d('🔗', "Associe un rôle existant à l'index 100 %."))
        .addRoleOption((o) =>
          o.setName('role').setDescription('Rôle Discord à utiliser').setRequired(true),
        ),
    )
    .addSubcommand((sc) =>
      sc
        .setName('definir-temple-roi')
        .setDescription(d('👑', 'Associe un rôle aux joueurs Roi du Temple.'))
        .addRoleOption((o) =>
          o.setName('role').setDescription('Rôle Discord à utiliser').setRequired(true),
        ),
    )
    .addSubcommand((sc) =>
      sc
        .setName('definir-temple-legende')
        .setDescription(d('✨', 'Associe un rôle aux joueurs Légende du Temple.'))
        .addRoleOption((o) =>
          o.setName('role').setDescription('Rôle Discord à utiliser').setRequired(true),
        ),
    )
    .addSubcommand((sc) =>
      sc.setName('voir').setDescription(d('📋', 'Voir la configuration actuelle des rôles.')),
    )
    .addSubcommand((sc) =>
      sc
        .setName('resync')
        .setDescription(d('🔄', "Resynchroniser les rôles d'un membre."))
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

    if (sub === 'creer-ranked' || sub === 'creer-index-full' || sub === 'creer-temple') {
      return interaction.reply({
        content:
          'La création automatique de rôles est désactivée. Crée toi-même tes rôles sur Discord, puis :\n' +
          '• Ranked : les IDs se collent en dur dans `src/services/rankedRoles.js` (objet `RANK_ROLE_IDS`), ou utilise `/admin-roles definir-ranked`.\n' +
          '• Index 100 % : `/admin-roles definir-index-full`.\n' +
          '• Temple : `/admin-roles definir-temple-roi` et `/admin-roles definir-temple-legende`.',
      });
    }

    if (sub === 'definir-ranked') {
      const tier = interaction.options.getString('tier', true).trim();
      const role = interaction.options.getRole('role', true);
      const def = rankedRoles.RANKS_ASC.find((t) => t.key === tier);
      if (!def) {
        return interaction.reply({
          content: `❌ Rang inconnu : \`${tier}\`. Clés valides : ${rankedRoles.RANKS_ASC.map((t) => `\`${t.key}\``).join(', ')}`,
        });
      }
      rankedRoles.setRoleIdForTier(hub, tier, role.id);
      return interaction.reply({
        content: `✅ Rang **${def.label}** (\`${tier}\`) → ${role}`,
      });
    }

    if (sub === 'definir-index-full') {
      const role = interaction.options.getRole('role', true);
      indexRoles.setIndexFullRoleId(hub, role.id);
      return interaction.reply({ content: `✅ Index 100 % → ${role}` });
    }

    if (sub === 'definir-temple-roi') {
      const role = interaction.options.getRole('role', true);
      templeDiscordRoles.setRoiRoleId(hub, role.id);
      return interaction.reply({ content: `✅ Temple Roi → ${role}` });
    }

    if (sub === 'definir-temple-legende') {
      const role = interaction.options.getRole('role', true);
      templeDiscordRoles.setLegendeRoleId(hub, role.id);
      return interaction.reply({ content: `✅ Temple Légende → ${role}` });
    }

    if (sub === 'voir') {
      const list = rankedRoles.listConfiguredRoles(hub);
      const lines = list.map((t) =>
        t.roleId ? `• **${t.label}** → <@&${t.roleId}>` : `• **${t.label}** → *non configuré*`,
      );
      const idxRole = indexRoles.getIndexFullRoleId(hub);
      lines.push('');
      lines.push(idxRole ? `📚 **Index 100 %** → <@&${idxRole}>` : '📚 **Index 100 %** → *non configuré*');
      const roiT = templeDiscordRoles.getRoiRoleId(hub);
      const legT = templeDiscordRoles.getLegendeRoleId(hub);
      lines.push(roiT ? `⛩️ **Temple Roi** → <@&${roiT}>` : '⛩️ **Temple Roi** → *non configuré*');
      lines.push(legT ? `✨ **Temple Légende** → <@&${legT}>` : '✨ **Temple Légende** → *non configuré*');
      const e = new EmbedBuilder()
        .setTitle('🛡️ Rôles Discord — configuration')
        .setColor(0x3498db)
        .setDescription(lines.join('\n'));
      return interaction.reply({ embeds: [e] });
    }

    if (sub === 'resync') {
      const target = interaction.options.getUser('membre', true);
      rankedRoles.resetCacheFor(target.id);
      templeDiscordRoles.resetCacheForUser(target.id);
      const r1 = await rankedRoles.syncRankRoleForUser(interaction.client, hub, target.id);
      const r2 = await indexRoles.syncIndexFullRole(interaction.client, hub, target.id);
      const r3 = await templeDiscordRoles.syncTempleRolesForUser(interaction.client, hub, target.id);
      const templeLine = r3.skipped
        ? 'temple *(rôles non configurés)*'
        : `temple **${r3.band || '?'}**${r3.changed ? ' *(Discord mis à jour)*' : ''}${r3.error ? ` · \`${r3.error}\`` : ''}`;
      return interaction.reply({
        content: `Resync ${target} : ranked **${r1.tier || '?'}** ${r1.changed ? '(modifié)' : ''} · index ${r2.changed ? '(modifié)' : '(rien)'} · ${templeLine}${
          r1.error ? ` · ranked err: \`${r1.error}\`` : ''
        }`,
      });
    }
  },

  async autocomplete(interaction) {
    try {
      const focused = interaction.options.getFocused(true);
      if (focused.name !== 'tier') return interaction.respond([]);
      const q = String(focused.value || '').toLowerCase();
      const choices = rankedRoles.RANKS_ASC
        .filter((t) => t.key.includes(q) || t.label.toLowerCase().includes(q))
        .slice(0, 25)
        .map((t) => ({ name: `${t.label} (${t.key})`, value: t.key }));
      return interaction.respond(choices);
    } catch {
      return interaction.respond([]);
    }
  },
};
