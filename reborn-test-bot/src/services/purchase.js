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
const indexBonuses = require('./indexBonuses');
const quests = require('./quests');
const trophies = require('./trophies');
const { replyEphemeral } = require('../lib/ephemeral');

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
  if (require('./economyState').isPaused()) {
    await interaction.reply({ content: 'L’économie du serveur est en pause. La boutique est temporairement gelée.' });
    return;
  }
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
    const chest = CHEST_META[sub];
    if (!chest) {
      await interaction.reply({ content: 'Coffre inconnu.' });
      return;
    }
    if (sub === 'catm') {
      const day = shop.utcDateKey();
      users.resetCatmIfNewDay(uid, day);
      const { count } = users.getCatmState(uid);
      if (count >= CATM_DAILY_LIMIT) {
        await interaction.reply({ content: `Limite journalière Coffre meilleur (**${CATM_DAILY_LIMIT}**/jour).` });
        return;
      }
    }
    const pay = discountedPrice(uid, chest.price);
    if (users.getStars(uid) < pay) {
      await interaction.reply({ content: 'Pas assez de starss.' });
      return;
    }
    users.addStars(uid, -pay);
    if (sub === 'catm') users.bumpCatm(uid, shop.utcDateKey());
    users.addInventory(uid, chest.itemId, 1);
    await interaction.reply({
      content: `**${chest.label}** acheté et ajouté à ton inventaire. Ouvre-le depuis \`/inventaire\` (sélectionne-le puis **Utiliser**).`,
    });
  }
}

/** Coffres starss : prix, item d'inventaire et libellé par sous-type. */
const CHEST_META = {
  classic: { price: CHEST_CLASSIC, itemId: 'coffre_classique', label: 'Coffre classique' },
  catm: { price: CHEST_CATM, itemId: 'coffre_catm', label: 'Coffre meilleur' },
  catl: { price: CHEST_CATL, itemId: 'coffre_catl', label: 'Coffre légendaire' },
  cats: { price: CHEST_CATS, itemId: 'coffre_cats', label: 'Coffre starss' },
};

const ITEM_TO_CHEST_SUB = {
  coffre_classique: 'classic',
  coffre_catm: 'catm',
  coffre_catl: 'catl',
  coffre_cats: 'cats',
};

/**
 * Ouvre un coffre déjà possédé (déclenché depuis l'inventaire). Tire le loot,
 * crédite starss/XP/items, suit les quêtes et renvoie un message récap.
 * @param {string} uid
 * @param {'classic'|'catm'|'catl'|'cats'} sub
 * @param {string|null} [guildId]
 * @param {{ guildId?: string|null, client?: import('discord.js').Client, member?: import('discord.js').GuildMember }} [accessCtx]
 * @returns {Promise<{ message: string }>}
 */
async function openChest(uid, sub, guildId = null, accessCtx = null) {
  const def = CHEST_META[sub];
  const label = def ? def.label : 'Coffre';

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
  const lootMultN = indexBonuses.chestLootMultN(uid, Number(skillTree.chestLootMult(uid)));
  const NON_STACKABLE = new Set(['diamant', 'hacker_token']);
  if (lootMultN > 1) {
    loot.stars *= BigInt(lootMultN);
    loot.xp *= lootMultN;
    loot.items = loot.items.map((it) =>
      NON_STACKABLE.has(it.id) ? it : { ...it, qty: it.qty * lootMultN },
    );
    loot.lines.push(`*(×${lootMultN} contenu — arbre + index)*`);
  }
  totalStars += loot.stars;
  totalXp += loot.xp;
  for (const it of loot.items) allItems.push(it);
  lines.push(...loot.lines);
  if (totalStars > 0n) users.addStars(uid, totalStars);
  if (totalXp > 0) users.addXp(uid, totalXp);

  let pendingHackerGrant = false;
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
    if (id === 'hacker_token') {
      pendingHackerGrant = true;
      continue;
    }
    users.addInventory(uid, id, qty);
  }

  if (pendingHackerGrant) {
    const ctx = accessCtx || {};
    const grantCtx = {
      userId: uid,
      guildId: guildId || ctx.guildId || null,
      client: ctx.client || null,
      member: ctx.member || null,
    };
    if (grantCtx.client && grantCtx.guildId) {
      const { grantHackerAccess, formatGrantMessage } = require('./hackerAccess');
      const accessResult = await grantHackerAccess(grantCtx);
      if (accessResult.ok) {
        for (let i = lines.length - 1; i >= 0; i -= 1) {
          if (/salon secret hacker/i.test(lines[i])) lines.splice(i, 1);
        }
        lines.push(formatGrantMessage(accessResult, { guildId: grantCtx.guildId }));
      } else {
        users.addInventory(uid, 'hacker_token', 1);
        lines.push('*(Jeton hacker en inventaire — utilise-le depuis `/inventaire`)*');
      }
    } else {
      users.addInventory(uid, 'hacker_token', 1);
    }
  }

  // Tracking quêtes : ouverture coffre légendaire + gain de starss.
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
  try { trophies.evaluate(uid, guildId || null); } catch { /* ignore */ }

  const starLine = totalStars > 0n ? `+**${totalStars.toLocaleString('fr-FR')}** starss` : '';
  const xpLine = totalXp > 0 ? `+**${totalXp}** XP` : '';
  const head = [starLine, xpLine].filter(Boolean).join(' · ');
  const bodyParts = [];
  if (lines.length) {
    bodyParts.push('', '**Loot :**');
    for (const line of lines) {
      if (line.includes('\n')) {
        for (const sub of line.split('\n')) bodyParts.push(`• ${sub}`);
      } else {
        bodyParts.push(`• ${line}`);
      }
    }
  }
  const tail = followUps.length ? `\n${followUps.join('\n')}` : '';
  return {
    message: `**${label}** ouvert${head ? ` — ${head}` : ''}${bodyParts.join('\n')}${tail}`.slice(0, 1900),
  };
}

module.exports = { handlePurchase, openChest, ITEM_TO_CHEST_SUB };
