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
      '**À quoi ça sert ?** C’est surtout pour **les postulants / futurs modérateurs** : on suit **candidature** + **épreuves** (score tests) + **comportement** (points sécu, warns), comme une **fiche de pré-recrutement** pour la hiérarchie. **Tout le monde** peut avoir des warns, mais *en pratique* c’est le **dossier type staff** (tu n’es pas « en recrutement » juste en ouvrant la commande).',
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
