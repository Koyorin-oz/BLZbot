/**
 * Logique des events Espace / Océan (gdoc REBORN).
 *
 * - Spawn aléatoire : à chaque fenêtre (2 h Espace, 6 h Océan) une chance 1/2.
 *   Quand ça spawn, l'event est actif 30 min et la monnaie se gagne par activité.
 * - Monnaie gagnée uniquement pendant que l'event est actif.
 * - Coffres, conversion en starss, achat de rôle, quêtes → rôles.
 *
 * État global stocké en `meta` (les monnaies sont par joueur, globales).
 */

const db = require('../db');
const meta = require('./meta');
const users = require('./users');
const { EVENTS, getEvent } = require('../reborn/eventConfig');
const { getItem } = require('../reborn/catalog');

const KEY_UNTIL = (k) => `evso_until:${k}`;
const KEY_NEXTROLL = (k) => `evso_nextroll:${k}`;
const KEY_ANNOUNCE = 'evso_announce';

function now() {
  return Date.now();
}

/* ----------------------------------------------------------------- État spawn */

function isActive(eventKey) {
  return Number(meta.get(KEY_UNTIL(eventKey)) || 0) > now();
}

function activeUntil(eventKey) {
  return Number(meta.get(KEY_UNTIL(eventKey)) || 0);
}

function activate(eventKey) {
  const ev = getEvent(eventKey);
  if (!ev) return 0;
  const until = now() + ev.spawn.durationMs;
  meta.set(KEY_UNTIL(eventKey), String(until));
  return until;
}

/** Force le spawn (commande admin / test). */
function forceSpawn(eventKey) {
  const until = activate(eventKey);
  return { ok: until > 0, until };
}

/* ------------------------------------------------------------------- Monnaies */

/**
 * Crédite la monnaie d'event pour une activité, pour chaque event actif.
 * @param {string} userId
 * @param {'msg'|'voc'} kind
 * @param {bigint} units — minutes pour 'voc', sinon 1
 */
function grantActivity(userId, kind, units = 1n) {
  for (const ev of Object.values(EVENTS)) {
    if (!isActive(ev.key)) continue;
    const c = ev.currency;
    const gain = kind === 'msg' ? c.perMsg : c.perVoiceMin * (units > 0n ? units : 0n);
    if (gain > 0n) users.addEventBal(userId, c.field, gain);
  }
}

function balance(userId, eventKey) {
  const ev = getEvent(eventKey);
  if (!ev) return 0n;
  return users.getEventBal(userId, ev.currency.field);
}

/* --------------------------------------------------------------------- Coffres */

function invQty(userId, itemId) {
  const row = users.getInventory(userId).find((r) => r.item_id === itemId);
  return row ? Number(row.qty) : 0;
}

function chestCount(userId, eventKey) {
  const ev = getEvent(eventKey);
  return ev ? invQty(userId, ev.chest.id) : 0;
}

/** Achète un coffre d'event avec la monnaie (l'ajoute à l'inventaire). */
function buyChest(userId, eventKey) {
  const ev = getEvent(eventKey);
  if (!ev) return { ok: false, error: 'Event inconnu.' };
  users.getOrCreate(userId, '');
  if (!users.takeEventBal(userId, ev.currency.field, ev.chest.cost)) {
    return {
      ok: false,
      error: `Il te faut **${ev.chest.cost.toLocaleString('fr-FR')}** ${ev.currency.name} (tu as ${balance(userId, eventKey).toLocaleString('fr-FR')}).`,
    };
  }
  users.addInventory(userId, ev.chest.id, 1);
  return { ok: true, chestName: ev.chest.name, count: chestCount(userId, eventKey) };
}

function pickLoot(loot) {
  const total = loot.reduce((a, [, w]) => a + w, 0);
  let r = Math.random() * total;
  for (const [id, w] of loot) {
    r -= w;
    if (r <= 0) return id;
  }
  return loot[loot.length - 1][0];
}

/** Ouvre un coffre d'event (le consomme) et crédite l'item tiré. */
function openChest(userId, eventKey) {
  const ev = getEvent(eventKey);
  if (!ev) return { ok: false, error: 'Event inconnu.' };
  if (!users.takeInventory(userId, ev.chest.id, 1)) {
    return { ok: false, error: `Tu n'as aucun **${ev.chest.name}**.` };
  }
  const itemId = pickLoot(ev.chest.loot);
  users.addInventory(userId, itemId, 1);
  const def = getItem(itemId);
  return { ok: true, itemId, itemName: def?.name || itemId, rarity: def?.rarity || '' };
}

