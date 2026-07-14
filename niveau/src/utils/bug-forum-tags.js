const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
} = require("discord.js");

/** Serveur staff / bugs (forum blzbot-bugs). */
const BUG_TRACKER_GUILD_ID = "1493276404643532810";
const BUG_FORUM_CHANNEL_ID = "1493282774323302450";
/** Rôle notifié à chaque nouveau signalement. */
const BUG_NOTIFY_ROLE_ID = "1493277032745013452";

const TAG = {
  corriger: "1493284123333365915",
  enCours: "1493284188504461322",
  enCoursKoyorin: "1493284236122390618",
  enCoursRoxxor: "1493292230570545382",
  dejaSignale: "1524529509624184864",
  signalementRejete: "1525846693327667241",
};

/** Tags « en cours » retirés par /bug-corriger. */
const EN_COURS_TAG_IDS = [TAG.enCours, TAG.enCoursKoyorin, TAG.enCoursRoxxor];

const BUTTON_DEFS = [
  { key: "enCours", label: "En cours", style: ButtonStyle.Primary },
  { key: "dejaSignale", label: "Déjà signalé", style: ButtonStyle.Secondary },
  { key: "corriger", label: "Corrigé", style: ButtonStyle.Success },
  { key: "signalementRejete", label: "Signalement rejeté", style: ButtonStyle.Danger, },
];

// Inclure aussi les variantes spécifiques (Koyorin/Roxxor) parmi les tags gérés.
const MANAGED_TAG_IDS = [
  ...new Set([...BUTTON_DEFS.map((def) => TAG[def.key]), ...EN_COURS_TAG_IDS]),
];
const FINAL_TAG_IDS = [TAG.dejaSignale, TAG.corriger, TAG.signalementRejete];
const BUTTON_PREFIX = "bug_tag:";

function isBugTrackerGuild(guildId) {
  return String(guildId || "") === BUG_TRACKER_GUILD_ID;
}

/**
 * @param {import('discord.js').Interaction} interaction
 * @returns {Promise<import('discord.js').ThreadChannel|null>}
 */
async function resolveBugForumThread(interaction) {
  if (!isBugTrackerGuild(interaction.guildId)) return null;
  const ch = interaction.channel;
  if (!ch?.isThread?.()) return null;
  if (String(ch.parentId) !== BUG_FORUM_CHANNEL_ID) return null;
  return ch;
}

/**
 * Remplace tous les tags gérés par le tag sélectionné.
 * @returns {'set'}
 */
async function toggleForumTag(thread, tagId) {
  const current = [...(thread.appliedTags || [])];
  const next = current.filter((id) => !MANAGED_TAG_IDS.includes(id));
  if (!next.includes(tagId)) next.push(tagId);
  await thread.setAppliedTags(next);
  return "set";
}

/** Retire tous les tags « en cours » et pose « Corrigé ». */
async function markBugAsFixed(thread) {
  const current = (thread.appliedTags || []).filter(
    (id) => !EN_COURS_TAG_IDS.includes(id),
  );
  if (!current.includes(TAG.corriger)) current.push(TAG.corriger);
  await thread.setAppliedTags(current);
}

function buildBugTagButtons() {
  const buttons = BUTTON_DEFS.map((def) =>
    new ButtonBuilder()
      .setCustomId(`${BUTTON_PREFIX}${TAG[def.key]}`)
      .setLabel(def.label)
      .setStyle(def.style),
  );
  return [new ActionRowBuilder().addComponents(buttons)];
}

function parseBugTagButtonId(customId) {
  if (!String(customId || "").startsWith(BUTTON_PREFIX)) return null;
  return String(customId).slice(BUTTON_PREFIX.length);
}

function tagLabelForId(tagId) {
  const def = BUTTON_DEFS.find((d) => TAG[d.key] === tagId);
  return def?.label || "Tag";
}

function isFinalBugTag(tagId) {
  return FINAL_TAG_IDS.includes(tagId);
}

function buildResolutionEmbed(tagId, userId) {
  const isFixed = tagId === TAG.corriger;
  const isRejected = tagId === TAG.signalementRejete;
  const mention = userId ? `<@${userId}>` : "un membre du staff";
  return new EmbedBuilder()
    .setTitle(
      isFixed
        ? "✅ Signalement traité"
        : isRejected
          ? "❌ Signalement rejeté"
          : "✅ Signalement déjà signalé",
    )
    .setDescription(
      isFixed
        ? `Ce signalement a été marqué comme corrigé par ${mention}. Le fil est maintenant fermé.`
        : isRejected
          ? `Ce signalement a été marqué comme rejeté par ${mention}. Le fil est maintenant fermé.`
          : `Ce signalement a été marqué comme déjà signalé par ${mention}. Le fil est maintenant fermé.`,
    )
    .setColor(isFixed ? 0x2ecc71 : isRejected ? 0xe74c3c : 0x3498db)
    .setTimestamp();
}

