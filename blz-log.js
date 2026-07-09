/**
 * Logs BLZbot — format épuré type Simbot (BLZ_COMPACT_LOG auto sur PebbleHost).
 */
const fs = require('node:fs');

let _policyApplied = false;
let _testBannerShown = false;
/** @type {Map<string, number>} */
const _dedupRecent = new Map();
const DEDUP_MS = 3 * 60 * 1000;

function isPebbleHost() {
    if (process.env.BLZ_PEBBLE_HOST === '1') return true;
    if (fs.existsSync('/home/container/.env')) return true;
    try {
        return process.cwd().startsWith('/home/container');
    } catch {
        return false;
    }
}

function isCompact() {
    const v = String(process.env.BLZ_COMPACT_LOG || '').trim().toLowerCase();
    if (v === '1' || v === 'true' || v === 'yes' || v === 'on') return true;
    if (v === '0' || v === 'false' || v === 'no' || v === 'off') return false;
    return isPebbleHost();
}

function applyGlobalLogPolicy() {
    if (_policyApplied) return;
    _policyApplied = true;

    if (isPebbleHost() && process.env.BLZ_COMPACT_LOG === undefined) {
        process.env.BLZ_COMPACT_LOG = '1';
    }
    process.env.DOTENV_CONFIG_QUIET = 'true';

    try {
        const dotenv = require('dotenv');
        if (!dotenv.__blzQuietPatched) {
            const orig = dotenv.config.bind(dotenv);
            dotenv.config = (opts = {}) => orig({ quiet: true, ...opts, quiet: opts.quiet ?? true });
            dotenv.__blzQuietPatched = true;
        }
    } catch {
        /* dotenv absent */
    }

    if (!process.env.NODE_OPTIONS?.includes('--no-deprecation')) {
        process.env.NODE_OPTIONS = [process.env.NODE_OPTIONS, '--no-deprecation'].filter(Boolean).join(' ').trim();
    }

    if (isCompact() && !process.env.BLZ_CHILD_LOG_LEVEL) {
        process.env.LOG_LEVEL = process.env.LOG_LEVEL || 'ERROR';
    }
}

function timeTag() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/**
 * @param {string} tag
 * @param {string} message
 */
function blzLine(tag, message) {
    const t = timeTag();
    const msg = String(message ?? '').replace(/\s+/g, ' ').trim();
    if (!msg) return;
    console.log(`${t} [${tag}] ${msg}`);
}

function blzWarn(tag, message) {
    const t = timeTag();
    console.warn(`${t} [${tag}] ${message}`);
}

function blzError(tag, message, err) {
    const t = timeTag();
    const extra = err ? ` — ${err?.message || err}` : '';
    console.error(`${t} [${tag}] ${message}${extra}`);
}

/** `niveau/src/index.js` → `niveau`, `ia/index.js` → `ia` */
function shortScriptName(scriptPath) {
    const s = String(scriptPath || '').replace(/\\/g, '/');
    if (s.includes('niveau/')) return 'niveau';
    if (s.includes('modération/') || s.includes('moderation/')) return 'modération';
    if (s.includes('verification/')) return 'verif';
    if (s.includes('/ia/') || s === 'ia/index.js' || s.startsWith('ia/')) return 'ia';
    if (s.includes('reborn-test-bot')) return 'reborn';
    if (s.includes('run-deploy-all') || s.includes('deploy-all')) return 'deploy';
    const base = s.split('/').pop() || s;
    return base.replace(/\.js$/, '');
}

/** Retire timestamps / tags imbriqués des workers. */
function normalizeChildBody(line) {
    let s = String(line).trim();
    for (let i = 0; i < 8; i++) {
        const next = s
            .replace(/^\d{2}:\d{2}:\d{2}\s+/, '')
            .replace(/^\[\d{4}-\d{2}-\d{2}T[^\]]+\]\s+/, '')
            .replace(/^\[(ERROR|WARN|INFO|DEBUG)\]\s+/i, '')
            .replace(/^\[[\w\-\/éèàùâêîôûçÉÈÀ\.]+\]\s+/i, '')
            .trim();
        if (next === s) break;
        s = next;
    }
    return s;
}

function shouldDedupLine(body) {
    const key = body.slice(0, 160);
    const now = Date.now();
    const prev = _dedupRecent.get(key);
    if (prev != null && now - prev < DEDUP_MS) return true;
    _dedupRecent.set(key, now);
    if (_dedupRecent.size > 400) {
        for (const [k, ts] of _dedupRecent) {
            if (now - ts > DEDUP_MS) _dedupRecent.delete(k);
        }
    }
    return false;
}

