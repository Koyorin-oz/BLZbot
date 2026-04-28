/**
 * Serveur HTTP de vérification (OAuth Discord + capture IP).
 *
 * Flow :
 *   1. Le bot Discord poste un panneau avec un bouton "Vérifier". Le clic envoie au membre
 *      un lien éphémère vers `${PUBLIC_BASE_URL}/oauth/start?state=...` (state HMAC signé,
 *      contient discordUserId + guildId, expire après 30 min).
 *   2. `/oauth/start` redirige vers Discord OAuth2 (scope identify + email).
 *   3. Discord renvoie sur `/oauth/callback` avec un code → on échange pour un access_token,
 *      on fetch /users/@me, on hashe l'email (anti double-compte).
 *   4. On donne le rôle "vérifié" via REST Discord, on persiste en DB, on log dans le salon
 *      configuré (sans IP) ET on DM les owners (avec IP).
 *
 * IP : récupérée via `x-forwarded-for` (premier élément) si présent, sinon `req.socket.remoteAddress`.
 *      `app.set('trust proxy', 1)` est obligatoire si tu passes par un reverse proxy
 *      (Cloudflare Tunnel, ngrok, Nginx, Render, Railway…).
 */
const express = require('express');
const { verifyState, hashEmail, normalizeEmail } = require('./cryptoUtil');
const {
  saveVerifiedForGuild,
  DuplicateEmailError,
  getGuildConfig,
  assertUniqueVerificationEmail,
} = require('./database');
const { addGuildMemberRole, removeGuildMemberRole } = require('./discordApi');

function page(title, bodyHtml) {
  return `<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"><title>${title}</title>
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <style>body{font-family:system-ui,sans-serif;max-width:42rem;margin:2rem auto;padding:0 1rem;line-height:1.5;background:#0e1116;color:#e6e8ec}h1{color:#5865f2}code,pre{background:#1a1d23;padding:.2em .4em;border-radius:.3em;color:#f0a;font-size:.95em}a{color:#79c0ff}</style>
  </head><body><h1>${title}</h1>${bodyHtml}</body></html>`;
}

function firstQueryString(val) {
  if (val == null) return null;
  if (Array.isArray(val)) return typeof val[0] === 'string' ? val[0] : null;
  return typeof val === 'string' ? val : null;
}

function clientIp(req) {
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff.trim()) {
    return xff.split(',')[0].trim();
  }
  if (Array.isArray(xff) && xff[0]) {
    return String(xff[0]).split(',')[0].trim();
  }
  return req.socket?.remoteAddress || 'inconnue';
}

/**
 * @param {object} opts
 * @param {string} opts.botToken
 * @param {string} opts.clientId
 * @param {string} opts.clientSecret
 * @param {string} opts.redirectUri
 * @param {string} opts.publicBaseUrl
 * @param {string} opts.stateSecret
 * @param {number} opts.httpPort
 * @param {(info: {
 *   guildId: string,
 *   userId: string,
 *   success: boolean,
 *   reason?: string,
 *   ip: string,
 *   userAgent?: string,
 *   email?: string,
 *   existingUserId?: string
 * }) => Promise<void>} [opts.onVerificationLog]
 */
