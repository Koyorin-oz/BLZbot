const base = require('../config');

let applicationOwnerIds = new Set();

/**
 * @param {import('discord.js').Client} client
 */
async function refreshApplicationOwners(client) {
  applicationOwnerIds = new Set();
  try {
    const app = await client.application.fetch();
    if (app.owner?.id) applicationOwnerIds.add(app.owner.id);
    if (app.team?.ownerUserId) applicationOwnerIds.add(app.team.ownerUserId);
    if (app.team?.members) {
      for (const m of app.team.members.values()) {
        if (m.permissions?.has?.('Administrator')) applicationOwnerIds.add(m.id);
      }
    }
  } catch {
    /* ignore */
  }
}

function isOwner(userId) {
  if (base.ownerIds.has(userId)) return true;
  if (applicationOwnerIds.has(userId)) return true;
  return false;
}

module.exports = { refreshApplicationOwners, isOwner };
