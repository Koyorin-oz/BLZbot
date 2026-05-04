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
 *      configuré (sans IP) ET on DM les owners (avec IP + email).
 *
 * Sécurité réseau :
 *   - `trustedProxySecret` : si défini, on n'accepte que les requêtes contenant le header
 *     `X-Verif-Proxy-Secret` égal à cette valeur (cf. deploy/reverse-proxy/).
 *   - `trustedProxyIps`    : alternative — whitelist d'IPs sources autorisées à hit le bot.
 *   - `httpHost`           : interface d'écoute (`0.0.0.0` par défaut, `127.0.0.1` pour
 *                            bind local seulement quand le proxy est sur la même machine).
 *
 * IP : récupérée via `x-forwarded-for` (premier élément) UNIQUEMENT si la requête
 *      a passé le check `isTrustedProxy`. Sinon on retombe sur `req.socket.remoteAddress`
 *      (anti-spoof : un attaquant ne peut pas forger son IP via XFF si le bot exige
 *      le secret du proxy).
 *
 * Détection VPN : `lookupIp(ip)` → si `proxy` ou `hosting`, on refuse la vérif
 *      après récupération de l’email OAuth (pour que les logs owner DM incluent l’email).
 */
const express = require('express');
const { verifyState, hashEmail, hashIp, normalizeEmail } = require('./cryptoUtil');
const {
  saveVerifiedForGuild,
  DuplicateEmailError,
  getGuildConfig,
  assertUniqueVerificationEmail,
  findAltsByIp,
  peekOAuthTicket,
  deleteOAuthTicket,
  OAUTH_TICKET_ID_RE,
} = require('./database');
const { addGuildMemberRole, removeGuildMemberRole } = require('./discordApi');
const { lookupIp, isVpnOrProxy } = require('./geolocation');
const { VERIF_BUILD_ID } = require('./buildId');

function page(title, bodyHtml) {
  return `<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"><title>${title}</title>
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="robots" content="noindex,nofollow">
  <style>body{font-family:system-ui,sans-serif;max-width:42rem;margin:2rem auto;padding:0 1rem;line-height:1.5;background:#0e1116;color:#e6e8ec}h1{color:#5865f2}code,pre{background:#1a1d23;padding:.2em .4em;border-radius:.3em;color:#f0a;font-size:.95em}a{color:#79c0ff}.ok{color:#2ecc71}.warn{color:#e67e22}.err{color:#e74c3c}ul{margin:.5rem 0 .5rem 1.5rem}</style>
  </head><body><h1>${title}</h1>${bodyHtml}</body></html>`;
}

function firstQueryString(val) {
  if (val == null) return null;
  if (Array.isArray(val)) return typeof val[0] === 'string' ? val[0] : null;
  return typeof val === 'string' ? val : null;
}

/**
 * IP du client.
 *
 * Si `trustXForwardedFor === true`, on lit `X-Forwarded-For` (premier élément).
 * Sinon on retourne l'IP du socket TCP (sans tenir compte du header XFF qui
 * peut être forgé par n'importe qui).
 */
function clientIp(req, trustXForwardedFor = true) {
  if (trustXForwardedFor) {
    const xff = req.headers['x-forwarded-for'];
    if (typeof xff === 'string' && xff.trim()) return xff.split(',')[0].trim();
    if (Array.isArray(xff) && xff[0]) return String(xff[0]).split(',')[0].trim();
  }
  return req.socket?.remoteAddress || 'inconnue';
}

/**
 * Détermine si la requête vient bien du reverse proxy autorisé.
 *  - Si `trustedProxySecret` configuré : check `X-Verif-Proxy-Secret`.
 *  - Sinon, si `trustedProxyIps` configurée : check IP source.
 *  - Sinon (config absente), tout est accepté (mode dev / Pebble direct).
 */
