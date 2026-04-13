const { StreamType } = require('@discordjs/voice');
const logger = require('./logger');

/**
 * Flux audio YouTube pour @discordjs/voice : essaie play-dl, puis yt-dlp (binaire npm youtube-dl-exec)
 * quand YouTube ne fournit plus d’URL directe parsable par play-dl (TypeError Invalid URL).
 */

/**
 * @param {string} watchUrl URL https://www.youtube.com/watch?v=…
 * @returns {Promise<{ stream: import('node:stream').Readable, type: string }>}
 */
async function getYoutubeStreamForDiscord(watchUrl) {
    const play = require('play-dl');
    try {
        return await play.stream(watchUrl, { discordPlayerCompatibility: true });
    } catch (e) {
        const msg = e?.message || String(e);
        logger.warn('[MUSIC] play-dl stream échoue, fallback yt-dlp:', msg);
        return spawnYtdlpWebmOpusStream(watchUrl);
    }
}

/**
 * @param {string} watchUrl
 */
function spawnYtdlpWebmOpusStream(watchUrl) {
    const youtubedl = require('youtube-dl-exec');
    const subprocess = youtubedl.exec(
        watchUrl,
        {
            format: 'bestaudio[ext=webm]/bestaudio/best',
            output: '-',
            quiet: true,
            noWarnings: true,
            noPlaylist: true,
            limitRate: '50M',
        },
        {
            windowsHide: true,
        }
    );

    const stream = subprocess.stdout;
    if (!stream) {
        try {
            subprocess.kill('SIGKILL');
        } catch (_) {
            /* ignore */
        }
        throw new Error('yt-dlp: pas de flux audio (stdout)');
    }

    const kill = () => {
        try {
            if (!subprocess.killed) subprocess.kill('SIGKILL');
        } catch (_) {
            /* ignore */
        }
    };

    stream.once('error', kill);
    subprocess.once('error', (err) => {
        logger.warn('[MUSIC] yt-dlp process:', err?.message || err);
        kill();
    });

    return { stream, type: StreamType.WebmOpus };
}

module.exports = { getYoutubeStreamForDiscord };
