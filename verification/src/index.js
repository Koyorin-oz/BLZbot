/**
 * Entry point — bot Discord + serveur OAuth.
 *
 * Routage des logs de vérification :
 *  - Log SANS IP   → salon configuré via /setup-verification (cfg.log_channel_no_ip_id)
 *  - Log AVEC IP   → DM à chaque ID listé dans OWNER_DM_IDS (variable .env)
 *
 * Si OWNER_DM_IDS est vide, le DM est silencieusement ignoré (pas d'erreur).
 */
require('dotenv').config();

const { EmbedBuilder } = require('discord.js');
const { createOAuthServer } = require('./oauthServer');
const { createBot } = require('./bot');
const { getGuildConfig } = require('./database');

function requireEnv(name) {
  const v = process.env[name];
  if (!v || !String(v).trim()) {
    console.error(`Variable d'environnement manquante : ${name}`);
    process.exit(1);
  }
  return String(v).trim();
}

function parseOwnerDmIds(raw) {
  if (!raw) return [];
  return String(raw)
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter((s) => /^\d{17,22}$/.test(s));
}

async function sendChannelEmbed(client, channelId, embed) {
  if (!channelId) return;
  try {
    const ch = await client.channels.fetch(channelId);
    if (ch && ch.isTextBased()) {
      await ch.send({ embeds: [embed] });
    }
  } catch (e) {
    console.error("[log] impossible d'envoyer dans le salon", channelId, e.message || e);
  }
}

async function dmUserEmbed(client, userId, embed) {
  try {
    const user = await client.users.fetch(userId);
    await user.send({ embeds: [embed] });
  } catch (e) {
    console.error('[dm] impossible de DM', userId, e.message || e);
  }
}

/** @param {object} geo */
function formatConnexion(geo) {
  if (!geo) return '🌐 Localisation indisponible';
  const flag = geo.flag || '🌐';
  const country = geo.country || 'Inconnu';
  const isp = geo.isp || geo.org || '';
  return isp ? `${flag} ${country} • ${isp}` : `${flag} ${country}`;
}

/** Mention + sous-ligne `(pseudo)` (à partir d'un User Discord). */
function userField(user) {
  if (!user) return '*(inconnu)*';
  const tag = user.username ? `*(${user.username})*` : '';
  return `<@${user.id}>${tag ? `\n${tag}` : ''}`;
}

/**
 * Calcule un score d'alt sur la base du nombre de comptes liés à la même IP.
 * Renvoie : niveau (Haute/Moyenne/Faible), risque faux-positif (%), longueur de la barre verte.
 */
function computeAltConfidence(altCount) {
  if (altCount >= 5) return { level: 'Haute', emoji: '🔴', risk: 5, bar: 9 };
  if (altCount >= 2) return { level: 'Moyenne', emoji: '🟡', risk: 15, bar: 6 };
  return { level: 'Faible', emoji: '🟢', risk: 30, bar: 3 };
}

function progressBar(filled, total = 10) {
  const f = Math.max(0, Math.min(total, filled));
  return `\`[${'░'.repeat(f)}${' '.repeat(total - f)}]\``;
}

async function buildSuccessEmbed(client, p) {
  const user = await client.users.fetch(p.userId).catch(() => null);
  return new EmbedBuilder()
    .setColor(0x2ecc71)
    .setTitle('✅ Vérification Réussie')
    .setDescription(
      "L'utilisateur a passé tous les contrôles de sécurité avec succès. " +
        'Le rôle vérifié lui a été attribué automatiquement.',
    )
    .addFields(
      { name: '👤 Utilisateur', value: userField(user) || `<@${p.userId}>`, inline: true },
      { name: '🌐 Connexion', value: formatConnexion(p.geo), inline: true },
    )
    .setTimestamp(new Date());
}

async function buildAltEmbed(client, p) {
  const user = await client.users.fetch(p.userId).catch(() => null);
  const altCount = (p.alts || []).length;
  const conf = computeAltConfidence(altCount);
  const altMentions = (p.alts || [])
    .slice(0, 20)
    .map((a) => `<@${a.discord_user_id}>`)
    .join(', ') || '*(aucun)*';

  return new EmbedBuilder()
    .setColor(0xe67e22)
    .setTitle('🟠 Compte Alternatif Détecté — Vérifié avec Alerte')
    .setDescription(
      '⚠️ **Vérification accordée** — le rôle a été attribué malgré l’alerte.\n' +
        '🚨 Un compte alternatif probable a été détecté sur ce serveur.',
    )
    .addFields(
      {
        name: 'Niveau de confiance',
        value: `${conf.emoji} **${conf.level} confiance**`,
        inline: false,
      },
      {
        name: 'Risque de faux positif',
        value: `Très faible (~${conf.risk}%)\n${progressBar(conf.bar)}\n*Faux positif possible : membres du même foyer ou appareil partagé.*`,
        inline: false,
      },
      {
        name: 'Action recommandée',
        value:
          'Vérifiez les comptes listés ci-dessous. Si vous confirmez qu’il s’agit d’un alt, ' +
          'sanctionnez selon votre politique habituelle.',
        inline: false,
      },
      { name: '👤 Utilisateur', value: userField(user) || `<@${p.userId}>`, inline: true },
      { name: '🌐 Connexion', value: formatConnexion(p.geo), inline: true },
      { name: '🔗 Comptes liés', value: altMentions, inline: false },
    )
    .setTimestamp(new Date());
}

