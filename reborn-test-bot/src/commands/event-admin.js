const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType,
  EmbedBuilder,
} = require('discord.js');
const eventRoles = require('../services/eventRoles');
const eventsSO = require('../services/eventsSO');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('event-admin')
    .setDescription('Gestion des events Espace / Océan (rôles, salon, spawn).')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand((sc) =>
      sc.setName('creer-roles').setDescription('Crée les 8 rôles de quête des events.'),
    )
    .addSubcommand((sc) =>
      sc
        .setName('salon')
        .setDescription("Définit le salon d'annonce des spawns d'event.")
        .addChannelOption((o) =>
          o
            .setName('salon')
            .setDescription("Salon où annoncer les events")
            .addChannelTypes(ChannelType.GuildText)
            .setRequired(true),
        ),
    )
    .addSubcommand((sc) =>
      sc
        .setName('spawn')
        .setDescription('Force le spawn immédiat d\'un event (test).')
        .addStringOption((o) =>
          o
            .setName('event')
            .setDescription('Quel event')
            .setRequired(true)
            .addChoices(
              { name: 'Espace', value: 'space' },
              { name: 'Océan', value: 'ocean' },
            ),
        ),
    )
    .addSubcommand((sc) => sc.setName('voir').setDescription('État des events et config.')),

  async execute(interaction, ctx) {
    if (
      !ctx?.isOwner?.() &&
      !interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)
    ) {
      return interaction.reply({ content: 'Réservé aux administrateurs.' });
    }
    if (!interaction.guildId) return interaction.reply({ content: 'Sur un serveur uniquement.' });
    const sub = interaction.options.getSubcommand();

    if (sub === 'creer-roles') {
      return interaction.reply({
        content:
          'La création automatique de rôles est désactivée. Crée tes rôles d\'event toi-même sur Discord, puis colle leurs IDs en dur dans `src/services/eventRoles.js` (objet `EVENT_ROLE_IDS`).',
      });
    }

    if (sub === 'salon') {
      const channel = interaction.options.getChannel('salon', true);
      eventsSO.setAnnounce(interaction.guildId, channel.id);
      return interaction.reply({ content: `Salon d'annonce des events : ${channel}.` });
    }

    if (sub === 'spawn') {
      const eventKey = interaction.options.getString('event', true);
      const r = eventsSO.forceSpawn(eventKey);
      if (!r.ok) return interaction.reply({ content: 'Spawn impossible.' });
      try {
        await eventsSO.tick(interaction.client);
      } catch {
        /* ignore */
      }
      return interaction.reply({
        content: `Event **${eventKey}** lancé — fin <t:${Math.floor(r.until / 1000)}:R>.`,
      });
    }

    if (sub === 'voir') {
      const ann = eventsSO.getAnnounce();
      const roleList = eventRoles
        .listConfigured(interaction.guildId)
        .map((e) => `${e.label} → ${e.roleId ? `<@&${e.roleId}>` : '*non configuré*'}`);
      const embed = new EmbedBuilder()
        .setTitle('Events — état')
        .setColor(0x5865f2)
        .setDescription(
          [
            `Espace : ${eventsSO.isActive('space') ? `actif (fin <t:${Math.floor(eventsSO.activeUntil('space') / 1000)}:R>)` : 'inactif'}`,
            `Océan : ${eventsSO.isActive('ocean') ? `actif (fin <t:${Math.floor(eventsSO.activeUntil('ocean') / 1000)}:R>)` : 'inactif'}`,
            `Salon d'annonce : ${ann?.channelId ? `<#${ann.channelId}>` : '*non configuré*'}`,
            '',
            '**Rôles d\'event :**',
            ...roleList,
          ].join('\n'),
        );
      return interaction.reply({ embeds: [embed] });
    }
  },
};
