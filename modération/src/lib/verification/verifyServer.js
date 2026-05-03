/**
 * Serveur HTTP de vérification — version SANS OAuth, SANS Express.
 *
 * Pourquoi pas d'Express : l'environnement Pebble Host n'a pas de manière fiable
 * d'installer des packages npm avant l'exécution du bot, ce qui causait un
 * `Error: Cannot find module 'express'` au démarrage. On utilise donc le module
 * `http` natif de Node.js : pas de dépendance externe, tout marche dès le clone.
 *
 * Pourquoi pas d'OAuth : OAuth Discord exige un client_secret stocké côté serveur,
 * inaccessible quand le compte Dev Portal du propriétaire de l'app est suspendu.
 * On contourne en remplaçant la preuve "Discord a vérifié l'identité" par un
 * token HMAC envoyé en DM par le bot lui-même : seul le destinataire du DM peut
 * cliquer sur le lien (le DM est privé), et le token expire après 30 minutes.
 *
 * Trade-off : on perd la garantie d'email Discord (pas de détection double-compte
 * par email). On garde la détection d'alts par IP + capture geo.
 *
 * Flow :
 *   1. Le bot Discord poste un panneau public avec le bouton "🔐 Vérifier".
 *      Le clic envoie au membre un DM avec un lien éphémère vers
 *      `${PUBLIC_BASE_URL}/verify/start?state=<HMAC>`.
 *   2. `GET /verify/start` : affiche une page HTML avec un bouton "Je confirme".
 *      (page d'attente pour empêcher la validation par prefetch automatique
 *      des navigateurs ou des clients Discord).
 *   3. `POST /verify/submit` : capture l'IP du visiteur, vérifie le state HMAC,
 *      attribue le rôle vérifié via REST Discord (BOT_TOKEN, pas besoin de
 *      client_secret), persiste en DB, log dans le salon configuré (sans IP)
 *      et DM les owners (avec IP brute).
 *
 * IP : récupérée via `x-forwarded-for` (premier élément) si présent, sinon
 *      `req.socket.remoteAddress`. On fait toujours confiance à `x-forwarded-for`
 *      car le bot est censé tourner derrière un reverse proxy (Pebble Host /
 *      Cloudflare Tunnel / ngrok / Nginx). Si tu exposes le port en direct,
 *      pense à filtrer ce header avant.
 */
const http = require('node:http');
const { URL } = require('node:url');
const querystring = require('node:querystring');

const { verifyState, hashEmail, hashIp } = require('./cryptoUtil');
const {
    saveVerifiedForGuild,
    getGuildConfig,
    findAltsByIp,
    findVerifiedInGuild,
} = require('./database');
const { grantVerifiedRole } = require('./discordApi');
const { lookupIp, isVpnOrProxy } = require('./geolocation');

function escapeHtml(s) {
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function page(title, bodyHtml) {
    return `<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="robots" content="noindex,nofollow">
  <style>
    body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:42rem;margin:2rem auto;padding:0 1rem;line-height:1.55;background:#0e1116;color:#e6e8ec}
    h1{color:#5865f2;margin-top:0}
    .card{background:#1a1d23;border:1px solid #2a2e36;border-radius:.6rem;padding:1.25rem;margin:1rem 0}
    .btn{display:inline-block;background:#5865f2;color:#fff;border:0;padding:.7rem 1.4rem;font-size:1rem;border-radius:.4rem;cursor:pointer;text-decoration:none}
    .btn:hover{background:#4752c4}
    .btn:disabled{opacity:.6;cursor:not-allowed}
    code,pre{background:#0a0c10;padding:.2em .4em;border-radius:.3em;color:#f0a;font-size:.95em}
    .ok{color:#2ecc71}.warn{color:#e67e22}.err{color:#e74c3c}
  </style>
  </head><body><h1>${escapeHtml(title)}</h1>${bodyHtml}</body></html>`;
}

/**
 * IP du client.
 *
 * Si `trustXForwardedFor === true`, on lit `X-Forwarded-For` (premier élément).
 * Sinon on retourne l'IP du socket TCP (sans tenir compte du header XFF qui
 * peut être forgé par n'importe qui).
 *
 * Le mode « trust XFF » n'est activé que si la requête vient bien du reverse
 * proxy (vérifié via `X-Verif-Proxy-Secret` ou IP whitelist) — voir `isTrustedProxy`.
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

/** Lit un corps `application/x-www-form-urlencoded` borné en taille (4 Ko). */
function readUrlEncodedBody(req, maxBytes = 4 * 1024) {
    return new Promise((resolve, reject) => {
        let received = 0;
        const chunks = [];
        req.on('data', (chunk) => {
            received += chunk.length;
            if (received > maxBytes) {
                req.destroy();
                reject(new Error('payload too large'));
                return;
            }
            chunks.push(chunk);
        });
        req.on('end', () => {
            try {
                const raw = Buffer.concat(chunks).toString('utf8');
                resolve(querystring.parse(raw));
            } catch (e) {
                reject(e);
            }
        });
        req.on('error', reject);
    });
}

function sendHtml(res, status, html) {
    res.writeHead(status, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
    });
    res.end(html);
}

