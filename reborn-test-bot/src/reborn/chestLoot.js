/**
 * Tables de loot coffres (approx doc REBORN / CATL / CATS).
 * Retourne une liste de lignes lisibles + effets appliqués côté purchase.
 */

const { getItem } = require('./catalog');

function pick(weights) {
  const t = weights.reduce((a, [, w]) => a + w, 0);
  let r = Math.random() * t;
  for (const [k, w] of weights) {
    r -= w;
    if (r <= 0) return k;
  }
  return weights[weights.length - 1][0];
}

/** Coffre classique : starss + petite chance d’item. */
function rollClassic() {
  const kind = pick([
    ['stars', 55],
    ['stars_big', 30],
    ['item_rare', 10],
    ['item_epic', 5],
  ]);
  if (kind === 'stars') return { lines: ['+25 000 starss'], stars: 25_000n, xp: 0, items: [] };
  if (kind === 'stars_big') return { lines: ['+120 000 starss'], stars: 120_000n, xp: 0, items: [] };
  if (kind === 'item_rare') return { lines: ['Item rare : Planète'], stars: 15_000n, xp: 0, items: [{ id: 'planete', qty: 1 }] };
  return { lines: ['Item épique : Corail'], stars: 20_000n, xp: 0, items: [{ id: 'corail', qty: 1 }] };
}

function rollCatm() {
  const kind = pick([
    ['stars', 40],
    ['item_leg', 35],
    ['item_myth', 20],
    ['boost', 5],
  ]);
  if (kind === 'stars') return { lines: ['+200 000 starss'], stars: 200_000n, xp: 0, items: [] };
  if (kind === 'item_leg') return { lines: ['Requin (Légendaire)'], stars: 50_000n, xp: 0, items: [{ id: 'requin', qty: 1 }] };
  if (kind === 'item_myth') return { lines: ['Baleine (Mythique)'], stars: 80_000n, xp: 0, items: [{ id: 'baleine', qty: 1 }] };
  return { lines: ['×2 Starss (1h)'], stars: 30_000n, xp: 0, items: [{ id: 'starss_boost', qty: 1 }] };
}

/** CATL : orienté gros gains (doc coffre légendaire). */
function rollCatl() {
  const kind = pick([
    ['stars', 25],
    ['item_myth', 35],
    ['item_goat', 25],
    ['crystal', 15],
  ]);
  if (kind === 'stars') return { lines: ['+400 000 starss'], stars: 400_000n, xp: 0, items: [] };
  if (kind === 'item_myth') return { lines: ['Quasar'], stars: 100_000n, xp: 0, items: [{ id: 'quasar', qty: 1 }] };
  if (kind === 'item_goat') return { lines: ['Galaxie'], stars: 150_000n, xp: 0, items: [{ id: 'galaxie', qty: 1 }] };
  return { lines: ['Crystal (Goatesque)'], stars: 200_000n, xp: 0, items: [{ id: 'crystal', qty: 1 }] };
}

/**
 * CATS (doc) : 50% CATL-equivalent, 20% 10k XP, 15% VIP (→ starss), 9% re-roll CATS, 5% rôle Hacker (item token), 1% Diamant
 */
function rollCats(meta, userId) {
  const roll = pick([
    ['leg_bundle', 50],
    ['xp10k', 20],
    ['vip', 15],
    ['retry', 9],
    ['hacker_token', 5],
    ['diamond', 1],
  ]);
  if (roll === 'leg_bundle') {
    const inner = rollCatl();
    inner.lines.unshift('(bundle type CATL)');
    return inner;
  }
  if (roll === 'xp10k') return { lines: ['+10 000 XP (appliqué au profil)'], stars: 50_000n, xp: 10_000, items: [] };
  if (roll === 'vip') return { lines: ['+1 point VIP (converti 250k starss)'], stars: 250_000n, xp: 0, items: [] };
  if (roll === 'retry') return { lines: ['Second tirage CATS !'], stars: 100_000n, xp: 0, items: [], rollAgain: true };
  if (roll === 'hacker_token') {
    return { lines: ['Jeton **Accès Hacker** (consommable rôle)'], stars: 0n, xp: 0, items: [{ id: 'hacker_token', qty: 1 }] };
  }
  const h = meta.diamondHolder();
  if (h && h !== userId) {
    return { lines: ['Diamant indisponible — **5 000 000 starss** à la place'], stars: 5_000_000n, xp: 0, items: [] };
  }
  meta.setDiamondHolder(userId);
  return { lines: ['**Diamant** (unique)'], stars: 0n, xp: 0, items: [{ id: 'diamant', qty: 1 }] };
}

/** Loot salon Hacker (doc proba par rareté). */
function rollHackerSalon() {
  const rar = pick([
    ['Commun', 30],
    ['Rare', 20],
    ['Epique', 20],
    ['Légendaire', 15],
    ['Mythique', 10],
    ['Goatesque', 3],
    ['Staresque', 2],
  ]);
  const pool = require('./catalog').ITEMS.filter((i) => i.rarity === rar && !i.id.startsWith('coffre'));
  const it = pool[Math.floor(Math.random() * Math.max(1, pool.length))] || getItem('planete');
  return { itemId: it.id, name: it.name };
}

function rollChest(type, meta, userId) {
  if (type === 'classic') return rollClassic();
  if (type === 'catm') return rollCatm();
  if (type === 'catl') return rollCatl();
  if (type === 'cats') return rollCats(meta, userId);
  return rollClassic();
}

module.exports = { rollChest, rollHackerSalon };
