/**
 * Configuration des events temporaires « Espace » et « Océan » (gdoc REBORN).
 *
 * Espace : 1/2 chance de spawn toutes les 2 h, dure 30 min.
 *          Monnaie = météorites (3/msg, 10/min voc). 1 météorite = 30 starss.
 * Océan  : 1/2 chance de spawn toutes les 6 h, dure 30 min.
 *          Monnaie = litres d'eau (3/msg, 10/min voc). 1 litre = 60 starss.
 *
 * Les items de loot existent déjà dans `catalog.js` ; les deux coffres d'event
 * (`coffre_stellaire`, `coffre_submerge`) y sont ajoutés.
 */

const HOUR = 60 * 60 * 1000;
const MIN = 60 * 1000;

/** @typedef {'space'|'ocean'} EventKey */

const SPACE = {
  key: 'space',
  name: 'Espace',
  command: 'space',
  color: 0x5865f2,
  emoji: '🌌',
  currency: {
    field: 'meteorites',
    name: 'météorites',
    short: 'météorite',
    perMsg: 3n,
    perVoiceMin: 10n,
    starssPerUnit: 30n,
  },
  spawn: { chance: 0.5, intervalMs: 2 * HOUR, durationMs: 30 * MIN },
  chest: {
    id: 'coffre_stellaire',
    name: 'Coffre stellaire',
    cost: 3_000n,
    loot: [
      ['planete', 50],
      ['etoile', 20],
      ['trou_noir', 15],
      ['quasar', 9],
      ['galaxie', 5],
      ['univers', 1],
    ],
  },
  indexItems: ['planete', 'etoile', 'trou_noir', 'quasar', 'galaxie', 'univers'],
  entryRole: { key: 'meteore', cost: 30_000n },
  roles: {
    meteore: 'Météore',
    galaxien: 'Galaxien',
    lumineux: 'Lumineux',
    egocentrique: 'Égocentrique',
  },
  quests: [
    {
      key: 'q_meteore',
      label: 'Acheter le rôle « Météore »',
      rarity: 'Épique',
      roleKey: 'meteore',
      type: 'buyRole',
    },
    {
      key: 'q_galaxien',
      label: 'Avoir 10 étoiles, 5 trous noirs, 3 quasars et 1 galaxie',
      rarity: 'Mythique',
      roleKey: 'galaxien',
      type: 'haveAll',
      need: [
        ['etoile', 10],
        ['trou_noir', 5],
        ['quasar', 3],
        ['galaxie', 1],
      ],
    },
    {
      key: 'q_lumineux',
      label: 'Avoir 20 étoiles OU 3 quasars',
      rarity: 'Légendaire',
      roleKey: 'lumineux',
      type: 'haveAny',
      need: [
        ['etoile', 20],
        ['quasar', 3],
      ],
    },
    {
      key: 'q_egocentrique',
      label: 'Avoir l\'item « The Universe »',
      rarity: 'Staresque',
      roleKey: 'egocentrique',
      type: 'haveAll',
      need: [['univers', 1]],
    },
  ],
};

const OCEAN = {
  key: 'ocean',
  name: 'Océan',
  command: 'ocean',
  color: 0x1abc9c,
  emoji: '🌊',
  currency: {
    field: 'litres_eau',
    name: "litres d'eau",
    short: "litre d'eau",
    perMsg: 3n,
    perVoiceMin: 10n,
    starssPerUnit: 60n,
  },
  spawn: { chance: 0.5, intervalMs: 6 * HOUR, durationMs: 30 * MIN },
  chest: {
    id: 'coffre_submerge',
    name: 'Coffre submergé',
    cost: 3_000n,
    loot: [
      ['poisson', 50],
      ['corail', 20],
      ['requin', 15],
      ['baleine', 9],
      ['titanic', 5],
      ['megalodon', 1],
    ],
  },
  indexItems: ['poisson', 'corail', 'requin', 'baleine', 'titanic', 'megalodon'],
  entryRole: { key: 'eau', cost: 30_000n },
  roles: {
    eau: "J'adore l'eau, faut en boire",
    perdu: "Perdu de l'océan",
    marin: 'Animal marin',
    roi: "Roi de l'océan",
  },
  quests: [
    {
      key: 'q_eau',
      label: 'Acheter le rôle « J\'adore l\'eau, faut en boire »',
      rarity: 'Épique',
      roleKey: 'eau',
      type: 'buyRole',
    },
    {
      key: 'q_perdu',
      label: 'Avoir 10 coraux, 5 requins, 3 baleines et 1 épave du Titanic',
      rarity: 'Mythique',
      roleKey: 'perdu',
      type: 'haveAll',
      need: [
        ['corail', 10],
        ['requin', 5],
        ['baleine', 3],
        ['titanic', 1],
      ],
    },
    {
      key: 'q_marin',
      label: 'Avoir 20 requins OU 10 baleines',
      rarity: 'Légendaire',
      roleKey: 'marin',
      type: 'haveAny',
      need: [
        ['requin', 20],
        ['baleine', 10],
      ],
    },
    {
      key: 'q_roi',
      label: 'Avoir l\'item « Megalodon »',
      rarity: 'Staresque',
      roleKey: 'roi',
      type: 'haveAll',
      need: [['megalodon', 1]],
    },
  ],
};

const EVENTS = { space: SPACE, ocean: OCEAN };

/** @param {EventKey} key */
function getEvent(key) {
  return EVENTS[key] || null;
}

/** Liste [ [roleKey, label], ... ] de tous les rôles d'event (les deux events). */
function allRoleEntries() {
  const out = [];
  for (const ev of Object.values(EVENTS)) {
    for (const [roleKey, label] of Object.entries(ev.roles)) {
      out.push({ eventKey: ev.key, roleKey, label });
    }
  }
  return out;
}

module.exports = { EVENTS, SPACE, OCEAN, getEvent, allRoleEntries };
