const {
  ContainerBuilder,
  MediaGalleryBuilder,
  TextDisplayBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  MessageFlags,
} = require('discord.js');
const users = require('../services/users');
const shop = require('../services/shop');
const { getItem } = require('../reborn/catalog');
const { BOOST_ROW_PRICE, CHEST_CLASSIC, CHEST_CATM, CHEST_CATL, CHEST_CATS, CATM_DAILY_LIMIT } = require('../reborn/constants');
const { getBlzAttachment } = require('./blzBackground');

function fmt(n) {
  return BigInt(n).toLocaleString('fr-FR');
}

/**
 * @returns {Promise<{ files: import('discord.js').AttachmentBuilder[], components: import('discord.js').ContainerBuilder[], flags: number }>}
 */
async function buildBoutiquePayload(uid, username) {
  users.getOrCreate(uid, username);
  shop.ensureShopSlots(uid);
  const slots = shop.getTodaySlots(uid);
  const bal = users.getStars(uid);
  const dayKey = shop.effectiveShopDateKey(uid);
  users.resetCatmIfNewDay(uid, shop.utcDateKey());
  const { count: catmCount } = users.getCatmState(uid);

  const blz = getBlzAttachment();
  const container = new ContainerBuilder();
  if (blz) {
    const gallery = new MediaGalleryBuilder().addItems({ media: { url: blz.mediaUrl } });
    container.addMediaGalleryComponents(gallery);
  }

  const time = new Date().toLocaleString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  const text = new TextDisplayBuilder().setContent(
    [
      '# ⭐ Boutique REBORN',
      'Bienvenue ! Ici tu peux acheter des items du **jour**, des **coffres** et des **boosts 1h** avec tes **Starss**.',
      '➜ **Choisis un article** dans le menu déroulant, puis clique sur **Acheter**.',
      '',
      `Tu possèdes actuellement **${fmt(bal)}** Starss — clé du jour : \`${dayKey}\` · *${time}*`,
      '',
      `**Coffres** — limite **CATM** aujourd’hui : **${catmCount}/${CATM_DAILY_LIMIT}**.',
      `Prix : classique **${fmt(CHEST_CLASSIC)}** · CATM **${fmt(CHEST_CATM)}** · CATL **${fmt(CHEST_CATL)}** · CATS **${fmt(CHEST_CATS)}**`,
      `**Boosts 1h** : **${fmt(BOOST_ROW_PRICE)}** chacun (×2 XP, ×2 GXP, ×2 Starss).`,
    ].join('\n'),
  );
  container.addTextDisplayComponents(text);

  const options = [];
  for (const s of slots) {
    const it = getItem(s.item_id);
    const name = it?.name || s.item_id;
    options.push({
      label: name.slice(0, 100),
      value: `s:${s.slot}`,
      description: `Slot — ${fmt(s.price)} ⭐`.slice(0, 100),
    });
  }
  options.push(
    { label: 'Coffre classique', value: 'c:classic', description: fmt(CHEST_CLASSIC) + ' ⭐' },
    { label: 'CATM', value: 'c:catm', description: `Limite / jour · ${fmt(CHEST_CATM)} ⭐` },
    { label: 'CATL (légendaire)', value: 'c:catl', description: fmt(CHEST_CATL) + ' ⭐' },
    { label: 'CATS (star)', value: 'c:cats', description: fmt(CHEST_CATS) + ' ⭐' },
    { label: '×2 XP (1h)', value: 'b:xp', description: fmt(BOOST_ROW_PRICE) + ' ⭐' },
    { label: '×2 GXP (1h)', value: 'b:gxp', description: fmt(BOOST_ROW_PRICE) + ' ⭐' },
    { label: '×2 Starss (1h)', value: 'b:starss', description: fmt(BOOST_ROW_PRICE) + ' ⭐' },
  );
  if (options.length > 25) options.length = 25;

  const select = new StringSelectMenuBuilder()
    .setCustomId('rb:shop:sel')
    .setPlaceholder('Choisir un article')
    .addOptions(options);
  const row0 = new ActionRowBuilder().addComponents(select);
  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('rb:shop:go')
      .setLabel('Acheter')
      .setStyle(ButtonStyle.Success)
      .setEmoji('💸'),
    new ButtonBuilder()
      .setCustomId('rb:shop:re')
      .setLabel('Rafraîchir')
      .setStyle(ButtonStyle.Secondary)
      .setEmoji('🔄'),
  );
  container.addActionRowComponents(row0, row1);
  return {
    files: blz ? [blz.file] : [],
    components: [container],
    flags: MessageFlags.IsComponentsV2,
  };
}

/**
 * @returns {Promise<{ files: import('discord.js').AttachmentBuilder[], components: import('discord.js').ContainerBuilder[], flags: number }>}
 */
async function buildInventairePayload(uid, username) {
  users.getOrCreate(uid, username);
  const rows = users.getInventory(uid);
  const blz = getBlzAttachment();
  const container = new ContainerBuilder();
  if (blz) {
    container.addMediaGalleryComponents(
      new MediaGalleryBuilder().addItems({ media: { url: blz.mediaUrl } }),
    );
  }
  if (!rows.length) {
    const td = new TextDisplayBuilder().setContent(
      ['# 🎒 Inventaire', "Tu n'as **aucun** objet pour le moment. Passe à la **boutique** pour en acheter !"].join('\n'),
    );
    container.addTextDisplayComponents(td);
  } else {
    const time = new Date().toLocaleString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    const td = new TextDisplayBuilder().setContent(
      [
        '# 🎒 Ton inventaire',
        'Même principe que la boutique : parcours la liste, sélectionne un item pour lire le détail, **rafraîchis** si besoin.',
        `Dernière mise à jour *${time}*`,
      ].join('\n'),
    );
    container.addTextDisplayComponents(td);
    const options = rows.slice(0, 25).map((r) => {
      const it = getItem(r.item_id);
      const name = (it?.name || r.item_id).slice(0, 100);
      return { label: `${name} (×${r.qty})`.slice(0, 100), value: `i:${r.item_id}`, description: (it?.rarity || 'Item').slice(0, 100) };
    });
    const select = new StringSelectMenuBuilder()
      .setCustomId('rb:inv:sel')
      .setPlaceholder('Choisir un item')
      .addOptions(options);
    const row0 = new ActionRowBuilder().addComponents(select);
    const row1 = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('rb:inv:re')
        .setLabel('Rafraîchir')
        .setStyle(ButtonStyle.Secondary)
        .setEmoji('🔄'),
    );
    container.addActionRowComponents(row0, row1);
  }
  return {
    files: blz ? [blz.file] : [],
    components: [container],
    flags: MessageFlags.IsComponentsV2,
  };
}

module.exports = { buildBoutiquePayload, buildInventairePayload };
