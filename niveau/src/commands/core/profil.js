const { buildProfilV2Slash } = require('./profil-v2-factory');

/** Alias français : même rendu que /profil-v2. Le profil long / composants reste /profile. */
module.exports = buildProfilV2Slash(
    'profil',
    'Carte profil BLZ (1024×381) — alias de /profil-v2. Le profil classique avec boutons : /profile.',
    'profil'
);
