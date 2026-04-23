/**
 * Deban via forum (mode TEST uniquement).
 *
 * Principe : sur le serveur de test, chaque demande de débannissement crée un POST FORUM
 * au lieu d'un embed dans un salon texte. Le post porte un tag "En cours" ; à la fin du vote,
 * le tag devient "Deban" (accepté) ou "Refuse" (refusé), puis le post est verrouillé.
 *
 * Structure config JSON persistée (modération/deban_forum_config.json) :
 * {
 *   "<testGuildId>": {
 *     "forumGuildId": "...",
 *     "forumChannelId": "...",
 *     "tags": {
 *        "enCours": "<tagId>",
 *        "deban":   "<tagId>",
 *        "refuse":  "<tagId>"
 *     },
 *     "createdAt": "2026-..."
 *   }
 * }
 */
const fs = require('fs');
const path = require('path');
const {
    ChannelType,
    ForumLayoutType,
    PermissionFlagsBits,
    EmbedBuilder,
    ButtonBuilder,
    ActionRowBuilder,
    ButtonStyle,
} = require('discord.js');

const CONFIG_PATH = path.join(__dirname, '..', '..', 'deban_forum_config.json');

const TAG_SPECS = [
    { key: 'enCours', name: 'En cours', emoji: '⚙️', moderated: false },
    { key: 'deban', name: 'Deban', emoji: '✅', moderated: false },
    { key: 'refuse', name: 'Refuse', emoji: '❌', moderated: false },
];

/* ============================== CONFIG ============================== */

function loadConfig() {
    if (!fs.existsSync(CONFIG_PATH)) return {};
    try {
        return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')) || {};
    } catch (err) {
        console.error('[DebanForum] Erreur parsing deban_forum_config.json:', err?.message || err);
        return {};
    }
}

function saveConfig(config) {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf8');
}

/**
 * Récupère la config forum pour un serveur de test donné, ou null si absente.
 */
function getForumConfigForGuild(testGuildId) {
    if (!testGuildId) return null;
    const config = loadConfig();
    return config[testGuildId] || null;
}

function setForumConfigForGuild(testGuildId, data) {
    const config = loadConfig();
    config[testGuildId] = { ...data, updatedAt: new Date().toISOString() };
    saveConfig(config);
    return config[testGuildId];
}

function removeForumConfigForGuild(testGuildId) {
    const config = loadConfig();
    if (config[testGuildId]) {
        delete config[testGuildId];
        saveConfig(config);
        return true;
    }
    return false;
}

/* ============================ FORUM SETUP ============================ */

/**
 * Crée un forum channel avec les 3 tags (En cours / Deban / Refuse), puis persiste la config.
 *
 * @param {import('discord.js').Client} client
 * @param {object} opts
 * @param {string} opts.testGuildId      - Guild où le panel sera posé (mémorise le mapping)
 * @param {string} opts.forumGuildId     - Guild qui hébergera le forum
 * @param {string} [opts.name]           - Nom du salon forum (défaut: `deban-forum`)
 * @param {string} [opts.parentId]       - ID de la catégorie parent (optionnel)
 * @returns {Promise<{ forumChannel, tags: {enCours, deban, refuse}, config }>}
 */
async function createDebanForum(client, { testGuildId, forumGuildId, name = 'deban-forum', parentId = null } = {}) {
    const guild = await client.guilds.fetch(forumGuildId);
    const me = guild.members.me || (await guild.members.fetchMe().catch(() => null));
    if (!me) throw new Error('Bot introuvable sur le serveur cible.');

    const requiredPerms = [
        PermissionFlagsBits.ManageChannels,
        PermissionFlagsBits.ManageThreads,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.SendMessagesInThreads,
        PermissionFlagsBits.CreatePublicThreads,
        PermissionFlagsBits.ViewChannel,
    ];
    const missing = requiredPerms.filter((p) => !me.permissions.has(p));
    if (missing.length > 0) {
        throw new Error(
            `Le bot n'a pas les permissions nécessaires sur ${guild.name} : ${missing.join(', ')}. Il lui faut au minimum Gérer les salons, Gérer les threads, Créer des posts.`
        );
    }

    const availableTags = TAG_SPECS.map(({ name: tagName, emoji, moderated }) => ({
        name: tagName,
        emoji: emoji ? { name: emoji } : undefined,
        moderated,
    }));

    const forumChannel = await guild.channels.create({
        name,
        type: ChannelType.GuildForum,
        parent: parentId || undefined,
        availableTags,
        topic: 'Demandes de débannissement (mode test). Chaque post = une demande. Les tags indiquent l\'état.',
        defaultForumLayout: ForumLayoutType.ListView,
    });

    const tagsIndex = indexTagsByKey(forumChannel);
    if (!tagsIndex.enCours || !tagsIndex.deban || !tagsIndex.refuse) {
        // Sécurité : si pour une raison X les tags n'ont pas été créés comme prévu, on log et renvoie ce qu'on a
        console.warn('[DebanForum] Tags partiels après création :', tagsIndex);
    }

    const persisted = setForumConfigForGuild(testGuildId, {
        forumGuildId,
        forumChannelId: forumChannel.id,
        tags: {
            enCours: tagsIndex.enCours || null,
            deban: tagsIndex.deban || null,
            refuse: tagsIndex.refuse || null,
        },
        createdAt: new Date().toISOString(),
    });

    return { forumChannel, tags: persisted.tags, config: persisted };
}

