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

async function sendChannelText(client, channelId, content) {
  if (!channelId) return;
  const text = String(content).slice(0, 2000);
  try {
    const ch = await client.channels.fetch(channelId);
    if (ch && ch.isTextBased()) {
      await ch.send({ content: text });
    }
  } catch (e) {
    console.error("[log] impossible d'envoyer dans le salon", channelId, e.message || e);
  }
}

async function dmUser(client, userId, content) {
  const text = String(content).slice(0, 2000);
  try {
    const user = await client.users.fetch(userId);
    await user.send({ content: text });
  } catch (e) {
    console.error('[dm] impossible de DM', userId, e.message || e);
  }
}

/**
 * @param {import('discord.js').Client} client
 * @param {string[]} ownerDmIds
 * @param {object} p
 */
async function onVerificationLog(client, ownerDmIds, p) {
  const { guildId, userId, success, reason, ip, userAgent, email, existingUserId } = p;
  const cfg = getGuildConfig(guildId);

  let guildLabel = `\`${guildId}\``;
  try {
    const g = await client.guilds.fetch(guildId);
    guildLabel = `**${g.name}** (\`${guildId}\`)`;
  } catch {
    /* ignore */
  }

  const status = success ? '✅ Vérification réussie' : '❌ Vérification échouée';
  const extra = existingUserId
    ? `\n**Compte déjà lié à cet email :** <@${existingUserId}> (\`${existingUserId}\`)`
    : '';

  const bodyNoIp =
    `${status}\n` +
    `**Serveur :** ${guildLabel}\n` +
    `**Membre :** <@${userId}> (\`${userId}\`)\n` +
    (reason ? `**Détail :** ${reason}` : '') +
    extra;

  const bodyWithIp =
    `${bodyNoIp}\n` +
    `**IP :** \`${ip}\`` +
    (userAgent ? `\n**User-Agent :** \`${userAgent}\`` : '') +
    (email ? `\n**Email Discord :** \`${email}\`` : '');

  if (cfg?.log_channel_no_ip_id) {
    await sendChannelText(client, cfg.log_channel_no_ip_id, bodyNoIp);
  }

  if (ownerDmIds.length > 0) {
    await Promise.allSettled(ownerDmIds.map((id) => dmUser(client, id, bodyWithIp)));
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