function sendText(res, status, text) {
    res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(text);
}

/**
 * @param {object} opts
 * @param {string} opts.botToken
 * @param {string} opts.publicBaseUrl
 * @param {string} opts.stateSecret
 * @param {number} opts.httpPort
 * @param {string} [opts.httpHost] Interface d'écoute (`0.0.0.0` par défaut, `127.0.0.1` pour bind local seulement).
 * @param {string} [opts.trustedProxySecret] Secret partagé attendu dans `X-Verif-Proxy-Secret`. Si défini, toute requête sans ce header est refusée (403).
 * @param {string[]} [opts.trustedProxyIps] Whitelist d'IPs sources autorisées à hit le bot. Alternative au secret.
 * @param {(info: {
 *   guildId: string,
 *   userId: string,
 *   success: boolean,
 *   reason?: string,
 *   ip: string,
 *   userAgent?: string,
 *   existingUserId?: string,
 *   geo?: { country: string, countryCode: string, isp: string, flag: string } | null,
 *   alts?: Array<{ discord_user_id: string, verified_at: number }>
 * }) => Promise<void>} [opts.onVerificationLog]
 */
function createVerifyServer(opts) {
    /**
     * Émet un log enrichi (géo + alts) si le callback `onVerificationLog` est branché.
     * Le payload accepte aussi un `kind` machine-readable (`success` / `pending_alt` /
     * `vpn_blocked` / `failed`) pour que le dispatcher choisisse le bon embed.
     */
    const emitLog = async (ip, userAgent, payload) => {
        if (!opts.onVerificationLog) return;
        let geo = payload.geo || null;
        if (!geo) {
            try {
                geo = await lookupIp(ip);
            } catch { /* géo indisponible : on log sans */ }
        }
        let alts = payload.alts;
        if (!Array.isArray(alts) && payload.guildId && payload.userId) {
            const ipH = hashIp(ip);
            try {
                alts = findAltsByIp(payload.guildId, ipH, payload.userId) || [];
            } catch { alts = []; }
        }
        try {
            await opts.onVerificationLog({ ...payload, ip, userAgent, geo, alts: alts || [] });
        } catch (logErr) {
            console.error('[onVerificationLog]', logErr);
        }
    };

    async function handleStart(req, res, parsedUrl) {
        const state = parsedUrl.searchParams.get('state');
        if (!state) {
            sendHtml(res, 400, page('Lien invalide', '<p>Paramètre <code>state</code> manquant.</p>'));
            return;
        }
        const decoded = verifyState(state, opts.stateSecret);
        if (!decoded) {
            sendHtml(
                res,
                400,
                page(
                    'Lien expiré',
                    '<p>Le lien de vérification a expiré ou est invalide. Retourne sur Discord et utilise de nouveau le bouton ou la commande <code>/verify</code>.</p>',
                ),
            );
            return;
        }

        const action = `${opts.publicBaseUrl.replace(/\/$/, '')}/verify/submit`;
        const body = `
      <div class="card">
        <p>Tu es sur le point de valider la vérification de ton compte Discord pour le serveur.</p>
        <p>En cliquant sur le bouton ci-dessous, tu confirmes :</p>
        <ul>
          <li>Que tu es bien le propriétaire du compte Discord <strong>cible du lien</strong> (celui qui a reçu ce lien en MP).</li>
          <li>Que tu autorises le serveur à enregistrer ton <strong>adresse IP</strong> pour détecter d'éventuels comptes alternatifs.</li>
        </ul>
        <form method="POST" action="${escapeHtml(action)}">
          <input type="hidden" name="state" value="${escapeHtml(state)}">
          <button class="btn" type="submit">✅ Je confirme la vérification</button>
        </form>
        <p style="margin-top:1rem;font-size:.9em;opacity:.7">Lien à usage unique, expire 30 minutes après son émission.</p>
      </div>
    `;
        sendHtml(res, 200, page('🔐 Vérification', body));
    }

    async function handleSubmit(req, res, parsedUrl) {
        const ip = clientIp(req);
        const userAgent = String(req.headers['user-agent'] || '').slice(0, 300);

        let bodyParams;
        try {
            bodyParams = await readUrlEncodedBody(req);
        } catch {
            sendHtml(res, 413, page('Requête trop grande', '<p>Payload refusé.</p>'));
            return;
        }
        const stateBody = bodyParams?.state;
        const state =
            (Array.isArray(stateBody) ? stateBody[0] : stateBody) || parsedUrl.searchParams.get('state');

        if (!state) {
            sendHtml(res, 400, page('Requête invalide', '<p>Paramètre <code>state</code> manquant.</p>'));
            return;
        }
        const decoded = verifyState(state, opts.stateSecret);
        if (!decoded) {
            sendHtml(res, 400, page('Lien expiré', '<p>State invalide ou expiré.</p>'));
            return;
        }
        const { discordUserId, guildId } = decoded;

        const cfg = getGuildConfig(guildId);
        if (!cfg || !cfg.verified_role_id) {
            await emitLog(ip, userAgent, {
                guildId,
                userId: discordUserId,
                success: false,
                kind: 'failed',
                reason:
                    'Serveur non configuré (rôle vérifié manquant). Un administrateur doit utiliser /setup-verification.',
            });
            sendHtml(
                res,
                503,
                page(
                    'Configuration manquante',
                    '<p>Ce serveur n\'a pas encore terminé la configuration de la vérification.</p>',
                ),
            );
            return;
        }

        // Si déjà vérifié → rebrancher le rôle (cas du membre qui a quitté/revenu).
        // Pas de re-check VPN ici : si le compte a déjà passé l'épreuve une fois,
        // on ne le pénalise pas s'il revient sur un VPN (cas légit : voyage, école…).
        const already = findVerifiedInGuild(guildId, discordUserId);
        if (already) {
            try {
                await grantVerifiedRole(
                    opts.botToken,
                    guildId,
                    discordUserId,
                    cfg.verified_role_id,
                    opts.unverifiedRoleId,
                );
            } catch { /* le rôle est peut-être déjà appliqué */ }
            await emitLog(ip, userAgent, {
                guildId,
                userId: discordUserId,
                success: true,
                kind: 'success',
                reason: 'Déjà vérifié — rôle réappliqué.',
            });
            sendHtml(
                res,
                200,
                page(
                    '✅ Déjà vérifié',
                    '<p class="ok">Tu étais déjà enregistré comme vérifié sur ce serveur. Le rôle a été ré-attribué. Tu peux fermer cette page.</p>',
                ),
            );
            return;
        }

        // 1) Récupération géo + détection VPN/proxy/hosting AVANT toute action.
        let geo = null;
        try {
            geo = await lookupIp(ip);
        } catch { /* géo indisponible : on continue sans */ }

        if (geo && isVpnOrProxy(geo)) {
            await emitLog(ip, userAgent, {
                guildId,
                userId: discordUserId,
                success: false,
                kind: 'vpn_blocked',
                geo,
                reason: 'Connexion VPN/proxy/datacenter détectée — vérification refusée.',
            });
            sendHtml(
                res,
                403,
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

        // 2) Détection d'alts par IP exacte. Si match → on N'attribue PAS le rôle :
        //    un staff doit valider via le bouton "Vérifier manuellement". On n'écrit
        //    rien en DB non plus, pour pouvoir retenter la vérif si le staff refuse.
        const ipH = hashIp(ip);
        let alts = [];
        try {
            alts = findAltsByIp(guildId, ipH, discordUserId) || [];
        } catch { alts = []; }

        if (alts.length > 0) {
            await emitLog(ip, userAgent, {
                guildId,
                userId: discordUserId,
                success: false,
                kind: 'pending_alt',
                geo,
                alts,
                reason: `Alt détecté (${alts.length} compte(s) déjà vérifié(s) sur cette IP). Validation manuelle requise.`,
            });
            sendHtml(
                res,
                202,
                page(
                    '⏸️ Vérification en attente',
                    `<p class="warn">Un compte alternatif a été détecté sur ce serveur depuis ta connexion.</p>
           <p>Le rôle vérifié n'a <strong>pas</strong> été attribué automatiquement.</p>
           <p>Un membre du staff va examiner ta demande. Tu n'as rien à faire — tu peux fermer cette page.</p>`,
                ),
            );
            return;
        }

        // 3) Cas nominal : pas de VPN, pas d'alt → on attribue le rôle + on persiste.
        const emailHashPlaceholder = hashEmail(`noverif:${discordUserId}`);

        try {
            await grantVerifiedRole(
                opts.botToken,
                guildId,
                discordUserId,
                cfg.verified_role_id,
                opts.unverifiedRoleId,
            );
        } catch (roleErr) {
            await emitLog(ip, userAgent, {
                guildId,
                userId: discordUserId,
                success: false,
                kind: 'failed',
                geo,
                reason: `Impossible d'attribuer le rôle vérifié : ${String(roleErr.message || roleErr)}`,
            });
            sendHtml(
                res,
                502,
                page(
                    'Rôle non attribué',
                    '<p class="err">Le bot n\'a pas pu te donner le rôle (hiérarchie des rôles ou permissions). Contacte un administrateur, puis réessaie avec <code>/verify</code>.</p>',
                ),
            );
            return;
        }

        try {
            saveVerifiedForGuild(guildId, discordUserId, emailHashPlaceholder, ipH);
        } catch (e) {
            await emitLog(ip, userAgent, {
                guildId,
                userId: discordUserId,
                success: false,
                kind: 'failed',
                geo,
                reason: `Erreur enregistrement base : ${String(e.message || e)}`,
            });
            console.error('[verify/submit] saveVerifiedForGuild', e);
            sendHtml(res, 500, page('Erreur', '<p class="err">Erreur technique lors de l\'enregistrement.</p>'));
            return;
        }

        await emitLog(ip, userAgent, {
            guildId,
            userId: discordUserId,
            success: true,
            kind: 'success',
            geo,
            reason: 'Vérification terminée, rôle attribué.',
        });

        sendHtml(
            res,
            200,
            page(
                '✅ Vérification réussie',
                '<p class="ok">Ton compte est vérifié et le rôle a été attribué sur le serveur. Tu peux fermer cette page.</p>',
            ),
        );
    }

    const server = http.createServer(async (req, res) => {
        // L'URL absolue n'est utilisée que pour parser le path/searchParams ;
        // l'host est ignoré côté logique.
        let parsedUrl;
        try {
            parsedUrl = new URL(req.url || '/', 'http://internal.local');
        } catch {
            sendText(res, 400, 'Bad URL');
            return;
        }

        try {
            if (req.method === 'GET' && parsedUrl.pathname === '/health') {
                sendText(res, 200, 'ok');
                return;
            }
            if (req.method === 'GET' && parsedUrl.pathname === '/verify/start') {
                await handleStart(req, res, parsedUrl);
                return;
            }
            if (req.method === 'POST' && parsedUrl.pathname === '/verify/submit') {
                await handleSubmit(req, res, parsedUrl);
                return;
            }
            sendText(res, 404, 'Not found');
        } catch (e) {
            console.error('[verifyServer]', e);
            if (!res.headersSent) {
                sendHtml(res, 500, page('Erreur serveur', '<p class="err">Erreur interne.</p>'));
            } else {
                try { res.end(); } catch { /* déjà fermé */ }
            }
        }
    });

    server.listen(opts.httpPort, () => {
        console.log(`[http] Verif sur le port ${opts.httpPort} — base ${opts.publicBaseUrl}`);
    });

    return { server };
}

module.exports = { createVerifyServer, clientIp };
