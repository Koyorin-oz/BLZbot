const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ContainerBuilder,
  TextDisplayBuilder,
  SectionBuilder,
  ThumbnailBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
} = require('discord.js');
const path = require('path');
const CONFIG = require('../config.js');
const { denyUnlessCanMod } = require('../utils/mod-access');
const { stripHexToInt } = require(
  path.join(__dirname, '..', '..', '..', 'blz-embed-theme'),
);

/**
 * Prototype bienvenue Components V2 — `/test-root`
 * Permet de tester emoji, texte et salons cliquables (même hors serveur / bot absent)
 * via des liens Discord `channels/guildId/channelId` + labels custom.
 */

function parseAccentColor(hex) {
  if (!hex) return stripHexToInt(CONFIG.WELCOME?.ACCENT_COLOR);
  return stripHexToInt(hex);
}

function channelJumpUrl(guildId, channelId) {
  return `https://discord.com/channels/${guildId}/${channelId}`;
}

function isSnowflake(v) {
  return /^\d{17,22}$/.test(String(v || '').trim());
}

/**
 * Parse un emoji Discord (unicode, <:n:id>, <a:n:id>, ou n:id).
 * @returns {{ markdown: string, buttonEmoji: import('discord.js').APIMessageComponentEmoji | string | null }}
 */
function parseEmoji(raw) {
  const s = String(raw || '').trim();
  if (!s) return { markdown: '', buttonEmoji: null };

  const custom = s.match(/^<(a?):([a-zA-Z0-9_]{1,32}):(\d{17,22})>$/);
  if (custom) {
    const animated = custom[1] === 'a';
    const name = custom[2];
    const id = custom[3];
    return {
      markdown: animated ? `<a:${name}:${id}>` : `<:${name}:${id}>`,
      buttonEmoji: { id, name, animated },
    };
  }

  const short = s.match(/^([a-zA-Z0-9_]{1,32}):(\d{17,22})$/);
  if (short) {
    const name = short[1];
    const id = short[2];
    return {
      markdown: `<:${name}:${id}>`,
      buttonEmoji: { id, name },
    };
  }

  if (isSnowflake(s)) {
    return {
      markdown: `<:emoji:${s}>`,
      buttonEmoji: { id: s, name: 'emoji' },
    };
  }

  // Unicode / texte libre
  return { markdown: s, buttonEmoji: s };
}

/**
 * Lit un slot salon depuis les options slash.
 * @returns {{ id: string, nom: string, emojiMd: string, buttonEmoji: *, guildId: string, url: string } | null}
 */
function readSalonSlot(interaction, n, fallbackGuildId) {
  const id = interaction.options.getString(`salon${n}_id`)?.trim();
  if (!id || !isSnowflake(id)) return null;

  const nom =
    interaction.options.getString(`salon${n}_nom`)?.trim() || `Salon ${n}`;
  const emojiRaw = interaction.options.getString(`salon${n}_emoji`)?.trim() || '';
  const { markdown: emojiMd, buttonEmoji } = parseEmoji(emojiRaw);

  const serveurOpt = interaction.options.getString(`salon${n}_serveur`)?.trim();
  const guildId =
    serveurOpt && isSnowflake(serveurOpt) ? serveurOpt : fallbackGuildId;

  return {
    id,
    nom,
    emojiMd,
    buttonEmoji,
    guildId,
    url: channelJumpUrl(guildId, id),
  };
}

/** Libellé plain dans le texte (pas de lien — les boutons sous le message sont cliquables). */
function salonPlainLabel(salon) {
  return [salon.emojiMd, salon.nom].filter(Boolean).join(' ').trim() || salon.nom;
}

function addSalonOptions(builder, n) {
  return builder
    .addStringOption((o) =>
      o
        .setName(`salon${n}_id`)
        .setDescription(`ID salon bouton #${n} (même si bot absent / autre serveur)`)
        .setRequired(false),
    )
    .addStringOption((o) =>
      o
        .setName(`salon${n}_nom`)
        .setDescription(`Label du bouton #${n} (ex: Règlement)`)
        .setRequired(false)
        .setMaxLength(80),
    )
    .addStringOption((o) =>
      o
        .setName(`salon${n}_emoji`)
        .setDescription(`Emoji du bouton #${n} (📋 ou <:nom:id>)`)
        .setRequired(false)
        .setMaxLength(80),
    )
    .addStringOption((o) =>
      o
        .setName(`salon${n}_serveur`)
        .setDescription(`ID serveur du bouton #${n} (si autre serveur)`)
        .setRequired(false),
    );
}