/**
 * Associe chaque tag forum par son nom attendu à la clé interne (enCours/deban/refuse).
 */
function indexTagsByKey(forumChannel) {
    const tags = forumChannel.availableTags || [];
    const byName = new Map(tags.map((t) => [String(t.name).toLowerCase().trim(), t.id]));
    const out = {};
    for (const spec of TAG_SPECS) {
        const id = byName.get(spec.name.toLowerCase().trim());
        if (id) out[spec.key] = id;
    }
    return out;
}

/**
 * Sync des tags : si la config contient des IDs de tags invalides (tag supprimé manuellement),
 * on tente de re-matcher par nom et on met à jour la config.
 */
async function ensureTagsValid(client, testGuildId) {
    const cfg = getForumConfigForGuild(testGuildId);
    if (!cfg || !cfg.forumChannelId) return null;

    const forumChannel = await client.channels.fetch(cfg.forumChannelId).catch(() => null);
    if (!forumChannel || forumChannel.type !== ChannelType.GuildForum) return null;

    const tags = forumChannel.availableTags || [];
    const validIds = new Set(tags.map((t) => t.id));
    const anyMissing = !cfg.tags?.enCours || !cfg.tags?.deban || !cfg.tags?.refuse
        || !validIds.has(cfg.tags.enCours) || !validIds.has(cfg.tags.deban) || !validIds.has(cfg.tags.refuse);

    if (!anyMissing) return { forumChannel, tags: cfg.tags, config: cfg };

    const rematched = indexTagsByKey(forumChannel);
    const updated = {
        enCours: rematched.enCours || cfg.tags?.enCours || null,
        deban: rematched.deban || cfg.tags?.deban || null,
        refuse: rematched.refuse || cfg.tags?.refuse || null,
    };

    setForumConfigForGuild(testGuildId, { ...cfg, tags: updated });
    return { forumChannel, tags: updated, config: { ...cfg, tags: updated } };
}

/* ============================ POST CREATION ============================ */

/**
 * Construit le payload (embed + boutons de vote) affiché dans le starter message du post.
 */
function buildDebanPostPayload(userData, reportContent, mentionRoleId) {
    const embed = new EmbedBuilder()
        .setTitle(`Demande de débannissement — ${userData.discordUsername}`)
        .setDescription(reportContent)
        .addFields(
            { name: 'Oui', value: '0', inline: true },
            { name: 'Non', value: '0', inline: true }
        )
        .setColor('#FFD700')
        .setFooter({ text: `ID : ${userData.discordId}` })
        .setTimestamp();

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`deban_vote_oui_${userData.discordId}`)
            .setLabel('Oui')
            .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
            .setCustomId(`deban_vote_non_${userData.discordId}`)
            .setLabel('Non')
            .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
            .setCustomId(`fin_deban_vote_${userData.discordId}`)
            .setLabel('Fin du Vote')
            .setStyle(ButtonStyle.Secondary)
    );

    const content = mentionRoleId ? `<@&${mentionRoleId}> Nouvelle demande de débannissement.` : undefined;
    return { content, embeds: [embed], components: [row] };
}

/**
 * Crée un post forum pour une demande de deban.
 *
 * @param {import('discord.js').Client} client
 * @param {string} testGuildId
 * @param {object} userData   (discordId, discordUsername, …)
 * @param {string} reportContent
 * @param {string} mentionRoleId  Rôle à ping dans le post (ex: Staff)
 * @returns {Promise<{ thread, starterMessage, forumChannel, tags }>}
 */
async function createDebanPost(client, testGuildId, userData, reportContent, mentionRoleId) {
    const resolved = await ensureTagsValid(client, testGuildId);
    if (!resolved) {
        throw new Error(
            `Aucune configuration forum trouvée pour la guild ${testGuildId}. Utilisez /panel-deban-test pour créer le forum.`
        );
    }

    const { forumChannel, tags } = resolved;
    const payload = buildDebanPostPayload(userData, reportContent, mentionRoleId);

    const appliedTags = tags.enCours ? [tags.enCours] : [];

    const thread = await forumChannel.threads.create({
        name: `Appeal by @${userData.discordUsername}`.slice(0, 100),
        autoArchiveDuration: 10080, // 7 jours
        appliedTags,
        message: {
            content: payload.content,
            embeds: payload.embeds,
            components: payload.components,
            allowedMentions: mentionRoleId ? { roles: [mentionRoleId] } : { parse: [] },
        },
        reason: `Demande de déban de ${userData.discordUsername} (${userData.discordId})`,
    });

    // Le starter message d'un post forum a le même ID que le thread.
    let starterMessage = null;
    try {
        starterMessage = await thread.fetchStarterMessage();
    } catch {
        starterMessage = null;
    }

    return { thread, starterMessage, forumChannel, tags };
}

