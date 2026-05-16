/**
 * Logs BLZbot — format court pour Pebble / orchestrateur (BLZ_COMPACT_LOG).
 * Auto-compact si le conteneur est sous /home/container (PebbleHost).
 */
const fs = require('node:fs');

let _policyApplied = false;
let _testBannerShown = false;

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
 * @param {string} tag ex. niveau, modération, maintemp
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

/** `niveau/src/index.js` → `niveau` */
function shortScriptName(scriptPath) {
    const s = String(scriptPath || '').replace(/\\/g, '/');
    if (s.includes('niveau/')) return 'niveau';
    if (s.includes('modération/') || s.includes('moderation/')) return 'modération';
    if (s.includes('verification/')) return 'verif';
    if (s.includes('/ia/')) return 'ia';
    if (s.includes('reborn-test-bot')) return 'reborn';
    const base = s.split('/').pop() || s;
    return base.replace(/\.js$/, '');
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
    /\[deploy-all\] Démarrage — si rien/i,
    /\[deploy-all\] Déploiement :/i,
    /\[deploy-all\] Connecté :/i,
    /\[deploy-all\] 1\/2/i,
    /\[deploy-all\] 2\/2/i,
    /\[BLZ\] ——— Mode TEST ———/,
    /\[BLZ\] BLZ_MAIN_GUILD_ID ne peut pas/i,
    /\[BLZ\] Ton GUILD_ID dans le \.env est déjà/i,
    /\[reborn\] BDD :/i,
];

const CHILD_LINE_KEEP = [
    /Slash GLOBAL/i,
    /Slash \*\*guild\*\*/i,
    /\[deploy-all\] Terminé/i,
    /\[maintemp\]/i,
    /est prêt/i,
    /Connecté en tant que/i,
    /— \d+ cmd/i,
    /Modération GLOBAL:/i,
    /\[modération\] Slash GLOBAL/i,
    /\[niveau\] Slash GLOBAL/i,
    /ERREUR|❌|Crash|error/i,
    /\[WARN\]/i,
    /\[ERROR\]/i,
    /Mode TEST ·/i,
    /\[verif\] (bot|http|Build)/i,
    /\[ia\]/i,
    /\[Welcome\]/i,
    /\[ANTI-RAID\]/i,
];

/**
 * Filtre le bruit des workers sous maintemp (compact uniquement).
 * @param {string} scriptName
 * @param {string} line
 */
function shouldEmitChildLine(scriptName, line) {
    if (!isCompact()) return true;
    const raw = String(line).replace(/\r\n/g, '\n');
    const parts = raw.split('\n');
    return parts.some((part) => {
        const s = part.trim();
        if (!s) return false;
        if (CHILD_LINE_KEEP.some((re) => re.test(s))) return true;
        if (CHILD_LINE_SKIP.some((re) => re.test(s))) return false;
        if (/^\[INFO\]/i.test(s)) return false;
        if (/^✓ Commande chargée:/i.test(s)) return false;
        if (/^✓ Événement chargé:/i.test(s)) return false;
        if (/^\[COMMANDS\]/i.test(s)) return false;
        if (/^\[EVENTS\]/i.test(s)) return false;
        if (/^\[READY\]/i.test(s)) return false;
        if (/^🔄 Tentative modèle:/i.test(s)) return false;
        if (/^🎯 Groq ciblé/i.test(s)) return false;
        if (/^🔄 Tentative Groq/i.test(s)) return false;
        if (/^✅ Stream Groq/i.test(s)) return false;
        if (/^✅ Succès Groq/i.test(s)) return false;
        if (/^✅ JSON détecté/i.test(s)) return false;
        if (/^📋 Réponse structurée/i.test(s)) return false;
        if (/^🔍 \[DUPLICATE CHECK\]/i.test(s)) return false;
        if (/^🧠 \d+ nouveaux faits/i.test(s)) return false;
        if (/^Appel Groq \(ex-Gemma\)/i.test(s)) return false;
        if (/Embeddings non configurés/i.test(s)) return false;
        if (/Paramètres utilisateur chargés/i.test(s)) return false;
        if (/La base de connaissances des embeddings est vide/i.test(s)) return false;
        if (/Historique du fil chargé/i.test(s)) return false;
        if (/Démarrage de la tâche d'archivage/i.test(s)) return false;
        if (/Archivage\/suppression des fils/i.test(s)) return false;
        if (/Salon panneau IA inconnu/i.test(s)) return false;
        if (/Commandes slash enregistrées \(mode additif\)/i.test(s)) return false;
        if (/^\[\d{4}-\d{2}-\d{2}T/.test(s) && !/❌|ERREUR|Error|Crash/i.test(s)) return false;
        return true;
    });
}

/**
 * Affiche une ligne enfant avec tag court.
 */
function emitChildLine(scriptName, text) {
    const tag = shortScriptName(scriptName);
    const lines = String(text).replace(/\r\n/g, '\n').split('\n');
    for (const line of lines) {
        const s = line.trimEnd();
        if (!s.trim()) continue;
        if (!shouldEmitChildLine(scriptName, s)) continue;
        const body = s.replace(/^\[[^\]]+\]\s*/, '').trim() || s;
        blzLine(tag, body);
    }
}

function logTestModeBanner(guildId, mainGuildId) {
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
    shouldEmitChildLine,
    emitChildLine,
    logTestModeBanner,
};
