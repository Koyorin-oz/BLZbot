/**
 * Items qui comptent pour le % d’index (collection catalogue).
 * Exclut boosts, skips, coffres et consommables « utilitaires » boutique.
 */
const { ITEMS } = require('../reborn/catalog');

const INDEX_EXCLUDE = new Set([
  'xp_boost',
  'gxp_boost',
  'starss_boost',
  'skip_daily',
  'skip_weekly',
  'skip_quest',
  'double_daily',
  'reset_boutique',
  'remboursement',
  'event_spawner',
  'streak_keeper',
  'coffre_classique',
  'coffre_catm',
  'coffre_catl',
  'coffre_cats',
]);

const INDEXABLE_IDS = ITEMS.filter((i) => !INDEX_EXCLUDE.has(i.id)).map((i) => i.id);
const INDEXABLE_SET = new Set(INDEXABLE_IDS);

function isIndexable(itemId) {
  return INDEXABLE_SET.has(itemId);
}

function totalIndexable() {
  return INDEXABLE_IDS.length;
}

module.exports = { INDEXABLE_IDS, INDEX_EXCLUDE, isIndexable, totalIndexable };
