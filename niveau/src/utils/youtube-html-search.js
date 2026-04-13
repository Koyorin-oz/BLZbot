const axios = require('axios');

const USER_AGENT =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

/** ID vidéo YouTube standard (11 caractères). */
const YOUTUBE_VIDEO_ID_RE = /^[a-zA-Z0-9_-]{11}$/;

/**
 * Extrait l’ID vidéo depuis une URL YouTube (watch, music, shorts, embed, youtu.be, etc.).
 * @param {string | null | undefined} raw
 * @returns {string | null}
 */
function extractYoutubeVideoId(raw) {
    if (raw == null) return null;
    const s = String(raw).trim();
    if (!s) return null;
    let u;
    try {
        u = new URL(s);
    } catch {
        return null;
    }
    const host = (u.hostname || '').replace(/^www\./, '').toLowerCase();

    if (host === 'youtu.be') {
        const id = u.pathname.split('/').filter(Boolean)[0]?.split('?')[0] ?? '';
        return YOUTUBE_VIDEO_ID_RE.test(id) ? id : null;
    }

    if (host === 'youtube-nocookie.com') {
        const m = u.pathname.match(/^\/embed\/([a-zA-Z0-9_-]{11})(?:\/|$|\?)/);
        return m && YOUTUBE_VIDEO_ID_RE.test(m[1]) ? m[1] : null;
    }

    const isYoutubeHost = host === 'youtube.com' || host.endsWith('.youtube.com');
    if (isYoutubeHost) {
        const v = u.searchParams.get('v');
        if (v && YOUTUBE_VIDEO_ID_RE.test(v)) return v;
        const path = u.pathname;
        const shorts = path.match(/^\/shorts\/([a-zA-Z0-9_-]{11})(?:\/|$|\?)/);
        if (shorts && YOUTUBE_VIDEO_ID_RE.test(shorts[1])) return shorts[1];
        const embed = path.match(/^\/embed\/([a-zA-Z0-9_-]{11})(?:\/|$|\?)/);
        if (embed && YOUTUBE_VIDEO_ID_RE.test(embed[1])) return embed[1];
        const live = path.match(/^\/live\/([a-zA-Z0-9_-]{11})(?:\/|$|\?)/);
        if (live && YOUTUBE_VIDEO_ID_RE.test(live[1])) return live[1];
    }

    return null;
}

/**
 * URL canonique pour play-dl / @discordjs/voice (évite Invalid URL si lien music/shorts/embed).
 * @param {string | null | undefined} raw
 * @returns {string | null}
 */
function normalizeYoutubePlayUrl(raw) {
    const id = extractYoutubeVideoId(raw);
    return id ? `https://www.youtube.com/watch?v=${id}` : null;
}

/**
 * @param {string} url
 * @returns {boolean}
 */
function isYoutubeWatchUrl(url) {
    return extractYoutubeVideoId(url) !== null;
}

/**
 * Extrait le premier objet JSON à partir d’un `{` en respectant chaînes et accolades
 * (le HTML YouTube contient des `;` dans le JSON — un simple split ne suffit pas).
 * @param {string} html
 * @param {number} braceStart index du `{` initial
 * @returns {object | null}
 */
function parseBalancedJsonObject(html, braceStart) {
    if (html[braceStart] !== '{') return null;
    let depth = 0;
    let inString = false;
    let escape = false;
    for (let i = braceStart; i < html.length; i++) {
        const c = html[i];
        if (inString) {
            if (escape) {
                escape = false;
                continue;
            }
            if (c === '\\') {
                escape = true;
                continue;
            }
            if (c === '"') inString = false;
            continue;
        }
        if (c === '"') {
            inString = true;
            continue;
        }
        if (c === '{') depth++;
        else if (c === '}') {
            depth--;
            if (depth === 0) {
                try {
                    return JSON.parse(html.slice(braceStart, i + 1));
                } catch {
                    return null;
                }
            }
        }
    }
    return null;
}

