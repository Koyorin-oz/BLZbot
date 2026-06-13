/**
 * Matrice combinée Index / Ranked / Guilde.
 *
 * Les **paliers d'index** (10 % → 100 %) débloquent des bonus permanents.
 * Le **rang ranked** (RP) débloque ses propres modifs (gain RP).
 * Le **grade de guilde** (Bronze → Star) ouvre les options de séparation
 * (Star = anti-séparation) et débloque l'icône.
 *
 * Les bonus index sont **appliqués en jeu** via `indexBonuses.js` (earn, XP, coffres).
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
 * Bonus ranked pour le RP courant (lecture rapide).
 * Le rang affiché suit l'échelle complète du gdoc (`rankedRoles`).
 * Les « perks » décrivent le gain RP et la décrépitude de la bande de RP.
 */
function rankedTier(rp) {
  const rankedRoles = require('./rankedRoles');
  const r = typeof rp === 'bigint' ? rp : BigInt(rp || 0);
  const rank = rankedRoles.rankForRp(r);
  // Bande de RP -> gain message/vocal et décrépitude journalière (cf. rankedRp.js).
  let perks;
  if (r >= 100_000n) perks = ['Gain 2/2', 'Décrépitude 5k/j'];
  else if (r >= 90_000n) perks = ['Gain 3/4', 'Décrépitude 4k/j'];
  else if (r >= 80_000n) perks = ['Gain 4/7', 'Décrépitude 3k/j'];
  else if (r >= 70_000n) perks = ['Gain 5/10', 'Décrépitude 2k/j'];
  else if (r >= 60_000n) perks = ['Gain 6/15', 'Décrépitude 1k/j'];
  else if (r >= 50_000n) perks = ['Gain 8/20', 'Décrépitude 500/j'];
  else perks = ['Gain 10/30', 'Pas de décrépitude'];
  return { tier: rank.key, label: rank.label, perks };
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
