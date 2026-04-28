/**
 * REST Discord (Bot) — attribuer / retirer un rôle directement (sans collection cache).
 */

async function addGuildMemberRole(botToken, guildId, userId, roleId) {
  const url = `https://discord.com/api/v10/guilds/${guildId}/members/${userId}/roles/${roleId}`;
  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      Authorization: `Bot ${botToken}`,
    },
  });
  if (!res.ok && res.status !== 204) {
    const text = await res.text().catch(() => '');
    throw new Error(`Discord API ${res.status}: ${text || res.statusText}`);
  }
}

async function removeGuildMemberRole(botToken, guildId, userId, roleId) {
  const url = `https://discord.com/api/v10/guilds/${guildId}/members/${userId}/roles/${roleId}`;
  const res = await fetch(url, {
    method: 'DELETE',
    headers: {
      Authorization: `Bot ${botToken}`,
    },
  });
  if (!res.ok && res.status !== 204) {
    const text = await res.text().catch(() => '');
    throw new Error(`Discord API ${res.status}: ${text || res.statusText}`);
  }
}

module.exports = { addGuildMemberRole, removeGuildMemberRole };
