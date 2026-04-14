/**
 * Réglages persistants anti-AFK (cooldown, chance, sanctions vocal).
 * Fichier : niveau/voice-afk.runtime.json
 */

const fs = require('fs');
const path = require('path');

const CONFIG_PATH = path.join(__dirname, '../../voice-afk.runtime.json');

const DEFAULTS = {
    minIntervalMinutes: 15,
    maxIntervalMinutes: 30,
    eventChancePercent: 50,
    penaltyDurationMinutes: 15,
    penalizedRpPercent: 50,
    penalizedXpPercent: 100,
    penalizedStarsPercent: 100,
};

/** @type {typeof DEFAULTS} */
let cache = { ...DEFAULTS };

function clamp(n, lo, hi) {
    return Math.min(hi, Math.max(lo, n));
}

function normalize() {
    cache.minIntervalMinutes = clamp(Math.round(Number(cache.minIntervalMinutes) || DEFAULTS.minIntervalMinutes), 5, 180);
    cache.maxIntervalMinutes = clamp(Math.round(Number(cache.maxIntervalMinutes) || DEFAULTS.maxIntervalMinutes), 5, 180);
    if (cache.minIntervalMinutes > cache.maxIntervalMinutes) {
        const t = cache.minIntervalMinutes;
        cache.minIntervalMinutes = cache.maxIntervalMinutes;
        cache.maxIntervalMinutes = t;
    }
    cache.eventChancePercent = clamp(Math.round(Number(cache.eventChancePercent) ?? DEFAULTS.eventChancePercent), 0, 100);
    cache.penaltyDurationMinutes = clamp(Math.round(Number(cache.penaltyDurationMinutes) || DEFAULTS.penaltyDurationMinutes), 1, 1440);
    cache.penalizedRpPercent = clamp(Math.round(Number(cache.penalizedRpPercent) ?? DEFAULTS.penalizedRpPercent), 0, 100);
    cache.penalizedXpPercent = clamp(Math.round(Number(cache.penalizedXpPercent) ?? DEFAULTS.penalizedXpPercent), 0, 100);
    cache.penalizedStarsPercent = clamp(Math.round(Number(cache.penalizedStarsPercent) ?? DEFAULTS.penalizedStarsPercent), 0, 100);
}

function load() {
    try {
        if (fs.existsSync(CONFIG_PATH)) {
            const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
            const parsed = JSON.parse(raw);
            cache = { ...DEFAULTS, ...parsed };
        } else {
            cache = { ...DEFAULTS };
        }
    } catch {
        cache = { ...DEFAULTS };
    }
    normalize();
}

function save() {
    const dir = path.dirname(CONFIG_PATH);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(cache, null, 2), 'utf8');
}

load();

function getSnapshot() {
    return { ...cache };
}

function getMinIntervalMs() {
    return cache.minIntervalMinutes * 60 * 1000;
}

function getMaxIntervalMs() {
    return cache.maxIntervalMinutes * 60 * 1000;
}

function getEventChance() {
    return cache.eventChancePercent / 100;
}

function getPenaltyDurationMs() {
    return cache.penaltyDurationMinutes * 60 * 1000;
}

function percentToMultiplier(percent) {
    return clamp(percent / 100, 0, 1);
}

function getPenalizedRpMultiplier() {
    return percentToMultiplier(cache.penalizedRpPercent);
}

function getPenalizedXpMultiplier() {
    return percentToMultiplier(cache.penalizedXpPercent);
}

function getPenalizedStarsMultiplier() {
    return percentToMultiplier(cache.penalizedStarsPercent);
}

/**
 * @param {{ minMinutes: number, maxMinutes: number, chancePercent?: number|null }} opts
 */
function setDelai(opts) {
    cache.minIntervalMinutes = opts.minMinutes;
    cache.maxIntervalMinutes = opts.maxMinutes;
    if (opts.chancePercent != null && opts.chancePercent !== undefined) {
        cache.eventChancePercent = opts.chancePercent;
    }
    normalize();
    save();
}

/**
 * @param {{ durationMinutes: number, rpPercent: number, xpPercent?: number|null, starsPercent?: number|null }} opts
 */
function setSanctions(opts) {
    cache.penaltyDurationMinutes = opts.durationMinutes;
    cache.penalizedRpPercent = opts.rpPercent;
    if (opts.xpPercent != null && opts.xpPercent !== undefined) {
        cache.penalizedXpPercent = opts.xpPercent;
    }
    if (opts.starsPercent != null && opts.starsPercent !== undefined) {
        cache.penalizedStarsPercent = opts.starsPercent;
    }
    normalize();
    save();
}

module.exports = {
    DEFAULTS,
    CONFIG_PATH,
    load,
    getSnapshot,
    getMinIntervalMs,
    getMaxIntervalMs,
    getEventChance,
    getPenaltyDurationMs,
    getPenalizedRpMultiplier,
    getPenalizedXpMultiplier,
    getPenalizedStarsMultiplier,
    setDelai,
    setSanctions,
};