function isTrustedProxy(req, opts) {
  const secret = opts.trustedProxySecret;
  if (secret) {
    const provided = String(req.headers['x-verif-proxy-secret'] || '').trim();
    return provided.length > 0 && provided === secret;
  }
  const list = opts.trustedProxyIps;
  if (Array.isArray(list) && list.length > 0) {
    const remote = String(req.socket?.remoteAddress || '').replace(/^::ffff:/, '');
    return list.includes(remote);
  }
  return true; // Pas de restriction configurée → on accepte tout (mode legacy).
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
 * @param {string} [opts.httpHost]            Interface d'écoute (`0.0.0.0` par défaut).
 * @param {string} [opts.trustedProxySecret]  Secret partagé attendu dans `X-Verif-Proxy-Secret`. Si défini, toute requête sans ce header est refusée (403).
 * @param {string[]} [opts.trustedProxyIps]   Whitelist d'IPs sources autorisées à hit le bot.
 * @param {(info: {
 *   guildId: string,
 *   userId: string,
 *   success: boolean,
 *   reason?: string,
 *   ip: string,
 *   userAgent?: string,
 *   email?: string,
 *   existingUserId?: string,
 *   geo?: { country: string, countryCode: string, isp: string, flag: string, proxy: boolean, hosting: boolean, mobile: boolean } | null,
 *   alts?: Array<{ discord_user_id: string, verified_at: number }>
 * }) => Promise<void>} [opts.onVerificationLog]
 */
function createOAuthServer(opts) {
  const httpHost = String(opts.httpHost || '').trim() || '0.0.0.0';
  const trustedProxySecret = String(opts.trustedProxySecret || '').trim() || null;
  const trustedProxyIps = Array.isArray(opts.trustedProxyIps)
    ? opts.trustedProxyIps.map((s) => String(s).trim()).filter(Boolean)
    : [];

  const proxyEnforced = Boolean(trustedProxySecret || trustedProxyIps.length > 0);

  const proxyOpts = { trustedProxySecret, trustedProxyIps };

  if (proxyEnforced) {
    if (trustedProxySecret) {
      console.log('[verif] Reverse proxy obligatoire (header X-Verif-Proxy-Secret).');
    } else {
      console.log(`[verif] Reverse proxy obligatoire (whitelist ${trustedProxyIps.length} IP(s)).`);
    }
  } else {
    console.warn(
      '[verif] Aucun garde-fou reverse proxy — TOUT le monde peut hit le port HTTP.\n' +
        '       Recommandé : VERIFY_PROXY_SECRET=<long random> ou VERIFY_PROXY_IPS=<ip1,ip2>',
    );
  }

  const app = express();
  // Express trust proxy : on délègue la logique à `clientIp(req, trustXff)` ci-dessous,
  // donc on désactive le trust automatique ici pour éviter qu'Express ne lise XFF
  // de son propre chef sur des routes où on ne veut pas qu'il le fasse.
  app.set('trust proxy', false);

  // ─── Garde-fou « reverse proxy attendu » ──────────────────────────────────
  // Si un secret ou une whitelist est configuré, on refuse toute requête qui
  // ne vient pas du proxy. `/health` reste joignable pour les checks locaux
  // (Docker healthcheck, monitoring) — ne contient pas de logique sensible.
  app.use((req, res, next) => {
    if (!proxyEnforced) return next();
    if (req.path === '/health') return next();
    if (isTrustedProxy(req, proxyOpts)) return next();
    res.status(403).type('text').send('Forbidden');
  });

  app.get('/health', (_req, res) => {
    res.type('text').send(`ok ${VERIF_BUILD_ID}`);
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
    // On ne fait confiance à `X-Forwarded-For` que si le proxy est configuré
    // ET que la requête a passé `isTrustedProxy`. Sinon on lit l'IP du socket.
    const trustXff = proxyEnforced ? isTrustedProxy(req, proxyOpts) : true;
    const ip = clientIp(req, trustXff);
    const userAgent = String(req.headers['user-agent'] || '').slice(0, 300);
    const code = firstQueryString(req.query.code);
    const state = firstQueryString(req.query.state);
    const err = firstQueryString(req.query.error);

    /**
     * Émet un log enrichi (géoloc + alts) si le callback `onVerificationLog`
     * est branché. On résout la géo + les alts à la volée pour ne pas
     * dupliquer la logique sur chaque branche d'erreur.
     */
    const emitLog = async (payload) => {
      if (!opts.onVerificationLog) return;
      let geo = payload.geo || null;
      if (!geo) {
        try {
          geo = await lookupIp(ip);
        } catch {
          /* géo indisponible : on log sans */
        }
      }
      let alts = payload.alts;
      if (!Array.isArray(alts) && payload.guildId && payload.userId) {
        const ipH = hashIp(ip);
        try {
          alts = findAltsByIp(payload.guildId, ipH, payload.userId) || [];
        } catch {
          alts = [];
        }
      }
      try {
        await opts.onVerificationLog({ ...payload, ip, userAgent, geo, alts: alts || [] });
      } catch (logErr) {
        console.error('[onVerificationLog]', logErr);
      }
    };

    if (err) {
      let logDecoded = null;
      if (state) {
        if (OAUTH_TICKET_ID_RE.test(state)) {
          logDecoded = peekOAuthTicket(state);
          deleteOAuthTicket(state);
        } else {
          logDecoded = verifyState(state, opts.stateSecret);
        }
      }
      if (logDecoded) {
        await emitLog({
          guildId: logDecoded.guildId,
          userId: logDecoded.discordUserId,
          success: false,
          reason: `OAuth refusé ou erreur Discord : ${String(err)}`,
        });
      }
      res.status(400).send(page('Refusé', `<p>Discord a renvoyé une erreur : <code>${String(err)}</code></p>`));
      return;
    }

    if (!code || !state) {
      res.status(400).send(page('Réponse incomplète', '<p>Code ou state manquant.</p>'));
      return;
    }

    const isTicketState = state && OAUTH_TICKET_ID_RE.test(state);
    let decoded = null;
    if (isTicketState) {
      decoded = peekOAuthTicket(state);
    } else {
      decoded = verifyState(state, opts.stateSecret);
    }
    if (!decoded) {
      res.status(400).send(page('Lien expiré', '<p>State invalide ou expiré.</p>'));
      return;
    }
    const { discordUserId, guildId } = decoded;

    const cfg = getGuildConfig(guildId);
    if (!cfg || !cfg.verified_role_id) {
      await emitLog({
        guildId,
        userId: discordUserId,
        success: false,
        reason:
          'Serveur non configuré (rôle vérifié manquant). Un administrateur doit utiliser /setup-verification.',
      });
      res
        .status(503)
        .send(page('Configuration manquante', "<p>Ce serveur n'a pas encore terminé la configuration de la vérification.</p>"));
      return;
    }

    // 1) Détection VPN/proxy/datacenter AVANT de brûler du quota OAuth.
    //    On bloque tôt pour donner un message clair au membre.
    let geoEarly = null;
    try {
      geoEarly = await lookupIp(ip);
    } catch {
      /* géo indisponible : on continue sans */
    }
    if (geoEarly && isVpnOrProxy(geoEarly)) {
      await emitLog({
        guildId,
        userId: discordUserId,
        success: false,
        reason: 'Connexion VPN/proxy/datacenter détectée — vérification refusée.',
        geo: geoEarly,
      });
      res.status(403).send(
        page(
          '🚫 Vérification refusée — VPN détecté',
          `<p class="err">Un VPN, proxy ou service de tunneling a été détecté sur ta connexion.</p>
           <p>Pour des raisons de sécurité (anti double-compte), la vérification est refusée tant qu'un VPN est actif.</p>
           <ul>
             <li>Désactive ton VPN / proxy / Tor</li>
             <li>Reviens sur Discord et utilise le bouton 🔐 Vérifier ou la commande <code>/verify</code></li>
           </ul>`,
        ),
      );
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
        await emitLog({
          guildId,
          userId: discordUserId,
          success: false,
          reason: 'Mauvais compte Discord utilisé pendant OAuth (compte différent du lien).',
          geo: geoEarly,
        });
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
        await emitLog({
          guildId,
          userId: discordUserId,
          success: false,
          reason: !email
            ? 'Email Discord absent sur le compte OAuth.'
            : 'Email Discord présent mais non marqué comme vérifié par Discord (active la vérif email sur ton compte).',
          geo: geoEarly,
        });
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
        await emitLog({
          guildId,
          userId: discordUserId,
          success: false,
          reason: 'Email Discord invalide.',
          geo: geoEarly,
        });
        res.status(400).send(page('Email invalide', '<p>Email Discord invalide.</p>'));
        return;
      }

      const emailHash = hashEmail(emailNorm);
      const ipH = hashIp(ip);

      try {
        assertUniqueVerificationEmail(guildId, discordUserId, emailHash);
      } catch (e) {
        if (e instanceof DuplicateEmailError) {
          await emitLog({
            guildId,
            userId: discordUserId,
            success: false,
            reason: 'Double compte : cette adresse e-mail est déjà liée à un autre compte sur ce serveur.',
            email: emailNorm,
            existingUserId: e.otherDiscordUserId,
            geo: geoEarly,
          });
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
        await emitLog({
          guildId,
          userId: discordUserId,
          success: false,
          reason: `Impossible d'attribuer le rôle vérifié : ${String(roleErr.message || roleErr)}`,
          email: emailNorm,
          geo: geoEarly,
        });
        res.status(502).send(
          page(
            'Rôle non attribué',
            "<p>La vérification OAuth a réussi, mais le bot n'a pas pu te donner le rôle (hiérarchie des rôles ou permissions). Contacte un administrateur, puis réessaie avec <code>/verify</code> si besoin.</p>",
          ),
        );
        return;
      }

      try {
        saveVerifiedForGuild(guildId, discordUserId, emailHash, ipH);
      } catch (e) {
        await removeGuildMemberRole(opts.botToken, guildId, discordUserId, cfg.verified_role_id).catch(() => {});
        if (e instanceof DuplicateEmailError) {
          await emitLog({
            guildId,
            userId: discordUserId,
            success: false,
            reason: 'Conflit email (race) : un autre compte a été enregistré entre-temps.',
            email: emailNorm,
            existingUserId: e.otherDiscordUserId,
            geo: geoEarly,
          });
          res.status(409).send(
            page(
              'Double compte détecté',
              `<p>Un autre compte utilise déjà cette adresse e-mail sur ce serveur.</p><p>Ton ID : <code>${discordUserId}</code></p>`,
            ),
          );
          return;
        }
        await emitLog({
          guildId,
          userId: discordUserId,
          success: false,
          reason: `Erreur enregistrement base : ${String(e.message || e)}`,
          email: emailNorm,
          geo: geoEarly,
        });
        throw e;
      }

      await emitLog({
        guildId,
        userId: discordUserId,
        success: true,
        reason: 'Vérification terminée, rôle attribué.',
        email: emailNorm,
        geo: geoEarly,
      });

      if (isTicketState) deleteOAuthTicket(state);

      res.send(
        page(
          '✅ Vérification réussie',
          '<p class="ok">Ton compte est vérifié et le rôle a été attribué sur le serveur. Tu peux fermer cette page.</p>',
        ),
      );
    } catch (e) {
      console.error('[oauth/callback]', e);
      await emitLog({
        guildId,
        userId: discordUserId,
        success: false,
        reason: `Erreur technique : ${String(e.message || e)}`,
        geo: geoEarly,
      });
      res.status(500).send(
        page('Erreur', `<p class="err">Une erreur technique est survenue.</p><pre>${escapeHtml(String(e.message || e))}</pre>`),
      );
    }
  });

  const server = app.listen(opts.httpPort, httpHost, () => {
    console.log(
      `[http] OAuth sur ${httpHost}:${opts.httpPort} — callback ${opts.redirectUri}` +
        (proxyEnforced ? ' — ⛓️ reverse proxy obligatoire' : ' — ⚠️  pas de garde-fou proxy'),
    );
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
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

module.exports = { createOAuthServer, clientIp };
