const {
    joinVoiceChannel,
    createAudioPlayer,
    createAudioResource,
    AudioPlayerStatus,
    NoSubscriberBehavior,
} = require('@discordjs/voice');
const play = require('play-dl');
const logger = require('./logger');

/** @typedef {{ title: string, url: string, requestedBy: string }} MusicTrack */

const sessions = new Map();

const MAX_QUEUE = 40;
const MAX_HISTORY = 35;
const MAX_PLAYLIST_IMPORT = 18;

class GuildMusicSession {
    /**
     * @param {string} guildId
     */
    constructor(guildId) {
        this.guildId = guildId;
        /** @type {MusicTrack[]} */
        this.queue = [];
        /** @type {MusicTrack[]} */
        this.history = [];
        /** @type {MusicTrack | null} */
        this.current = null;
        this.connection = null;
        this.voiceChannelId = null;
        this.panelChannelId = null;
        this.panelMessageId = null;
        /** @type {import('discord.js').Client | null} */
        this._client = null;
        this.skipIdlePushOnce = false;

        this.player = createAudioPlayer({
            behaviors: { noSubscriber: NoSubscriberBehavior.Pause },
        });
        this.player.on(AudioPlayerStatus.Idle, () => this._onIdle());
        this.player.on('error', (err) => {
            logger.error('[MUSIC] AudioPlayer error:', err);
            try {
                this.player.stop(true);
            } catch (_) {
                /* ignore */
            }
        });
    }

    _onIdle() {
        if (this.skipIdlePushOnce) {
            this.skipIdlePushOnce = false;
            void this._playNextFromQueue();
            return;
        }
        if (this.current) {
            this.history.push(this.current);
            if (this.history.length > MAX_HISTORY) {
                this.history.splice(0, this.history.length - MAX_HISTORY);
            }
        }
        this.current = null;
        void this._playNextFromQueue();
    }

    /**
     * @param {import('discord.js').Client} client
     * @param {import('discord.js').VoiceChannel} voiceChannel
     */
    ensureConnection(client, voiceChannel) {
        this._client = client;
        this.voiceChannelId = voiceChannel.id;

        if (this.connection && this.connection.joinConfig.channelId === voiceChannel.id) {
            return this.connection;
        }

        if (this.connection) {
            try {
                this.connection.destroy();
            } catch (_) {
                /* ignore */
            }
            this.connection = null;
        }

        this.connection = joinVoiceChannel({
            channelId: voiceChannel.id,
            guildId: voiceChannel.guild.id,
            adapterCreator: voiceChannel.guild.voiceAdapterCreator,
            selfDeaf: true,
            selfMute: false,
        });

        this.connection.subscribe(this.player);
        return this.connection;
    }

    /**
     * @param {string} channelId
     * @param {string} messageId
     */
    setPanelMessage(channelId, messageId) {
        this.panelChannelId = channelId;
        this.panelMessageId = messageId;
    }

    /**
     * @param {MusicTrack} track
     */
    enqueue(track) {
        if (this.queue.length >= MAX_QUEUE) {
            return false;
        }
        this.queue.push(track);
        return true;
    }

    /** @param {MusicTrack[]} tracks */
    enqueueMany(tracks) {
        let n = 0;
        for (const t of tracks) {
            if (this.queue.length >= MAX_QUEUE) break;
            this.queue.push(t);
            n++;
        }
        return n;
    }

    async startOrContinue(client, voiceChannel) {
        this.ensureConnection(client, voiceChannel);
        if (this.player.state.status === AudioPlayerStatus.Idle && !this.current) {
            await this._playNextFromQueue();
        }
    }

    async _playNextFromQueue() {
        this.current = null;
        while (this.queue.length) {
            const track = this.queue.shift();
            try {
                const src = await play.stream(track.url, { discordPlayerCompatibility: true });
                const resource = createAudioResource(src.stream, {
                    inputType: src.type,
                    inlineVolume: true,
                });
                if (resource.volume) {
                    resource.volume.setVolume(0.85);
                }
                this.current = track;
                this.player.play(resource);
                await this.refreshPanel();
                return;
            } catch (e) {
                logger.error('[MUSIC] Stream error:', e?.message || e);
            }
        }
        await this.refreshPanel();
    }

    skip() {
        this.player.stop(true);
    }

    previous() {
        if (!this.history.length) return false;
        const prev = this.history.pop();
        if (this.current) {
            this.queue.unshift(this.current);
        }
        this.current = null;
        this.queue.unshift(prev);
        this.skipIdlePushOnce = true;
        this.player.stop(true);
        return true;
    }

    pause() {
        const ok = this.player.pause(true);
        return ok;
    }

    resume() {
        const ok = this.player.unpause();
        return ok;
    }

    isPaused() {
        return this.player.state.status === AudioPlayerStatus.Paused;
    }

