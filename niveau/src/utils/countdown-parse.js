/** Parse une date/heure « mur Paris » → timestamp UTC (ms). */

function pad2(n) {
    return String(n).padStart(2, '0');
}

function parisPartsFromMs(ms) {
    const parts = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Europe/Paris',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
    }).formatToParts(new Date(ms));
    const pick = (t) => parseInt(parts.find((p) => p.type === t)?.value || '0', 10);
    return {
        y: pick('year'),
        m: pick('month'),
        d: pick('day'),
        h: pick('hour'),
        mi: pick('minute'),
        s: pick('second'),
    };
}

function compareParisParts(a, b) {
    const keys = ['y', 'm', 'd', 'h', 'mi'];
    for (const k of keys) {
        if (a[k] < b[k]) return -1;
        if (a[k] > b[k]) return 1;
    }
    return 0;
}

/**
 * @param {number} y
 * @param {number} m 1-12
 * @param {number} d
 * @param {number} h
 * @param {number} mi
 * @returns {number}
 */
function parisLocalToUtcMs(y, m, d, h, mi) {
    const target = { y, m, d, h, mi, s: 0 };
    let low = Date.UTC(y, m - 1, d - 1, 0, 0, 0);
    let high = Date.UTC(y, m - 1, d + 2, 23, 59, 59);
    while (low <= high) {
        const mid = Math.floor((low + high) / 2);
        const cmp = compareParisParts(parisPartsFromMs(mid), target);
        if (cmp === 0) return mid;
        if (cmp < 0) low = mid + 60_000;
        else high = mid - 60_000;
    }
    return low;
}

/**
 * @param {string} dateStr `30/06/2026`, `2026-06-30`, `30.06.2026`
 * @param {string} [timeStr] `18:00`
 * @returns {{ ok: true, ms: number } | { ok: false, error: string }}
 */
function parseParisDateTime(dateStr, timeStr = '18:00') {
    const raw = String(dateStr || '').trim();
    if (!raw) return { ok: false, error: 'Date vide.' };

    let y;
    let m;
    let d;
    const normalized = raw.replace(/\./g, '/');

    if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(normalized)) {
        [y, m, d] = normalized.split('-').map((x) => parseInt(x, 10));
    } else {
        const parts = normalized.split('/').map((x) => parseInt(x, 10));
        if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) {
            return { ok: false, error: 'Format date : `JJ/MM/AAAA` ou `AAAA-MM-JJ`.' };
        }
        if (parts[0] > 999) {
            [y, m, d] = parts;
        } else {
            [d, m, y] = parts;
        }
    }

    const tRaw = String(timeStr || '18:00').trim();
    const tm = tRaw.match(/^(\d{1,2}):(\d{2})$/);
    if (!tm) return { ok: false, error: 'Format heure : `HH:MM` (ex. 18:00).' };
    const h = parseInt(tm[1], 10);
    const mi = parseInt(tm[2], 10);
    if (h > 23 || mi > 59) return { ok: false, error: 'Heure invalide.' };
    if (!y || m < 1 || m > 12 || d < 1 || d > 31) {
        return { ok: false, error: 'Date invalide.' };
    }

    const ms = parisLocalToUtcMs(y, m, d, h, mi);
    if (!Number.isFinite(ms) || ms <= 0) {
        return { ok: false, error: 'Impossible de convertir la date.' };
    }
    return { ok: true, ms };
}

/**
 * @param {number} targetMs
 * @returns {{ days: number, hours: number, minutes: number, totalMs: number, past: boolean }}
 */
function diffUntil(targetMs) {
    const totalMs = targetMs - Date.now();
    if (totalMs <= 0) {
        return { days: 0, hours: 0, minutes: 0, totalMs: 0, past: true };
    }
    const days = Math.floor(totalMs / 86_400_000);
    const hours = Math.floor((totalMs % 86_400_000) / 3_600_000);
    const minutes = Math.floor((totalMs % 3_600_000) / 60_000);
    return { days, hours, minutes, totalMs, past: false };
}

/** Une ligne titre + timestamp Discord (fuseau auto du lecteur). */
function formatDiscordCountdownBlock(targetMs, title) {
    const unix = Math.floor(targetMs / 1000);
    const head = String(title || 'Réouverture').trim();
    return `## ${head}\n\n<t:${unix}:F>`;
}

module.exports = {
    parseParisDateTime,
    diffUntil,
    formatDiscordCountdownBlock,
    parisPartsFromMs,
};
