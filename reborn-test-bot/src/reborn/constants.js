/** Specs MAJ REBORN (référence bot de test) — à affiner avec le chef. */

const STARSS_PER_MESSAGE = 15;
const STARSS_PER_VOICE_MINUTE = 40;

const RARITY_PRICE_STARSS = {
  Commun: 10_000n,
  Rare: 25_000n,
  Epique: 100_000n,
  Légendaire: 500_000n,
  Mythique: 1_000_000n,
  Goatesque: 3_000_000n,
  Staresque: 10_000_000n,
};

/** Ligne 1 boutique : proba par tirage (doc). */
const SHOP_ROW1_RARITY_WEIGHTS = [
  ['Commun', 50],
  ['Rare', 25],
  ['Epique', 10],
  ['Légendaire', 7],
  ['Mythique', 5],
  ['Goatesque', 2],
  ['Staresque', 1],
];

const BOOST_ROW_PRICE = 30_000n;

const CHEST_CLASSIC = 100_000n;
const CHEST_CATM = 500_000n;
const CHEST_CATL = 1_000_000n;
const CHEST_CATS = 3_000_000n;

const CATM_DAILY_LIMIT = 10;
const CATL_ROLL_MS = 3 * 60 * 60 * 1000;
const CATS_ROLL_MS = 3 * 60 * 60 * 1000;
const CATL_SPAWN_CHANCE = 0.5;
const CATS_SPAWN_CHANCE = 0.01;

/** GXP message / minute voc par tranche de niveau joueur (doc guildes). */
function gxpRatesForPlayerLevel(level) {
  const lv = Math.max(0, Math.floor(Number(level) || 0));
  if (lv < 10) return { msg: 0n, vocMin: 0n };
  if (lv < 20) return { msg: 1n, vocMin: 2n };
  if (lv < 30) return { msg: 2n, vocMin: 4n };
  if (lv < 40) return { msg: 3n, vocMin: 6n };
  if (lv < 50) return { msg: 4n, vocMin: 8n };
  if (lv < 60) return { msg: 5n, vocMin: 10n };
  if (lv < 70) return { msg: 6n, vocMin: 12n };
  if (lv < 80) return { msg: 7n, vocMin: 14n };
  if (lv < 90) return { msg: 8n, vocMin: 16n };
  if (lv < 100) return { msg: 9n, vocMin: 18n };
  return { msg: 10n, vocMin: 20n };
}

/** GRP ranked : 1/10 du ranked « normal » (doc) — ici 1/msg et 3/min voc si ranked normal = 10/msg 30/min. */
function grpRatesForMessage() {
  return { msg: 1n, vocMin: 3n };
}

module.exports = {
  STARSS_PER_MESSAGE,
  STARSS_PER_VOICE_MINUTE,
  RARITY_PRICE_STARSS,
  SHOP_ROW1_RARITY_WEIGHTS,
  BOOST_ROW_PRICE,
  CHEST_CLASSIC,
  CHEST_CATM,
  CHEST_CATL,
  CHEST_CATS,
  CATM_DAILY_LIMIT,
  CATL_ROLL_MS,
  CATS_ROLL_MS,
  CATL_SPAWN_CHANCE,
  CATS_SPAWN_CHANCE,
  gxpRatesForPlayerLevel,
  grpRatesForMessage,
};
