const fs = require('node:fs');
const path = require('node:path');
const {
    ChannelType,
    PermissionFlagsBits,
    OverwriteType,
} = require('discord.js');
const logger = require('./logger');

const STATE_PATH = path.join(__dirname, '..', 'database', 'member-stats-voice.json');
/** Limite Discord sur les renommages de salons : on ne rafraîchit les noms que périodiquement. */
const REFRESH_INTERVAL_MS = 10 * 60 * 1000;

/** @type {NodeJS.Timeout | null} */
let schedulerId = null;

/**
 * @typedef {object} GuildVoiceStatsState
 * @property {string} categoryId
 * @property {string} totalChannelId
 * @property {string} humansChannelId
 * @property {string} botsChannelId
 * @property {number} botCount
 */

/** @returns {Record<string, GuildVoiceStatsState>} */
function loadState() {
    try {
        if (!fs.existsSync(STATE_PATH)) return {};
        const raw = fs.readFileSync(STATE_PATH, 'utf8');
        const data = JSON.parse(raw);
        return data && typeof data === 'object' ? data : {};
    } catch (e) {
        logger.warn(`[member-stats-voice] Impossible de lire l’état: ${e.message}`);
        return {};
    }
}

/** @param {Record<string, GuildVoiceStatsState>} data */
function saveState(data) {
    const dir = path.dirname(STATE_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(STATE_PATH, JSON.stringify(data, null, 2), 'utf8');
}

/**
 * Carte guilde → ID catégorie (un salon/catégorie n’appartient qu’à une seule guilde Discord).
 * Format .env : MEMBER_STATS_CATEGORY_IDS=guildId:catId,guildId2:catId2
 * @returns {Map<string, string>}
 */
function parseMemberStatsCategoryIdsByGuild() {
    const raw = String(process.env.MEMBER_STATS_CATEGORY_IDS || '').trim();
    const map = new Map();
    if (!raw) return map;
    for (const part of raw.split(/[,;\n]+/)) {
        const seg = part.trim();
        const i = seg.indexOf(':');
        if (i === -1) continue;
        const g = seg.slice(0, i).trim();
        const c = seg.slice(i + 1).trim();
        if (/^\d{17,22}$/.test(g) && /^\d{17,22}$/.test(c)) map.set(g, c);
    }
    return map;
}

/**
 * Catégorie par défaut pour une guilde.
 * Si `MEMBER_STATS_CATEGORY_IDS` contient au moins une paire, seules les guildes listées ont un défaut
 * (ex. prod dans le .env, test sans catégorie fixe → il faut passer `categorie_id` sur le test).
 * Si la variable est vide, comportement classique : MEMBER_STATS_CATEGORY_ID puis fallback code.
 * @param {string} [guildId]
 * @returns {string | null}
 */
function defaultCategoryId(guildId) {
    const gid = String(guildId || '').trim();
    const map = parseMemberStatsCategoryIdsByGuild();
    if (gid && map.has(gid)) return map.get(gid);
    if (map.size > 0) {
        return null;
    }
    const fromEnv = String(process.env.MEMBER_STATS_CATEGORY_ID || '').trim();
    if (/^\d{17,22}$/.test(fromEnv)) return fromEnv;
    return '1257363671185621216';
}

/**
 * @param {import('discord.js').Guild} guild
 * @returns {import('discord.js').OverwriteResolvable[]}
 */
function buildVoiceStatOverwrites(guild) {
    /** @type {import('discord.js').OverwriteResolvable[]} */
    const overwrites = [
        {
            id: guild.id,
            type: OverwriteType.Role,
            allow: [PermissionFlagsBits.ViewChannel],
            deny: [
                PermissionFlagsBits.Connect,
                PermissionFlagsBits.Speak,
                PermissionFlagsBits.UseVAD,
                PermissionFlagsBits.Stream,
            ],
        },
    ];

    for (const role of guild.roles.cache.values()) {
        if (role.managed) continue;
        if (role.id === guild.id) continue;
        if (!role.permissions.has(PermissionFlagsBits.Administrator)) continue;
        overwrites.push({
            id: role.id,
            type: OverwriteType.Role,
            allow: [
                PermissionFlagsBits.ViewChannel,
                PermissionFlagsBits.Connect,
                PermissionFlagsBits.Speak,
                PermissionFlagsBits.UseVAD,
            ],
        });
    }

    return overwrites;
}

/**
 * @param {import('discord.js').Guild} guild
 * @param {GuildVoiceStatsState} st
 */
function expectedNames(guild, st) {
    const total = guild.memberCount;
    const bots = Math.min(Math.max(0, st.botCount), total);
    const humans = Math.max(0, total - bots);
    return {
        total: `Tous Les Membres: ${total}`,
        humans: `Membres: ${humans}`,
        bots: `Bots: ${bots}`,
    };
}

/**
 * @param {import('discord.js').Guild} guild
 * @param {GuildVoiceStatsState} st
 */
async function applyChannelNames(guild, st) {
    const names = expectedNames(guild, st);
    const map = [
        [st.totalChannelId, names.total],
        [st.humansChannelId, names.humans],
        [st.botsChannelId, names.bots],
    ];
    for (const [id, name] of map) {
        const ch = guild.channels.cache.get(id) ?? (await guild.channels.fetch(id).catch(() => null));
        if (!ch || !ch.isVoiceBased()) continue;
        if (ch.name === name) continue;
        try {
            await ch.setName(name, 'Compteurs membres');
        } catch (e) {
            logger.warn(`[member-stats-voice] setName ${id}: ${e.message || e}`);
        }
    }
}

/**
 * @param {import('discord.js').Guild} guild
 * @param {GuildVoiceStatsState} st
 */
async function syncOverwrites(guild, st) {
    const overwrites = buildVoiceStatOverwrites(guild);
    for (const id of [st.totalChannelId, st.humansChannelId, st.botsChannelId]) {
        const ch = guild.channels.cache.get(id) ?? (await guild.channels.fetch(id).catch(() => null));
        if (!ch || !ch.isVoiceBased()) continue;
        try {
            await ch.permissionOverwrites.set(overwrites, 'Compteurs membres — accès admin seulement');
        } catch (e) {
            logger.warn(`[member-stats-voice] overwrites ${id}: ${e.message || e}`);
        }
    }
}

/**
 * @param {import('discord.js').Client} client
 */
async function tickAllGuilds(client) {
    const state = loadState();
    for (const [guildId, st] of Object.entries(state)) {
        const guild = client.guilds.cache.get(guildId) ?? (await client.guilds.fetch(guildId).catch(() => null));
        if (!guild) continue;
        try {
            await applyChannelNames(guild, st);
        } catch (e) {
            logger.debug(`[member-stats-voice] tick ${guildId}: ${e.message}`);
        }
    }
}

/**
 * @param {import('discord.js').Client} client
 */
function startScheduler(client) {
    if (schedulerId) return;
    schedulerId = setInterval(() => {
        tickAllGuilds(client).catch((e) => logger.warn(`[member-stats-voice] tick: ${e.message}`));
    }, REFRESH_INTERVAL_MS);
    setTimeout(() => {
        tickAllGuilds(client).catch((e) => logger.warn(`[member-stats-voice] tick initial: ${e.message}`));
    }, 45_000);
    logger.info('[member-stats-voice] Planificateur de renommage démarré (toutes les 10 min).');
}

/**
 * @param {import('discord.js').Guild} guild
 * @param {import('discord.js').GuildMember} member
 */
async function onMemberJoined(guild, member) {
    const state = loadState();
    const st = state[guild.id];
    if (!st) return;
    if (member.user?.bot) {
        st.botCount = (st.botCount || 0) + 1;
        saveState(state);
    }
}

/**
 * @param {import('discord.js').Guild} guild
 * @param {import('discord.js').GuildMember | import('discord.js').PartialGuildMember} member
 */
async function onMemberLeft(guild, member) {
    const state = loadState();
    const st = state[guild.id];
    if (!st) return;
    if (member.user?.bot) {
        st.botCount = Math.max(0, (st.botCount || 0) - 1);
        saveState(state);
    }
}

/**
 * @param {import('discord.js').Guild} guild
 * @param {string} categoryId
 */
async function countBotsInGuild(guild) {
    const members = await guild.members.fetch();
    return members.filter((m) => m.user?.bot).size;
}

/**
 * @param {import('discord.js').Guild} guild
 * @param {string} categoryId
 * @param {{ recreate?: boolean }} [opts]
 */
async function deployMemberStatsVoice(guild, categoryId, opts = {}) {
    const raw = await guild.channels.fetch(categoryId).catch(() => null);
    if (!raw || raw.type !== ChannelType.GuildCategory) {
        throw new Error(
            'Catégorie introuvable sur **ce** serveur (un ID de catégorie ne marche que dans la guilde où il existe). ' +
                'Passe `categorie_id` dans la commande ou configure `MEMBER_STATS_CATEGORY_IDS` (voir .env.example).'
        );
    }

    await guild.roles.fetch().catch(() => {});
    const overwrites = buildVoiceStatOverwrites(guild);
    const botCount = await countBotsInGuild(guild);
    const total = guild.memberCount;

    let state = loadState();
    let st = state[guild.id];

    if (opts.recreate && st) {
        for (const id of [st.totalChannelId, st.humansChannelId, st.botsChannelId]) {
            const ch = guild.channels.cache.get(id) ?? (await guild.channels.fetch(id).catch(() => null));
            if (ch) await ch.delete('Redéploiement compteurs membres').catch(() => {});
        }
        delete state[guild.id];
        saveState(state);
        st = undefined;
    }

    const names = {
        total: `Tous Les Membres: ${total}`,
        humans: `Membres: ${Math.max(0, total - botCount)}`,
        bots: `Bots: ${botCount}`,
    };

    /** @param {string | undefined} id @param {string} name */
    async function ensureVoice(id, name) {
        if (id) {
            const existing =
                guild.channels.cache.get(id) ?? (await guild.channels.fetch(id).catch(() => null));
            if (existing && existing.type === ChannelType.GuildVoice && existing.parentId === categoryId) {
                await existing
                    .edit({
                        name,
                        permissionOverwrites: overwrites,
                        parent: categoryId,
                    })
                    .catch(() => {});
                return existing.id;
            }
        }
        const created = await guild.channels.create({
            name,
            type: ChannelType.GuildVoice,
            parent: categoryId,
            permissionOverwrites: overwrites,
            reason: 'Déploiement compteurs membres (BLZbot)',
        });
        return created.id;
    }

    const totalChannelId = await ensureVoice(st?.totalChannelId, names.total);
    const humansChannelId = await ensureVoice(st?.humansChannelId, names.humans);
    const botsChannelId = await ensureVoice(st?.botsChannelId, names.bots);

    st = {
        categoryId,
        totalChannelId,
        humansChannelId,
        botsChannelId,
        botCount,
    };
    state = loadState();
    state[guild.id] = st;
    saveState(state);

    await syncOverwrites(guild, st);
    await applyChannelNames(guild, st);

    return st;
}

module.exports = {
    defaultCategoryId,
    deployMemberStatsVoice,
    startScheduler,
    onMemberJoined,
    onMemberLeft,
    loadState,
};