const CHILD_LINE_SKIP = [
    /^\s*$/,
    /\[dotenv@/i,
    /injecting env/i,
    /tip:\s*⌘/i,
    /tip:\s*📡/i,
    /tip:\s*⚙️/i,
    /tip:\s*🔐/i,
    /observe env with Radar/i,
    /enable debug logging/i,
    /prevent committing \.env/i,
    /load multiple \.env files/i,
    /^\[DEBUG\]/i,
    /^◇ injected env/i,
    /Initialisation de la base de données/i,
    /Base de données initialisée/i,
    /Tables de la base de données/i,
    /Connexion à la base de données/i,
    /\[MAJ-MARS\]/i,
    /\[GUILD-WAR\]/i,
    /Table ranked_daily_activity/i,
    /Table vip_custom_roles/i,
    /Tables de la boutique personnelle/i,
    /\[TUTORIAL\] Table tutorial_progress/i,
    /\[daily\] module canvas:/i,
    /Police personnalisée non trouvée/i,
    /\[DEPLOY-COMMANDS\]/i,
    /^═{3,}/,
    /^\[DEPLOY\] Loaded \d+ local/i,
    /^\[niveau\/deploy\] \/panel-voc code/i,
    /^\[\d+\] (Updating|Creating) \//i,
    /^\s*✅ Updated:/i,
    /^\s*✅ Created:/i,
    /Déploiement slash dans \d+s/i,
    /^\[modération\/deploy\] \d+ commande\(s\) locales/i,
    /🔄 Modération — enregistrement GLOBAL/i,
    /🔄 \[GLOBAL\] mise à jour/i,
    /✨ \[GLOBAL\] créée/i,
    /🗑️ \[GLOBAL\]/i,
    /✓ Connecté à la base de données/i,
    /Chargement dynamique de \d+ commande/i,
    /Commande \/.*chargée dynamiquement/i,
    /Événement Halloween/i,
    /Événement Noël/i,
    /Événement Saint-Valentin/i,
    /✅ Commandes des événements chargées/i,
    /\[INFO\] Commandes niveau \(global\)/i,
    /\[deploy-all\] Démarrage/i,
    /\[deploy-all\] Déploiement :/i,
    /\[deploy-all\] Connecté :/i,
    /\[deploy-all\] 1\/2/i,
    /\[deploy-all\] 2\/2/i,
    /\[BLZ\] ——— Mode TEST ———/,
    /\[BLZ\] BLZ_MAIN_GUILD_ID ne peut pas/i,
    /\[BLZ\] Ton GUILD_ID dans le \.env est déjà/i,
    /\[reborn\] BDD :/i,
    /Slash : orchestrateur/i,
    /REBORN \d+ cmd prêtes/i,
    /Slash niveau \+ modération/i,
    /Connecté .+ · app \d+/i,
    /REBORN preflight OK/i,
    /REBORN : \d+ slash/i,
    /Global niveau :/i,
    /REBORN sur guilde/i,
    /REBORN secours guilde/i,
    /\[DebanForum\] Forum/i,
    /Fonts manquantes pour le rendu de guilde/i,
    /BLZ_REBORN_SLASH_SCOPE=/i,
    /Salon panneau IA inconnu/i,
    /HTTP sans garde-fou proxy/i,
    /HTTP :\d+ · ⚠ sans proxy/i,
    /Vérification reset streak/i,
    /Supplying "ephemeral"/i,
    /Use `node --trace-warnings`/i,
    /\(node:\d+\) Warning:/i,
    /Deploy slash terminé.*cherche temple/i,
    /\[BOT_ROLE\]/i,
    /reborn désactivé/i,
    /reborn backup/i,
    /Échec sur tous les nœuds SearXNG/i,
    /chercher temple:guilde dans les lignes/i,
    /legacyGlobal/i,
    /mirrorGuild/i,
    /guildOnly \+/i,
    /cleanGuilds/i,
    /purgeGlobal/i,
    /REBORN guild \+/i,
];

const CHILD_LINE_ALLOW = [
    /^ready ·/i,
    /^reborn ·/i,
    /^services ·/i,
    /^deploy /i,
    /deploy .* ok/i,
    /global \+\d+/i,
    /modération \+\d+/i,
    /\[deploy\] Terminé/i,
    /Mode TEST ·/i,
    /❌|ERREUR|\[ERROR\]|Crash|unhandledRejection|uncaughtException/i,
];

/**
 * @param {string} scriptName
 * @param {string} line
 */
function shouldEmitChildLine(scriptName, line) {
    if (!isCompact()) return true;
    const s = String(line).replace(/\r\n/g, '\n').trim();
    if (!s) return false;

    const body = normalizeChildBody(s);
    if (!body) return false;

    if (CHILD_LINE_SKIP.some((re) => re.test(body) || re.test(s))) return false;

    if (CHILD_LINE_ALLOW.some((re) => re.test(body))) {
        return !shouldDedupLine(body);
    }

    if (/^ready ·/i.test(body)) return !shouldDedupLine(body);
    if (/❌|ERREUR|\[ERROR\]|Crash/i.test(body)) return true;

  // Messages courts utiles (≤ 90 car.) sans bruit deploy intermédiaire
    if (body.length <= 90 && !/\[niveau\/deploy\]/i.test(body) && !/REBORN/i.test(body)) {
        return !shouldDedupLine(body);
    }

    return false;
}

/**
 * @param {string} scriptName
 * @param {string} text
 */
function emitChildLine(scriptName, text) {
    const tag = shortScriptName(scriptName);
    const lines = String(text).replace(/\r\n/g, '\n').split('\n');
    for (const line of lines) {
        const s = line.trimEnd();
        if (!s.trim()) continue;
        if (!shouldEmitChildLine(scriptName, s)) continue;
        const body = normalizeChildBody(s);
        if (!body) continue;
        blzLine(tag, body);
    }
}

function logTestModeBanner(guildId, mainGuildId) {
    if (process.env.BLZ_SUPPRESS_TEST_BANNER === '1') return;
    if (_testBannerShown) return;
    _testBannerShown = true;
    const main = mainGuildId ? ` · main=${mainGuildId}` : '';
    if (isCompact()) {
        blzLine('BLZ', `Mode TEST · guild=${guildId}${main}`);
    } else {
        console.warn(
            `[BLZ] ——— Mode TEST ———  GUILD_ID=${guildId} (runtime + slash) · serveur principal slash aussi : BLZ_MAIN_GUILD_ID=${mainGuildId || '—'}`,
        );
    }
}

module.exports = {
    isPebbleHost,
    isCompact,
    applyGlobalLogPolicy,
    timeTag,
    blzLine,
    blzWarn,
    blzError,
    shortScriptName,
    normalizeChildBody,
    shouldEmitChildLine,
    emitChildLine,
    logTestModeBanner,
};