async function closeResolvedBugThread(thread, tagId, userId) {
  await thread.send({ embeds: [buildResolutionEmbed(tagId, userId)] });
  await thread.setArchived(true, "Signalement traité");
  await thread.setLocked(true);
}

/**
 * @param {import('discord.js').ButtonInteraction} interaction
 */
async function handleBugTagButton(interaction) {
  const tagId = parseBugTagButtonId(interaction.customId);
  if (!tagId) return false;

  const thread = await resolveBugForumThread(interaction);
  if (!thread) {
    await interaction.reply({
      content:
        "❌ Ce bouton ne fonctionne que dans un fil du forum **blzbot-bugs**.",
      flags: 64,
    });
    return true;
  }

  await interaction.deferUpdate();

  // Si le bouton pressé est le bouton "En cours", choisir la variante
  // spécifique selon l'utilisateur (Koyorin ou Roxxor) sinon laisser
  // le tag générique.
  let appliedTagId = tagId;
  if (tagId === TAG.enCours) {
    const uid = String(interaction.user.id);
    if (uid === "1278372257483456603") appliedTagId = TAG.enCoursKoyorin;
    else if (uid === "1057705135515639859") appliedTagId = TAG.enCoursRoxxor;
    else appliedTagId = TAG.enCours;
  }

  await toggleForumTag(thread, appliedTagId);

  const label = tagId === TAG.enCours ? "En cours" : tagLabelForId(tagId);

  if (isFinalBugTag(appliedTagId)) {
    await closeResolvedBugThread(thread, appliedTagId, interaction.user.id);
  } else {
    await interaction.followUp({
      content: `🏷️ Tag **${label}** appliqué sur ce signalement.`,
      flags: 64,
    });
  }
  return true;
}

/**
 * Crée un post sur le forum blzbot-bugs (utilisé par /bug et rapports auto).
 * @param {import('discord.js').Client} client
 * @param {{
 *   threadTitle: string,
 *   description: string,
 *   reporterLabel: string,
 *   reporterId: string,
 *   bugId?: string,
 * }} opts
 * @returns {Promise<import('discord.js').ThreadChannel>}
 */
async function createBugForumPost(client, opts) {
  const channel = await client.channels.fetch(BUG_FORUM_CHANNEL_ID);
  if (!channel || channel.type !== ChannelType.GuildForum) {
    throw new Error(`Forum bugs introuvable (${BUG_FORUM_CHANNEL_ID})`);
  }

  const threadName = String(opts.threadTitle || "Signalement")
    .replace(/\s+/g, " ")
    .slice(0, 100);
  const descSlice =
    String(opts.description || "").length > 3900
      ? `${String(opts.description).slice(0, 3897)}…`
      : String(opts.description || "(aucune description)");

  const timestamp = Math.floor(Date.now() / 1000);
  const embed = new EmbedBuilder()
    .setTitle("🐛 Signalement")
    .setDescription(descSlice)
    .addFields(
      { name: "Membre", value: opts.reporterLabel, inline: true },
      { name: "ID Discord", value: `\`${opts.reporterId}\``, inline: true },
      {
        name: "Date du signalement",
        value: `<t:${timestamp}:F>`,
        inline: false,
      },
    )
    .setColor(0xe67e22)
    .setTimestamp();

  if (opts.bugId) {
    embed.addFields({
      name: "ID erreur",
      value: `\`${opts.bugId}\``,
      inline: false,
    });
  }

  const thread = await channel.threads.create({
    name: threadName,
    message: {
      content: `<@&${BUG_NOTIFY_ROLE_ID}>`,
      embeds: [embed],
      components: buildBugTagButtons(),
      allowedMentions: { roles: [BUG_NOTIFY_ROLE_ID] },
    },
    appliedTags: [TAG.enCours],
  });

  return thread;
}

module.exports = {
  BUG_TRACKER_GUILD_ID,
  BUG_FORUM_CHANNEL_ID,
  BUG_NOTIFY_ROLE_ID,
  TAG,
  EN_COURS_TAG_IDS,
  BUTTON_PREFIX,
  isBugTrackerGuild,
  resolveBugForumThread,
  toggleForumTag,
  markBugAsFixed,
  buildBugTagButtons,
  handleBugTagButton,
  createBugForumPost,
};
