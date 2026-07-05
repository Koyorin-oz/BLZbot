/**
 * Bot Discord — partie commandes/UI :
 *  - /setup-verification : panneau admin avec menus (salon panneau, rôle vérifié, salon
 *    logs SANS IP, personnalisation embed, publication).
 *  - /verify : commande de secours pour obtenir le lien OAuth (équivalent du bouton).
 *  - /man-verify : donne le rôle vérifié + entrée DB sans OAuth (staff).
 *  - /antiraid : détection + gestion anti-raid (sur l’app BLZbot-protect — activer **Message Content Intent**).
 *  - Le bouton « Vérifier » : lien **100 % discord.com** grâce à un `state` court (ticket SQLite) :
 *    pas de limite 512 tatillonne, pas de shortener, pas de modal « tu quittes Discord » sur le clic.
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
const { VERIF_BUILD_ID } = require('./buildId');
const {
  getGuildConfig,
  upsertGuildConfig,
  getEffectiveEmbed,
  resetEmbedToDefault,
  findVerifiedInGuild,
  deleteVerifiedForGuild,
  saveVerifiedForGuild,
  createOAuthTicket,
} = require('./database');
const { hashManualVerificationPlaceholder } = require('./cryptoUtil');
const { removeGuildMemberRole } = require('./discordApi');
const { grantVerifiedRole } = require('./memberRoles');
const { openRaidDb } = require('./antiraid/raidDb');
const AntiRaidManager = require('./antiraid/manager');
const antiraidSlash = require('./antiraid/slashCommand');

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

/** Limite API Discord pour l’URL d’un bouton style Link (sinon la réponse interaction est rejetée). */
const DISCORD_LINK_BUTTON_URL_MAX = 512;

/** Bouton ouvrant l'OAuth dans le navigateur (pas de lien brut dans le message → pas d'embed preview). */
function buildVerifyLinkRow(url) {
  if (url.length > DISCORD_LINK_BUTTON_URL_MAX) {
    console.error(
      `[bot] URL bouton vérif trop longue (${url.length} > ${DISCORD_LINK_BUTTON_URL_MAX}) — vérifie PUBLIC_BASE_URL.`,
    );
  }
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setLabel('🔐 Vérifier')
      .setStyle(ButtonStyle.Link)
      .setURL(url),
  );
}

/**
 * Réponse éphémère avec bouton lien OAuth (defer + edit pour meilleure compat. clients).
 */
async function replyVerifyLinkEphemeral(interaction, url) {
  if (!/^https:\/\//i.test(url) || url.length > DISCORD_LINK_BUTTON_URL_MAX) {
    console.error('[verify] URL bouton refusée (https requis, max 512) :', url.length);
    await interaction.reply({
      content:
        '**Erreur de configuration** : `PUBLIC_BASE_URL` doit être une URL **https** complète dans le `.env`.\n' +
        `Build \`${VERIF_BUILD_ID}\`.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  try {
    await interaction.editReply({
      content: '',
      components: [buildVerifyLinkRow(url)],
    });
  } catch (e) {
    console.error('[verify] editReply:', e && e.message, e && e.rawError);
    await interaction
      .editReply({
        content:
          `Impossible d’afficher le bouton : ${e.message || e}\n` +
          `Build \`${VERIF_BUILD_ID}\` — vérifie les logs du bot.`,
      })
      .catch(() => {});
  }
}

/**
 * @param {object} opts
 * @param {string} opts.clientId      App Discord vérif — `VERIFICATION_CLIENT_ID`.
 * @param {string} opts.redirectUri    `OAUTH_REDIRECT_URI`.
 */
