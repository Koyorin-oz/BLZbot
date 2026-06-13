/**
 * Panneau partagé des events Espace / Océan (3 onglets : profil, index, boutique).
 * Utilisé par `/space`, `/ocean` et le routeur de boutons `evso:*`.
 */

const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require('discord.js');
const eventsSO = require('../services/eventsSO');
const { getEvent } = require('../reborn/eventConfig');

function fmt(n) {
  return (typeof n === 'bigint' ? n : BigInt(n || 0)).toLocaleString('fr-FR');
}

function tabRow(eventKey, current) {
  const mk = (tab, label) =>
    new ButtonBuilder()
      .setCustomId(`evso:${eventKey}:tab:${tab}`)
      .setLabel(label)
      .setStyle(current === tab ? ButtonStyle.Primary : ButtonStyle.Secondary);
  return new ActionRowBuilder().addComponents(
    mk('profil', 'Profil'),
    mk('index', 'Index'),
    mk('shop', 'Boutique'),
  );
}

function shopActionRow(eventKey, ev, userId) {
  const hasChest = eventsSO.chestCount(userId, eventKey) > 0;
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`evso:${eventKey}:act:buychest`)
      .setLabel(`Acheter ${ev.chest.name} (${fmt(ev.chest.cost)})`)
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`evso:${eventKey}:act:openchest`)
      .setLabel('Ouvrir un coffre')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(!hasChest),
    new ButtonBuilder()
      .setCustomId(`evso:${eventKey}:act:convert`)
      .setLabel('Convertir en starss')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`evso:${eventKey}:act:buyrole`)
      .setLabel(`Rôle (${fmt(ev.entryRole.cost)})`)
      .setStyle(ButtonStyle.Secondary),
  );
}

/**
 * @param {'space'|'ocean'} eventKey
 * @param {string} userId
 * @param {'profil'|'index'|'shop'} tab
 * @param {string} [note] — message d'action à afficher en haut
 */
function buildEventPanel(eventKey, userId, tab = 'profil', note = '') {
  const ev = getEvent(eventKey);
  if (!ev) return { embeds: [], components: [] };
  const cur = ev.currency;
  const prof = eventsSO.profile(userId, eventKey);
  const embed = new EmbedBuilder().setColor(ev.color);
  const statusLine = prof.active
    ? `**Event actif** — fin <t:${Math.floor(prof.activeUntil / 1000)}:R>`
    : 'Event **inactif** (tu peux quand même gérer tes gains et coffres).';

  if (tab === 'index') {
    const items = eventsSO.indexStatus(userId, eventKey);
    const owned = items.filter((i) => i.owned).length;
    embed
      .setTitle(`${ev.emoji} ${ev.name} — Index`)
      .setDescription(
        `${owned}/${items.length} items découverts.\n\n` +
          items
            .map((i) => `${i.owned ? '✅' : '⬜'} **${i.name}** *(${i.rarity})*${i.qty > 1 ? ` ×${i.qty}` : ''}`)
            .join('\n'),
      );
    const quests = eventsSO.questStatuses(userId, eventKey);
    embed.addFields({
      name: 'Quêtes',
      value: quests
        .map((q) => `${q.claimed ? '✅' : q.met ? '◆' : '○'} **${q.roleLabel}** — ${q.label} *(${q.rarity})*`)
        .join('\n'),
    });
  } else if (tab === 'shop') {
    embed
      .setTitle(`${ev.emoji} ${ev.name} — Boutique`)
      .setDescription(
        [
          `Solde : **${fmt(prof.balance)}** ${cur.name}.`,
          '',
          `• **${ev.chest.name}** : ${fmt(ev.chest.cost)} ${cur.name}.`,
          `• Conversion : **1 ${cur.short} = ${fmt(cur.starssPerUnit)} starss**.`,
          `• Rôle « ${ev.roles[ev.entryRole.key]} » : ${fmt(ev.entryRole.cost)} ${cur.name}.`,
          '',
          `Coffres en stock : **${prof.chestCount}**.`,
        ].join('\n'),
      );
  } else {
    embed
      .setTitle(`${ev.emoji} ${ev.name} — Profil`)
      .setDescription(
        [
          statusLine,
          '',
          `**${cur.name}** : **${fmt(prof.balance)}**`,
          `**${ev.chest.name}** : **${prof.chestCount}**`,
          `**Rôles obtenus** : ${prof.roles.length ? prof.roles.join(', ') : '—'}`,
        ].join('\n'),
      )
      .setFooter({ text: `Gains : ${cur.perMsg}/message · ${cur.perVoiceMin}/min vocal (event actif)` });
  }

  if (note) {
    embed.setDescription(`> ${note}\n\n${embed.data.description}`);
  }

  const components = [tabRow(eventKey, tab)];
  if (tab === 'shop') components.push(shopActionRow(eventKey, ev, userId));
  return { embeds: [embed], components };
}

module.exports = { buildEventPanel };