function createOAuthServer(opts) {
  const app = express();
  app.set('trust proxy', 1);

  app.get('/health', (_req, res) => {
    res.type('text').send('ok');
  });

  app.get('/oauth/start', (req, res) => {
    const state = firstQueryString(req.query.state);
    if (!state) {
      res.status(400).send(page('Lien invalide', '<p>Paramètre <code>state</code> manquant.</p>'));
      return;
    }
    const decoded = verifyState(state, opts.stateSecret);
    if (!decoded) {
      res.status(400).send(
        page(
          'Lien expiré',
          '<p>Le lien de vérification a expiré ou est invalide. Utilise de nouveau le bouton sur le serveur ou la commande <code>/verify</code>.</p>',
        ),
      );
      return;
    }
    const params = new URLSearchParams({
      client_id: opts.clientId,
      redirect_uri: opts.redirectUri,
      response_type: 'code',
      scope: 'identify email',
      state,
      prompt: 'consent',
    });
    res.redirect(`https://discord.com/api/oauth2/authorize?${params.toString()}`);
  });

  app.get('/oauth/callback', async (req, res) => {
    const ip = clientIp(req);
    const userAgent = String(req.headers['user-agent'] || '').slice(0, 300);
    const code = firstQueryString(req.query.code);
    const state = firstQueryString(req.query.state);
    const err = firstQueryString(req.query.error);

    if (err) {
      const decoded = state ? verifyState(state, opts.stateSecret) : null;
      if (decoded && opts.onVerificationLog) {
        await opts.onVerificationLog({
          guildId: decoded.guildId,
          userId: decoded.discordUserId,
          success: false,
          reason: `OAuth refusé ou erreur Discord : ${String(err)}`,
          ip,
          userAgent,
        });
      }
      res.status(400).send(page('Refusé', `<p>Discord a renvoyé une erreur : <code>${String(err)}</code></p>`));
      return;
    }

    if (!code || !state) {
      res.status(400).send(page('Réponse incomplète', '<p>Code ou state manquant.</p>'));
      return;
    }

    const decoded = verifyState(state, opts.stateSecret);
    if (!decoded) {
      res.status(400).send(page('Lien expiré', '<p>State invalide ou expiré.</p>'));
      return;
    }
    const { discordUserId, guildId } = decoded;

    const cfg = getGuildConfig(guildId);
    if (!cfg || !cfg.verified_role_id) {
      if (opts.onVerificationLog) {
        await opts.onVerificationLog({
          guildId,
          userId: discordUserId,
          success: false,
          reason:
            'Serveur non configuré (rôle vérifié manquant). Un administrateur doit utiliser /setup-verification.',
          ip,
          userAgent,
        });
      }
      res
        .status(503)
        .send(page('Configuration manquante', '<p>Ce serveur n\'a pas encore terminé la configuration de la vérification.</p>'));
      return;
    }

    try {
      const tokenJson = await exchangeDiscordCode({
        clientId: opts.clientId,
        clientSecret: opts.clientSecret,
        code,
        redirectUri: opts.redirectUri,
      });
      const me = await fetchDiscordMe(tokenJson.access_token);
      if (String(me.id) !== String(discordUserId)) {
        if (opts.onVerificationLog) {
          await opts.onVerificationLog({
            guildId,
            userId: discordUserId,
            success: false,
            reason: 'Mauvais compte Discord utilisé pendant OAuth (compte différent du lien).',
            ip,
            userAgent,
          });
        }
        res.status(400).send(
          page(
            'Mauvais compte Discord',
            '<p>Tu dois te connecter avec le <strong>même compte Discord</strong> que celui pour lequel tu as ouvert le lien.</p>',
          ),
        );
        return;
      }

      const email = me.email;
      const emailVerified = me.verified === true;
      if (!email || typeof email !== 'string' || !emailVerified) {
        if (opts.onVerificationLog) {
          await opts.onVerificationLog({
            guildId,
            userId: discordUserId,
            success: false,
            reason: !email
              ? 'Email Discord absent sur le compte OAuth.'
              : 'Email Discord présent mais non marqué comme vérifié par Discord (active la vérif email sur ton compte).',
            ip,
            userAgent,
          });
        }
        res.status(400).send(
          page(
            'Email Discord requis',
            '<p>Le compte Discord doit avoir une <strong>adresse e-mail vérifiée</strong> (paramètres Discord → compte). Puis recommence la vérification.</p>',
          ),
        );
        return;
      }

      const emailNorm = normalizeEmail(email);
      if (!emailNorm.includes('@')) {
        if (opts.onVerificationLog) {
          await opts.onVerificationLog({
            guildId,
            userId: discordUserId,
            success: false,
            reason: 'Email Discord invalide.',
            ip,
            userAgent,
          });
        }
        res.status(400).send(page('Email invalide', '<p>Email Discord invalide.</p>'));
        return;
      }

      const emailHash = hashEmail(emailNorm);

      try {
        assertUniqueVerificationEmail(guildId, discordUserId, emailHash);
      } catch (e) {
        if (e instanceof DuplicateEmailError) {
          if (opts.onVerificationLog) {
            await opts.onVerificationLog({
              guildId,
              userId: discordUserId,
              success: false,
              reason: 'Double compte : cette adresse e-mail est déjà liée à un autre compte sur ce serveur.',
              ip,
              userAgent,
              email: emailNorm,
              existingUserId: e.otherDiscordUserId,
            });
          }
          res.status(409).send(
            page(
              'Double compte détecté',
              `<p>Cette adresse e-mail est déjà utilisée par un autre compte Discord sur ce serveur.</p><p>Ton ID : <code>${discordUserId}</code></p>`,
            ),
          );
          return;
        }
        throw e;
      }

      try {
        await addGuildMemberRole(opts.botToken, guildId, discordUserId, cfg.verified_role_id);
      } catch (roleErr) {
        if (opts.onVerificationLog) {
          await opts.onVerificationLog({
            guildId,
            userId: discordUserId,
            success: false,
            reason: `Impossible d'attribuer le rôle vérifié : ${String(roleErr.message || roleErr)}`,
            ip,
            userAgent,
            email: emailNorm,
          });
        }
        res.status(502).send(
          page(
            'Rôle non attribué',
            '<p>La vérification OAuth a réussi, mais le bot n\'a pas pu te donner le rôle (hiérarchie des rôles ou permissions). Contacte un administrateur, puis réessaie avec <code>/verify</code> si besoin.</p>',
          ),
        );
        return;
      }

      try {
        saveVerifiedForGuild(guildId, discordUserId, emailHash);
      } catch (e) {
        await removeGuildMemberRole(opts.botToken, guildId, discordUserId, cfg.verified_role_id).catch(() => {});
        if (e instanceof DuplicateEmailError) {
          if (opts.onVerificationLog) {
            await opts.onVerificationLog({
              guildId,
              userId: discordUserId,
              success: false,
              reason: 'Conflit email (race) : un autre compte a été enregistré entre-temps.',
              ip,
              userAgent,
              email: emailNorm,
              existingUserId: e.otherDiscordUserId,
            });
          }
          res.status(409).send(
            page(
              'Double compte détecté',
              `<p>Un autre compte utilise déjà cette adresse e-mail sur ce serveur.</p><p>Ton ID : <code>${discordUserId}</code></p>`,
            ),
          );
          return;
        }
        if (opts.onVerificationLog) {
          await opts.onVerificationLog({
            guildId,
            userId: discordUserId,
            success: false,
            reason: `Erreur enregistrement base : ${String(e.message || e)}`,
            ip,
            userAgent,
          });
        }
        throw e;
      }

      if (opts.onVerificationLog) {
        await opts.onVerificationLog({
          guildId,
          userId: discordUserId,
          success: true,
          reason: 'Vérification terminée, rôle attribué.',
          ip,
          userAgent,
          email: emailNorm,
        });
      }

      res.send(
        page(
          '✅ Vérification réussie',
          '<p>Ton compte est vérifié et le rôle a été attribué sur le serveur. Tu peux fermer cette page.</p>',
        ),
      );
    } catch (e) {
      console.error('[oauth/callback]', e);
      if (opts.onVerificationLog) {
        await opts.onVerificationLog({
          guildId,
          userId: discordUserId,
          success: false,
          reason: `Erreur technique : ${String(e.message || e)}`,
          ip,
          userAgent,
        });
      }
      res.status(500).send(
        page('Erreur', `<p>Une erreur technique est survenue.</p><pre>${escapeHtml(String(e.message || e))}</pre>`),
      );
    }
  });

  const server = app.listen(opts.httpPort, () => {
    console.log(`[http] OAuth sur le port ${opts.httpPort} — callback ${opts.redirectUri}`);
  });

  return { app, server };
}

async function exchangeDiscordCode({ clientId, clientSecret, code, redirectUri }) {
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
  });
  const res = await fetch('https://discord.com/api/v10/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`oauth2/token ${res.status}: ${t}`);
  }
  return res.json();
}

async function fetchDiscordMe(accessToken) {
  const res = await fetch('https://discord.com/api/v10/users/@me', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`users/@me ${res.status}: ${t}`);
  }
  return res.json();
}

function escapeHtml(s) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

module.exports = { createOAuthServer, clientIp };
