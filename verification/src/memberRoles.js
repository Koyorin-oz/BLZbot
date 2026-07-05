'use strict';

const { addGuildMemberRole, removeGuildMemberRole } = require('./discordApi');

/**
 * Rôle retiré quand la vérification réussit (compte suspect / non vérifié).
 * Même ID que l’anti-raid par défaut — surcharge via VERIFICATION_SUSPECT_ROLE_ID ou ANTI_RAID_ROLE_ID.
 */
function resolveSuspectRoleId() {
  const raw = String(
    process.env.VERIFICATION_SUSPECT_ROLE_ID ||
      process.env.ANTI_RAID_ROLE_ID ||
      '1400457540386422916',
  ).trim();
  return /^\d{17,22}$/.test(raw) ? raw : null;
}

/**
 * Attribue le rôle vérifié puis retire le rôle suspect si le membre l’a encore.
 */
async function grantVerifiedRole(botToken, guildId, userId, verifiedRoleId) {
  await addGuildMemberRole(botToken, guildId, userId, verifiedRoleId);
  const suspectId = resolveSuspectRoleId();
  if (!suspectId || suspectId === String(verifiedRoleId)) return;
  try {
    await removeGuildMemberRole(botToken, guildId, userId, suspectId);
  } catch (e) {
    console.warn(
      `[verif] Retrait rôle suspect (${suspectId}) pour ${userId} sur ${guildId} :`,
      e.message || e,
    );
  }
}

module.exports = { grantVerifiedRole, resolveSuspectRoleId };