module.exports = {
  data: (() => {
    let b = new SlashCommandBuilder()
      .setName('test-root')
      .setDescription('Prototype message d’arrivée (bienvenue Components V2).')
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
      .addUserOption((o) =>
        o
          .setName('membre')
          .setDescription('Membre à simuler (avatar + mention). Défaut: toi.')
          .setRequired(false),
      )
      .addStringOption((o) =>
        o
          .setName('emoji')
          .setDescription('Emoji titre (haut). Ex: 👋 ou <:nom:id>')
          .setRequired(false)
          .setMaxLength(80),
      )
      .addStringOption((o) =>
        o
          .setName('titre')
          .setDescription('Titre custom (sinon: Bienvenue, @membre !)')
          .setRequired(false)
          .setMaxLength(200),
      )
      .addStringOption((o) =>
        o
          .setName('texte')
          .setDescription(
            'Corps (pas les boutons). {m} {serveur} {salon1..3} = noms plain',
          )
          .setRequired(false)
          .setMaxLength(600),
      )
      .addStringOption((o) =>
        o
          .setName('couleur')
          .setDescription('Couleur barre (#hex). Défaut: thème BLZ.')
          .setRequired(false)
          .setMaxLength(9),
      );

    for (let n = 1; n <= 3; n++) b = addSalonOptions(b, n);
    return b;
  })(),

  async execute(interaction) {
    const denied = denyUnlessCanMod(interaction, PermissionFlagsBits.Administrator);
    if (denied) return interaction.reply(denied);

    const hubGuildId = interaction.guildId;
    if (!hubGuildId) {
      return interaction.reply({
        content: '❌ À utiliser sur un serveur.',
        flags: 64,
      });
    }

    const targetUser =
      interaction.options.getUser('membre') || interaction.user;
    let member = interaction.guild?.members.cache.get(targetUser.id) || null;
    if (!member && interaction.guild) {
      member = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
    }

    const titleEmojiRaw =
      interaction.options.getString('emoji')?.trim() ||
      '👋';
    const { markdown: titleEmoji } = parseEmoji(titleEmojiRaw);

    const salons = [];
    for (let n = 1; n <= 3; n++) {
      const slot = readSalonSlot(interaction, n, hubGuildId);
      if (slot) salons.push(slot);
    }

    // Fallback: salons config bienvenue si rien renseigné
    if (salons.length === 0) {
      const w = CONFIG.WELCOME || {};
      if (isSnowflake(w.LINK_REGLEMENT_CHANNEL_ID)) {
        salons.push({
          id: w.LINK_REGLEMENT_CHANNEL_ID,
          nom: 'Règlement',
          emojiMd: '📋',
          buttonEmoji: '📋',
          guildId: hubGuildId,
          url: channelJumpUrl(hubGuildId, w.LINK_REGLEMENT_CHANNEL_ID),
        });
      }
      if (isSnowflake(w.LINK_TICKETS_CHANNEL_ID)) {
        salons.push({
          id: w.LINK_TICKETS_CHANNEL_ID,
          nom: 'Tickets',
          emojiMd: '🪢',
          buttonEmoji: '🪢',
          guildId: hubGuildId,
          url: channelJumpUrl(hubGuildId, w.LINK_TICKETS_CHANNEL_ID),
        });
      }
    }

    const serverName = interaction.guild?.name || 'ce serveur';
    const mention = member || targetUser;

    // Texte = libellés non cliquables. Les seuls clics = boutons Link sous le message.
    const salonLabels = salons.map(salonPlainLabel);
    const defaultBody =
      `➜ Nous sommes ravis de te voir arriver sur le serveur **${serverName}** !\n` +
      (salonLabels.length
        ? `➜ N'hésite pas à aller faire un tour dans ${salonLabels.join(' et ')} si t'as besoin d'aide.\n`
        : '') +
      `➜ Passe un agréable séjour ici ! 🔥`;

    let body = interaction.options.getString('texte')?.trim() || defaultBody;
    body = body
      .replace(/\\n/g, '\n')
      .replace(/\{m\}/gi, `${mention}`)
      .replace(/\{serveur\}/gi, serverName)
      .replace(/\{salon1\}/gi, salonLabels[0] || '`salon1 manquant`')
      .replace(/\{salon2\}/gi, salonLabels[1] || '`salon2 manquant`')
      .replace(/\{salon3\}/gi, salonLabels[2] || '`salon3 manquant`');

    const customTitle = interaction.options.getString('titre')?.trim();
    const titleLine = customTitle
      ? `## ${titleEmoji} **${customTitle}**`
      : `## ${titleEmoji} **Bienvenue,** ${mention} **!**`;

    const mainText = new TextDisplayBuilder().setContent(
      `${titleLine}\n${body}`,
    );

    const avatar = targetUser.displayAvatarURL({ extension: 'png', size: 128 });
    const thumbnail = new ThumbnailBuilder()
      .setURL(avatar)
      .setDescription(`Avatar — ${targetUser.username}`);

    const mainSection = new SectionBuilder()
      .addTextDisplayComponents(mainText)
      .setThumbnailAccessory(thumbnail);

    const container = new ContainerBuilder()
      .setAccentColor(parseAccentColor(interaction.options.getString('couleur')))
      .addSectionComponents(mainSection);

    if (salons.length > 0) {
      container.addSeparatorComponents(
        new SeparatorBuilder()
          .setDivider(true)
          .setSpacing(SeparatorSpacingSize.Small),
      );

      const row = new ActionRowBuilder();
      for (const salon of salons.slice(0, 5)) {
        const btn = new ButtonBuilder()
          .setStyle(ButtonStyle.Link)
          .setLabel(salon.nom.slice(0, 80))
          .setURL(salon.url);
        if (salon.buttonEmoji) {
          try {
            btn.setEmoji(salon.buttonEmoji);
          } catch {
            /* emoji invalide → label seul */
          }
        }
        row.addComponents(btn);
      }
      container.addActionRowComponents(row);
    }

    await interaction.reply({
      components: [container],
      flags: MessageFlags.IsComponentsV2,
      allowedMentions: { users: [targetUser.id] },
    });
  },
};