/* ----------------------------------------------------------------- Conversion */

/** Convertit toute la monnaie d'event en starss. */
function convertAll(userId, eventKey) {
  const ev = getEvent(eventKey);
  if (!ev) return { ok: false, error: 'Event inconnu.' };
  const bal = balance(userId, eventKey);
  if (bal <= 0n) return { ok: false, error: `Tu n'as aucune ${ev.currency.name} à convertir.` };
  users.takeEventBal(userId, ev.currency.field, bal);
  const starss = bal * ev.currency.starssPerUnit;
  users.addStars(userId, starss);
  return { ok: true, converted: bal, starss };
}

/* ------------------------------------------------------------------ Quêtes/rôles */

function isQuestClaimed(userId, questKey) {
  return !!db
    .prepare('SELECT 1 FROM event_quests_claimed WHERE user_id = ? AND quest_key = ?')
    .get(userId, questKey);
}

function markQuestClaimed(userId, questKey) {
  db.prepare(
    'INSERT OR IGNORE INTO event_quests_claimed (user_id, quest_key, claimed_ms) VALUES (?, ?, ?)',
  ).run(userId, questKey, now());
}

/** Condition remplie pour une quête (hors buyRole, géré au moment de l'achat). */
function questConditionMet(userId, quest) {
  if (quest.type === 'buyRole') return isQuestClaimed(userId, quest.key);
  if (quest.type === 'haveAll') {
    return (quest.need || []).every(([id, n]) => invQty(userId, id) >= n);
  }
  if (quest.type === 'haveAny') {
    return (quest.need || []).some(([id, n]) => invQty(userId, id) >= n);
  }
  return false;
}

/** Achète le rôle d'entrée de l'event (quête 1) avec la monnaie. */
function buyRole(userId, eventKey) {
  const ev = getEvent(eventKey);
  if (!ev) return { ok: false, error: 'Event inconnu.' };
  const quest = ev.quests.find((q) => q.type === 'buyRole');
  if (!quest) return { ok: false, error: 'Pas de rôle achetable.' };
  if (isQuestClaimed(userId, quest.key)) {
    return { ok: false, error: `Tu as déjà le rôle **${ev.roles[quest.roleKey]}**.` };
  }
  users.getOrCreate(userId, '');
  if (!users.takeEventBal(userId, ev.currency.field, ev.entryRole.cost)) {
    return {
      ok: false,
      error: `Il te faut **${ev.entryRole.cost.toLocaleString('fr-FR')}** ${ev.currency.name} (tu as ${balance(userId, eventKey).toLocaleString('fr-FR')}).`,
    };
  }
  markQuestClaimed(userId, quest.key);
  return { ok: true, roleKey: quest.roleKey, roleLabel: ev.roles[quest.roleKey] };
}

/**
 * Réclame toutes les quêtes (haveAll/haveAny) dont la condition est remplie.
 * @returns {{ newly: { eventKey: string, label: string, roleLabel: string }[] }}
 */
function checkAndClaim(userId) {
  const newly = [];
  for (const ev of Object.values(EVENTS)) {
    for (const quest of ev.quests) {
      if (quest.type === 'buyRole') continue;
      if (isQuestClaimed(userId, quest.key)) continue;
      if (!questConditionMet(userId, quest)) continue;
      markQuestClaimed(userId, quest.key);
      newly.push({ eventKey: ev.key, label: quest.label, roleLabel: ev.roles[quest.roleKey] });
    }
  }
  return { newly };
}

/** RoleKeys de toutes les quêtes réclamées (pour la sync Discord). */
function claimedRoleKeys(userId) {
  const out = [];
  for (const ev of Object.values(EVENTS)) {
    for (const quest of ev.quests) {
      if (isQuestClaimed(userId, quest.key)) out.push(quest.roleKey);
    }
  }
  return out;
}