/**
 * @param {string} html
 * @returns {object | null}
 */
function extractYtInitialData(html) {
    if (!html || typeof html !== 'string') return null;
    const withVar = 'var ytInitialData = ';
    const plain = 'ytInitialData = ';
    let idx = html.indexOf(withVar);
    if (idx !== -1) {
        idx += withVar.length;
    } else {
        idx = html.indexOf(plain);
        if (idx === -1) return null;
        idx += plain.length;
    }
    while (idx < html.length && /\s/.test(html[idx])) idx++;
    return parseBalancedJsonObject(html, idx);
}

/**
 * @param {unknown} node
 * @param {object[]} acc
 * @param {number} maxAcc
 */
function collectVideoRenderers(node, acc, maxAcc) {
    if (!node || acc.length >= maxAcc) return;
    if (typeof node !== 'object') return;
    if (node.videoRenderer?.videoId) {
        acc.push(node.videoRenderer);
        if (acc.length >= maxAcc) return;
    }
    for (const v of Object.values(node)) {
        if (acc.length >= maxAcc) return;
        if (Array.isArray(v)) {
            for (const x of v) collectVideoRenderers(x, acc, maxAcc);
        } else if (v && typeof v === 'object') {
            collectVideoRenderers(v, acc, maxAcc);
        }
    }
}

/**
 * @param {object} vr
 * @returns {string}
 */
function titleFromVideoRenderer(vr) {
    const t = vr.title;
    if (!t) return 'Sans titre';
    if (typeof t.simpleText === 'string') return t.simpleText;
    if (Array.isArray(t.runs)) return t.runs.map((r) => r.text || '').join('') || 'Sans titre';
    return 'Sans titre';
}

/**
 * Recherche YouTube sans play-dl (évite le crash browseId quand YouTube change le JSON).
 * @param {string} query
 * @param {number} limit
 * @returns {Promise<{ title: string, url: string, durationRaw: string }[]>}
 */
async function searchYoutubeViaHtml(query, limit = 10) {
    const q = encodeURIComponent(String(query || '').trim());
    if (!q) return [];

    const url = `https://www.youtube.com/results?search_query=${q}&sp=EgIQAQ%253D%253D`;

    const { data: html, status } = await axios.get(url, {
        headers: {
            'User-Agent': USER_AGENT,
            'Accept-Language': 'fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7',
            Accept: 'text/html,application/xhtml+xml',
        },
        maxRedirects: 5,
        timeout: 20000,
        validateStatus: (s) => s < 500,
        responseType: 'text',
        transformResponse: [(d) => d],
    });

    if (status === 429) {
        throw new Error('YouTube limite les requêtes (429). Réessaie dans un instant ou colle un lien.');
    }

    if (typeof html === 'string' && html.includes('Our systems have detected unusual traffic')) {
        throw new Error('YouTube a détecté un trafic automatisé. Réessaie plus tard ou colle un lien YouTube.');
    }

    const json = extractYtInitialData(typeof html === 'string' ? html : String(html));
    if (!json) {
        throw new Error('Impossible de lire la page de résultats YouTube.');
    }

    const renderers = [];
    collectVideoRenderers(json, renderers, 80);

    const out = [];
    const seen = new Set();
    for (const vr of renderers) {
        const id = vr.videoId;
        if (!id || seen.has(id)) continue;
        seen.add(id);

        const lengthText = vr.lengthText?.simpleText;
        const live = !lengthText;

        if (live) continue;

        const watchUrl = `https://www.youtube.com/watch?v=${id}`;
        out.push({
            title: titleFromVideoRenderer(vr).slice(0, 200),
            url: watchUrl,
            durationRaw: lengthText || '',
        });
        if (out.length >= limit) break;
    }

    return out;
}

module.exports = {
    searchYoutubeViaHtml,
    isYoutubeWatchUrl,
};