function createBot(opts) {
  const raidDb = openRaidDb();
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMembers,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.DirectMessages,
    ],
    partials: [Partials.Channel, Partials.User, Partials.Message],
  });

  const antiRaidManager = new AntiRaidManager(client, raidDb);

  /**
   * URL du screen d’autorisation Discord : le `state` est un ticket 32 hex (court) → toujours sur discord.com.
   */
  function buildVerifyUrl(discordUserId, guildId) {
    const ticket = createOAuthTicket(guildId, discordUserId);
    const params = new URLSearchParams({
      client_id: String(opts.clientId || '').trim(),
      redirect_uri: String(opts.redirectUri || '').trim(),
      response_type: 'code',
      scope: 'identify email',
      state: ticket,
      prompt: 'consent',
    });
    return `https://discord.com/api/oauth2/authorize?${params.toString()}`;
  }

  client.once(Events.ClientReady, async (c) => {
    const { isCompact, blzLine } = require(require('node:path').join(__dirname, '..', '..', 'blz-log.js'));
    try {
      await c.application.commands.set(buildSlashCommands());
      if (isCompact()) {
        blzLine('verif', `${c.user.tag} · OAuth · slash enregistrés`);
      } else {
        console.log(`[bot] Connecté : ${c.user.tag}`);
        console.log(
          `[bot] Build ${VERIF_BUILD_ID} — OAuth bouton = discord.com + ticket SQLite (state court). GET /health`,
        );
        console.log(
          '[bot] Commandes slash globales enregistrées (/verify, /man-verify, /setup-verification, /unverify, /antiraid).',
        );
      }
    } catch (e) {
      console.error('[bot] Échec enregistrement des commandes globales :', e);
    }
  });

  /**
   * Ré-applique le rôle vérifié si un membre déjà vérifié rejoint à nouveau le serveur.
   */
  client.on(Events.GuildMemberAdd, async (member) => {
    if (member.user.bot) return;
    try {
      await antiRaidManager.trackJoin(member);
    } catch (e) {
      console.error('[GuildMemberAdd] Anti-raid trackJoin :', e.message || e);
    }
    const cfg = getGuildConfig(member.guild.id);
    if (!cfg?.verified_role_id) return;
    if (member.roles.cache.has(cfg.verified_role_id)) return;
    const row = findVerifiedInGuild(member.guild.id, member.id);
    if (!row) return;
    try {
      await grantVerifiedRole(client.token, member.guild.id, member.id, cfg.verified_role_id);
    } catch (e) {
      console.error('[GuildMemberAdd] Rôle vérifié impossible :', e.message || e);
    }
  });

  client.on(Events.MessageCreate, async (message) => {
    try {
      await antiRaidManager.trackMessage(message);
    } catch (e) {
      console.error('[MessageCreate] Anti-raid trackMessage :', e.message || e);
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

      if (interaction.commandName === 'man-verify') {
        await handleManVerifyCommand(interaction, client);
        return;
      }

      if (interaction.commandName === 'antiraid') {
        await antiraidSlash.execute(interaction, { antiRaidManager });
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
      await grantVerifiedRole(
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
  await replyVerifyLinkEphemeral(interaction, url);
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
      await grantVerifiedRole(
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
  await replyVerifyLinkEphemeral(interaction, url);
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
      const logCh = await interaction.guild.channels.fetch(cfg.log_channel_no_ip_id).catch(() => null);
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

async function handleManVerifyCommand(interaction, client) {
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

  const cfg = getGuildConfig(interaction.guild.id);
  if (!cfg?.verified_role_id) {
    await interaction.reply({
      content:
        "Ce serveur n'a pas configuré la vérification. Un administrateur doit d'abord utiliser `/setup-verification`.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const target = interaction.options.getUser('membre', true);
  const raison = (interaction.options.getString('note') || '').trim();

  if (target.bot) {
    await interaction.reply({
      content: 'Impossible de vérifier un bot.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const member = await interaction.guild.members.fetch(target.id).catch(() => null);
  if (!member) {
    await interaction.editReply({ content: '❌ Ce membre n’est pas sur le serveur ou est introuvable.' });
    return;
  }

  const me = interaction.guild.members.me;
  const verifiedRole = interaction.guild.roles.cache.get(cfg.verified_role_id);
  if (!verifiedRole) {
    await interaction.editReply({
      content:
        '❌ Le rôle vérifié configuré est introuvable. Reconfigure-le avec `/setup-verification`.',
    });
    return;
  }
  if (verifiedRole.position >= me.roles.highest.position) {
    await interaction.editReply({
      content:
        '❌ Mon rôle est trop bas dans la hiérarchie : je ne peux pas attribuer le rôle vérifié.',
    });
    return;
  }

  const existing = findVerifiedInGuild(interaction.guild.id, target.id);
  if (existing && member.roles.cache.has(cfg.verified_role_id)) {
    await interaction.editReply({
      content: `✅ ${target} est déjà vérifié sur ce serveur (rôle + base de données).`,
    });
    return;
  }

  const emailHash = hashManualVerificationPlaceholder(interaction.guild.id, target.id);

  try {
    await grantVerifiedRole(client.token, interaction.guild.id, target.id, cfg.verified_role_id);
    saveVerifiedForGuild(interaction.guild.id, target.id, emailHash, null);
  } catch (e) {
    console.error('[man-verify]', e);
    await removeGuildMemberRole(
      client.token,
      interaction.guild.id,
      target.id,
      cfg.verified_role_id,
    ).catch(() => {});
    await interaction.editReply({
      content: `❌ Impossible de finaliser la vérification manuelle : ${e.message || e}`,
    });
    return;
  }

  await interaction.editReply({
    content: `✅ ${target} a été **vérifié manuellement** (rôle attribué + enregistrement en base).`,
  });

  if (cfg.log_channel_no_ip_id) {
    try {
      const logCh = await interaction.guild.channels.fetch(cfg.log_channel_no_ip_id).catch(() => null);
      if (logCh && logCh.isTextBased()) {
        const embed = new EmbedBuilder()
          .setTitle('Vérification manuelle')
          .setColor(0x3498db)
          .setDescription(
            `${target} (\`${target.id}\`) a reçu le rôle vérifié **sans OAuth** (staff).`,
          )
          .addFields({
            name: 'Attribué par',
            value: `${interaction.user} (\`${interaction.user.id}\`)`,
            inline: true,
          })
          .setTimestamp(new Date());
        if (raison) embed.addFields({ name: 'Note staff', value: raison.slice(0, 1024), inline: false });
        await logCh.send({ embeds: [embed] }).catch(() => {});
      }
    } catch (e) {
      console.error('[man-verify] log channel :', e?.message || e);
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
    new SlashCommandBuilder()
      .setName('man-verify')
      .setDescription('Vérifier manuellement un membre (rôle + base, sans lien OAuth)')
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
      .setDMPermission(false)
      .addUserOption((opt) =>
        opt.setName('membre').setDescription('Membre à marquer comme vérifié').setRequired(true),
      )
      .addStringOption((opt) =>
        opt
          .setName('note')
          .setDescription('Note staff (optionnelle, salon logs)')
          .setRequired(false)
          .setMaxLength(500),
      )
      .toJSON(),
    antiraidSlash.data.toJSON(),
  ];
}

module.exports = { createBot, buildSlashCommands };
