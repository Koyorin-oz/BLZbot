/**
 * Accès salon secret hacker : rôle Discord + permission sur le salon configuré.
 */
const { PermissionFlagsBits } = require('discord.js');
const cfg = require('../config');
const meta = require('./meta');

const META_KEY_PREFIX = 'hacker_access_';

function hasHackerSalonAccess(userId, member) {
  if (meta.get(`${META_KEY_PREFIX}${userId}`) === '1') return true;
  if (cfg.hackerRoleId && member?.roles?.cache?.has(cfg.hackerRoleId)) return true;
  return false;
}

/**
 * @param {{ userId: string, guildId?: string|null, client?: import('discord.js').Client, member?: import('discord.js').GuildMember }} ctx
 */
async function grantHackerAccess(ctx) {
  const channelId = cfg.hackerChannelId;
  const roleId = cfg.hackerRoleId;
  const { userId, guildId, client, member } = ctx;

  if (!guildId || !client) {
    return { ok: false, error: 'Utilise le **jeton hacker** sur le serveur (pas en DM).' };
  }
  if (!channelId && !roleId) {
    return { ok: false, error: 'Salon hacker non configuré côté bot — contacte le staff.' };
  }

  let m = member;
  if (!m?.roles) {
    const guild = await client.guilds.fetch(guildId).catch(() => null);
    if (!guild) return { ok: false, error: 'Serveur introuvable.' };
    m = await guild.members.fetch(userId).catch(() => null);
  }
  if (!m) return { ok: false, error: 'Impossible de te trouver sur le serveur.' };

  let roleGranted = false;
  let alreadyHadRole = false;
  if (roleId) {
    if (m.roles.cache.has(roleId)) {
      alreadyHadRole = true;
    } else {
      try {
        await m.roles.add(roleId, 'Accès salon secret hacker');
        roleGranted = true;
      } catch (e) {
        console.error('[hackerAccess] role add', e?.message || e);
      }
    }
  }

  let channelGranted = false;
  if (channelId) {
    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (channel?.permissionOverwrites) {
      const existing = channel.permissionOverwrites.cache.get(m.id);
      const canView = existing?.allow?.has(PermissionFlagsBits.ViewChannel);
      if (!canView) {
        try {
          await channel.permissionOverwrites.edit(
            m.id,
            {
              ViewChannel: true,
              SendMessages: true,
              ReadMessageHistory: true,
            },
            { reason: 'Accès salon secret hacker (jeton)' },
          );
          channelGranted = true;
        } catch (e) {
          console.error('[hackerAccess] channel overwrite', e?.message || e);
        }
      }
    }
  }

  meta.set(`${META_KEY_PREFIX}${userId}`, '1');

  const accessViaRole = roleGranted || alreadyHadRole;
  const accessViaChannel = channelGranted;
  if (!accessViaRole && !accessViaChannel) {
    return {
      ok: false,
      error:
        'Impossible d’ouvrir le salon hacker — vérifie que le bot peut gérer les permissions du salon et le rôle Hacker.',
    };
  }

  return {
    ok: true,
    roleGranted,
    alreadyHadRole,
    channelGranted,
    channelId,
  };
}

function formatGrantMessage(result) {
  const lines = [];
  const ch = result.channelId;
  if (result.roleGranted) {
    lines.push('💻 **Rôle Hacker** attribué !');
  } else if (result.alreadyHadRole) {
    lines.push('Tu avais déjà le rôle **Hacker**.');
  }
  if (ch) {
    lines.push(`🔓 **Salon secret hacker** débloqué — <#${ch}>`);
  }
  lines.push(
    'Clique sur **Récupérer mon item** dans le panneau `/salon-hacker` pour ton loot (toutes les 12 h).',
  );
  return lines.join('\n');
}

module.exports = {
  hasHackerSalonAccess,
  grantHackerAccess,
  formatGrantMessage,
};
