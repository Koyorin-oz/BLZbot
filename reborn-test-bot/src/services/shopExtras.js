const db = require('../db');
const users = require('./users');
const shop = require('./shop');
const skillTree = require('./skillTree');

const CATL_CLAIM_MS = 3 * 60 * 60 * 1000;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

function weekKey() {
  return String(Math.floor(Date.now() / WEEK_MS));
}

/** Étape 5 boutique : un CATL gratuit toutes les 3 h. */
function claimGuaranteedCatl(userId) {
  if (!skillTree.hasCatlGuarantee(userId)) {
    return { ok: false, error: 'Réservé au palier 5 Boutique de l’arbre.' };
  }
  const u = users.getUser(userId) || users.getOrCreate(userId, '');
  const last = u.shop_catl_last_claim_ms || 0;
  const now = Date.now();
  if (now - last < CATL_CLAIM_MS) {
    const left = Math.ceil((CATL_CLAIM_MS - (now - last)) / 60000);
    return { ok: false, error: `Prochain Coffre légendaire gratuit dans **${left} min**.` };
  }
  db.prepare('UPDATE users SET shop_catl_last_claim_ms = ? WHERE id = ?').run(now, userId);
  users.addInventory(userId, 'coffre_catl', 1);
  return { ok: true };
}

/**
 * Reset boutique :
 *  - palier 1+ branche shop : 1 reset gratuit / semaine
 *  - sinon : consomme 1 item « reset_boutique » de l’inventaire
 */
function useShopReset(userId) {
  users.getOrCreate(userId, '');
  const wk = weekKey();
  const u = users.getUser(userId);
  const usedFreeWeek = (u?.shop_reset_used_week_key || '') === wk;
  const tier = skillTree.step(userId, 'shop');
  let consumed = 'item';
  if (tier >= 1 && !usedFreeWeek) {
    db.prepare('UPDATE users SET shop_reset_used_week_key = ? WHERE id = ?').run(wk, userId);
    consumed = 'free';
  } else if (!users.takeInventory(userId, 'reset_boutique', 1)) {
    if (tier >= 1) {
      return { ok: false, error: 'Tu as déjà utilisé ton reset gratuit cette semaine. Achète un item *Reset boutique* pour réessayer.' };
    }
    return { ok: false, error: 'Il te faut **1× Reset boutique** dans ton inventaire (ou palier 1 Boutique de l’arbre).' };
  }
  const day = shop.effectiveShopDateKey(userId);
  db.prepare('DELETE FROM user_shop WHERE user_id = ? AND shop_date = ?').run(userId, day);
  shop.ensureShopSlots(userId);
  return { ok: true, consumed };
}

function nextCatlReadyMs(userId) {
  const u = users.getUser(userId);
  if (!u) return 0;
  const last = u.shop_catl_last_claim_ms || 0;
  return last + CATL_CLAIM_MS;
}

function freeResetAvailable(userId) {
  const u = users.getUser(userId);
  if (!u) return false;
  if (skillTree.step(userId, 'shop') < 1) return false;
  return (u.shop_reset_used_week_key || '') !== weekKey();
}

module.exports = {
  claimGuaranteedCatl,
  useShopReset,
  nextCatlReadyMs,
  freeResetAvailable,
  CATL_CLAIM_MS,
};
