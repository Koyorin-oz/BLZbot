const axios = require('axios');

const USER_AGENT =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

/**
 * @param {string} url
 * @returns {boolean}
 */
function isYoutubeWatchUrl(url) {
    if (!url || typeof url !== 'string') return false;
    try {
        const u = new URL(url.trim());
        const host = u.hostname.replace(/^www\./, '');
        if (host === 'youtu.be') {
            const id = u.pathname.replace(/^\//, '').split('/')[0];
            return /^[\w-]{11}$/.test(id);
        }
        if (host === 'youtube.com' || host === 'm.youtube.com') {
            const v = u.searchParams.get('v');
            return Boolean(v && /^[\w-]{11}$/.test(v));
        }
        return false;
    } catch {
        return false;
    }
}

/**
 * @param {string} html
 * @returns {object | null}
 */
function extractYtInitialData(html) {
    if (!html || typeof html !== 'string') return null;
    const splitKey = 'var ytInitialData = ';
    let chunk = html.split(splitKey)[1];
    if (!chunk) {
        const alt = 'ytInitialData = ';
        chunk = html.split(alt)[1];
    }
    if (!chunk) return null;
    const head = chunk.split(/;\s*(var|const|let)\s/)[0]?.trim();
    if (!head) return null;
    try {
        return JSON.parse(head);
    } catch {
        return null;
    }
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
    collectVideoRenderers(json, renderers, Math.max(limit * 8, 40));

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
