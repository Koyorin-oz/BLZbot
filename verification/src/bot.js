/**
 * Bot Discord — partie commandes/UI :
 *  - /setup-verification : panneau admin avec menus (salon panneau, rôle vérifié, salon
 *    logs SANS IP, personnalisation embed, publication).
 *  - /verify : commande de secours pour obtenir le lien OAuth (équivalent du bouton).
 *  - Le bouton "Vérifier" du panneau public ouvre un lien éphémère vers `/oauth/start?...`.
 *
 * Note : les logs AVEC IP partent en DM aux owners (voir `index.js`), pas dans un salon.
 * Pour cette raison, /setup-verification ne propose PAS de "salon logs avec IP".
 */
const {
  Client,
  GatewayIntentBits,
  Partials,
  Events,
  SlashCommandBuilder,
  MessageFlags,
  PermissionFlagsBits,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  RoleSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ChannelType,
} = require('discord.js');
const { signState } = require('./cryptoUtil');
const {
  getGuildConfig,
  upsertGuildConfig,
  getEffectiveEmbed,
  resetEmbedToDefault,
  findVerifiedInGuild,
  deleteVerifiedForGuild,
} = require('./database');
const { addGuildMemberRole, removeGuildMemberRole } = require('./discordApi');

function isGuildAdmin(interaction) {
  return Boolean(
    interaction.guild && interaction.memberPermissions?.has(PermissionFlagsBits.Administrator),
  );
}

/**
 * Permissions staff acceptées pour /unverify : on autorise les modérateurs classiques
 * en plus des admins, pour que la commande soit utilisable au quotidien sans donner
 * Administrator à tout le monde.
 */
function isStaffForUnverify(interaction) {
  if (!interaction.guild || !interaction.memberPermissions) return false;
  return (
    interaction.memberPermissions.has(PermissionFlagsBits.Administrator) ||
    interaction.memberPermissions.has(PermissionFlagsBits.ManageGuild) ||
    interaction.memberPermissions.has(PermissionFlagsBits.BanMembers) ||
    interaction.memberPermissions.has(PermissionFlagsBits.KickMembers) ||
    interaction.memberPermissions.has(PermissionFlagsBits.ModerateMembers)
  );
}

function buildSetupRows() {
  return [
    new ActionRowBuilder().addComponents(
      new ChannelSelectMenuBuilder()
        .setCustomId('setup:panel_ch')
        .setPlaceholder('Salon du panneau (embed + bouton)')
        .setMinValues(1)
        .setMaxValues(1)
        .setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement),
    ),
    new ActionRowBuilder().addComponents(
      new RoleSelectMenuBuilder()
        .setCustomId('setup:verified_role')
        .setPlaceholder('Rôle donné après vérification')
        .setMinValues(1)
        .setMaxValues(1),
    ),
    new ActionRowBuilder().addComponents(
      new ChannelSelectMenuBuilder()
        .setCustomId('setup:log_noip')
        .setPlaceholder('Salon logs (sans adresse IP)')
        .setMinValues(1)
        .setMaxValues(1)
        .setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement),
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('setup:publish')
        .setLabel('Publier / mettre à jour le panneau')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId('setup:embed_modal')
        .setLabel("Personnaliser l'embed")
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId('setup:embed_default')
        .setLabel('Embed par défaut')
        .setStyle(ButtonStyle.Secondary),
    ),
  ];
}

function describeConfig(cfg) {
  const c = cfg || {};
  const fmt = (id) => (id ? `<#${id}>` : '*(non défini)*');
  const role = c.verified_role_id ? `<@&${c.verified_role_id}>` : '*(non défini)*';
  return (
    `**Salon panneau :** ${fmt(c.panel_channel_id)}\n` +
    `**Rôle vérifié :** ${role}\n` +
    `**Logs sans IP :** ${fmt(c.log_channel_no_ip_id)}\n` +
    `**Logs avec IP :** *DM aux owners* (configuré via \`OWNER_DM_IDS\` dans \`.env\`)\n\n` +
    `Utilise les menus ci-dessous pour modifier chaque valeur, puis **Publier** pour poster le message public avec le bouton de vérification.`
  );
}

/**
 * @param {object} opts
 * @param {string} opts.publicBaseUrl
 * @param {string} opts.stateSecret
 */
