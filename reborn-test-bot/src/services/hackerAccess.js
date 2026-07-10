/**
 * Accès salon secret hacker : rôle Discord + permission sur le salon configuré.
 */
const path = require('path');
const { PermissionFlagsBits } = require('discord.js');
const cfg = require('../config');
const meta = require('./meta');

const META_KEY_PREFIX = 'hacker_access_';

const BLZ_GUILD_CHANNELS = (() => {
  try {
    return require(path.join(__dirname, '..', '..', '..', 'niveau', 'src', 'utils', 'blz-guild-channels'));
  } catch {
    return null;
  }
})();

function resolveChannelIdForGuild(guildId) {
  if (BLZ_GUILD_CHANNELS?.resolveHackerChannelId) {
    const id = BLZ_GUILD_CHANNELS.resolveHackerChannelId(guildId);
    if (id) return id;
  }
  return cfg.hackerChannelId;
}

function resolveRoleIdForGuild(guildId) {
  if (BLZ_GUILD_CHANNELS?.resolveHackerRoleIdForGuild) {
    const id = BLZ_GUILD_CHANNELS.resolveHackerRoleIdForGuild(guildId);
    if (id) return id;
  }
  return cfg.hackerRoleId;
}

function hasHackerSalonAccess(userId, member) {
  if (meta.get(`${META_KEY_PREFIX}${userId}`) === '1') return true;
  const roleId = member?.guild?.id ? resolveRoleIdForGuild(member.guild.id) : cfg.hackerRoleId;
  if (roleId && member?.roles?.cache?.has(roleId)) return true;
  return false;
}

/**
 * @param {{ userId: string, guildId?: string|null, client?: import('discord.js').Client, member?: import('discord.js').GuildMember }} ctx
 */
async function grantHackerAccess(ctx) {
  const { userId, guildId, client, member } = ctx;

  if (!guildId || !client) {
    return { ok: false, error: 'Utilise le **jeton hacker** sur le serveur (pas en DM).' };
  }

  const channelId = resolveChannelIdForGuild(guildId);
  const roleId = resolveRoleIdForGuild(guildId);

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
    const role = m.guild.roles.cache.get(roleId) || (await m.guild.roles.fetch(roleId).catch(() => null));
    if (!role) {
      console.warn(`[hackerAccess] rôle ${roleId} introuvable sur la guilde ${guildId}`);
    } else if (m.roles.cache.has(roleId)) {
      alreadyHadRole = true;
    } else {
      try {
        await m.roles.add(role, 'Accès salon secret hacker');
        roleGranted = true;
      } catch (e) {
        console.error('[hackerAccess] role add', e?.message || e);
      }
    }
  }

  let channelGranted = false;
  let channelSameGuild = false;
  let channelName = null;
  let effectiveChannelId = null;
  if (channelId) {
    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (!channel) {
      console.warn(`[hackerAccess] salon ${channelId} introuvable`);
    } else if (channel.guildId !== guildId) {
      console.warn(
        `[hackerAccess] salon ${channelId} appartient à ${channel.guildId}, pas à ${guildId} — ping ignoré`,
      );
    } else if (channel.permissionOverwrites) {
      effectiveChannelId = channel.id;
      channelName = channel.name;
      channelSameGuild = true;
      const existing = channel.permissionOverwrites.cache.get(m.id);
      const canView = existing?.allow?.has(PermissionFlagsBits.ViewChannel);
      if (canView) {
        channelGranted = true;
      } else {
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
    channelId: effectiveChannelId,
    channelName,
    channelSameGuild,
    channelGuildId: channelSameGuild ? guildId : null,
  };
}

function formatGrantMessage(result, { guildId } = {}) {
  const lines = [];
  if (result.roleGranted) {
    lines.push('💻 **Rôle Hacker** attribué.');
  } else if (result.alreadyHadRole) {
    lines.push('Tu avais déjà le **rôle Hacker**.');
  }

  if (result.channelGranted || result.channelId || result.channelName) {
    const canMention =
      result.channelSameGuild &&
      result.channelId &&
      guildId &&
      result.channelGuildId === guildId;
    if (canMention) {
      lines.push(`🔓 Salon secret : <#${result.channelId}>`);
    } else if (result.channelName) {
      lines.push(`🔓 Salon secret **#${result.channelName}** débloqué.`);
    } else {
      lines.push('🔓 **Accès salon secret hacker** débloqué.');
    }
  }

  lines.push('Loot toutes les **12 h** via `/salon-hacker` → **Récupérer mon item**.');
  return lines.join('\n');
}

module.exports = {
  hasHackerSalonAccess,
  grantHackerAccess,
  formatGrantMessage,
  resolveChannelIdForGuild,
  resolveRoleIdForGuild,
};
