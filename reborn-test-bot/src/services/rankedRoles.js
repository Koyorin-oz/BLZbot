/**
 * Rôles Discord par rang Ranked RP.
 *
 * Les IDs sont stockés en DB (`meta`) par hub Discord ID, sous la clé
 * `ranked_role_<key>:<hubId>`. La commande `/admin-roles creer-ranked`
 * les crée et les enregistre, puis `syncRankRoleForUser()` les applique en
 * fonction du RP courant du joueur.
 *
 * Échelle complète (gdoc) : 27 sous-rangs + 5 tops, du plus bas au plus haut.
 *   Vide (0)
 *   Plastique I/II/III      50 / 100 / 200
 *   Bronze   I/II/III       300 / 500 / 800
 *   Argent   I/II/III       1 000 / 1 500 / 2 000
 *   Or       I/II/III       3 000 / 4 000 / 5 000
 *   Diamant  I/II/III       6 000 / 7 000 / 8 000
 *   Émeraude I/II/III       10 000 / 15 000 / 20 000
 *   Rubis    I/II/III       25 000 / 30 000 / 40 000
 *   Légendaire              50 000
 *   Mythique                60 000
 *   Master                  70 000
 *   Goat                    80 000
 *   Star                    100 000
 *
 * Anti-spam : un cache mémoire évite d'appeler l'API Discord à chaque message
 * (resync uniquement quand le rang change réellement).
 */

const meta = require('./meta');
const users = require('./users');

// Couleurs par famille (les I/II/III partagent la couleur de famille).
const C = {
  vide: 0x4f545c,
  plastique: 0x95a5a6,
  bronze: 0xcd7f32,
  argent: 0xc0c0c0,
  or: 0xf1c40f,
  diamant: 0x55ddff,
  emeraude: 0x2ecc71,
  rubis: 0xe74c3c,
  legendaire: 0xe67e22,
  mythique: 0x9b59b6,
  master: 0x1abc9c,
  goat: 0xf39c12,
  star: 0xffd700,
};

/**
 * Liste des rangs, du plus bas au plus haut.
 * `family` regroupe les sous-rangs (utile pour les quêtes « passer <famille> »).
 * @type {{ key: string, label: string, threshold: bigint, color: number, family: string }[]}
 */
const RANKS_ASC = [
  { key: 'vide', label: 'Vide', threshold: 0n, color: C.vide, family: 'vide' },

  { key: 'plastique_1', label: 'Plastique I', threshold: 50n, color: C.plastique, family: 'plastique' },
  { key: 'plastique_2', label: 'Plastique II', threshold: 100n, color: C.plastique, family: 'plastique' },
  { key: 'plastique_3', label: 'Plastique III', threshold: 200n, color: C.plastique, family: 'plastique' },

  { key: 'bronze_1', label: 'Bronze I', threshold: 300n, color: C.bronze, family: 'bronze' },
  { key: 'bronze_2', label: 'Bronze II', threshold: 500n, color: C.bronze, family: 'bronze' },
  { key: 'bronze_3', label: 'Bronze III', threshold: 800n, color: C.bronze, family: 'bronze' },

  { key: 'argent_1', label: 'Argent I', threshold: 1_000n, color: C.argent, family: 'argent' },
  { key: 'argent_2', label: 'Argent II', threshold: 1_500n, color: C.argent, family: 'argent' },
  { key: 'argent_3', label: 'Argent III', threshold: 2_000n, color: C.argent, family: 'argent' },

  { key: 'or_1', label: 'Or I', threshold: 3_000n, color: C.or, family: 'or' },
  { key: 'or_2', label: 'Or II', threshold: 4_000n, color: C.or, family: 'or' },
  { key: 'or_3', label: 'Or III', threshold: 5_000n, color: C.or, family: 'or' },

  { key: 'diamant_1', label: 'Diamant I', threshold: 6_000n, color: C.diamant, family: 'diamant' },
  { key: 'diamant_2', label: 'Diamant II', threshold: 7_000n, color: C.diamant, family: 'diamant' },
  { key: 'diamant_3', label: 'Diamant III', threshold: 8_000n, color: C.diamant, family: 'diamant' },

  { key: 'emeraude_1', label: 'Émeraude I', threshold: 10_000n, color: C.emeraude, family: 'emeraude' },
  { key: 'emeraude_2', label: 'Émeraude II', threshold: 15_000n, color: C.emeraude, family: 'emeraude' },
  { key: 'emeraude_3', label: 'Émeraude III', threshold: 20_000n, color: C.emeraude, family: 'emeraude' },

  { key: 'rubis_1', label: 'Rubis I', threshold: 25_000n, color: C.rubis, family: 'rubis' },
  { key: 'rubis_2', label: 'Rubis II', threshold: 30_000n, color: C.rubis, family: 'rubis' },
  { key: 'rubis_3', label: 'Rubis III', threshold: 40_000n, color: C.rubis, family: 'rubis' },

  { key: 'legendaire', label: 'Légendaire', threshold: 50_000n, color: C.legendaire, family: 'legendaire' },
  { key: 'mythique', label: 'Mythique', threshold: 60_000n, color: C.mythique, family: 'mythique' },
  { key: 'master', label: 'Master', threshold: 70_000n, color: C.master, family: 'master' },
  { key: 'goat', label: 'Goat', threshold: 80_000n, color: C.goat, family: 'goat' },
  { key: 'star', label: 'Star', threshold: 100_000n, color: C.star, family: 'star' },
];

