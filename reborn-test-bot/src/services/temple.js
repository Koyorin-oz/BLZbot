const db = require('../db');
const users = require('./users');
const indexProgress = require('./indexProgress');
const pg = require('./playerGuilds');
const gm = require('./guildMember');
const skillTree = require('./skillTree');
const meta = require('./meta');

const STAR_RP = 100_000n;
const STAR_GRP = 200_000n;

/**
 * 11 sources « clés » qui composent le Temple (doc REBORN).
 * Le set persistant (`temple_sources_json`) garde la trace de toutes
 * les clés déjà déclenchées (events / phases) — la valeur courante recompose ce
 * qui peut être recalculé en direct (classes, max_rp, diamond, index, grade…).
 */
const SOURCE_DEFS = [
  { id: 'classes', name: 'Maître des classes', desc: '5/5 sur **les 5 branches** d’arbre.', kind: 'live' },
  { id: 'max_rp', name: 'Étoile pourpre', desc: `Atteindre **${Number(STAR_RP).toLocaleString('fr-FR')}** points RP.`, kind: 'live' },
  { id: 'diamond', name: 'Sceau du Diamant', desc: 'Détenir le **Diamant** unique du serveur.', kind: 'live' },
  { id: 'index_full', name: 'Codex complet', desc: 'Index items à **100 %**.', kind: 'live' },
  { id: 'guild_grade_star', name: 'Bannière étoile', desc: 'Membre d’une guilde au grade **Star**.', kind: 'live' },
  { id: 'grp_star', name: 'GRP star', desc: `Atteindre **${Number(STAR_GRP).toLocaleString('fr-FR')}** GRP.`, kind: 'live' },
  { id: 'level_99', name: 'Sage du Centième', desc: 'Atteindre le **niveau 99**.', kind: 'live' },
  { id: 'voice_master', name: 'Voix sacrée', desc: 'Cumuler **600 minutes** de vocal.', kind: 'live' },
  { id: 'separation_won', name: 'Vainqueur séparation', desc: 'Remporter une **séparation**.', kind: 'persisted' },
  { id: 'hacker', name: 'Sceau Hacker', desc: 'Posséder un **jeton d’accès Hacker**.', kind: 'live' },
  { id: 'event_champion', name: 'Champion d’event', desc: 'Finir 1ᵉʳ d’un **événement** du serveur.', kind: 'persisted' },
];

function parseSources(json) {
  try {
    const a = JSON.parse(json || '[]');
    return Array.isArray(a) ? a.map(String) : [];
  } catch {
    return [];
  }
}

/**
 * Recalcule les points « temple » + écrit la liste persistante des clés.
 * @param {string} userId
 * @param {string | null} hubDiscordId
 */
function sync(userId, hubDiscordId) {
  users.getOrCreate(userId, '');
  const u = users.getUser(userId);
  const satisfied = new Set();

  const tree = skillTree.getTree(userId);
  let allClass = true;
  for (const b of skillTree.BRANCHES) {
    if ((tree[b] || 0) < 5) allClass = false;
  }
  if (allClass) satisfied.add('classes');

  if (users.getPoints(userId) >= STAR_RP) satisfied.add('max_rp');

  if (meta.diamondHolder() === userId || users.getInventory(userId).some((r) => r.item_id === 'diamant' && r.qty > 0)) {
    satisfied.add('diamond');
  }

  const ir = indexProgress.getRow(userId);
  if ((ir?.completion_pct || 0) >= 100) satisfied.add('index_full');

  if ((u?.level || 1) >= 99) satisfied.add('level_99');
  if ((u?.voice_minutes_total || 0) >= 600) satisfied.add('voice_master');

  const hackerInv = users.getInventory(userId).some((r) => r.item_id === 'hacker_token' && r.qty > 0);
  if (hackerInv) satisfied.add('hacker');

  if (hubDiscordId) {
    const m = pg.getMembershipInHub(userId, hubDiscordId);
    if (m) {
      const g = pg.getGuild(m.guild_id);
      if (g && (g.grade || '') === 'star') satisfied.add('guild_grade_star');
      const { grp } = gm.getMemberRow(hubDiscordId, userId);
      if (grp >= STAR_GRP) satisfied.add('grp_star');
    }
  }

  const prev = parseSources(users.getUser(userId).temple_sources_json);
  const merged = new Set([...prev, ...satisfied]);
  const pts = merged.size;
  db.prepare('UPDATE users SET temple_points = ?, temple_sources_json = ? WHERE id = ?').run(
    pts,
    JSON.stringify([...merged].sort()),
    userId,
  );
  return { points: pts, keys: [...merged] };
}

/** Marque définitivement une clé persistante (séparations gagnées, events, etc.). */
function markKey(userId, key) {
  users.getOrCreate(userId, '');
  const u = users.getUser(userId);
  const cur = new Set(parseSources(u.temple_sources_json));
  if (cur.has(key)) return false;
  cur.add(key);
  const pts = cur.size;
  db.prepare('UPDATE users SET temple_points = ?, temple_sources_json = ? WHERE id = ?').run(
    pts,
    JSON.stringify([...cur].sort()),
    userId,
  );
  return true;
}

/** Renvoie l'état "carte" du temple : sources + points + verrou. */
function statusFor(userId, hubDiscordId) {
  const { points, keys } = sync(userId, hubDiscordId);
  const u = users.getUser(userId);
  const unlocked = !!u?.temple_unlocked;
  return {
    points,
    keys: new Set(keys),
    total: SOURCE_DEFS.length,
    unlocked,
    sources: SOURCE_DEFS,
  };
}

/**
 * Construit les lignes affichables (avec masquage tant que le Temple est verrouillé) :
 *  - **avant unlock** : on affiche **l'icône clé** mais pas le nom détaillé.
 *  - **après unlock** : on dévoile le nom + descriptif.
 */
function publicLines(userId, hubDiscordId) {
  const st = statusFor(userId, hubDiscordId);
  const lines = [];
  for (const s of SOURCE_DEFS) {
    const got = st.keys.has(s.id);
    const icon = got ? '🟢' : '🔒';
    if (st.unlocked) {
      lines.push(`${icon} **${s.name}** — ${got ? 'obtenu' : '—'}`);
    } else {
      lines.push(got ? `${icon} **${s.name}** — *clé acquise*` : `${icon} *Clé inconnue*`);
    }
  }
  return { lines, status: st };
}

/**
 * Classement Temple sur le hub :
 *   1) Roi du Temple : meilleur `temple_points` (≥ 6 clés). En cas d'égalité,
 *      celui qui a déverrouillé le Temple en premier (`temple_unlocked = 1`).
 *   2) Légende : top 5 suivants (≥ 3 clés).
 * Renvoie `{ kings: [...], legends: [...] }`.
 */
function classement(limit = 10) {
  const rows = db
    .prepare(
      'SELECT id, username, temple_points, temple_unlocked FROM users WHERE COALESCE(temple_points,0) > 0 ORDER BY temple_points DESC, temple_unlocked DESC LIMIT ?',
    )
    .all(Math.max(1, Math.min(50, limit)));
  const kings = rows.filter((r) => (r.temple_points || 0) >= 6);
  const legends = rows.filter((r) => (r.temple_points || 0) >= 3 && (r.temple_points || 0) < 6);
  return { kings, legends, all: rows };
}

module.exports = { sync, parseSources, statusFor, publicLines, markKey, classement, SOURCE_DEFS, STAR_RP, STAR_GRP };
