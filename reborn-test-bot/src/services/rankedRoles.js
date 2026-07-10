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
  plastique_1: '1515118846225416192',
  plastique_2: '1515118845080109146',
  plastique_3: '', // ID non fourni (doublon avec bronze dans la liste Discord)
  bronze_1: '1515118844111487087',
  bronze_2: '1515114243060400319',
  bronze_3: '1515114242414477352',
  argent_1: '1515114241462505672',
  argent_2: '1515114241076629564',
  argent_3: '1515114240724177057',
  or_1: '1515114238878941204',
  or_2: '1515114238354526369',
  or_3: '1515114237830234112',
  diamant_1: '1515114236731457630',
  diamant_2: '1515114231513481377',
  diamant_3: '1515119462536450139',
  emeraude_1: '1515119456848969849',
  emeraude_2: '1515119454093049946',
  emeraude_3: '1515119449546690650',
  rubis_1: '1515119397000187904',
  rubis_2: '1515119446472003741',
  rubis_3: '1515119396333289644',
  legendaire: '1515119395939156139',
  mythique: '1515119395121135756',
  master: '1515119394420686898',
  goat: '1515119389018558464',
  star: '1515119392118013972',
};

/** Rôles « famille » (ex. « Émeraude » en plus de « Émeraude I »). */
const FAMILY_ROLE_IDS = {
  plastique: '1515118847009755196',
  bronze: '1515118844627128442',
  argent: '1515114241735000257',
  or: '1515114240267124791',
  diamant: '1515114237318660096',
  emeraude: '1515119459293986920',
  rubis: '1515119397000187904',
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

/** Rôles « famille » de l'ancien système niveau (ex. rôle « Or » en plus de « Or II »). */
const MAIN_RANK_NAMES = [
  'Plastique',
  'Bronze',
  'Argent',
  'Or',
  'Diamant',
  'Émeraude',
  'Rubis',
  'Légendaire',
  'Mythique',
  'MASTER',
  'GOAT',
  'STAR',
];

function normalizeRankName(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

const RANK_LABELS_NORM = new Set(RANKS_ASC.map((r) => normalizeRankName(r.label)));

function familyMainName(family) {
  const map = {
    plastique: 'Plastique',
    bronze: 'Bronze',
    argent: 'Argent',
    or: 'Or',
    diamant: 'Diamant',
    emeraude: 'Émeraude',
    rubis: 'Rubis',
    legendaire: 'Légendaire',
    mythique: 'Mythique',
    master: 'MASTER',
    goat: 'GOAT',
    star: 'STAR',
  };
  return map[family] || null;
}

function getFamilyRoleId(family) {
  if (!family || family === 'vide') return null;
  return FAMILY_ROLE_IDS[family] || null;
}

function rolesToKeepForTier(tier, cfg) {
  const def = RANK_BY_KEY.get(tier) || RANKS_ASC[0];
  const targetRoleId = cfg.find((c) => c.key === tier)?.roleId || null;
  const familyRoleId = getFamilyRoleId(def.family);
  const keep = new Set();
  if (targetRoleId) keep.add(targetRoleId);
  if (familyRoleId) keep.add(familyRoleId);
  return { def, targetRoleId, familyRoleId, keep };
}

function rolesToRemoveForTier(tier, cfg) {
  const { keep } = rolesToKeepForTier(tier, cfg);
  const remove = new Set();
  for (const c of cfg) {
    if (c.roleId && !keep.has(c.roleId)) remove.add(c.roleId);
  }
  for (const fid of Object.values(FAMILY_ROLE_IDS)) {
    if (fid && !keep.has(fid)) remove.add(fid);
  }
  return [...remove];
}

/** Vérifie que le membre n'a plus d'anciens rôles ranked et possède le bon rôle configuré. */
function memberMatchesTier(member, tier, cfg) {
  const { def, targetRoleId, familyRoleId, keep } = rolesToKeepForTier(tier, cfg);
  const currentNorm = normalizeRankName(def.label);
  const expectedMainNorm =
    def.family && def.family !== 'vide' ? normalizeRankName(familyMainName(def.family)) : null;

  for (const c of cfg) {
    if (!c.roleId || keep.has(c.roleId)) continue;
    if (member.roles.cache.has(c.roleId)) return false;
  }
  for (const fid of Object.values(FAMILY_ROLE_IDS)) {
    if (!fid || keep.has(fid)) continue;
    if (member.roles.cache.has(fid)) return false;
  }

  if (tier !== 'vide' && targetRoleId && !member.roles.cache.has(targetRoleId)) {
    return false;
  }
  if (
    tier !== 'vide' &&
    familyRoleId &&
    familyRoleId !== targetRoleId &&
    !member.roles.cache.has(familyRoleId)
  ) {
    return false;
  }

  for (const role of member.roles.cache.values()) {
    const n = normalizeRankName(role.name);
    if (RANK_LABELS_NORM.has(n) && n !== currentNorm) return false;
    if (
      expectedMainNorm &&
      MAIN_RANK_NAMES.some((m) => normalizeRankName(m) === n) &&
      n !== expectedMainNorm
    ) {
      return false;
    }
  }
  return true;
}

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
  const cfg = listConfiguredRoles(hubDiscordId);
  const hasConfiguredRoles = cfg.some((c) => c.roleId);
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
    return { ok: false, error: 'membre absent' };
  }

  if (
    lastAppliedTier.get(cacheKey) === tier &&
    memberMatchesTier(member, tier, cfg)
  ) {
    return { ok: true, tier, changed: false };
  }

  if (!hasConfiguredRoles) {
    // Pas de mapping meta : on retire quand même les anciens rôles nommés (système niveau).
    const def = RANK_BY_KEY.get(tier) || RANKS_ASC[0];
    const currentNorm = normalizeRankName(def.label);
    const expectedMainNorm =
      def.family && def.family !== 'vide' ? normalizeRankName(familyMainName(def.family)) : null;
    let changed = false;
    const warnings = [];
    for (const role of [...member.roles.cache.values()]) {
      const n = normalizeRankName(role.name);
      const staleSub = RANK_LABELS_NORM.has(n) && n !== currentNorm;
      const staleMain =
        expectedMainNorm &&
        MAIN_RANK_NAMES.some((m) => normalizeRankName(m) === n) &&
        n !== expectedMainNorm;
      if (!staleSub && !staleMain) continue;
      try {
        await member.roles.remove(role, 'Ranked RP rang auto (legacy)');
        changed = true;
      } catch (e) {
        warnings.push(`${role.name}: ${e?.message || e}`);
      }
    }
    if (memberMatchesTier(member, tier, cfg)) {
      lastAppliedTier.set(cacheKey, tier);
    }
    return {
      ok: warnings.length === 0,
      tier,
      changed,
      error: warnings.length ? warnings.join('; ') : undefined,
    };
  }

  const { def, targetRoleId, familyRoleId, keep } = rolesToKeepForTier(tier, cfg);
  const otherRoleIds = rolesToRemoveForTier(tier, cfg);
  const currentNorm = normalizeRankName(def.label);
  const expectedMainNorm =
    def.family && def.family !== 'vide' ? normalizeRankName(familyMainName(def.family)) : null;
  const oldTier = lastAppliedTier.get(cacheKey);
  let changed = false;
  const warnings = [];
  try {
    if (targetRoleId && !member.roles.cache.has(targetRoleId)) {
      await member.roles.add(targetRoleId, 'Ranked RP rang auto');
      changed = true;
    } else if (tier !== 'vide' && !targetRoleId) {
      warnings.push(
        `rôle Discord non configuré pour ${def.label} (${tier}) — /admin-roles definir-ranked`,
      );
    }
    if (
      familyRoleId &&
      familyRoleId !== targetRoleId &&
      !member.roles.cache.has(familyRoleId)
    ) {
      await member.roles.add(familyRoleId, 'Ranked RP rang auto (famille)');
      changed = true;
    }

    for (const rid of otherRoleIds) {
      if (!member.roles.cache.has(rid)) continue;
      try {
        await member.roles.remove(rid, 'Ranked RP rang auto');
        changed = true;
      } catch (e) {
        warnings.push(`remove role ${rid}: ${e?.message || e}`);
      }
    }

    for (const role of [...member.roles.cache.values()]) {
      const n = normalizeRankName(role.name);
      const staleSub = RANK_LABELS_NORM.has(n) && n !== currentNorm;
      const staleMain =
        expectedMainNorm &&
        MAIN_RANK_NAMES.some((m) => normalizeRankName(m) === n) &&
        n !== expectedMainNorm;
      if (!staleSub && !staleMain) continue;
      if (keep.has(role.id)) continue;
      try {
        await member.roles.remove(role, 'Ranked RP rang auto (legacy)');
        changed = true;
      } catch (e) {
        warnings.push(`${role.name}: ${e?.message || e}`);
      }
    }

    if (memberMatchesTier(member, tier, cfg)) {
      lastAppliedTier.set(cacheKey, tier);
    } else if (warnings.length) {
      console.warn(`[rankedRoles] sync incomplet ${userId} → ${tier}: ${warnings.join('; ')}`);
    }

    if (
      changed &&
      oldTier &&
      oldTier !== tier &&
      rankIndex(tier) > rankIndex(oldTier)
    ) {
      const newLabel = def.label || tier;
      try {
        const ranksPath = require('path').join(__dirname, '..', '..', '..', 'niveau', 'src', 'utils', 'ranks');
        const { sendRankUpNotification } = require(ranksPath);
        await sendRankUpNotification(client, hubDiscordId, userId, member, newLabel);
      } catch {
        /* notification best-effort */
      }
    }

    return {
      ok: warnings.length === 0,
      tier,
      changed,
      oldTier: oldTier || null,
      error: warnings.length ? warnings.join('; ') : undefined,
    };
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
  RANK_ROLE_IDS,
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
