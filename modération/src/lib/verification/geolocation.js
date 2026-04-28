/**
 * Géolocalisation IP — ip-api.com (gratuit, sans clé, 45 req/min).
 *
 * Renvoie `{ country, countryCode, isp, org, flag }` ou `null` si l'IP est privée
 * / la résolution échoue. Cache mémoire (TTL 24h) pour limiter la pression sur
 * l'API et masquer la latence côté UX.
 *
 * Sécurité : seule ip-api.com reçoit l'IP. Le résumé géo est inclus dans les
 * logs publics ; l'IP brute reste exclusivement dans les DM owners.
 */

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const cache = new Map();

function isPrivateIp(ip) {
    if (!ip || typeof ip !== 'string') return true;
    const s = ip.trim();
    if (
        s === '127.0.0.1' ||
        s === '::1' ||
        s === '0.0.0.0' ||
        s.startsWith('10.') ||
        s.startsWith('192.168.') ||
        s.startsWith('169.254.') ||
        /^172\.(1[6-9]|2\d|3[0-1])\./.test(s) ||
        /^f[cd][0-9a-f]{2}:/i.test(s) ||
        s.toLowerCase().startsWith('fe80:')
    ) {
        return true;
    }
    return false;
}

/** Convertit un code ISO-2 (ex. "FR") en emoji drapeau régional. */
function flagFromCountryCode(cc) {
    if (!cc || typeof cc !== 'string' || cc.length !== 2) return '🌐';
    const A = 0x1f1e6;
    const upper = cc.toUpperCase();
    const codes = [...upper].map((ch) => A + (ch.charCodeAt(0) - 65));
    if (codes.some((c) => Number.isNaN(c) || c < 0x1f1e6 || c > 0x1f1ff)) return '🌐';
    return String.fromCodePoint(...codes);
}

/**
 * @param {string} ip
 * @returns {Promise<{ country: string, countryCode: string, isp: string, org: string, flag: string } | null>}
 */
async function lookupIp(ip) {
    if (isPrivateIp(ip)) return null;
    const cached = cache.get(ip);
    if (cached && cached.expiresAt > Date.now()) return cached.value;

    try {
        const url = `http://ip-api.com/json/${encodeURIComponent(ip)}?fields=status,country,countryCode,isp,org`;
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 4000);
        const res = await fetch(url, { signal: ctrl.signal });
        clearTimeout(timer);
        if (!res.ok) return null;
        const j = await res.json();
        if (!j || j.status !== 'success') {
            cache.set(ip, { value: null, expiresAt: Date.now() + 5 * 60 * 1000 });
            return null;
        }
        const value = {
            country: String(j.country || 'Inconnu'),
            countryCode: String(j.countryCode || ''),
            isp: String(j.isp || j.org || 'Inconnu'),
            org: String(j.org || ''),
            flag: flagFromCountryCode(j.countryCode),
        };
        cache.set(ip, { value, expiresAt: Date.now() + CACHE_TTL_MS });
        return value;
    } catch {
        return null;
    }
}

module.exports = { lookupIp, flagFromCountryCode, isPrivateIp };
