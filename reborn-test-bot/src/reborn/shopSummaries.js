const { getItem } = require('./catalog');

/**
 * Textes courts pour le menu déroulant Discord (max 100 caractères par option).
 * @param {string} itemId
 * @returns {string}
 */
function summaryForItemId(itemId) {
  const s = ITEM_BLURBS[itemId];
  if (s) return s.slice(0, 100);
  const it = getItem(itemId);
  if (it) {
    return `${it.rarity} — ${it.kind || 'item'} — voir doc REBORN.`.slice(0, 100);
  }
  return 'Objet REBORN — voir doc / inventaire pour le détail.';
}

const ITEM_BLURBS = {
  double_daily: 'Réclame ta récompense daily une 2ᵉ fois aujourd’hui.',
  streak_keeper: 'Restaure ta série quotidienne perdue sans casser ton streak.',
  reset_boutique: 'Tire 5 nouveaux articles dans ta boutique tout de suite.',
  remboursement: 'Te crédite 200 000 starss immédiatement.',
  event_spawner: 'Lance un événement Chasse aux étoiles sur le serveur.',
  skip_quest: 'Valide et réclame ta quête du jour (ou hebdo) sans la faire.',
  skip_daily: 'Valide et réclame ta quête quotidienne sans la faire.',
  skip_weekly: 'Valide et réclame ta quête hebdomadaire sans la faire.',
  crystal: 'Utilise-le pour gagner 500 000 starss.',
  diamant: 'Objet unique du serveur : bonus forts et Sceau du Diamant.',
  corail: 'Objet de collection (océan) pour ton index.',
  requin: 'Objet de collection (océan), rareté supérieure.',
  baleine: 'Objet de collection (océan), très rare.',
  titanic: 'Objet de collection (océan), pièce d’exception.',
  megalodon: 'Objet de collection (océan), le plus prestigieux.',
  planete: 'Objet de collection (espace) pour ton index.',
  etoile: 'Objet de collection (espace), rareté supérieure.',
  trou_noir: 'Objet de collection (espace), très rare.',
  quasar: 'Objet de collection (espace), pièce d’exception.',
  galaxie: 'Objet de collection (espace), prestige.',
  univers: 'Objet de collection (espace), le sommet de la série.',
  poisson: 'Objet de collection (océan), entrée de gamme.',
  coffre_classique: 'Ouvre-le pour des starss, de l’XP et parfois un objet.',
  coffre_catm: 'Coffre amélioré : meilleurs gains que le classique.',
  coffre_catl: 'Coffre légendaire : gros gains et chances de bonus.',
  coffre_cats: 'Coffre starss : le plus haut, jackpots possibles.',
  hacker_token: 'Consomme pour obtenir le rôle Hacker (loot via /salon-hacker).',
  coffre_stellaire: 'Coffre de l’event Espace : ouvre-le pour des objets spatiaux.',
  coffre_submerge: 'Coffre de l’event Océan : ouvre-le pour des objets marins.',
  xp_boost: 'Double tes gains d’XP joueur pendant 1 heure.',
  gxp_boost: 'Double les gains de GXP de ta guilde pendant 1 heure.',
  starss_boost: 'Double tes gains de starss pendant 1 heure.',
};

/** Un emoji par item, pour l'affichage inventaire / boutique. */
const ITEM_EMOJIS = {
  double_daily: '🔁',
  streak_keeper: '🔥',
  reset_boutique: '🔄',
  remboursement: '💵',
  event_spawner: '🌠',
  skip_quest: '⏭️',
  skip_daily: '⏭️',
  skip_weekly: '⏭️',
  crystal: '💠',
  diamant: '💎',
  corail: '🪸',
  requin: '🦈',
  baleine: '🐋',
  titanic: '🚢',
  megalodon: '🦷',
  planete: '🪐',
  etoile: '🌟',
  trou_noir: '🕳️',
  quasar: '💫',
  galaxie: '🌌',
  univers: '🌐',
  poisson: '🐟',
  coffre_classique: '📦',
  coffre_catm: '🎁',
  coffre_catl: '🧰',
  coffre_cats: '🏆',
  hacker_token: '💻',
  coffre_stellaire: '🌌',
  coffre_submerge: '🌊',
  xp_boost: '🟦',
  gxp_boost: '🟩',
  starss_boost: '⭐',
};

/**
 * @param {string} itemId
 * @returns {string} un emoji représentatif (fallback générique).
 */
function emojiForItemId(itemId) {
  return ITEM_EMOJIS[itemId] || '📦';
}

const CHEST = {
  classic: 'Coffre entrée de gamme — mix starss/XP/items.',
  catm: 'Coffre amélioré ; respecte la limite journalière du Coffre meilleur.',
  catl: 'Coffre légendaire — gros lots + règles 3h (doc).',
  cats: 'Coffre « star » — top tier, cher.',
};

const BOOST = {
  xp: '×2 XP joueur 1h — idéal pour monter de niveau vite.',
  gxp: '×2 GXP 1h — pousse le ladder guilde.',
  starss: '×2 Starss 1h — monnaie du quotidien boostée.',
};

/**
 * @param {'classic'|'catm'|'catl'|'cats'} k
 */
function summaryChest(k) {
  return (CHEST[k] || 'Coffre REBORN.').slice(0, 100);
}

/**
 * @param {'xp'|'gxp'|'starss'} k
 */
function summaryBoost(k) {
  return (BOOST[k] || 'Boost 1h.').slice(0, 100);
}

module.exports = { summaryForItemId, summaryChest, summaryBoost, emojiForItemId };
