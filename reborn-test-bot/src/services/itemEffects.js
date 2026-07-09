/**
 * Effets des items du catalogue REBORN.
 * `useItem(userId, itemId)` consomme l'item et applique l'effet (boosts XP/GXP/Starss,
 * skips quêtes, reset boutique, remboursement, event spawner, diamant…).
 *
 * Cooldowns perso : stockés dans `users.item_cd_json` (ex. `event_spawner` 24 h).
 * Plancher global event_spawner (1 h) : `meta.last_event_spawner_ms`.
 */

const db = require('../db');
const cfg = require('../config');
const users = require('./users');
const meta = require('./meta');
const quests = require('./quests');
const skillTree = require('./skillTree');

const ONE_HOUR = 60 * 60 * 1000;

function _readCd(uid) {
  const u = users.getUser(uid);
  try {
    const o = JSON.parse(u?.item_cd_json || '{}');
    return typeof o === 'object' && o ? o : {};
  } catch {
    return {};
  }
}
function _writeCd(uid, obj) {
  db.prepare('UPDATE users SET item_cd_json = ? WHERE id = ?').run(
    JSON.stringify(obj || {}),
    uid,
  );
}
function _setCd(uid, key, untilMs) {
  const o = _readCd(uid);
  o[key] = Number(untilMs) || 0;
  _writeCd(uid, o);
}
function _getCd(uid, key) {
  const o = _readCd(uid);
  return Number(o[key] || 0);
}

/**
 * Applique un boost (étend la durée existante au lieu de la remplacer si encore active).
 */
function _applyBoost(uid, field, durationMs) {
  const u = users.getUser(uid);
  const cur = u?.[field] || 0;
  const base = Math.max(cur, Date.now());
  const until = base + durationMs;
  users.setBoostField(uid, field, until);
  return until;
}

/**
 * Attribue le rôle hacker Discord (REBORN_HACKER_ROLE_ID) après consommation du jeton.
 * @param {{ userId: string, guildId?: string|null, client?: import('discord.js').Client, member?: import('discord.js').GuildMember }} ctx
 */
async function grantHackerRoleFromToken(ctx) {
  const roleId = cfg.hackerRoleId;
  if (!roleId) {
    return { ok: true, roleGranted: false, reason: 'no_role_config' };
  }
  const { userId, guildId, client, member } = ctx;
  if (!guildId || !client) {
    return { ok: false, error: 'Utilise le **jeton hacker** sur le serveur (pas en DM).' };
  }
  let m = member;
  if (!m?.roles) {
    const guild = await client.guilds.fetch(guildId).catch(() => null);
    if (!guild) return { ok: false, error: 'Serveur introuvable.' };
    m = await guild.members.fetch(userId).catch(() => null);
  }
  if (!m) return { ok: false, error: 'Impossible de te trouver sur le serveur.' };
  if (m.roles.cache.has(roleId)) {
    return { ok: true, roleGranted: false, alreadyHad: true };
  }
  await m.roles.add(roleId, 'Jeton hacker consommé');
  return { ok: true, roleGranted: true };
}

/**
 * @param {string} userId
 * @param {string} itemId
 * @param {{ guildId?: string|null, client?: import('discord.js').Client, member?: import('discord.js').GuildMember }} [ctx]
 * @returns {Promise<{ ok: boolean, error?: string, message?: string, lines?: string[] }>}
 */
