const db = require('../db');
const users = require('./users');
const indexProgress = require('./indexProgress');
const quests = require('./quests');
const gm = require('./guildMember');
const pg = require('./playerGuilds');

/**
 * @typedef {object} TrophyDef
 * @property {string} id
 * @property {string} name
 * @property {string} desc
 * @property {string} [tier]
 * @property {number} [templeBonus]   nombre de points temple bonus à l'unlock (défaut 0)
 * @property {(ctx: Record<string, any>) => boolean} check
 */

/** @type {TrophyDef[]} */
const DEFS = [
  { id: 'premier_pas', tier: 'commun', name: 'Premier pas', desc: 'Envoyer au moins 1 message sur un serveur.', check: (c) => c.lifetime_msgs >= 1 },
  { id: 'bavard', tier: 'rare', name: 'Bavard', desc: '10 messages dans la même journée.', check: (c) => c.msgs_today >= 10 },
  { id: 'verbeux', tier: 'rare', name: 'Verbeux', desc: '100 messages cumulés.', check: (c) => c.lifetime_msgs >= 100 },
  { id: 'chroniqueur', tier: 'epique', name: 'Chroniqueur', desc: '1 000 messages cumulés.', check: (c) => c.lifetime_msgs >= 1000 },
  { id: 'fortune', tier: 'rare', name: 'Fortune', desc: 'Posséder 100 000 starss.', check: (c) => c.stars >= 100_000n },
  { id: 'millionnaire', tier: 'epique', name: 'Millionnaire', desc: 'Posséder 1 000 000 starss.', check: (c) => c.stars >= 1_000_000n },
  { id: 'magnat', tier: 'mythique', name: 'Magnat', desc: 'Posséder 10 000 000 starss.', check: (c) => c.stars >= 10_000_000n },
  { id: 'veteran', tier: 'rare', name: 'Vétéran', desc: 'Atteindre le niveau 15.', check: (c) => c.level >= 15 },
  { id: 'mentor', tier: 'epique', name: 'Mentor', desc: 'Atteindre le niveau 50.', check: (c) => c.level >= 50 },
  { id: 'sommite', tier: 'mythique', name: 'Sommité', desc: 'Atteindre le niveau 99.', check: (c) => c.level >= 99 },
  { id: 'collectionneur', tier: 'rare', name: 'Collectionneur', desc: 'Index items ≥ 25 %.', check: (c) => c.index_pct >= 25 },
  { id: 'archiviste', tier: 'epique', name: 'Archiviste', desc: 'Index items ≥ 75 %.', check: (c) => c.index_pct >= 75 },
  { id: 'completionniste', tier: 'mythique', name: 'Complétionniste', desc: 'Index items 100 %.', check: (c) => c.index_pct >= 100 },
  { id: 'guilde_soldat', tier: 'commun', name: 'En guilde', desc: 'Être membre d’une guilde joueur sur ce serveur.', check: (c) => Boolean(c.in_player_guild) },
  { id: 'grp_argent', tier: 'rare', name: 'GRP Argent', desc: 'Atteindre 5 000 GRP sur un serveur.', check: (c) => c.grp_total >= 5000n },
  { id: 'grp_or', tier: 'epique', name: 'GRP Or', desc: 'Atteindre 25 000 GRP.', check: (c) => c.grp_total >= 25_000n },
  { id: 'grp_diamant', tier: 'mythique', name: 'GRP Diamant', desc: 'Atteindre 100 000 GRP.', check: (c) => c.grp_total >= 100_000n },
  { id: 'voixdor', tier: 'epique', name: 'Voix d’or', desc: '60 minutes de vocal cumulées.', check: (c) => c.voice_minutes >= 60 },
  { id: 'maitre_vocal', tier: 'mythique', name: 'Maître vocal', desc: '600 minutes de vocal cumulées.', check: (c) => c.voice_minutes >= 600 },
  { id: 'separation_winner', tier: 'mythique', name: 'Vainqueur de la séparation', desc: 'Remporter au moins 1 séparation.', check: (c) => c.separations_won >= 1 },
  { id: 'arbre_complet', tier: 'mythique', templeBonus: 1, name: 'Arbre planté', desc: 'Compléter une branche d’arbre (5 paliers).', check: (c) => c.max_branch_step >= 5 },
  { id: 'temple_eveille', tier: 'goatesque', templeBonus: 1, name: 'Éveil du Temple', desc: 'Avoir au moins 1 point Temple.', check: (c) => c.temple_points >= 1 },
  { id: 'hacker', tier: 'mythique', templeBonus: 1, name: 'Hacker', desc: 'Posséder un *Jeton d’accès Hacker*.', check: (c) => c.has_hacker_token },
  { id: 'fortune_diamant', tier: 'staresque', templeBonus: 1, name: 'Possesseur du Diamant', desc: 'Détenir le Diamant unique du serveur.', check: (c) => c.has_diamond },
];

const TIER_WEIGHTS = {
  commun: 50,
  rare: 25,
  epique: 12,
  mythique: 8,
  goatesque: 4,
  staresque: 1,
};

const TIER_REWARD = {
  commun: 5_000n,
  rare: 15_000n,
  epique: 50_000n,
  mythique: 200_000n,
  goatesque: 500_000n,
  staresque: 1_500_000n,
};

function isUnlocked(userId, trophyId) {
  return !!db.prepare('SELECT 1 FROM trophies_unlocked WHERE user_id = ? AND trophy_id = ?').get(userId, trophyId);
}

