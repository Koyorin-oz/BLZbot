const { ChannelType, PermissionFlagsBits } = require('discord.js');
const { Routes } = require('discord-api-types/v10');
const logger = require('./logger');
const { postOrReplaceMusicPanel } = require('./voice-music-manager');

/** Salon d’accueil par défaut (rejoindre ce vocal → création d’un salon privé). */
const DEFAULT_LOBBY_CHANNEL_ID = '1388968408711823411';

/** Catégorie Discord où créer les vocaux privés (surcharge : PRIVATE_ROOM_CATEGORY_ID dans le .env). */
const DEFAULT_VOICE_CATEGORY_ID = '1388968406664871986';

function normChannelName(s) {
    return String(s || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * ID du salon lobby sur CE serveur : .env / défaut, sinon recherche par nom (autre ID sur serveur de test).
 */
async function resolveLobbyVoiceChannel(guild, preferredId) {
    if (!guild) return { id: preferredId, channel: null, ok: false };

    if (/^\d{17,22}$/.test(preferredId)) {
        const ch = await guild.channels.fetch(preferredId).catch(() => null);
        if (ch?.isVoiceBased?.()) return { id: ch.id, channel: ch, ok: true };
    }

    const custom = String(process.env.PRIVATE_ROOM_LOBBY_NAME || '').trim();
    const exactNames = [
        custom,
        '➕ ・ Crée ton vocale !',
        '➕ · Crée ton vocale !',
        'Crée ton vocale !',
        'Crée ton vocale!',
    ].filter(Boolean);

    const seen = new Set();
    for (const name of exactNames) {
        const key = normChannelName(name);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        const hit = guild.channels.cache.find(
            (c) => c.isVoiceBased?.() && normChannelName(c.name) === key
        );
        if (hit) return { id: hit.id, channel: hit, ok: true };
    }

    const fuzzy = guild.channels.cache.find((c) => {
        if (!c.isVoiceBased?.()) return false;
        const compact = normChannelName(c.name).replace(/[^a-z0-9]+/g, '');
        return /cre.{0,10}ton.{0,10}voc/i.test(compact);
    });
    if (fuzzy) return { id: fuzzy.id, channel: fuzzy, ok: true };

    return { id: preferredId, channel: null, ok: false };
}

function getConfig() {
    const lobbyChannelId = String(
        process.env.PRIVATE_ROOM_LOBBY_CHANNEL_ID || DEFAULT_LOBBY_CHANNEL_ID
    ).trim();
    let voiceCategoryId = String(process.env.PRIVATE_ROOM_CATEGORY_ID || '').trim();
    if (!voiceCategoryId || !/^\d{17,22}$/.test(voiceCategoryId)) {
        voiceCategoryId = DEFAULT_VOICE_CATEGORY_ID;
    }
    const panelTextChannelId = String(process.env.PRIVATE_ROOM_PANEL_CHANNEL_ID || '').trim();
    const enabled =
        process.env.PRIVATE_ROOM_ENABLED !== '0' &&
        voiceCategoryId.length > 0 &&
        /^\d{17,22}$/.test(voiceCategoryId);
    return { lobbyChannelId, voiceCategoryId, panelTextChannelId, enabled };
}

/**
 * Résout catégorie + salon du panneau :
 * - catégorie = PRIVATE_ROOM_CATEGORY_ID si valide, sinon DEFAULT_VOICE_CATEGORY_ID (BLZ vocaux privés) ;
 * - panneau = PRIVATE_ROOM_PANEL_CHANNEL_ID, sinon premier salon texte de cette catégorie (ou salon système).
 * @param {{ requireLobby?: boolean }} opts — `requireLobby: false` pour ne pas exiger le lobby (ex. suppression vocal).
 */
async function resolvePrivateRoomConfig(client, guild, opts = {}) {
    const requireLobby = opts.requireLobby !== false;
    const preferredLobby = String(
        process.env.PRIVATE_ROOM_LOBBY_CHANNEL_ID || DEFAULT_LOBBY_CHANNEL_ID
    ).trim();
    let lobbyChannelId = preferredLobby;
    let voiceCategoryId = String(process.env.PRIVATE_ROOM_CATEGORY_ID || '').trim();
    if (!voiceCategoryId || !/^\d{17,22}$/.test(voiceCategoryId)) {
        voiceCategoryId = DEFAULT_VOICE_CATEGORY_ID;
    }
    let panelTextChannelId = String(process.env.PRIVATE_ROOM_PANEL_CHANNEL_ID || '').trim();

    if (guild) {
        if (requireLobby) {
            const lobbyRes = await resolveLobbyVoiceChannel(guild, preferredLobby);
            if (!lobbyRes.ok) {
                return {
                    lobbyChannelId: preferredLobby,
                    voiceCategoryId,
                    panelTextChannelId,
                    enabled: false,
                    error: 'lobby_not_found',
                };
            }
            lobbyChannelId = lobbyRes.id;
            if (
                lobbyRes.id !== preferredLobby &&
                !client._privateRoomLobbyResolvedLog?.has(guild.id)
            ) {
                if (!client._privateRoomLobbyResolvedLog) client._privateRoomLobbyResolvedLog = new Set();
                client._privateRoomLobbyResolvedLog.add(guild.id);
                logger.info(
                    `[PRIVATE_ROOM] Lobby sur « ${guild.name} » : <#${lobbyRes.id}> (l’ID par défaut ne correspond pas à ce serveur). Optionnel : PRIVATE_ROOM_LOBBY_CHANNEL_ID=${lobbyRes.id}`
                );
            }
        }

        if ((!panelTextChannelId || !/^\d{17,22}$/.test(panelTextChannelId)) && voiceCategoryId) {
            const pick = guild.channels.cache
                .filter(
                    (c) =>
                        c.parentId === voiceCategoryId &&
                        typeof c.isTextBased === 'function' &&
                        c.isTextBased()
                )
                .sort((a, b) => (a.rawPosition ?? 0) - (b.rawPosition ?? 0))
                .first();
            if (pick) {
                panelTextChannelId = pick.id;
            } else if (guild.systemChannel?.isTextBased?.()) {
                panelTextChannelId = guild.systemChannel.id;
            }
        }
    }

    const enabled =
        process.env.PRIVATE_ROOM_ENABLED !== '0' &&
        voiceCategoryId.length > 0 &&
        /^\d{17,22}$/.test(voiceCategoryId);

    let error;
    if (!enabled && process.env.PRIVATE_ROOM_ENABLED !== '0' && guild) {
        if (!voiceCategoryId || !/^\d{17,22}$/.test(voiceCategoryId)) {
            error = 'missing_category';
        }
    }

    return { lobbyChannelId, voiceCategoryId, panelTextChannelId, enabled, error };
}

function sessionKey(guildId, userId) {
    return `${guildId}:${userId}`;
}

function ensureSessions(client) {
    if (!client.privateRoomSessions) {
        client.privateRoomSessions = new Map();
    }
    return client.privateRoomSessions;
}

function defaultChannelName(member) {
    const prefix = 'Salon de ';
    const raw =
        String(member.displayName || member.user?.username || 'membre')
            .replace(/[\r\n\t]/g, ' ')
            .trim() || 'membre';
    const maxRest = Math.max(0, 100 - prefix.length);
    return (prefix + raw.slice(0, maxRest)).slice(0, 100);
}

/**
 * Salon ouvert à tous les membres du serveur ; le créateur a Gérer le salon + mute/déplacer.
 */
function buildOverwrites(guild, member) {
    const rows = [
        {
            id: guild.id,
            allow: [
                PermissionFlagsBits.ViewChannel,
                PermissionFlagsBits.Connect,
                PermissionFlagsBits.Speak,
            ],
        },
        {
            id: member.id,
            allow: [
                PermissionFlagsBits.ViewChannel,
                PermissionFlagsBits.Connect,
                PermissionFlagsBits.Speak,
                PermissionFlagsBits.MuteMembers,
                PermissionFlagsBits.DeafenMembers,
                PermissionFlagsBits.MoveMembers,
                PermissionFlagsBits.ManageChannels,
            ],
        },
    ];
    const botId = guild.client?.user?.id;
    if (botId) {
        rows.push({
            id: botId,
            allow: [
                PermissionFlagsBits.ViewChannel,
                PermissionFlagsBits.Connect,
                PermissionFlagsBits.SendMessages,
                PermissionFlagsBits.EmbedLinks,
                PermissionFlagsBits.ReadMessageHistory,
                PermissionFlagsBits.AttachFiles,
            ],
        });
    }
    return rows;
}

function ensurePrivateRoomByVoice(client) {
    if (!client.privateRoomByVoiceId) {
        client.privateRoomByVoiceId = new Map();
    }
    return client.privateRoomByVoiceId;
}

function registerPrivateRoomVoice(client, guildId, ownerId, voiceChannelId) {
    ensurePrivateRoomByVoice(client).set(voiceChannelId, { ownerId, guildId });
}

function unregisterPrivateRoomVoice(client, voiceChannelId) {
    client.privateRoomByVoiceId?.delete(voiceChannelId);
}

function getPrivateRoomVoiceMeta(client, voiceChannelId) {
    return client.privateRoomByVoiceId?.get(voiceChannelId) || null;
}

function formatDiscordErr(e) {
    if (!e) return '';
    const raw = e.rawError ?? e.cause?.rawError;
    let rawStr = '';
    try {
        rawStr = raw ? ` | API: ${JSON.stringify(raw).slice(0, 400)}` : '';
    } catch (_) {
        rawStr = '';
    }
    return `${e.message || e} [code ${e.code ?? '?'}]${rawStr}`;
}

/**
 * @param {import('discord.js').GuildChannel} ch
 */
function collectCategoryTextChannels(guild, categoryId) {
    if (!categoryId) return [];
    return guild.channels.cache
        .filter(
            (c) =>
                String(c.parentId) === String(categoryId) &&
                typeof c.isTextBased === 'function' &&
                c.isTextBased() &&
                !c.isVoiceBased?.()
        )
        .sort((a, b) => (a.rawPosition ?? 0) - (b.rawPosition ?? 0))
        .map((c) => c);
}

/**
 * Poste le panneau dans le chat du vocal ; si impossible, tente l’API REST puis des salons texte.
 * @param {{ skipFallback?: boolean }} [opts]
 * @returns {Promise<{ where: 'voice' | 'voice-rest' | 'fallback' | 'none' }>}
 */
async function sendPrivateRoomControlPanel(client, guild, cfg, member, voiceChannel, opts = {}) {
    const skipFallback = opts.skipFallback === true;
    const { buildPrivateVoicePanelPayload } = require('./voice-room-panel');
    const botId = client.user.id;
    const memberId = member.id;

    try {
        await voiceChannel.permissionOverwrites.edit(botId, {
            ViewChannel: true,
            Connect: true,
            SendMessages: true,
            EmbedLinks: true,
            ReadMessageHistory: true,
            AttachFiles: true,
        });
    } catch (e) {
        console.error(`[PRIVATE_ROOM] overwrite bot: ${formatDiscordErr(e)}`);
    }

    const panelPayload = {
        content: `<@${memberId}>`,
        ...buildPrivateVoicePanelPayload(voiceChannel.id, 'restricted'),
    };

    const restBody = () => ({
        content: panelPayload.content,
        embeds: panelPayload.embeds.map((e) => e.toJSON()),
        components: panelPayload.components.map((r) => r.toJSON()),
    });

    let lastErr;

    async function trySendInVoice(ch) {
        let partial;
        try {
            partial = await ch.send({
                content: panelPayload.content,
                allowedMentions: { users: [memberId] },
            });
            await partial.edit({
                embeds: panelPayload.embeds,
                components: panelPayload.components,
            });
            return true;
        } catch (eSplit) {
            if (partial) {
                await partial.delete().catch(() => null);
            }
            try {
                await ch.send(panelPayload);
                return true;
            } catch (eFull) {
                lastErr = eFull;
                console.error(`[PRIVATE_ROOM] vocal send split/edit: ${formatDiscordErr(eSplit)}`);
                console.error(`[PRIVATE_ROOM] vocal send full: ${formatDiscordErr(eFull)}`);
                return false;
            }
        }
    }

    const fresh = await guild.channels.fetch(voiceChannel.id, { force: true }).catch(() => voiceChannel);

    for (let attempt = 0; attempt < 4; attempt++) {
        if (attempt > 0) {
            await new Promise((r) => setTimeout(r, 500 * attempt));
        }
        if (await trySendInVoice(fresh)) {
            return { where: 'voice' };
        }
    }

    try {
        await client.rest.post(Routes.channelMessages(voiceChannel.id), { body: restBody() });
        return { where: 'voice-rest' };
    } catch (e) {
        lastErr = e;
        console.error(`[PRIVATE_ROOM] vocal REST: ${formatDiscordErr(e)}`);
    }

    if (skipFallback) {
        return { where: 'none' };
    }

    const fallbackIntro =
        `${panelPayload.content}\n*(Le chat du vocal a refusé l’envoi — panneau ici. Vérifie que le bot peut **Envoyer des messages** sur les **salons vocaux** / la catégorie. Commande : \`/panel-voc\`.)*\n`;
    const fallbackPayload = {
        content: fallbackIntro,
        embeds: panelPayload.embeds,
        components: panelPayload.components,
    };

    const targets = [];
    if (cfg.panelTextChannelId && /^\d{17,22}$/.test(cfg.panelTextChannelId)) {
        const t = await guild.channels.fetch(cfg.panelTextChannelId).catch(() => null);
        if (t && typeof t.send === 'function') targets.push(t);
    }
    for (const c of collectCategoryTextChannels(guild, cfg.voiceCategoryId)) {
        if (!targets.some((x) => x.id === c.id)) targets.push(c);
    }
    if (guild.systemChannel && typeof guild.systemChannel.send === 'function') {
        if (!targets.some((x) => x.id === guild.systemChannel.id)) targets.push(guild.systemChannel);
    }

    for (const tch of targets) {
        try {
            await tch.send(fallbackPayload);
            console.error(
                `[PRIVATE_ROOM] Panneau en SECOURS dans #${tch.name} (${tch.id}) — corrige les permissions « Envoyer des messages » pour le bot sur les vocaux de la catégorie.`
            );
            return { where: 'fallback' };
        } catch (e) {
            lastErr = e;
            console.error(`[PRIVATE_ROOM] fallback #${tch.id}: ${formatDiscordErr(e)}`);
        }
    }

    console.error(
        `[PRIVATE_ROOM] PANNEAU IMPOSSIBLE vocal ${voiceChannel.name} (${voiceChannel.id}) — ${formatDiscordErr(lastErr)}`
    );
    logger.error(`[PRIVATE_ROOM] Panneau : échec total. ${formatDiscordErr(lastErr)}`);
    return { where: 'none' };
}

async function createPrivateVoice(client, member, cfg) {
    const guild = member.guild;
    const me = guild.members.me;
    if (
        !me?.permissions.has(PermissionFlagsBits.ManageChannels) ||
        !me?.permissions.has(PermissionFlagsBits.MoveMembers)
    ) {
        logger.warn('[PRIVATE_ROOM] Le bot a besoin de « Gérer les salons » et « Déplacer les membres ».');
        return { ok: false, error: 'perms' };
    }

    const parent = await guild.channels.fetch(cfg.voiceCategoryId).catch(() => null);
    if (!parent || parent.type !== ChannelType.GuildCategory) {
        logger.warn('[PRIVATE_ROOM] Catégorie PRIVATE_ROOM_CATEGORY_ID introuvable ou invalide.');
        return { ok: false, error: 'category' };
    }

    const name = defaultChannelName(member);
    const channel = await guild.channels.create({
        name,
        type: ChannelType.GuildVoice,
        parent,
        permissionOverwrites: buildOverwrites(guild, member),
        reason: `Salon vocal privé — ${member.user.tag}`,
    });

    const sessions = ensureSessions(client);
    sessions.set(sessionKey(guild.id, member.id), { voiceChannelId: channel.id, ownerId: member.id });
    registerPrivateRoomVoice(client, guild.id, member.id, channel.id);

    /** Panneau AVANT le déplacement : évite les courses API / état vocal ; Discord accepte parfois mieux. */
    let panelWhere = await sendPrivateRoomControlPanel(client, guild, cfg, member, channel);
    if (panelWhere.where === 'none') {
        setTimeout(() => {
            sendPrivateRoomControlPanel(client, guild, cfg, member, channel, { skipFallback: true })
                .then((w) => {
                    if (w.where === 'voice' || w.where === 'voice-rest') {
                        console.error(
                            `[PRIVATE_ROOM] Panneau vocal OK après retry différé (2,5s) — ${channel.id}`
                        );
                    }
                })
                .catch(() => {});
        }, 2500);
    }

    if (member.voice?.channel) {
        await member.voice.setChannel(channel).catch((e) => {
            logger.warn(`[PRIVATE_ROOM] Impossible de déplacer le membre: ${e.message}`);
        });
    }

    if (panelWhere.where === 'voice' || panelWhere.where === 'voice-rest') {
        try {
            await postOrReplaceMusicPanel(client, guild.id, fresh, member);
        } catch (e) {
            logger.warn(`[PRIVATE_ROOM] Panneau musique: ${e?.message || e}`);
        }
    }

    logger.info(`[PRIVATE_ROOM] Créé ${channel.name} (${channel.id}) pour ${member.user.tag}`);
    return { ok: true, channel };
}

/**
 * Supprime le vocal privé du bot quand plus aucun humain dedans.
 */
async function deleteIfOwnerEmpty(client, channel) {
    const cfg = await resolvePrivateRoomConfig(client, channel.guild, { requireLobby: false });
    if (!cfg.enabled || !channel?.isVoiceBased?.()) return;
    if (String(channel.parentId || '') !== String(cfg.voiceCategoryId)) return;

    const sessions = client.privateRoomSessions;
    if (!sessions) return;

    const entry = [...sessions.entries()].find(([, v]) => v.voiceChannelId === channel.id);
    if (!entry) return;

    const humans = channel.members.filter((m) => !m.user.bot).size;
    if (humans > 0) return;

    await channel.delete(`Salon privé vide — ${channel.name}`).catch((e) => {
        logger.debug(`[PRIVATE_ROOM] Suppression: ${e.message}`);
    });
    unregisterPrivateRoomVoice(client, channel.id);
    sessions.delete(entry[0]);
}

async function handleLobbyJoin(client, oldState, newState) {
    if (!newState.guild || !newState.member || newState.member.user.bot) return;

    const cfg = await resolvePrivateRoomConfig(client, newState.guild);
    if (!cfg.enabled) {
        if (cfg.error === 'lobby_not_found') {
            logger.warn(
                `[PRIVATE_ROOM] Salon lobby introuvable (ID ${cfg.lobbyChannelId}). Vérifie PRIVATE_ROOM_LOBBY_CHANNEL_ID / GUILD_ID.`
            );
        } else if (cfg.error === 'missing_category' && !client._privateRoomMissingCategoryWarned) {
            client._privateRoomMissingCategoryWarned = true;
            logger.warn('[PRIVATE_ROOM] Catégorie vocale invalide — vérifie PRIVATE_ROOM_CATEGORY_ID dans le .env.');
        }
        return;
    }

    const lobbyIds = new Set([cfg.lobbyChannelId]);
    const joinedLobby =
        oldState.channelId !== newState.channelId &&
        newState.channelId &&
        lobbyIds.has(String(newState.channelId));

    if (!joinedLobby) return;

    const { guild, member } = newState;
    const sessions = ensureSessions(client);
    const key = sessionKey(guild.id, member.id);
    let session = sessions.get(key);
    if (!session) {
        session = { voiceChannelId: null };
        sessions.set(key, session);
    }

    if (session.voiceChannelId) {
        const existing = await guild.channels.fetch(session.voiceChannelId).catch(() => null);
        if (existing?.isVoiceBased?.()) {
            await member.voice.setChannel(existing).catch(() => null);
            return;
        }
        session.voiceChannelId = null;
    }

    try {
        const created = await createPrivateVoice(client, member, cfg);
        if (!created?.ok && created?.error !== 'perms' && created?.error !== 'category') {
            logger.warn('[PRIVATE_ROOM] createPrivateVoice:', created?.error);
        }
    } catch (e) {
        logger.error('[PRIVATE_ROOM]', e?.message || e);
    }
}

module.exports = {
    getConfig,
    resolvePrivateRoomConfig,
    handleLobbyJoin,
    deleteIfOwnerEmpty,
    ensureSessions,
    buildOverwrites,
    getPrivateRoomVoiceMeta,
};
