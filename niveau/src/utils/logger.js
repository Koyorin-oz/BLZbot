require('dotenv').config({ quiet: true });

const path = require('node:path');

const LOG_LEVELS = {
    NONE: 0,
    ERROR: 1,
    WARN: 2,
    INFO: 3,
    DEBUG: 4,
};

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
const compact = process.env.BLZ_COMPACT_LOG === '1';
let blz = null;
if (compact) {
    try {
        blz = require(path.join(__dirname, '..', '..', '..', 'blz-log.js'));
    } catch {
        blz = null;
    }
}

function emit(level, message, ...args) {
    const extra = args.length ? ` ${args.map((a) => (a?.message ? a.message : String(a))).join(' ')}` : '';
    const msg = `${message}${extra}`.trim();
    if (!msg) return;

    if (compact && blz) {
        if (level === 'error') blz.blzError('niveau', msg);
        else if (level === 'warn') blz.blzWarn('niveau', msg);
        else if (level === 'info' || level === 'debug') {
            /* compact : pas de spam info/debug */
        }
        return;
    }

    const prefix = level === 'error' ? '[ERROR]' : level === 'warn' ? '[WARN]' : level === 'debug' ? '[DEBUG]' : '[INFO]';
    const fn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
    fn(`${prefix} ${msg}`);
}

const logger = {
    error: (message, ...args) => {
        if (currentLogLevel >= LOG_LEVELS.ERROR) emit('error', message, ...args);
    },
    warn: (message, ...args) => {
        if (currentLogLevel >= LOG_LEVELS.WARN) emit('warn', message, ...args);
    },
    info: (message, ...args) => {
        if (currentLogLevel >= LOG_LEVELS.INFO) emit('info', message, ...args);
    },
    debug: (message, ...args) => {
        if (currentLogLevel >= LOG_LEVELS.DEBUG) emit('debug', message, ...args);
    },
};

module.exports = logger;