/* ============================ POST LOCK/CLOSE ============================ */

/**
 * Ferme un post de débannissement : applique le tag final (deban/refuse), retire "en cours",
 * édite le starter message (embed final + boutons désactivés) puis verrouille le thread.
 *
 * Verrouiller (`setLocked(true)`) empêche les non-modérateurs d'envoyer des messages
 * tout en laissant le post visible : c'est exactement le comportement demandé
 * ("admins/modos peuvent parler, les autres non").
 *
 * @param {object} opts
 * @param {import('discord.js').ThreadChannel} opts.thread
 * @param {import('discord.js').Message}       opts.starterMessage  Optionnel — refetché si absent
 * @param {string}                             opts.testGuildId
 * @param {boolean}                            opts.accepted         true si deban accepté
 * @param {import('discord.js').EmbedBuilder}  [opts.resultEmbed]    Embed final à poser
 * @returns {Promise<{ locked: boolean, tagApplied: string|null }>}
 */
async function closeDebanPost({ thread, starterMessage, testGuildId, accepted, resultEmbed }) {
    if (!thread) return { locked: false, tagApplied: null };

    const cfg = getForumConfigForGuild(testGuildId);
    const tagFinal = accepted ? cfg?.tags?.deban : cfg?.tags?.refuse;

    // 1) Applique le tag final + retire "En cours"
    if (tagFinal) {
        try {
            const current = Array.isArray(thread.appliedTags) ? [...thread.appliedTags] : [];
            const filtered = current.filter((t) => t !== cfg?.tags?.enCours);
            if (!filtered.includes(tagFinal)) filtered.push(tagFinal);
            // Discord limite à 5 tags max par post
            await thread.setAppliedTags(filtered.slice(0, 5)).catch(() => null);
        } catch (err) {
            console.warn('[DebanForum] setAppliedTags:', err?.message || err);
        }
    }

    // 2) Edite le starter message : embed final + boutons désactivés
    if (resultEmbed) {
        try {
            const msg = starterMessage || (await thread.fetchStarterMessage().catch(() => null));
            if (msg) {
                const disabledRow = msg.components?.[0];
                if (disabledRow?.components) {
                    disabledRow.components.forEach((btn) => { if (btn.data) btn.data.disabled = true; });
                }
                await msg.edit({ embeds: [resultEmbed], components: disabledRow ? [disabledRow] : [] }).catch(() => null);
            }
        } catch (err) {
            console.warn('[DebanForum] edit starter message:', err?.message || err);
        }
    }

    // 3) Verrouille le thread — seuls les membres avec ManageThreads (=admins/modos) peuvent y écrire.
    //    On NE l'archive PAS : il reste visible tel quel par tous ceux qui peuvent voir le forum.
    let locked = false;
    try {
        await thread.setLocked(true, `Deban ${accepted ? 'accepté' : 'refusé'} — post verrouillé`);
        locked = true;
    } catch (err) {
        console.warn('[DebanForum] setLocked:', err?.message || err);
    }

    return { locked, tagApplied: tagFinal || null };
}

/**
 * Détecte si un channel (thread ou parent) est un post forum de notre système deban.
 * Utile dans le handler de fin de vote pour différencier les votes embed-classique des posts forum.
 */
function isDebanForumThread(channel) {
    if (!channel?.isThread?.()) return false;
    const parent = channel.parent;
    if (!parent || parent.type !== ChannelType.GuildForum) return false;
    // Vérifie que le parent figure dans un des mappings persistés.
    const all = loadConfig();
    return Object.values(all).some((cfg) => cfg?.forumChannelId === parent.id);
}

/**
 * Retrouve le testGuildId associé à un forum channel (parent d'un thread).
 */
function findTestGuildIdByForumChannelId(forumChannelId) {
    const all = loadConfig();
    for (const [testGuildId, cfg] of Object.entries(all)) {
        if (cfg?.forumChannelId === forumChannelId) return testGuildId;
    }
    return null;
}

module.exports = {
    CONFIG_PATH,
    TAG_SPECS,
    loadConfig,
    saveConfig,
    getForumConfigForGuild,
    setForumConfigForGuild,
    removeForumConfigForGuild,
    createDebanForum,
    ensureTagsValid,
    createDebanPost,
    buildDebanPostPayload,
    closeDebanPost,
    isDebanForumThread,
    findTestGuildIdByForumChannelId,
};