/** Statut des quêtes d'un event (pour l'affichage). */
function questStatuses(userId, eventKey) {
  const ev = getEvent(eventKey);
  if (!ev) return [];
  return ev.quests.map((q) => ({
    label: q.label,
    rarity: q.rarity,
    roleLabel: ev.roles[q.roleKey],
    claimed: isQuestClaimed(userId, q.key),
    met: q.type === 'buyRole' ? isQuestClaimed(userId, q.key) : questConditionMet(userId, q),
  }));
}

/** Profil event : monnaie, coffres, rôles obtenus. */
function profile(userId, eventKey) {
  const ev = getEvent(eventKey);
  if (!ev) return null;
  const roles = Object.entries(ev.roles)
    .filter(([rk]) => {
      const q = ev.quests.find((x) => x.roleKey === rk);
      return q && isQuestClaimed(userId, q.key);
    })
    .map(([, label]) => label);
  return {
    balance: balance(userId, eventKey),
    chestCount: chestCount(userId, eventKey),
    roles,
    active: isActive(eventKey),
    activeUntil: activeUntil(eventKey),
  };
}

/** Index event : items possédés / manquants. */
function indexStatus(userId, eventKey) {
  const ev = getEvent(eventKey);
  if (!ev) return [];
  return ev.indexItems.map((id) => {
    const def = getItem(id);
    const qty = invQty(userId, id);
    return { id, name: def?.name || id, rarity: def?.rarity || '', qty, owned: qty > 0 };
  });
}

/* ------------------------------------------------------------------- Annonce */

function setAnnounce(guildId, channelId) {
  meta.set(KEY_ANNOUNCE, JSON.stringify({ guildId, channelId }));
}

function getAnnounce() {
  try {
    const o = JSON.parse(meta.get(KEY_ANNOUNCE) || 'null');
    return o && o.channelId ? o : null;
  } catch {
    return null;
  }
}

/* ----------------------------------------------------------------- Scheduler */

let _announcing = false;

/**
 * Tick périodique : roll de spawn pour chaque event quand la fenêtre est due.
 * Annonce le spawn dans le salon configuré (best-effort).
 * @param {import('discord.js').Client} client
 */
async function tick(client) {
  const t = now();
  for (const ev of Object.values(EVENTS)) {
    const nextRollKey = KEY_NEXTROLL(ev.key);
    let nextRoll = Number(meta.get(nextRollKey) || 0);
    if (nextRoll === 0) {
      // Première initialisation : prochaine fenêtre dans intervalMs.
      meta.set(nextRollKey, String(t + ev.spawn.intervalMs));
      continue;
    }
    if (t < nextRoll) continue;
    // Fenêtre due : on programme la suivante puis on tente le spawn.
    meta.set(nextRollKey, String(t + ev.spawn.intervalMs));
    if (isActive(ev.key)) continue; // déjà actif, pas de double spawn
    if (Math.random() < ev.spawn.chance) {
      const until = activate(ev.key);
      await announceSpawn(client, ev, until).catch(() => {});
    }
  }
}

async function announceSpawn(client, ev, until) {
  if (_announcing) return;
  const cfg = getAnnounce();
  if (!cfg || !client) return;
  try {
    _announcing = true;
    const channel = await client.channels.fetch(cfg.channelId).catch(() => null);
    if (!channel || !channel.isTextBased?.()) return;
    const { EmbedBuilder } = require('discord.js');
    const embed = new EmbedBuilder()
      .setTitle(`${ev.emoji} Event ${ev.name} — c'est parti !`)
      .setColor(ev.color)
      .setDescription(
        [
          `L'event **${ev.name}** vient d'apparaître pour **30 minutes**.`,
          `Gagne des **${ev.currency.name}** (${ev.currency.perMsg}/message, ${ev.currency.perVoiceMin}/min vocal) en restant actif.`,
          `Ouvre \`/${ev.command}\` pour le profil, l'index et la boutique.`,
          `Fin <t:${Math.floor(until / 1000)}:R>.`,
        ].join('\n'),
      );
    await channel.send({ embeds: [embed] });
  } finally {
    _announcing = false;
  }
}

module.exports = {
  isActive,
  activeUntil,
  forceSpawn,
  grantActivity,
  balance,
  chestCount,
  buyChest,
  openChest,
  convertAll,
  buyRole,
  checkAndClaim,
  claimedRoleKeys,
  questStatuses,
  profile,
  indexStatus,
  setAnnounce,
  getAnnounce,
  tick,
};
