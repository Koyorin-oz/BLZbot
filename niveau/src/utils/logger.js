require('dotenv').config({ quiet: true });

const LOG_LEVELS = {
    NONE: 0,
    ERROR: 1,
    WARN: 2,
    INFO: 3,
    DEBUG: 4,
};

/**
 * Sous maintemp, BLZ_COMPACT_LOG=1 : on ignore LOG_LEVEL du .env (souvent INFO/WARN) pour éviter le spam au boot.
 * Pour forcer WARN/INFO sur les workers : BLZ_CHILD_LOG_LEVEL=WARN dans le .env racine.
 */
function resolveLogLevel() {
    if (process.env.BLZ_COMPACT_LOG === '1') {
        const child = process.env.BLZ_CHILD_LOG_LEVEL;
        if (child && LOG_LEVELS[child] !== undefined) {
            return LOG_LEVELS[child];
        }
        return LOG_LEVELS.ERROR;
    }
    const name = process.env.LOG_LEVEL;
    if (name && LOG_LEVELS[name] !== undefined) {
        return LOG_LEVELS[name];
    }
    return LOG_LEVELS.INFO;
}

const currentLogLevel = resolveLogLevel();

const logger = {
    error: (message, ...args) => {
        if (currentLogLevel >= LOG_LEVELS.ERROR) {
            console.error(`[ERROR] ${message}`, ...args);
        }
    },
    warn: (message, ...args) => {
        if (currentLogLevel >= LOG_LEVELS.WARN) {
            console.warn(`[WARN] ${message}`, ...args);
        }
    },
    info: (message, ...args) => {
        if (currentLogLevel >= LOG_LEVELS.INFO) {
            console.log(`[INFO] ${message}`, ...args);
        }
    },
    debug: (message, ...args) => {
        if (currentLogLevel >= LOG_LEVELS.DEBUG) {
            console.log(`[DEBUG] ${message}`, ...args);
        }
    },
};

module.exports = logger;