// Ordre décroissant pour la résolution RP -> rang (premier seuil atteint).
const TIER_DEFS = [...RANKS_ASC].reverse();
const TIERS = RANKS_ASC.map((r) => r.key);
const RANK_BY_KEY = new Map(RANKS_ASC.map((r) => [r.key, r]));
const RANK_INDEX = new Map(RANKS_ASC.map((r, i) => [r.key, i]));

/** Renvoie la clé du rang pour un montant de RP. */
function tierForRp(rp) {
  const r = typeof rp === 'bigint' ? rp : BigInt(rp || 0);
  for (const t of TIER_DEFS) {
    if (r >= t.threshold) return t.key;
  }
  return 'vide';
}

/** Renvoie la définition complète du rang courant. */
function rankForRp(rp) {
  return RANK_BY_KEY.get(tierForRp(rp)) || RANKS_ASC[0];
}

/** Renvoie le rang suivant (ou null si déjà au sommet). */
function nextRank(rp) {
  const idx = RANK_INDEX.get(tierForRp(rp)) ?? 0;
  return RANKS_ASC[idx + 1] || null;
}

/** Index ordinal d'un rang (0 = Vide). Renvoie -1 si inconnu. */
function rankIndex(key) {
  return RANK_INDEX.has(key) ? RANK_INDEX.get(key) : -1;
}

/** Vrai si `key` est au moins aussi élevé que `targetKey`. */
function isAtLeast(key, targetKey) {
  const a = rankIndex(key);
  const b = rankIndex(targetKey);
  if (a < 0 || b < 0) return false;
  return a >= b;
}

/**
 * IDs de rôles Discord fournis manuellement (le bot ne crée plus aucun rôle).
 * Colle ici l'ID du rôle Discord que TU as créé pour chaque rang.
 * Laisse la chaîne vide ('') pour un rang sans rôle dédié.
 *
 * Ces IDs sont prioritaires sur ce qui est éventuellement défini via
 * `/admin-roles definir-ranked` (stocké en base).
 *
 * @type {Record<string, string>}
 */
const RANK_ROLE_IDS = {
  vide: '',
  plastique_1: '',
  plastique_2: '',
  plastique_3: '',
  bronze_1: '',
  bronze_2: '',
  bronze_3: '',
  argent_1: '',
  argent_2: '',
  argent_3: '',
  or_1: '',
  or_2: '',
  or_3: '',
  diamant_1: '',
  diamant_2: '',
  diamant_3: '',
  emeraude_1: '',
  emeraude_2: '',
  emeraude_3: '',
  rubis_1: '',
  rubis_2: '',
  rubis_3: '',
  legendaire: '',
  mythique: '',
  master: '',
  goat: '',
  star: '',
};

