/**
 * Classement guildes (par hub Discord) + règle « anti-séparation haut de ladder ».
 * Une guilde compte parmi les 3 meilleures GRP totaux (somme des membres) sur
 * le hub → elle est protégée contre la séparation pendant la saison en cours.
 */

const db = require('../db');
const pg = require('./playerGuilds');

function B(s) {
  try {
    return BigInt(s || '0');
  } catch {
    return 0n;
  }
}

/**
 * Renvoie la liste des guildes du hub triées par GRP total décroissant.
 * Forme : `[{ id, name, leader_id, members, grade, treasury, gxp, totalGrp }]`.
 */
function ladderForHub(hubDiscordId) {
  const guilds = db
    .prepare(
      'SELECT id, name, icon_url, leader_id, member_cap, guild_level, grade, treasury, gxp FROM player_guilds WHERE hub_discord_id = ? ORDER BY created_ms DESC',
    )
    .all(hubDiscordId);
  const grpStmt = db.prepare(
    "SELECT COALESCE(SUM(CAST(grp AS INTEGER)),0) AS total FROM guild_member_gxp WHERE guild_id = ?",
  );
  const memStmt = db.prepare('SELECT COUNT(*) AS c FROM player_guild_members WHERE guild_id = ?');
  const out = [];
  for (const g of guilds) {
    const totalGrp = B(grpStmt.get(g.id)?.total ?? 0);
    const members = memStmt.get(g.id)?.c ?? 0;
    out.push({
      ...g,
      members,
      treasury: B(g.treasury),
      gxp: B(g.gxp),
      totalGrp,
    });
  }
  out.sort((a, b) => (b.totalGrp > a.totalGrp ? 1 : b.totalGrp < a.totalGrp ? -1 : 0));
  return out;
}

/**
 * `top` premières guildes du hub par GRP total (n=3 par défaut).
 * Utilisé pour la protection « anti-séparation haut de ladder ».
 */
function topGuilds(hubDiscordId, n = 3) {
  return ladderForHub(hubDiscordId).slice(0, Math.max(1, n));
}

/**
 * Renvoie `true` si la guilde fait partie du top `n` GRP du hub
 * (ce qui active la protection anti-séparation côté ladder).
 */
function isTopLadderProtected(guildId, hubDiscordId, n = 3) {
  const top = topGuilds(hubDiscordId, n);
  return top.some((g) => g.id === guildId);
}

/**
 * Vérifie si une guilde est anti-séparation, soit par grade Star, soit par
 * la règle de top ladder. Renvoie `{ protected, reason }`.
 */
function antiSepStatus(guildId, hubDiscordId) {
  const g = pg.getGuild(guildId);
  if (!g) return { protected: false, reason: '' };
  if (g.anti_separation || (g.grade || '') === 'star') {
    return { protected: true, reason: 'Grade Star (anti-séparation permanente).' };
  }
  if (isTopLadderProtected(guildId, hubDiscordId, 3)) {
    return { protected: true, reason: 'Top 3 GRP du serveur (protection ladder).' };
  }
  return { protected: false, reason: '' };
}

/**
 * Guildes du hub triées par somme d’une colonne `users` sur les membres
 * (starss = CAST stars, rp = points ranked, niveau = xp_total).
 * Renvoie `[{ id, name, leader_id, guild_level, grade, members, score }]`.
 */
function memberAggLadderForHub(hubDiscordId, metric) {
  const col =
    metric === 'starss'
      ? "COALESCE(SUM(CAST(COALESCE(u.stars, '0') AS INTEGER)), 0)"
      : metric === 'rp'
        ? "COALESCE(SUM(CAST(COALESCE(u.points, '0') AS INTEGER)), 0)"
        : metric === 'niveau'
          ? 'COALESCE(SUM(COALESCE(u.xp_total, 0)), 0)'
          : '0';
  const rows = db
    .prepare(
      `SELECT g.id, g.name, g.leader_id, g.guild_level, g.grade,
              COUNT(pgm.user_id) AS members,
              ${col} AS score
       FROM player_guilds g
       INNER JOIN player_guild_members pgm ON pgm.guild_id = g.id
       INNER JOIN users u ON u.id = pgm.user_id
       WHERE g.hub_discord_id = ?
       GROUP BY g.id
       HAVING members >= 1
       ORDER BY score DESC`,
    )
    .all(hubDiscordId);
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    leader_id: r.leader_id,
    guild_level: r.guild_level,
    grade: r.grade,
    members: r.members,
    score: BigInt(r.score ?? 0),
  }));
}

module.exports = {
  ladderForHub,
  topGuilds,
  isTopLadderProtected,
  antiSepStatus,
  memberAggLadderForHub,
};
