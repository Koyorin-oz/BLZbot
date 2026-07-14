const { MessageFlags } = require('discord.js');

/** Réponses visibles uniquement par l'auteur de la commande / du clic. */
const EPHEMERAL = MessageFlags.Ephemeral;

function withEphemeral(opts = {}) {
  const flags =
    opts.flags !== undefined ? opts.flags | MessageFlags.Ephemeral : MessageFlags.Ephemeral;
  return { ...opts, flags };
}

function v2Ephemeral() {
  return MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral;
}

function replyEphemeral(interaction, opts) {
  return interaction.reply(withEphemeral(opts));
}

function followUpEphemeral(interaction, opts) {
  return interaction.followUp(withEphemeral(opts));
}

function deferReplyEphemeral(interaction, opts = {}) {
  return interaction.deferReply(withEphemeral(opts));
}

function editReplyEphemeral(interaction, opts = {}) {
  return interaction.editReply(withEphemeral(opts));
}

module.exports = {
  EPHEMERAL,
  withEphemeral,
  v2Ephemeral,
  replyEphemeral,
  followUpEphemeral,
  deferReplyEphemeral,
  editReplyEphemeral,
};