function metaKey(hubId, tier) {
  return `ranked_role_${tier}:${hubId}`;
}

function getRoleIdForTier(hubId, tier) {
  // Les IDs codés en dur priment, sinon fallback sur la config en base.
  const hard = RANK_ROLE_IDS[tier];
  if (hard) return hard;
  return meta.get(metaKey(hubId, tier));
}

function setRoleIdForTier(hubId, tier, roleId) {
  meta.set(metaKey(hubId, tier), String(roleId));
}

function listConfiguredRoles(hubId) {
  return RANKS_ASC.map((t) => ({ ...t, roleId: getRoleIdForTier(hubId, t.key) || null }));
}

/** Cache du dernier rang appliqué pour éviter le spam API. */
const lastAppliedTier = new Map(); // key: `${hubId}:${userId}` -> tier

/**
 * Synchronise le rôle Discord du joueur en fonction de son RP courant.
 * Ne fait rien si aucun rôle n'est configuré sur le hub.
 *
 * @param {import('discord.js').Client} client
 * @param {string} hubDiscordId
 * @param {string} userId
 * @returns {Promise<{ ok: boolean, tier?: string, changed?: boolean, error?: string }>}
 */
async function syncRankRoleForUser(client, hubDiscordId, userId) {
  if (!client || !hubDiscordId || !userId) return { ok: false, error: 'arguments' };
  const rp = users.getPoints(userId);
  const tier = tierForRp(rp);
  const cacheKey = `${hubDiscordId}:${userId}`;
  if (lastAppliedTier.get(cacheKey) === tier) {
    return { ok: true, tier, changed: false };
  }
  // Vérifier qu'au moins un rôle est configuré (sinon abandon silencieux).
  const cfg = listConfiguredRoles(hubDiscordId);
  if (!cfg.some((c) => c.roleId)) return { ok: true, tier, changed: false };
  let guild;
  try {
    guild = client.guilds.cache.get(hubDiscordId) || (await client.guilds.fetch(hubDiscordId));
  } catch (e) {
    return { ok: false, error: `guild fetch: ${e?.message || e}` };
  }
  if (!guild) return { ok: false, error: 'guild absente' };
  let member;
  try {
    member = guild.members.cache.get(userId) || (await guild.members.fetch(userId));
  } catch {
    // Le joueur n'est plus sur le serveur — on ne pollue pas les logs.
    return { ok: false, error: 'membre absent' };
  }
  const targetRoleId = cfg.find((c) => c.key === tier)?.roleId || null;
  const otherRoleIds = cfg.filter((c) => c.key !== tier && c.roleId).map((c) => c.roleId);
  let changed = false;
  try {
    if (targetRoleId && !member.roles.cache.has(targetRoleId)) {
      await member.roles.add(targetRoleId, 'Ranked RP rang auto');
      changed = true;
    }
    for (const rid of otherRoleIds) {
      if (member.roles.cache.has(rid)) {
        await member.roles.remove(rid, 'Ranked RP rang auto').catch(() => {});
        changed = true;
      }
    }
    lastAppliedTier.set(cacheKey, tier);
    return { ok: true, tier, changed };
  } catch (e) {
    return { ok: false, error: `roles: ${e?.message || e}` };
  }
}

/** Réinitialise le cache pour un user (utilisé par la commande `/admin-roles resync`). */
function resetCacheFor(userId) {
  for (const key of [...lastAppliedTier.keys()]) {
    if (key.endsWith(`:${userId}`)) lastAppliedTier.delete(key);
  }
}

module.exports = {
  TIERS,
  TIER_DEFS,
  RANKS_ASC,
  tierForRp,
  rankForRp,
  nextRank,
  rankIndex,
  isAtLeast,
  getRoleIdForTier,
  setRoleIdForTier,
  listConfiguredRoles,
  syncRankRoleForUser,
  resetCacheFor,
};
