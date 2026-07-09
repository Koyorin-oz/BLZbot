const { ChannelType } = require('discord.js');

/** Serveur forum bugs (fixe). */
const BUG_TRACKER_GUILD_ID = '1493276404643532810';
const BUG_FORUM_CHANNEL_ID = '1493282774323302450';
/** Tag appliqué à la création d'un signalement (= en cours / à traiter). */
const BUG_TAG_EN_COURS_ID = '1493284188504461322';
/** Tag « corrigé ». */
const BUG_TAG_CORRIGE_ID = '1493284123333365915';

function isBugForumThread(channel) {
    if (!channel?.isThread?.()) return false;
    const parentId = channel.parentId || channel.parent?.id;
    return parentId === BUG_FORUM_CHANNEL_ID;
}

/**
 * Retire le tag en cours et applique « corrigé » sur un post du forum bugs.
 * @param {import('discord.js').ThreadChannel} thread
 */
async function markBugThreadCorrige(thread) {
    const parent = thread.parent;
    const enCoursIds = new Set([BUG_TAG_EN_COURS_ID]);

    for (const tag of parent?.availableTags || []) {
        if (/en\s*cours|à\s*traiter|nouveau|open/i.test(String(tag.name || ''))) {
            enCoursIds.add(tag.id);
        }
    }

    const current = Array.isArray(thread.appliedTags) ? [...thread.appliedTags] : [];
    const next = current.filter((id) => !enCoursIds.has(id) && id !== BUG_TAG_CORRIGE_ID);
    if (!next.includes(BUG_TAG_CORRIGE_ID)) next.push(BUG_TAG_CORRIGE_ID);

    await thread.setAppliedTags(next.slice(0, 5));
    return { removed: [...enCoursIds].filter((id) => current.includes(id)), applied: BUG_TAG_CORRIGE_ID };
}

module.exports = {
    BUG_TRACKER_GUILD_ID,
    BUG_FORUM_CHANNEL_ID,
    BUG_TAG_EN_COURS_ID,
    BUG_TAG_CORRIGE_ID,
    isBugForumThread,
    markBugThreadCorrige,
};
