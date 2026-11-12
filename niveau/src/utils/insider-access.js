const fs = require('node:fs');
const path = require('node:path');
const { Events, MessageFlags } = require('discord.js');
const logger = require('./logger');

const INSIDER_USERS_PATH = path.join(__dirname, '..', '..', 'data', 'insider-users.json');
const DISCORD_USER_ID_PATTERN = /^\d{17,20}$/;
const reportedAllowlistErrors = new Set();

function reportAllowlistError(message) {
    if (reportedAllowlistErrors.has(message)) return;
    reportedAllowlistErrors.add(message);
    logger.error(`[insider] Liste des utilisateurs acceptés indisponible : ${message}`);
}

function initializeInsiderAllowlist(databasePath = INSIDER_USERS_PATH) {
    try {
        fs.mkdirSync(path.dirname(databasePath), { recursive: true });
        fs.writeFileSync(
            databasePath,
            `${JSON.stringify({ acceptedUserIds: [] }, null, 2)}\n`,
            { flag: 'wx' }
        );
        logger.warn(
            `[insider] Liste d’accès créée vide : ${databasePath}. Ajoute les IDs autorisés dans acceptedUserIds.`
        );
    } catch (error) {
        if (error.code !== 'EEXIST') {
            reportAllowlistError(error.message);
            return false;
        }
    }
    return true;
}

function isInsiderMode() {
    return ['1', 'true', 'yes', 'on'].includes(
        String(process.env.BLZ_INSIDER_MODE || '').toLowerCase()
    );
}

function isInsiderUserAllowed(userId, databasePath = INSIDER_USERS_PATH) {
    if (!DISCORD_USER_ID_PATTERN.test(String(userId || ''))) {
        return false;
    }

    try {
        const database = JSON.parse(fs.readFileSync(databasePath, 'utf8'));
        if (
            !database ||
            typeof database !== 'object' ||
            !Array.isArray(database.acceptedUserIds) ||
            !database.acceptedUserIds.every(
                (id) => typeof id === 'string' && DISCORD_USER_ID_PATTERN.test(id)
            )
        ) {
            throw new Error('format attendu : {"acceptedUserIds":["ID Discord"]}');
        }

        return database.acceptedUserIds.includes(String(userId));
    } catch (error) {
        reportAllowlistError(error.message);
        return false;
    }
}

function installInsiderInteractionGate(client, databasePath = INSIDER_USERS_PATH) {
    if (!isInsiderMode()) return;
    initializeInsiderAllowlist(databasePath);

    // Collectors listen to interactionCreate independently, so reject before dispatching to any listener.
    const emit = client.emit;
    client.emit = function (event, ...args) {
        const interaction = args[0];
        if (
            event === Events.InteractionCreate &&
            !isInsiderUserAllowed(interaction?.user?.id, databasePath)
        ) {
            try {
                if (!interaction?.isAutocomplete?.() && !interaction?.isRepliable?.()) {
                    return false;
                }
                const response = interaction.isAutocomplete()
                    ? interaction.respond([])
                    : interaction.reply({
                          content: 'Tu ne fais pas partie du programme BLZ Insider.',
                          flags: MessageFlags.Ephemeral,
                      });
                Promise.resolve(response).catch((error) =>
                    reportInteractionReplyError(error)
                );
            } catch (error) {
                reportInteractionReplyError(error);
            }
            return false;
        }
        return emit.call(this, event, ...args);
    };
}

function reportInteractionReplyError(error) {
    const code = error?.code || error?.rawError?.code;
    if (code === 10062 || code === '10062') {
        logger.warn('[insider] Interaction expirée avant le refus (Discord 10062).');
        return;
    }
    logger.error('[insider] Impossible de refuser l’interaction:', error);
}

module.exports = {
    isInsiderMode,
    isInsiderUserAllowed,
    initializeInsiderAllowlist,
    installInsiderInteractionGate,
};
