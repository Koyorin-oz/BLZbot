const {
  BOOST_ROW_PRICE,
  CHEST_CLASSIC,
  CHEST_CATM,
  CHEST_CATL,
  CHEST_CATS,
  CATM_DAILY_LIMIT,
} = require('../reborn/constants');
const { getItem } = require('../reborn/catalog');
const { rollChest } = require('../reborn/chestLoot');
const users = require('./users');
const shop = require('./shop');
const meta = require('./meta');
const skillTree = require('./skillTree');
const quests = require('./quests');
const trophies = require('./trophies');

function discountedPrice(userId, base) {
  const b = typeof base === 'bigint' ? base : BigInt(base);
  const d = skillTree.shopDiscountFrac(userId);
  const mult = BigInt(Math.round((1 - d) * 10000));
  return (b * mult) / 10000n;
}

const HOUR_MS = 60 * 60 * 1000;

function extendBoost(userId, field) {
  const u = users.getUser(userId);
  const now = Date.now();
  const cur = u[field] || 0;
  const base = Math.max(cur, now);
  users.setBoostField(userId, field, base + HOUR_MS);
}

/**
 * @param {import('discord.js').ButtonInteraction} interaction
 * @param {string[]} parts ['rb','s','0'] or ['rb','c','classic'] ...
 */