    stopAndClear() {
        this.queue.length = 0;
        this.history.length = 0;
        this.current = null;
        try {
            this.player.stop(true);
        } catch (_) {
            /* ignore */
        }
        if (this.connection) {
            try {
                this.connection.destroy();
            } catch (_) {
                /* ignore */
            }
            this.connection = null;
        }
        this.voiceChannelId = null;
        void this.refreshPanel();
    }

    getQueueLines() {
        const lines = [];
        if (this.current) {
            lines.push(`**▶ En cours :** ${this.current.title}`);
        }
        if (!this.queue.length) {
            lines.push(this.current ? '*File vide.*' : '*Aucune lecture.*');
            return lines;
        }
        this.queue.slice(0, 15).forEach((t, i) => {
            lines.push(`${i + 1}. ${t.title}`);
        });
        if (this.queue.length > 15) {
            lines.push(`*… +${this.queue.length - 15} autre(s)*`);
        }
        return lines;
    }

    async refreshPanel() {
        if (!this._client || !this.panelChannelId || !this.panelMessageId) return;
        try {
            const ch = await this._client.channels.fetch(this.panelChannelId).catch(() => null);
            if (!ch?.isTextBased?.()) return;
            const msg = await ch.messages.fetch(this.panelMessageId).catch(() => null);
            if (!msg?.editable) return;
            const { buildMusicPanelPayload } = require('./voice-music-panel');
            await msg.edit(buildMusicPanelPayload(this.guildId, this));
        } catch (e) {
            logger.debug(`[MUSIC] refreshPanel: ${e?.message || e}`);
        }
    }
}

/**
 * @param {string} guildId
 * @returns {GuildMusicSession}
 */
function getMusicSession(guildId) {
    let s = sessions.get(guildId);
    if (!s) {
        s = new GuildMusicSession(guildId);
        sessions.set(guildId, s);
    }
    return s;
}

/**
 * @param {import('discord.js').Client} client
 * @param {string} guildId
 * @param {import('discord.js').GuildChannel} textChannel
 * @param {import('discord.js').GuildMember} member
 */
async function postOrReplaceMusicPanel(client, guildId, textChannel, member) {
    const session = getMusicSession(guildId);
    session._client = client;
    if (session.panelChannelId && session.panelMessageId) {
        try {
            const oldCh = await client.channels.fetch(session.panelChannelId).catch(() => null);
            if (oldCh?.isTextBased?.()) {
                const oldMsg = await oldCh.messages.fetch(session.panelMessageId).catch(() => null);
                await oldMsg?.delete?.().catch(() => null);
            }
        } catch (_) {
            /* ignore */
        }
    }
    const { buildMusicPanelPayload } = require('./voice-music-panel');
    const payload = {
        content: `<@${member.id}>`,
        ...buildMusicPanelPayload(guildId, session),
    };
    const msg = await textChannel.send({
        ...payload,
        allowedMentions: { users: [member.id] },
    });
    session.setPanelMessage(textChannel.id, msg.id);
    return msg;
}

/**
 * @param {string} query
 * @returns {Promise<MusicTrack[] | null>}
 */
async function resolveYoutubeQueryToTracks(query, requestedBy) {
    let v;
    try {
        v = await play.yt_validate(query);
    } catch {
        return null;
    }
    if (v === 'video') {
        let title = query;
        try {
            const info = await play.video_basic_info(query);
            title = info.video_details?.title || title;
        } catch (_) {
            /* keep url as title fallback */
        }
        return [{ title, url: query, requestedBy }];
    }
    if (v === 'playlist') {
        try {
            const pl = await play.playlist_info(query, { incomplete: true });
            await pl.fetch();
            const all = await pl.all_videos();
            const slice = all.slice(0, MAX_PLAYLIST_IMPORT);
            return slice
                .filter((x) => x.url && !x.live)
                .map((x) => ({
                    title: x.title || 'Sans titre',
                    url: x.url,
                    requestedBy,
                }));
        } catch (e) {
            logger.warn('[MUSIC] playlist import:', e?.message || e);
            return null;
        }
    }
    return null;
}

/**
 * @param {string} query
 * @param {string} requestedBy
 */
async function searchYoutubeVideos(query, requestedBy) {
    const results = await play.search(query, {
        limit: 10,
        source: { youtube: 'video' },
    });
    return results
        .filter((r) => r.url && !r.live)
        .map((r) => ({
            title: r.title || 'Sans titre',
            url: r.url,
            requestedBy,
            durationRaw: r.durationRaw || '',
        }));
}

module.exports = {
    getMusicSession,
    postOrReplaceMusicPanel,
    resolveYoutubeQueryToTracks,
    searchYoutubeVideos,
    MAX_QUEUE,
    MAX_PLAYLIST_IMPORT,
};
