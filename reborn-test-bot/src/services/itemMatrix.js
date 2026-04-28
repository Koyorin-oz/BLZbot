/**
 * Matrice combinée Index / Ranked / Guilde.
 *
 * Les **paliers d'index** (10 % → 100 %) débloquent des bonus permanents.
 * Le **rang ranked** (RP) débloque ses propres modifs (gain RP).
 * Le **grade de guilde** (Bronze → Star) ouvre les options de séparation
 * (Star = anti-séparation) et débloque l'icône.
 *
 * Cette matrice se contente de **lister** les bonus actifs pour qu'on les
 * affiche en `/itemindex matrice` côté commande.
 */

const indexProgress = require('./indexProgress');
const playerGuilds = require('./playerGuilds');
const skillTree = require('./skillTree');
const users = require('./users');
const { label: gradeLabel } = require('../reborn/grades');

/**
 * Bonus d'index par palier (cohérent avec doc REBORN — multiplicateurs
 * permanents qu'on additionne).
 */
const INDEX_BONUSES = [
  { pct: 10, label: '+1 % XP' },
  { pct: 20, label: '+1 % Starss' },
  { pct: 30, label: '+2 % XP' },
  { pct: 40, label: '+2 % Starss' },
  { pct: 50, label: '+3 % GXP' },
  { pct: 60, label: '+5 % loot coffre' },
  { pct: 70, label: '+5 % GRP' },
  { pct: 80, label: '+1 slot inventaire (cosmétique)' },
  { pct: 90, label: '+10 % XP' },
  { pct: 100, label: 'Rôle « Pipelette ultime »' },
];

/**
 * Bonus ranked par palier de RP courant (lecture rapide).
 */
function rankedTier(rp) {
  const r = typeof rp === 'bigint' ? rp : BigInt(rp || 0);
  if (r >= 100_000n) return { tier: 'Apex', label: 'Apex (≥ 100k)', perks: ['Décrépitude max -5k/j', 'Visibilité top RP', 'Bonus arbre actifs'] };
  if (r >= 90_000n) return { tier: 'Master', label: 'Master (≥ 90k)', perks: ['Pool ranked actif', 'Bonus arbre 90+'] };
  if (r >= 80_000n) return { tier: 'Diamond', label: 'Diamond (≥ 80k)', perks: ['Décrépitude 2k/j', '+Pool stable'] };
  if (r >= 70_000n) return { tier: 'Platine', label: 'Platine (≥ 70k)', perks: ['Décrépitude 1k/j'] };
  if (r >= 60_000n) return { tier: 'Or', label: 'Or (≥ 60k)', perks: ['Gain msg 8/8'] };
  if (r >= 50_000n) return { tier: 'Argent', label: 'Argent (≥ 50k)', perks: ['Gain msg 10/10'] };
  return { tier: 'Bronze', label: 'Bronze (< 50k)', perks: ['Gain msg max'] };
}

/**
 * Construit la matrice complète pour un joueur.
 * Renvoie : `{ index, ranked, guilde, classes }`.
 */
function summary(userId, hubDiscordId) {
  users.getOrCreate(userId, '');
  const u = users.getUser(userId);
  // Index
  const ir = indexProgress.getRow(userId);
  const ipct = ir?.completion_pct || 0;
  const indexBonuses = INDEX_BONUSES.filter((b) => ipct >= b.pct);

  // Ranked
  const rp = users.getPoints(userId);
  const r = rankedTier(rp);
  const rb = skillTree.rankedRpBonuses(userId);

  // Guilde
  let guilde = null;
  if (hubDiscordId) {
    const m = playerGuilds.getMembershipInHub(userId, hubDiscordId);
    if (m) {
      const g = playerGuilds.getGuild(m.guild_id);
      const gm = require('./guildMember').getMemberRow(hubDiscordId, userId);
      guilde = {
        id: g.id,
        name: g.name,
        grade: g.grade || '',
        gradeLabel: gradeLabel(g.grade || ''),
        level: g.guild_level || 1,
        treasury: BigInt(g.treasury || '0'),
        memberGrp: gm?.grp || 0n,
        memberGxp: gm?.gxp || 0n,
        antiSeparation: !!g.anti_separation || (g.grade || '') === 'star',
      };
    }
  }

  // Classes (depuis l'arbre)
  const classes = skillTree.playerClasses(userId);

  return {
    index: { pct: ipct, bonuses: indexBonuses },
    ranked: { rp, ...r, pctBp: rb.pctBp, flatMsg: rb.flatMsg, flatVoc: rb.flatVoc },
    guilde,
    classes,
  };
}

module.exports = { summary, rankedTier, INDEX_BONUSES };
