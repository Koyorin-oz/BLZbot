const { MessageFlags } = require('discord.js');

const EPHEMERAL = MessageFlags.Ephemeral;

function isInteractionGone(err) {
  return err?.code === 10062 || err?.code === 40060;
}

/**
 * deferReply éphémère ; retourne false si l'interaction est déjà consommée (autre processus / timeout).
 * @returns {Promise<boolean>}
 */
async function deferEphemeral(interaction) {
  if (interaction.deferred || interaction.replied) return true;
  try {
    await interaction.deferReply({ flags: EPHEMERAL });
    return true;
  } catch (err) {
    if (isInteractionGone(err)) return false;
    throw err;
  }
}

module.exports = { EPHEMERAL, isInteractionGone, deferEphemeral };
