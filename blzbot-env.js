/**
 * Résolution du fichier `.env` pour BLZbot.
 *
 * Sur PebbleHost, le File Manager place en général le `.env` à la racine du conteneur :
 *   /home/container/.env
 * (démarrage depuis la racine du dépôt cloné dans ce dossier.)
 */
const fs = require('node:fs');
const path = require('node:path');

const PEBBLE_HOST_ENV_PATH = '/home/container/.env';

/**
 * @param {...string} candidates Chemins à tester dans l’ordre (premier fichier existant gagne).
 * @returns {string}
 */
function resolveDotenvPath(...candidates) {
    const fromOverride = process.env.DOTENV_CONFIG_PATH;
    if (fromOverride && typeof fromOverride === 'string' && fs.existsSync(fromOverride)) {
        return fromOverride;
    }
    for (const p of candidates) {
        if (p && fs.existsSync(p)) {
            return p;
        }
    }
    const first = candidates.find(Boolean);
    if (first) return first;
    return PEBBLE_HOST_ENV_PATH;
}

module.exports = {
    PEBBLE_HOST_ENV_PATH,
    resolveDotenvPath,
};
