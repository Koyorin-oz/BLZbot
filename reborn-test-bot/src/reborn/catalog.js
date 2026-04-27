/**
 * Catalogue items (noms REBORN + quelques équivalents « ancienne boutique » pour tests).
 * `price` optionnel : sinon dérivé de la rareté (prix doc).
 */

const { RARITY_PRICE_STARSS } = require('./constants');

/** @typedef {{ id: string, name: string, rarity: keyof typeof RARITY_PRICE_STARSS, price?: bigint, kind?: 'consumable'|'boost'|'chest_key'|'special' }}} ItemDef */

/** @type {ItemDef[]} */
const ITEMS = [
  { id: 'double_daily', name: 'Double Daily', rarity: 'Rare', kind: 'consumable' },
  { id: 'streak_keeper', name: 'Streak Keeper', rarity: 'Epique', kind: 'consumable' },
  { id: 'reset_boutique', name: 'Reset boutique', rarity: 'Rare', kind: 'consumable' },
  { id: 'remboursement', name: 'Remboursement', rarity: 'Légendaire', kind: 'consumable' },
  { id: 'event_spawner', name: 'Event Spawner', rarity: 'Mythique', kind: 'consumable' },
  { id: 'skip_quest', name: 'Skip quest', rarity: 'Epique', kind: 'consumable' },
  { id: 'skip_daily', name: 'Skip daily', rarity: 'Rare', kind: 'consumable' },
  { id: 'skip_weekly', name: 'Skip weekly', rarity: 'Rare', kind: 'consumable' },
  { id: 'xp_boost', name: 'Boost ×2 XP — 1h', rarity: 'Commun', price: 30_000n, kind: 'boost' },
  { id: 'gxp_boost', name: 'Boost ×2 GXP — 1h', rarity: 'Commun', price: 30_000n, kind: 'boost' },
  { id: 'starss_boost', name: 'Boost ×2 Starss — 1h', rarity: 'Commun', price: 30_000n, kind: 'boost' },
  { id: 'crystal', name: 'Crystal', rarity: 'Goatesque', kind: 'special' },
  { id: 'diamant', name: 'Diamant (unique serveur)', rarity: 'Staresque', kind: 'special' },
  { id: 'corail', name: 'Corail', rarity: 'Epique', kind: 'consumable' },
  { id: 'requin', name: 'Requin', rarity: 'Légendaire', kind: 'consumable' },
  { id: 'baleine', name: 'Baleine', rarity: 'Mythique', kind: 'consumable' },
  { id: 'titanic', name: 'Épave du Titanic', rarity: 'Goatesque', kind: 'consumable' },
  { id: 'megalodon', name: 'Megalodon', rarity: 'Staresque', kind: 'consumable' },
  { id: 'planete', name: 'Planète', rarity: 'Rare', kind: 'consumable' },
  { id: 'etoile', name: 'Étoile', rarity: 'Epique', kind: 'consumable' },
  { id: 'trou_noir', name: 'Trou noir', rarity: 'Légendaire', kind: 'consumable' },
  { id: 'quasar', name: 'Quasar', rarity: 'Mythique', kind: 'consumable' },
  { id: 'galaxie', name: 'Galaxie', rarity: 'Goatesque', kind: 'consumable' },
  { id: 'univers', name: 'The Univers', rarity: 'Staresque', kind: 'consumable' },
  { id: 'poisson', name: 'Poisson', rarity: 'Rare', kind: 'consumable' },
  { id: 'coffre_classique', name: 'Coffre Au Trésor Classique', rarity: 'Epique', price: 100_000n, kind: 'consumable' },
  { id: 'coffre_catm', name: 'Coffre Au Trésor Mieux (CATM)', rarity: 'Légendaire', price: 500_000n, kind: 'consumable' },
  { id: 'coffre_catl', name: 'Coffre Au Trésor Légendaire (CATL)', rarity: 'Mythique', price: 1_000_000n, kind: 'consumable' },
  { id: 'coffre_cats', name: 'Coffre Au Trésor Starss (CATS)', rarity: 'Goatesque', price: 3_000_000n, kind: 'consumable' },
  { id: 'hacker_token', name: 'Jeton d’accès Hacker', rarity: 'Mythique', kind: 'consumable' },
];

const byId = new Map(ITEMS.map((i) => [i.id, i]));

function priceFor(item) {
  if (item.price != null) return item.price;
  return RARITY_PRICE_STARSS[item.rarity] ?? 10_000n;
}

function getItem(id) {
  return byId.get(id) || null;
}

function randomItemOfRarity(rarity) {
  const pool = ITEMS.filter((i) => i.rarity === rarity && !['coffre_classique', 'coffre_catm', 'coffre_catl', 'coffre_cats'].includes(i.id));
  if (pool.length === 0) return ITEMS.find((i) => i.rarity === 'Commun') || ITEMS[0];
  return pool[Math.floor(Math.random() * pool.length)];
}

module.exports = { ITEMS, getItem, priceFor, randomItemOfRarity };