function createBot(opts) {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMembers,
      GatewayIntentBits.DirectMessages,
    ],
    partials: [Partials.Channel, Partials.User],
  });

  function buildVerifyUrl(discordUserId, guildId) {
    const state = signState({ discordUserId, guildId }, opts.stateSecret);
    const base = opts.publicBaseUrl.replace(/\/$/, '');
    return `${base}/oauth/start?state=${encodeURIComponent(state)}`;
  }

  client.once(Events.ClientReady, async (c) => {
    console.log(`[bot] Connecté : ${c.user.tag}`);
    try {
      await c.application.commands.set(buildSlashCommands());
      console.log('[bot] Commandes slash globales enregistrées (/verify, /setup-verification, /unverify).');
    } catch (e) {
      console.error('[bot] Échec enregistrement des commandes globales :', e);
    }
  });

  /**
   * Ré-applique le rôle vérifié si un membre déjà vérifié rejoint à nouveau le serveur.
   */
  client.on(Events.GuildMemberAdd, async (member) => {
    if (member.user.bot) return;
    const cfg = getGuildConfig(member.guild.id);
    if (!cfg?.verified_role_id) return;
    if (member.roles.cache.has(cfg.verified_role_id)) return;
    const row = findVerifiedInGuild(member.guild.id, member.id);
    if (!row) return;
    try {
      await addGuildMemberRole(client.token, member.guild.id, member.id, cfg.verified_role_id);
    } catch (e) {
      console.error('[GuildMemberAdd] Rôle vérifié impossible :', e.message || e);
    }
  });

  client.on(Events.InteractionCreate, async (interaction) => {
    try {
      if (interaction.isButton() && interaction.customId === 'verify:go') {
        await handleVerifyButton(interaction, buildVerifyUrl, client);
        return;
      }

      if (interaction.isModalSubmit() && interaction.customId === 'setup:embed_submit') {
        await handleEmbedModalSubmit(interaction, client);
        return;
      }

      if (interaction.isChannelSelectMenu()) {
        await handleChannelSelect(interaction);
        return;
      }

      if (interaction.isRoleSelectMenu() && interaction.customId === 'setup:verified_role') {
        await handleRoleSelect(interaction);
        return;
      }

      if (interaction.isButton() && interaction.customId.startsWith('setup:')) {
        await handleSetupButton(interaction, client);
        return;
      }

      if (!interaction.isChatInputCommand()) return;

      if (interaction.commandName === 'setup-verification') {
        if (!interaction.guild || !isGuildAdmin(interaction)) {
          await interaction.reply({
            content: 'Réservé aux membres avec la permission **Administrateur**.',
            flags: MessageFlags.Ephemeral,
          });
          return;
        }
        const cfg = getGuildConfig(interaction.guild.id);
        await interaction.reply({
          embeds: [
            new EmbedBuilder()
              .setTitle('Configuration — vérification')
              .setDescription(describeConfig(cfg))
              .setColor(0x5865f2),
          ],
          components: buildSetupRows(),
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      if (interaction.commandName === 'verify') {
        await handleVerifyCommand(interaction, buildVerifyUrl, client);
        return;
      }

      if (interaction.commandName === 'unverify') {
        await handleUnverifyCommand(interaction, client);
        return;
      }
    } catch (e) {
      console.error('[InteractionCreate]', e);
      const payload = { content: `Erreur : ${e.message || e}`, flags: MessageFlags.Ephemeral };
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp(payload).catch(() => {});
      } else {
        await interaction.reply(payload).catch(() => {});
      }
    }
  });

  return { client, buildVerifyUrl };
}

async function handleVerifyButton(interaction, buildVerifyUrl, client) {
  if (!interaction.guild) {
    await interaction.reply({
      content: 'Utilisable seulement sur un serveur.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  const cfg = getGuildConfig(interaction.guild.id);
  if (!cfg?.verified_role_id) {
    await interaction.reply({
      content: "La vérification n'est pas configurée sur ce serveur.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  const member = interaction.member;
  if (member?.roles?.cache?.has(cfg.verified_role_id)) {
    await interaction.reply({ content: 'Tu es déjà vérifié.', flags: MessageFlags.Ephemeral });
    return;
  }
  const existing = findVerifiedInGuild(interaction.guild.id, interaction.user.id);
  if (existing) {
    try {
      await addGuildMemberRole(
        client.token,
        interaction.guild.id,
        interaction.user.id,
        cfg.verified_role_id,
      );
      await interaction.reply({
        content: 'Tu étais déjà enregistré comme vérifié : le rôle a été réappliqué.',
        flags: MessageFlags.Ephemeral,
      });
    } catch (e) {
      await interaction.reply({
        content: `Impossible d'attribuer le rôle : ${e.message || e}`,
        flags: MessageFlags.Ephemeral,
      });
    }
    return;
  }
  const url = buildVerifyUrl(interaction.user.id, interaction.guild.id);
  await interaction.reply({
    content:
      `🔗 Ouvre ce lien dans ton navigateur (**même compte Discord**) :\n${url}\n\n` +
      `Une fois validé, tu recevras automatiquement le rôle.`,
    flags: MessageFlags.Ephemeral,
  });
}

async function handleVerifyCommand(interaction, buildVerifyUrl, client) {
  if (!interaction.guild) {
    await interaction.reply({
      content: 'À utiliser sur un serveur.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  const cfg = getGuildConfig(interaction.guild.id);
  if (!cfg?.verified_role_id) {
    await interaction.reply({
      content:
        "Ce serveur n'a pas encore configuré la vérification. Demande à un **administrateur** d'utiliser `/setup-verification`.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  let member = interaction.member;
  if (!member) {
    member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
  }
  if (!member) {
    await interaction.reply({
      content: 'Impossible de charger ton profil sur ce serveur. Réessaie dans un instant.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  if (member.roles.cache.has(cfg.verified_role_id)) {
    await interaction.reply({ content: 'Tu as déjà le rôle vérifié.', flags: MessageFlags.Ephemeral });
    return;
  }
  const row = findVerifiedInGuild(interaction.guild.id, interaction.user.id);
  if (row) {
    try {
      await addGuildMemberRole(
        client.token,
        interaction.guild.id,
        interaction.user.id,
        cfg.verified_role_id,
      );
      await interaction.reply({
        content: 'Tu étais déjà vérifié pour ce serveur : le rôle a été réattribué.',
        flags: MessageFlags.Ephemeral,
      });
    } catch (e) {
      await interaction.reply({
        content: `Erreur rôle : ${e.message || e}. Vérifie que le rôle du bot est **au-dessus** du rôle vérifié.`,
        flags: MessageFlags.Ephemeral,
      });
    }
    return;
  }
  const url = buildVerifyUrl(interaction.user.id, interaction.guild.id);
  await interaction.reply({
    content: `🔗 Lien de vérification :\n${url}`,
    flags: MessageFlags.Ephemeral,
  });
}

async function handleUnverifyCommand(interaction, client) {
  if (!interaction.guild) {
    await interaction.reply({
      content: 'Commande utilisable uniquement sur un serveur.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  if (!isStaffForUnverify(interaction)) {
    await interaction.reply({
      content:
        'Réservé au staff (Administrateur, Gérer le serveur, Bannir, Expulser ou Modérer les membres).',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const target = interaction.options.getUser('user', true);
  const reason = (interaction.options.getString('raison') || '').trim();

  if (target.bot) {
    await interaction.reply({
      content: 'Impossible de dévérifier un bot.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const cfg = getGuildConfig(interaction.guild.id);
  const dbRow = findVerifiedInGuild(interaction.guild.id, target.id);

  const member = await interaction.guild.members
    .fetch(target.id)
    .catch(() => null);

  const hasRole = Boolean(
    cfg?.verified_role_id && member?.roles?.cache?.has(cfg.verified_role_id),
  );

  if (!dbRow && !hasRole) {
    await interaction.editReply({
      content: `${target} n'est pas vérifié sur ce serveur (aucune entrée en base, pas de rôle vérifié appliqué).`,
    });
    return;
  }

  let roleRemoved = false;
  let roleError = null;
  if (hasRole) {
    try {
      await removeGuildMemberRole(
        client.token,
        interaction.guild.id,
        target.id,
        cfg.verified_role_id,
      );
      roleRemoved = true;
    } catch (e) {
      roleError = e?.message || String(e);
      console.error('[unverify] Échec retrait rôle :', roleError);
    }
  }

  const dbDeleted = deleteVerifiedForGuild(interaction.guild.id, target.id);

  const lines = [
    `**${target.tag || target.username}** (\`${target.id}\`) — dévérifié.`,
    `• Entrée DB supprimée : ${dbDeleted ? '✅' : '➖ (aucune)'}`,
    `• Rôle vérifié retiré : ${
      hasRole ? (roleRemoved ? '✅' : `❌ (${roleError || 'erreur'})`) : '➖ (pas appliqué)'
    }`,
  ];
  if (reason) lines.push(`• Raison : ${reason}`);
  lines.push('', "L'IP et l'email associés sont libérés : un autre compte peut désormais utiliser cet email sur ce serveur, et l'IP n'apparaîtra plus dans la détection d'alts.");

  await interaction.editReply({ content: lines.join('\n') });

  if (cfg?.log_channel_no_ip_id) {
    try {
      const logCh = await interaction.guild.channels
        .fetch(cfg.log_channel_no_ip_id)
        .catch(() => null);
      if (logCh && logCh.isTextBased()) {
        const embed = new EmbedBuilder()
          .setTitle('Membre dévérifié')
          .setColor(0xed4245)
          .setDescription(
            `**Cible :** ${target} (\`${target.id}\`)\n` +
              `**Modérateur :** ${interaction.user} (\`${interaction.user.id}\`)\n` +
              `**Rôle retiré :** ${
                hasRole ? (roleRemoved ? 'oui' : 'tentative échouée') : 'pas appliqué'
              }\n` +
              `**Entrée DB :** ${dbDeleted ? 'supprimée' : 'aucune'}` +
              (reason ? `\n**Raison :** ${reason}` : ''),
          )
          .setTimestamp(new Date());
        await logCh.send({ embeds: [embed] }).catch(() => {});
      }
    } catch (e) {
      console.error('[unverify] log channel error :', e?.message || e);
    }
  }
}

async function handleEmbedModalSubmit(interaction, client) {
  if (!interaction.guild || !isGuildAdmin(interaction)) {
    await interaction.reply({
      content: 'Réservé aux administrateurs.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  const title = interaction.fields.getTextInputValue('embed_title').trim();
  const description = interaction.fields.getTextInputValue('embed_description').trim();
  const colorRaw = interaction.fields.getTextInputValue('embed_color').trim();
  let embedColor = null;
  if (colorRaw) {
    const hex = colorRaw.startsWith('#') ? colorRaw.slice(1) : colorRaw;
    const n = parseInt(hex, 16);
    if (!Number.isNaN(n) && n >= 0 && n <= 0xffffff) embedColor = n;
  }
  upsertGuildConfig(interaction.guild.id, {
    embed_title: title || null,
    embed_description: description || null,
    embed_color: embedColor != null ? embedColor : null,
  });
  await refreshPublicPanel(interaction.guild, client);
  const cfg = getGuildConfig(interaction.guild.id);
  const warn =
    embedColor == null && colorRaw
      ? '\n⚠️ Couleur invalide ignorée (ex. `5865F2` ou `#5865F2`).'
      : '';
  await interaction.reply({
    content: `Embed mis à jour.${warn}`,
    embeds: [
      new EmbedBuilder()
        .setTitle('Configuration — vérification')
        .setDescription(describeConfig(cfg))
        .setColor(0x5865f2),
    ],
    components: buildSetupRows(),
    flags: MessageFlags.Ephemeral,
  });
}

async function handleChannelSelect(interaction) {
  if (!interaction.guild || !isGuildAdmin(interaction)) {
    await interaction.reply({
      content: 'Réservé aux administrateurs.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  const id = interaction.values[0];
  if (interaction.customId === 'setup:panel_ch')
    upsertGuildConfig(interaction.guild.id, { panel_channel_id: id });
  if (interaction.customId === 'setup:log_noip')
    upsertGuildConfig(interaction.guild.id, { log_channel_no_ip_id: id });
  const cfg = getGuildConfig(interaction.guild.id);
  await interaction.update({
    embeds: [
      new EmbedBuilder()
        .setTitle('Configuration — vérification')
        .setDescription(describeConfig(cfg))
        .setColor(0x5865f2),
    ],
    components: buildSetupRows(),
  });
}

async function handleRoleSelect(interaction) {
  if (!interaction.guild || !isGuildAdmin(interaction)) {
    await interaction.reply({
      content: 'Réservé aux administrateurs.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  const rid = interaction.values[0];
  upsertGuildConfig(interaction.guild.id, { verified_role_id: rid });
  const cfg = getGuildConfig(interaction.guild.id);
  await interaction.update({
    embeds: [
      new EmbedBuilder()
        .setTitle('Configuration — vérification')
        .setDescription(describeConfig(cfg))
        .setColor(0x5865f2),
    ],
    components: buildSetupRows(),
  });
}

async function handleSetupButton(interaction, client) {
  if (!interaction.guild || !isGuildAdmin(interaction)) {
    await interaction.reply({
      content: 'Réservé aux administrateurs.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  if (interaction.customId === 'setup:embed_modal') {
    const cfg = getGuildConfig(interaction.guild.id);
    const eff = getEffectiveEmbed(cfg);
    const modal = new ModalBuilder()
      .setCustomId('setup:embed_submit')
      .setTitle("Contenu de l'embed");
    const titleVal =
      String(cfg?.embed_title != null ? cfg.embed_title : eff.title).slice(0, 256) || ' ';
    const descVal =
      String(cfg?.embed_description != null ? cfg.embed_description : eff.description).slice(
        0,
        4000,
      ) || ' ';
    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('embed_title')
          .setLabel('Titre')
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setMaxLength(256)
          .setValue(titleVal),
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('embed_description')
          .setLabel('Description')
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(false)
          .setMaxLength(4000)
          .setValue(descVal),
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('embed_color')
          .setLabel('Couleur (hex, ex. 5865F2)')
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setMaxLength(7)
          .setValue(
            cfg?.embed_color != null
              ? Number(cfg.embed_color).toString(16).padStart(6, '0')
              : '5865f2',
          ),
      ),
    );
    await interaction.showModal(modal);
    return;
  }
  if (interaction.customId === 'setup:embed_default') {
    resetEmbedToDefault(interaction.guild.id);
    await refreshPublicPanel(interaction.guild, client);
    const cfg = getGuildConfig(interaction.guild.id);
    await interaction.update({
      embeds: [
        new EmbedBuilder()
          .setTitle('Configuration — vérification')
          .setDescription(describeConfig(cfg))
          .setColor(0x5865f2),
      ],
      components: buildSetupRows(),
    });
    return;
  }
  if (interaction.customId === 'setup:publish') {
    const cfg = getGuildConfig(interaction.guild.id);
    if (!cfg?.panel_channel_id || !cfg?.verified_role_id) {
      await interaction.reply({
        content:
          'Choisis au minimum un **salon panneau** et un **rôle vérifié** avant de publier.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    const channel = await interaction.guild.channels
      .fetch(cfg.panel_channel_id)
      .catch(() => null);
    if (!channel || !channel.isTextBased()) {
      await interaction.reply({
        content: 'Salon panneau introuvable ou type non supporté.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    const eff = getEffectiveEmbed(cfg);
    const embed = new EmbedBuilder().setTitle(eff.title).setDescription(eff.description).setColor(eff.color);
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('verify:go').setLabel('🔐 Vérifier').setStyle(ButtonStyle.Primary),
    );
    let messageId = cfg.panel_message_id;
    if (messageId) {
      const old = await channel.messages.fetch(messageId).catch(() => null);
      if (old) {
        await old.edit({ embeds: [embed], components: [row] });
      } else {
        const msg = await channel.send({ embeds: [embed], components: [row] });
        messageId = msg.id;
      }
    } else {
      const msg = await channel.send({ embeds: [embed], components: [row] });
      messageId = msg.id;
    }
    upsertGuildConfig(interaction.guild.id, { panel_message_id: messageId });
    await interaction.reply({
      content: `Panneau mis à jour dans <#${cfg.panel_channel_id}>.`,
      flags: MessageFlags.Ephemeral,
    });
  }
}

async function refreshPublicPanel(guild, client) {
  const cfg = getGuildConfig(guild.id);
  if (!cfg?.panel_channel_id || !cfg?.panel_message_id) return;
  const channel = await guild.channels.fetch(cfg.panel_channel_id).catch(() => null);
  if (!channel || !channel.isTextBased()) return;
  const msg = await channel.messages.fetch(cfg.panel_message_id).catch(() => null);
  if (!msg) return;
  const eff = getEffectiveEmbed(cfg);
  const embed = new EmbedBuilder().setTitle(eff.title).setDescription(eff.description).setColor(eff.color);
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('verify:go').setLabel('🔐 Vérifier').setStyle(ButtonStyle.Primary),
  );
  await msg.edit({ embeds: [embed], components: [row] }).catch(() => {});
}

function buildSlashCommands() {
  return [
    new SlashCommandBuilder()
      .setName('verify')
      .setDescription('Obtenir le lien de vérification (email Discord, anti double-compte sur ce serveur)')
      .toJSON(),
    new SlashCommandBuilder()
      .setName('setup-verification')
      .setDescription('Panneau admin : salon du bouton, rôle, salon logs, contenu de l’embed')
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
      .toJSON(),
    new SlashCommandBuilder()
      .setName('unverify')
      .setDescription("Retirer la vérification d'un membre (rôle + entrée DB) — staff uniquement")
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
      .setDMPermission(false)
      .addUserOption((opt) =>
        opt.setName('user').setDescription('Membre à dévérifier').setRequired(true),
      )
      .addStringOption((opt) =>
        opt
          .setName('raison')
          .setDescription('Raison (optionnelle, affichée dans les logs)')
          .setRequired(false)
          .setMaxLength(400),
      )
      .toJSON(),
  ];
}

module.exports = { createBot, buildSlashCommands };