async function buildFailEmbed(client, p) {
  const user = await client.users.fetch(p.userId).catch(() => null);
  const reason = p.reason || 'Raison non précisée.';
  const fields = [
    { name: '👤 Utilisateur', value: userField(user) || `<@${p.userId}>`, inline: true },
    { name: '🌐 Connexion', value: formatConnexion(p.geo), inline: true },
    { name: 'Détail', value: String(reason).slice(0, 1024), inline: false },
  ];
  if (p.existingUserId) {
    fields.push({
      name: 'Compte déjà lié à cet email',
      value: `<@${p.existingUserId}> (\`${p.existingUserId}\`)`,
      inline: false,
    });
  }
  return new EmbedBuilder()
    .setColor(0xe74c3c)
    .setTitle('❌ Vérification Échouée')
    .setDescription(
      "L'utilisateur n'a pas pu valider son compte. Le rôle n'a **pas** été attribué.",
    )
    .addFields(fields)
    .setTimestamp(new Date());
}

/** Embed DM owner : reprend l'embed public + ajoute les champs sensibles (IP, UA, email). */
function withSensitiveFields(embed, p) {
  const sensitive = [];
  sensitive.push({ name: '🛰️ IP', value: `\`${p.ip || 'inconnue'}\``, inline: true });
  if (p.email) sensitive.push({ name: '📧 Email Discord', value: `\`${p.email}\``, inline: true });
  if (p.userAgent) sensitive.push({ name: '🖥️ User-Agent', value: `\`${String(p.userAgent).slice(0, 200)}\`` });
  embed.addFields(...sensitive);
  return embed;
}

/**
 * @param {import('discord.js').Client} client
 * @param {string[]} ownerDmIds
 * @param {object} p  payload émis par oauthServer (avec geo + alts)
 */
async function onVerificationLog(client, ownerDmIds, p) {
  const { guildId, success, alts } = p;
  const cfg = getGuildConfig(guildId);

  let publicEmbed;
  if (!success) {
    publicEmbed = await buildFailEmbed(client, p);
  } else if ((alts || []).length > 0) {
    publicEmbed = await buildAltEmbed(client, p);
  } else {
    publicEmbed = await buildSuccessEmbed(client, p);
  }

  if (cfg?.log_channel_no_ip_id) {
    await sendChannelEmbed(client, cfg.log_channel_no_ip_id, publicEmbed);
  }

  if (ownerDmIds.length > 0) {
    let dmEmbed;
    if (!success) {
      dmEmbed = await buildFailEmbed(client, p);
    } else if ((alts || []).length > 0) {
      dmEmbed = await buildAltEmbed(client, p);
    } else {
      dmEmbed = await buildSuccessEmbed(client, p);
    }
    withSensitiveFields(dmEmbed, p);
    await Promise.allSettled(ownerDmIds.map((id) => dmUserEmbed(client, id, dmEmbed)));
  } else {
    console.warn(
      "[verif] OWNER_DM_IDS vide — le log avec IP n'a été envoyé à personne. " +
        'Ajoute des IDs dans le .env pour recevoir les DMs.',
    );
  }
}

async function main() {
  const botToken = requireEnv('BOT_TOKEN');
  const clientId = requireEnv('DISCORD_CLIENT_ID');
  const clientSecret = requireEnv('DISCORD_CLIENT_SECRET');
  const redirectUri = requireEnv('OAUTH_REDIRECT_URI');
  const publicBaseUrl = requireEnv('PUBLIC_BASE_URL');
  const stateSecret = requireEnv('OAUTH_STATE_SECRET');
  const httpPort = parseInt(process.env.HTTP_PORT || '3782', 10);
  const ownerDmIds = parseOwnerDmIds(process.env.OWNER_DM_IDS);

  if (ownerDmIds.length === 0) {
    console.warn(
      '[verif] OWNER_DM_IDS non défini ou invalide — les logs avec IP ne seront envoyés à PERSONNE.\n' +
        '       Ajoute par exemple : OWNER_DM_IDS=965984018216665099,1278372257483456603',
    );
  } else {
    console.log(`[verif] Logs avec IP → DM à ${ownerDmIds.length} owner(s) : ${ownerDmIds.join(', ')}`);
  }

  const { client } = createBot({
    publicBaseUrl,
    stateSecret,
  });

  await client.login(botToken);

  const { server } = createOAuthServer({
    botToken,
    clientId,
    clientSecret,
    redirectUri,
    publicBaseUrl,
    stateSecret,
    httpPort,
    onVerificationLog: (payload) => onVerificationLog(client, ownerDmIds, payload),
  });

  const shutdown = () => {
    server.close(() => process.exit(0));
    client.destroy();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
