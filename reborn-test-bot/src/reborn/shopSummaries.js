/**
 * Textes courts pour le menu déroulant Discord (max 100 caractères par option).
 * @param {string} itemId
 * @returns {string}
 */
function summaryForItemId(itemId) {
  const s = ITEM_BLURBS[itemId];
  if (s) return s.slice(0, 100);
  return 'Objet REBORN — voir doc / inventaire pour le détail.';
}

const ITEM_BLURBS = {
  double_daily: '2ᵉ claim daily le même jour. Utile si tu rates le reset.',
  streak_keeper: 'Protège une série (streak) en cas de raté. Confort progression.',
  reset_boutique: 'Relance la rotation des items du jour avant l’heure prévue.',
  remboursement: 'Mécanique d’indemnisation (spec). Vérifie règles en prod.',
  event_spawner: 'Déclenche / favorise un event côté monnaie d’event (spec).',
  skip_quest: 'Passe une étape de quête (coût arbre / doc).',
  skip_daily: 'Saute un jour de daily (file d’attente hebdo / doc).',
  skip_weekly: 'Saute la contrainte hebdo (doc).',
  crystal: 'Objet rare (spec) — cohérent avec l’ancienne boutique.',
  diamant: 'Unique serveur : bonus forts, souvent sujet de guerre éco.',
  corail: 'Objet thème mer — collection / quêtes.',
  requin: 'Idem — palier de rareté supérieur.',
  baleine: 'Idem — légendaire+.',
  titanic: 'Léger / gros lot — fun collecte.',
  megalodon: 'Haut de gamme — gros enjeu.',
  planete: 'Thème espace (doc) — cohérent index / coffres.',
  etoile: 'Idem — palier intermédiaire.',
  trou_noir: 'Gros item — risk/reward en loot.',
  quasar: 'Très haut — collection endgame.',
  galaxie: 'Prestige — type Grail.',
  univers: 'Sommet de la série thème espace.',
  poisson: 'Entrée de gamme thème mer.',
  coffre_classique: 'Loot aléatoire (starss, XP, parfois item) — farm de base.',
  coffre_catm: 'Mieux que classique ; limite 10/j. Bon rendement moyen.',
  coffre_catl: 'Légendaire : gros lots / roll bonus (spec REBORN).',
  coffre_cats: 'Le plus haut : star + jackpots (spec, cher).',
  hacker_token: 'Accès ou bonus salon Hacker (test).',
  xp_boost: '×2 gain XP perso 1h — stack / cumul (doc).',
  gxp_boost: '×2 GXP guilde 1h — focus war / ladder guilde.',
  starss_boost: '×2 Starss 1h — farm monnaie.',
};

const CHEST = {
  classic: 'Coffre entrée de gamme — mix starss/XP/items.',
  catm: 'Coffre amélioré ; respecte la limite journalière CATM.',
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

module.exports = { summaryForItemId, summaryChest, summaryBoost };
