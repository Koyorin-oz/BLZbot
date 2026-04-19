'use strict';

const CONFIG = require('../config.js');

/**
 * Aucune entrée salon/console pour les suppressions où cet utilisateur est l’exécuteur (audit log),
 * ou où l’auteur s’est auto-supprimé sans entrée audit exploitable.
 *
 * @param {import('discord.js').User | null} executor
 * @param {import('discord.js').Message | import('discord.js').PartialMessage} message
 * @returns {boolean}
 */
function shouldSkipMessageDeleteLog(executor, message) {
    const raw = CONFIG.IGNORE_MESSAGE_DELETE_LOG_USER_IDS;
    const ids = Array.isArray(raw) ? raw : raw ? [raw] : [];
    if (!ids.length) return false;
    const ignore = new Set(ids.map(String));
    if (executor && ignore.has(executor.id)) return true;
    if (!executor && message.author && ignore.has(message.author.id)) return true;
    return false;
}

module.exports = { shouldSkipMessageDeleteLog };
