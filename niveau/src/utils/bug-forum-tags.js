const { ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, EmbedBuilder } = require('discord.js');

/** Serveur staff / bugs (forum blzbot-bugs). */
const BUG_TRACKER_GUILD_ID = '1493276404643532810';
const BUG_FORUM_CHANNEL_ID = '1493282774323302450';
/** Rôle notifié à chaque nouveau signalement. */
const BUG_NOTIFY_ROLE_ID = '1493277032745013452';

const TAG = {
    corriger: '1493284123333365915',
    enCours: '1493284188504461322',
    enCoursKoyorin: '1493284236122390618',
    enCoursRoxxor: '1493292230570545382',
    dejaSignale: '1524529509624184864',
};

/** Tags « en cours » retirés par /bug-corriger. */
const EN_COURS_TAG_IDS = [TAG.enCours, TAG.enCoursKoyorin, TAG.enCoursRoxxor];

const BUTTON_DEFS = [
    { key: 'enCours', label: 'En cours', style: ButtonStyle.Primary },
    { key: 'enCoursKoyorin', label: 'En cours-Koyorin', style: ButtonStyle.Secondary },
    { key: 'enCoursRoxxor', label: 'En cours-Roxxor', style: ButtonStyle.Secondary },
    { key: 'dejaSignale', label: 'Déjà signalé', style: ButtonStyle.Secondary },
    { key: 'corriger', label: 'Corrigé', style: ButtonStyle.Success },
];

const BUTTON_PREFIX = 'bug_tag:';

function isBugTrackerGuild(guildId) {
    return String(guildId || '') === BUG_TRACKER_GUILD_ID;
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
 * Ajoute ou retire un tag forum (toggle).
 * @returns {'added'|'removed'}
 */
async function toggleForumTag(thread, tagId) {
    const current = [...(thread.appliedTags || [])];
    const idx = current.indexOf(tagId);
    if (idx >= 0) {
        current.splice(idx, 1);
        await thread.setAppliedTags(current);
        return 'removed';
    }
    current.push(tagId);
    await thread.setAppliedTags(current);
    return 'added';
}

/** Retire tous les tags « en cours » et pose « Corrigé ». */
async function markBugAsFixed(thread) {
    const current = (thread.appliedTags || []).filter((id) => !EN_COURS_TAG_IDS.includes(id));
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
    if (!String(customId || '').startsWith(BUTTON_PREFIX)) return null;
    return String(customId).slice(BUTTON_PREFIX.length);
}

function tagLabelForId(tagId) {
    const def = BUTTON_DEFS.find((d) => TAG[d.key] === tagId);
    return def?.label || 'Tag';
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
            content: '❌ Ce bouton ne fonctionne que dans un fil du forum **blzbot-bugs**.',
            flags: 64,
        });
        return true;
    }

    await interaction.deferUpdate();
    const action = await toggleForumTag(thread, tagId);
    const label = tagLabelForId(tagId);
    const verb = action === 'added' ? 'ajouté' : 'retiré';
    await interaction.followUp({
        content: `🏷️ Tag **${label}** ${verb} sur ce signalement.`,
        flags: 64,
    });
    return true;
}

module.exports = {
    BUG_TRACKER_GUILD_ID,
    BUG_FORUM_CHANNEL_ID,
    TAG,
    EN_COURS_TAG_IDS,
    BUTTON_PREFIX,
    isBugTrackerGuild,
    resolveBugForumThread,
    toggleForumTag,
    markBugAsFixed,
    buildBugTagButtons,
    handleBugTagButton,
};
