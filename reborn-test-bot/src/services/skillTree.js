const db = require('../db');
const users = require('./users');

const BRANCHES = /** @type {const} */ ([
  'quest',
  'guild',
  'shop',
  'ranked',
  'event',
]);

/** @param {string} userId */
function getTree(userId) {
  users.getOrCreate(userId, '');
  const raw = users.getUser(userId).skill_tree_json || '{}';
  try {
    const o = JSON.parse(raw);
    return typeof o === 'object' && o ? o : {};
  } catch {
    return {};
  }
}

function saveTree(userId, tree) {
  db.prepare('UPDATE users SET skill_tree_json = ? WHERE id = ?').run(JSON.stringify(tree), userId);
}

/** @param {string} userId */
function step(userId, branch) {
  const t = getTree(userId);
  const n = Math.min(5, Math.max(0, Math.floor(Number(t[branch]) || 0)));
  return n;
}

/** Coût pour passer de `currentStep` à `currentStep+1` (= numéro d’étape doc). */
function costForNext(currentStep) {
  return currentStep + 1;
}

/**
 * @param {string} userId
 * @param {string} branch
 */
function buy(userId, branch) {
  if (!BRANCHES.includes(branch)) return { ok: false, error: 'Branche inconnue.' };
  const cur = step(userId, branch);
  if (cur >= 5) return { ok: false, error: 'Branche complète.' };
  const cost = costForNext(cur);
  users.getOrCreate(userId, '');
  const sp = users.getUser(userId).skill_points || 0;
  if (sp < cost) return { ok: false, error: `Pas assez de points de compétence (besoin **${cost}**).` };
  const tree = getTree(userId);
  tree[branch] = cur + 1;
  db.prepare('UPDATE users SET skill_points = skill_points - ? WHERE id = ?').run(cost, userId);
  saveTree(userId, tree);
  syncTempleUnlock(userId);
  return { ok: true, branch, newStep: cur + 1 };
}

/** +points quand le niveau joueur augmente */
function onLevelUp(userId, deltaLevels) {
  if (deltaLevels <= 0) return;
  users.getOrCreate(userId, '');
  db.prepare('UPDATE users SET skill_points = skill_points + ? WHERE id = ?').run(deltaLevels, userId);
}

function syncTempleUnlock(userId) {
  const t = getTree(userId);
  let all5 = true;
  for (const b of BRANCHES) {
    if ((t[b] || 0) < 5) all5 = false;
  }
  db.prepare('UPDATE users SET temple_unlocked = ? WHERE id = ?').run(all5 ? 1 : 0, userId);
}

/** % bonus GXP guilde (branche guilde étape 2 : +10 %). */
function guildGxpMultBp(userId) {
  const s = step(userId, 'guild');
  let bp = 10000;
  if (s >= 2) bp += 1000;
  return bp;
}

/** % bonus GRP (branche guilde étape 4 : +10 %). */
function guildGrpMultBp(userId) {
  const s = step(userId, 'guild');
  let bp = 10000;
  if (s >= 4) bp += 1000;
  return bp;
}

/** Réduction boutique 0–30 % (étape 5 branche shop). */
function shopDiscountFrac(userId) {
  return step(userId, 'shop') >= 5 ? 0.3 : 0;
}

/** Branche ranked doc : % permanent + flats. */
function rankedRpBonuses(userId) {
  const s = step(userId, 'ranked');
  let pctBp = 10000;
  let flatMsg = 0n;
  let flatVoc = 0n;
  if (s >= 1) pctBp += 1000;
  if (s >= 2) flatMsg += 1n;
  if (s >= 3) pctBp += 1000;
  if (s >= 4) flatVoc += 2n;
  if (s >= 5) pctBp += 1000;
  return { pctBp, flatMsg, flatVoc };
}

module.exports = {
  BRANCHES,
  getTree,
  saveTree,
  buy,
  step,
  onLevelUp,
  syncTempleUnlock,
  guildGxpMultBp,
  guildGrpMultBp,
  shopDiscountFrac,
  rankedRpBonuses,
};