async function useItem(userId, itemId, ctx = {}) {
  users.getOrCreate(userId, '');
  const inv = users.getInventory(userId);
  const have = inv.find((r) => r.item_id === itemId)?.qty || 0;
  if (have <= 0) return { ok: false, error: 'Item absent de ton inventaire.' };

  const id = String(itemId);

  // Coffres starss : ouverts depuis l'inventaire (achat → inventaire → ouverture).
  const purchase = require('./purchase');
  const chestSub = purchase.ITEM_TO_CHEST_SUB[id];
  if (chestSub) {
    if (!users.takeInventory(userId, id, 1)) return { ok: false, error: 'Indisponible.' };
    const r = purchase.openChest(userId, chestSub, ctx?.guildId || null);
    return { ok: true, message: r.message };
  }

  // Boosts d'1 h
  if (id === 'xp_boost') {
    if (!users.takeInventory(userId, id, 1)) return { ok: false, error: 'Indisponible.' };
    const until = _applyBoost(userId, 'xp_boost_ms', ONE_HOUR);
    return { ok: true, message: `🟦 **Boost ×2 XP** activé jusqu'à <t:${Math.floor(until / 1000)}:t>.` };
  }
  if (id === 'gxp_boost') {
    if (!users.takeInventory(userId, id, 1)) return { ok: false, error: 'Indisponible.' };
    const until = _applyBoost(userId, 'gxp_boost_ms', ONE_HOUR);
    return { ok: true, message: `🟩 **Boost ×2 GXP** activé jusqu'à <t:${Math.floor(until / 1000)}:t>.` };
  }
  if (id === 'starss_boost') {
    if (!users.takeInventory(userId, id, 1)) return { ok: false, error: 'Indisponible.' };
    const until = _applyBoost(userId, 'starss_boost_ms', ONE_HOUR);
    return { ok: true, message: `⭐ **Boost ×2 Starss** activé jusqu'à <t:${Math.floor(until / 1000)}:t>.` };
  }

  // Skips quêtes (palier arbre + items consommables)
  if (id === 'skip_daily') {
    if (!users.takeInventory(userId, id, 1)) return { ok: false, error: 'Indisponible.' };
    const r = quests.skipDaily(userId, { fromItem: true });
    if (!r.ok) {
      // Rendre l'item si l'effet n'a pas pu s'appliquer.
      users.addInventory(userId, id, 1);
      return { ok: false, error: r.error || 'Skip impossible.' };
    }
    return { ok: true, message: '⏭️ **Quête quotidienne** validée et claim auto.' };
  }
  if (id === 'skip_weekly') {
    if (!users.takeInventory(userId, id, 1)) return { ok: false, error: 'Indisponible.' };
    const r = quests.skipWeekly(userId, { fromItem: true });
    if (!r.ok) {
      users.addInventory(userId, id, 1);
      return { ok: false, error: r.error || 'Skip impossible.' };
    }
    return { ok: true, message: '⏭️ **Quête hebdo** validée et claim auto.' };
  }
  if (id === 'skip_quest') {
    // Polyvalent : si daily pas claim → skip daily, sinon skip weekly.
    const u = quests.summary(userId);
    let r;
    if (!u.daily?.claimed) r = quests.skipDaily(userId, { fromItem: true });
    else r = quests.skipWeekly(userId, { fromItem: true });
    if (!r.ok) return { ok: false, error: r.error || 'Skip impossible.' };
    if (!users.takeInventory(userId, id, 1)) return { ok: false, error: 'Indisponible.' };
    return { ok: true, message: '⏭️ **Skip quête** appliqué (daily ou hebdo selon priorité).' };
  }

  // Reset boutique : crée 5 nouveaux slots aujourd'hui
  if (id === 'reset_boutique') {
    if (!users.takeInventory(userId, id, 1)) return { ok: false, error: 'Indisponible.' };
    const shop = require('./shop');
    const day = shop.effectiveShopDateKey(userId);
    db.prepare('DELETE FROM user_shop WHERE user_id = ? AND shop_date = ?').run(userId, day);
    shop.ensureShopSlots(userId);
    return { ok: true, message: '🔄 **Boutique reset** — 5 nouveaux slots tirés.' };
  }

  // Remboursement : restitue 80 % du prix d'achat moyen d'un item (simulé).
  if (id === 'remboursement') {
    if (!users.takeInventory(userId, id, 1)) return { ok: false, error: 'Indisponible.' };
    const refund = 200_000n;
    users.addStars(userId, refund);
    return { ok: true, message: `💵 **Remboursement** : +${refund.toLocaleString('fr-FR')} starss crédités.` };
  }

  if (id === 'streak_keeper') {
    if (!users.takeInventory(userId, id, 1)) return { ok: false, error: 'Indisponible.' };
    const streak = require('./streak');
    const r = streak.restoreLostStreak(userId);
    if (!r.ok) {
      users.addInventory(userId, id, 1);
      return { ok: false, error: r.error };
    }
    return { ok: true, message: `🔥 **Streak restaurée** — tu es de nouveau à **${r.streak}** jour(s).` };
  }

  // Double Daily : la prochaine récompense daily est doublée (flag stocké via meta).
  if (id === 'double_daily') {
    if (!users.takeInventory(userId, id, 1)) return { ok: false, error: 'Indisponible.' };
    meta.set(`double_daily_pending_${userId}`, '1');
    return { ok: true, message: '✨ **Double Daily** armé — ta prochaine récompense daily est ×2.' };
  }

  // Event Spawner : CD perso 24 h + plancher 1 h global (anti-spam).
  if (id === 'event_spawner') {
    const cdUntil = _getCd(userId, 'event_spawner');
    const now = Date.now();
    if (now < cdUntil) {
      return { ok: false, error: `Cooldown perso jusqu'à <t:${Math.floor(cdUntil / 1000)}:R>.` };
    }
    const lastGlobal = Number(meta.get('last_event_spawner_ms') || 0);
    if (now - lastGlobal < ONE_HOUR) {
      const wait = ONE_HOUR - (now - lastGlobal);
      return { ok: false, error: `Plancher global 1 h — réessaie dans ${Math.ceil(wait / 60000)} min.` };
    }
    if (!users.takeInventory(userId, id, 1)) return { ok: false, error: 'Indisponible.' };
    meta.set('last_event_spawner_ms', String(now));
    _setCd(userId, 'event_spawner', now + 24 * 60 * 60 * 1000);
    // Effet : déclenche un mini-event 1 h sur le serveur principal (best-effort)
    try {
      const events = require('./events');
      const hub = String(process.env.BLZ_MAIN_GUILD_ID || '').trim();
      if (hub) events.startEvent(hub, 'chasse');
    } catch { /* ignore */ }
    return { ok: true, message: '🌠 **Event Spawner** consommé — un événement **Chasse aux étoiles** vient de démarrer.' };
  }

  // Diamant : consomme et signe le détenteur (béton — un seul actif sur le serveur).
  if (id === 'diamant') {
    const cur = meta.diamondHolder();
    if (cur && cur !== userId) {
      return { ok: false, error: `Le **Diamant** est déjà détenu par <@${cur}>.` };
    }
    meta.setDiamondHolder(userId);
    return { ok: true, message: '💎 **Diamant** scellé en ton nom — clé Temple **Sceau du Diamant** débloquée.' };
  }

  // Crystal : consomme pour +500k starss (assist grade Goat).
  if (id === 'crystal') {
    if (!users.takeInventory(userId, id, 1)) return { ok: false, error: 'Indisponible.' };
    users.addStars(userId, 500_000n);
    return { ok: true, message: '💠 **Crystal** consommé : +500 000 starss (et tu peux toujours en garder pour un palier de grade).' };
  }

  // Hacker token : non consommé ici (panneau /salon-hacker + bouton).
  if (id === 'hacker_token') {
    return { ok: false, error: 'Le **jeton hacker** s’utilise via le **bouton** du panneau `/salon-hacker`.' };
  }

  // Items « décoratifs » (planète, étoile, baleine…) : pas d'effet direct,
  // ils servent à l'index (ranger / collectionner).
  return { ok: false, error: 'Cet item n’a pas d’effet utilisable ici (collection / index).' };
}

module.exports = { useItem };
