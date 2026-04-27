const {
  ContainerBuilder,
  MediaGalleryBuilder,
  TextDisplayBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
} = require('discord.js');
const { getBlzAttachment } = require('./blzBackground');

/**
 * @param {import('discord.js').User} target
 * @param {object} u -- row users
 * @param {string} hub
 * @param {string[]} wlines -- warn text lines
 */
function buildPassportTextV2({ target, u, hub, wlines }) {
  const blz = getBlzAttachment();
  const container = new ContainerBuilder();
  if (blz) {
    container.addMediaGalleryComponents(
      new MediaGalleryBuilder().addItems({ media: { url: blz.mediaUrl } }),
    );
  }
  const W = wlines.length ? wlines.map((l) => `• ${l}`).join('\n') : 'Aucun avertissement sur **ce** serveur.';
  const t = new TextDisplayBuilder().setContent(
    [
      `# 🪪 Passeport : **${target.username}**`,
      '**À quoi ça sert ?** Fiche **staff / recrutement** : on centralise ici le **niveau « sécu »** (points, warns), le **score des tests mod** et l’**état de candidature** — le même rôle qu’une **fiche RH** légère pour trancher un accès staff, sans remplacer un vrai outil d’audit.',
      '',
      `**Points de sécurité** : \`${u.secu_points ?? 10}\` · **Tests mod** : \`${u.mod_tests_score ?? 0} / 100\` · **Candidature** : \`${u.candidature_status ?? 'aucune'}\``,
      '',
      '**Aperçu warns (ce serveur)**',
      W.slice(0, 3000),
      '',
      '_Rappel_ : *+2 pts* récup stables / 30 j (affichage `voir`).',
    ].join('\n'),
  );
  container.addTextDisplayComponents(t);
  const cardId = `rb:ps:card:${target.id}`;
  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(cardId)
        .setLabel('Passeport — vue carte (canvas)')
        .setStyle(ButtonStyle.Primary)
        .setEmoji('🪪'),
    ),
  );
  const files = [];
  if (blz) files.push(blz.file);
  return { files, components: [container], flags: MessageFlags.IsComponentsV2 };
}

module.exports = { buildPassportTextV2 };