function unlock(userId, trophyId) {
  if (isUnlocked(userId, trophyId)) return false;
  db.prepare('INSERT INTO trophies_unlocked (user_id, trophy_id, unlocked_ms) VALUES (?, ?, ?)').run(userId, trophyId, Date.now());
  const def = DEFS.find((d) => d.id === trophyId);
  if (def) {
    const reward = TIER_REWARD[def.tier || 'commun'] || 0n;
    if (reward > 0n) users.addStars(userId, reward);
    if (def.templeBonus && def.templeBonus > 0) {
      try {
        const cur = db.prepare('SELECT temple_points FROM users WHERE id = ?').get(userId)?.temple_points || 0;
        db.prepare('UPDATE users SET temple_points = ? WHERE id = ?').run(cur + def.templeBonus, userId);
      } catch {
        /* ignore */
      }
    }
  }
  return true;
}

function buildContext(userId, hubDiscordId) {
  users.getOrCreate(userId, '');
  const u = users.getUser(userId);
  const qsum = quests.summary(userId);
  const row = db.prepare('SELECT lifetime_msgs FROM user_quest_state WHERE user_id = ?').get(userId);
  const ir = indexProgress.getRow(userId);
  let grp_total = 0n;
  let in_player_guild = false;
  if (hubDiscordId) {
    const m = pg.getMembershipInHub(userId, hubDiscordId);
    in_player_guild = Boolean(m);
    grp_total = gm.getMemberRow(hubDiscordId, userId).grp;
  }
  let max_branch_step = 0;
  try {
    const skillTree = require('./skillTree');
    for (const b of skillTree.BRANCHES) {
      const s = skillTree.step(userId, b);
      if (s > max_branch_step) max_branch_step = s;
    }
  } catch {
    /* ignore */
  }
  const has_hacker_token = (() => {
    const r = db.prepare('SELECT qty FROM inventory WHERE user_id = ? AND item_id = ?').get(userId, 'hacker_token');
    return Boolean(r && r.qty > 0);
  })();
  const has_diamond = (() => {
    const r = db.prepare('SELECT qty FROM inventory WHERE user_id = ? AND item_id = ?').get(userId, 'diamant');
    if (r && r.qty > 0) return true;
    try {
      return require('./meta').diamondHolder() === userId;
    } catch {
      return false;
    }
  })();
  return {
    lifetime_msgs: row?.lifetime_msgs || 0,
    msgs_today: qsum.msgs_today,
    stars: users.getStars(userId),
    level: u?.level || 1,
    index_pct: ir?.completion_pct || 0,
    in_player_guild,
    grp_total,
    voice_minutes: u?.voice_minutes_total || 0,
    separations_won: u?.separations_won || 0,
    max_branch_step,
    temple_points: u?.temple_points || 0,
    has_hacker_token,
    has_diamond,
  };
}

/** @param {string | null} [hubDiscordId] */
function evaluate(userId, hubDiscordId = null) {
  const ctx = buildContext(userId, hubDiscordId);
  const newly = [];
  for (const t of DEFS) {
    if (isUnlocked(userId, t.id)) continue;
    if (t.check(ctx) && unlock(userId, t.id)) newly.push(t.id);
  }
  return newly;
}

function listUnlocked(userId) {
  return db
    .prepare('SELECT trophy_id, unlocked_ms FROM trophies_unlocked WHERE user_id = ? ORDER BY unlocked_ms')
    .all(userId);
}

function pickWeighted(weights) {
  const total = weights.reduce((a, [, w]) => a + w, 0);
  let r = Math.random() * total;
  for (const [k, w] of weights) {
    r -= w;
    if (r <= 0) return k;
  }
  return weights[weights.length - 1][0];
}

const TROPHY_LOTTERY_COOLDOWN_MS = 24 * 60 * 60 * 1000;

/**
 * Tirage : pioche **un trophée non débloqué**, pondéré par tier. Renvoie l'unlock + récompense.
 * Le client gère le cooldown via `meta.set('trophy_lottery_last_<uid>', ms)`.
 */
function lottery(userId, hubDiscordId) {
  const meta = require('./meta');
  const key = `trophy_lottery_last_${userId}`;
  const last = parseInt(meta.get(key) || '0', 10) || 0;
  const now = Date.now();
  if (now - last < TROPHY_LOTTERY_COOLDOWN_MS) {
    const left = Math.ceil((TROPHY_LOTTERY_COOLDOWN_MS - (now - last)) / 3600000);
    return { ok: false, error: `Tirage déjà utilisé. Reviens dans **~${left} h**.` };
  }
  const unlockedIds = new Set(listUnlocked(userId).map((r) => r.trophy_id));
  const remaining = DEFS.filter((d) => !unlockedIds.has(d.id));
  if (!remaining.length) {
    meta.set(key, String(now));
    return { ok: false, error: 'Tu as déjà débloqué **tous** les trophées 👑.' };
  }
  // Construit les poids depuis les tiers ; on biaise vers les trophées proches d'être validés (ctx.check === true).
  const ctx = buildContext(userId, hubDiscordId);
  const weights = remaining.map((d) => {
    const base = TIER_WEIGHTS[d.tier || 'commun'] || 1;
    const bonus = d.check(ctx) ? base * 4 : 0;
    return [d.id, base + bonus];
  });
  const id = pickWeighted(weights);
  meta.set(key, String(now));
  if (unlock(userId, id)) {
    const def = DEFS.find((d) => d.id === id);
    const reward = TIER_REWARD[def?.tier || 'commun'] || 0n;
    return { ok: true, id, name: def?.name || id, tier: def?.tier || 'commun', reward, templeBonus: def?.templeBonus || 0 };
  }
  return { ok: false, error: 'Tirage : aucun trophée débloqué cette fois.' };
}

module.exports = {
  DEFS,
  TIER_REWARD,
  evaluate,
  isUnlocked,
  unlock,
  listUnlocked,
  buildContext,
  lottery,
  TROPHY_LOTTERY_COOLDOWN_MS,
};