async function handlePurchase(interaction, parts) {
  const uid = interaction.user.id;
  users.getOrCreate(uid, interaction.user.username);
  const kind = parts[1];
  const sub = parts[2];

  if (kind === 's') {
    const slot = parseInt(sub, 10);
    if (Number.isNaN(slot) || slot < 0 || slot > 4) {
      await interaction.reply({ content: 'Slot invalide.' });
      return;
    }
    shop.ensureShopSlots(uid);
    const row = shop.getSlot(uid, slot);
    if (!row) {
      await interaction.reply({ content: 'Slot introuvable.' });
      return;
    }
    const item = getItem(row.item_id);
    if (!item) {
      await interaction.reply({ content: 'Item inconnu.' });
      return;
    }
    const price = discountedPrice(uid, BigInt(row.price));
    if (users.getStars(uid) < price) {
      await interaction.reply({ content: `Pas assez de starss (besoin **${price.toLocaleString('fr-FR')}**).` });
      return;
    }
    users.addStars(uid, -price);
    if (item.id === 'diamant') {
      const h = meta.diamondHolder();
      if (h && h !== uid) {
        users.addStars(uid, price);
        await interaction.reply({ content: 'Le diamant est déjà possédé par un autre joueur.' });
        return;
      }
      meta.setDiamondHolder(uid);
    }
    users.addInventory(uid, item.id, 1);
    shop.removeSlot(uid, slot);
    await interaction.reply({
      content: `Achat : **${item.name}** pour **${price.toLocaleString('fr-FR')}** starss.`,
    });
    return;
  }

  if (kind === 'b') {
    const price = discountedPrice(uid, BOOST_ROW_PRICE);
    if (users.getStars(uid) < price) {
      await interaction.reply({ content: 'Pas assez de starss pour ce boost.' });
      return;
    }
    users.addStars(uid, -price);
    if (sub === 'xp') extendBoost(uid, 'xp_boost_ms');
    else if (sub === 'gxp') extendBoost(uid, 'gxp_boost_ms');
    else if (sub === 'starss') extendBoost(uid, 'starss_boost_ms');
    else {
      users.addStars(uid, price);
      await interaction.reply({ content: 'Boost inconnu.' });
      return;
    }
    await interaction.reply({ content: `Boost ×2 (**${sub}**) activé +1h (cumulable).` });
    return;
  }

  if (kind === 'c') {
    let price = 0n;
    let label = '';
    if (sub === 'classic') {
      price = CHEST_CLASSIC;
      label = 'Coffre Au Trésor Classique';
    } else if (sub === 'catm') {
      price = CHEST_CATM;
      label = 'Coffre Au Trésor Mieux (CATM)';
      const day = shop.utcDateKey();
      users.resetCatmIfNewDay(uid, day);
      const { count } = users.getCatmState(uid);
      if (count >= CATM_DAILY_LIMIT) {
        await interaction.reply({ content: `Limite journalière CATM (**${CATM_DAILY_LIMIT}**/jour).` });
        return;
      }
    } else if (sub === 'catl') {
      price = CHEST_CATL;
      label = 'Coffre Au Trésor Légendaire (CATL)';
    } else if (sub === 'cats') {
      price = CHEST_CATS;
      label = 'Coffre Au Trésor Starss (CATS)';
    } else {
      await interaction.reply({ content: 'Coffre inconnu.' });
      return;
    }
    const pay = discountedPrice(uid, price);
    if (users.getStars(uid) < pay) {
      await interaction.reply({ content: 'Pas assez de starss.' });
      return;
    }
    users.addStars(uid, -pay);
    if (sub === 'catm') users.bumpCatm(uid, shop.utcDateKey());

    const lines = [];
    let totalStars = 0n;
    let totalXp = 0;
    const allItems = [];
    let loot = rollChest(sub, meta, uid);
    const maxRollAgain = 2;
    let depth = 0;
    while (loot.rollAgain && depth < maxRollAgain) {
      depth += 1;
      const extra = rollChest(sub, meta, uid);
      loot = {
        lines: [...loot.lines, ...extra.lines],
        stars: loot.stars + extra.stars,
        xp: loot.xp + extra.xp,
        items: [...loot.items, ...extra.items],
        rollAgain: extra.rollAgain,
      };
    }
    // Bonus arbre boutique palier 2 : ×2 contenu coffres (starss + XP + qty items).
    // Les items « uniques » (diamant) et les jetons d'accès (hacker_token) restent en qty 1.
    const lootMult = skillTree.chestLootMult(uid);
    const lootMultN = Number(lootMult);
    const NON_STACKABLE = new Set(['diamant', 'hacker_token']);
    if (lootMult > 1n) {
      loot.stars *= lootMult;
      loot.xp *= lootMultN;
      loot.items = loot.items.map((it) =>
        NON_STACKABLE.has(it.id) ? it : { ...it, qty: it.qty * lootMultN },
      );
      loot.lines.push(`*(×${lootMultN} contenu — arbre boutique)*`);
    }
    totalStars += loot.stars;
    totalXp += loot.xp;
    for (const it of loot.items) allItems.push(it);
    lines.push(...loot.lines);
    if (totalStars > 0n) users.addStars(uid, totalStars);
    if (totalXp > 0) users.addXp(uid, totalXp);
    for (const { id, qty } of allItems) {
      if (id === 'diamant') {
        const h = meta.diamondHolder();
        if (h && h !== uid) {
          users.addStars(uid, 5_000_000n);
          lines.push('*(Diamant déjà pris — 5M starss)*');
          continue;
        }
        meta.setDiamondHolder(uid);
      }
      users.addInventory(uid, id, qty);
    }

    // Tracking quêtes : ouverture CATL + gain de starss.
    const followUps = [];
    if (sub === 'catl') {
      try {
        const r = quests.trackCatlOpen(uid);
        if (r) followUps.push(`🎯 **Quête validée** — ${r.label} (+${r.reward.toLocaleString('fr-FR')} starss)`);
      } catch (e) { console.error('[catl quest]', e?.message || e); }
    }
    if (totalStars > 0n) {
      try {
        const r = quests.trackStarssGain(uid, totalStars);
        if (r) followUps.push(`🎯 **Quête validée** — ${r.label} (+${r.reward.toLocaleString('fr-FR')} starss)`);
      } catch (e) { console.error('[starss quest]', e?.message || e); }
    }
    try { trophies.evaluate(uid, interaction.guildId || null); } catch { /* ignore */ }

    const starLine =
      totalStars > 0n ? `+**${totalStars.toLocaleString('fr-FR')}** starss` : '';
    const xpLine = totalXp > 0 ? `+**${totalXp}** XP` : '';
    const head = [starLine, xpLine].filter(Boolean).join(' · ');
    const body = lines.length ? `\n${lines.map((l) => `• ${l}`).join('\n')}` : '';
    const tail = followUps.length ? `\n${followUps.join('\n')}` : '';
    await interaction.reply({
      content: `**${label}** ouvert${head ? ` — ${head}` : ''}.${body}${tail}`.slice(0, 1900),
    });
  }
}

module.exports = { handlePurchase };
