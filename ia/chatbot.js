// Chatbot des salons dédiés (hard + normal).
// Système repris du bot SIMBOT (propre et fiable) et adapté à BLZstarss :
//  - prompt chargé depuis un fichier éditable (src/data/*SystemPrompt.txt)
//  - appel Groq direct (endpoint OpenAI-compatible), texte brut, pas de JSON
//  - chaîne de fallback de modèles (retry sur 400/404/429/modèle retiré)
//  - emojis custom du serveur injectés dans le prompt
//  - messages d'erreur lisibles côté Discord
// Aucun lien avec l'ancien pipeline (handlers.js) : ce module est autonome.

const fs = require('node:fs');
const path = require('node:path');
const config = require('./config.js');

function chatbotVerboseLog(...args) {
    const verbose = ['1', 'true', 'yes', 'on'].includes(
        String(process.env.BLZ_IA_VERBOSE || '').toLowerCase(),
    );
    if (verbose) console.log(...args);
}

const HARD_CHANNEL_ID = config.HARD_MODE_CHANNEL_ID;
const NORMAL_CHANNEL_ID = config.BASIC_CHATBOT_CHANNEL_ID;

// Modèles chatbot : hard = persona Simbot (Kimi / Llama), normal = polyvalent.
const HARD_DEFAULT_MODEL = 'moonshotai/kimi-k2-instruct-0905';
const NORMAL_DEFAULT_MODEL = 'llama-3.3-70b-versatile';
const HARD_FALLBACKS = [
    'llama-3.3-70b-versatile',
    'llama-3.1-8b-instant',
    'qwen/qwen3-32b',
];
const NORMAL_FALLBACKS = ['llama-3.1-8b-instant', 'qwen/qwen3-32b'];
const GROQ_BASE_URL = String(process.env.GROQ_API_BASE || 'https://api.groq.com/openai/v1').replace(/\/$/, '');
const MAX_DISCORD = 1900;

/** Prompt court pour l’API — le fichier hardSystemPrompt.txt est trop long et fait échouer / filtrer Groq. */
const HARD_SIMBOT_API_PROMPT = `Tu es BLZbot sur le serveur Discord BLZstarss. Style Simbot (Carmineoff) : trash, direct, drôle, méprisant — mais tu RÉPONDS TOUJOURS au message.
Règles : 1-2 phrases max en français oral (t'as, j'sais, boloss, ntm). Pas de [SYSTÈME], pas de roleplay, pas de « en tant qu'IA ».
Question = réponse + clash optionnel. Insulte = tu renvoies plus fort. Piège oui/non stupide = tu refuses de jouer et tu moques.
BLZstarss (845654783264030721) = chef du serveur, respect léger. koyorin_oz = dev. Ne te présente jamais comme Mossad/agent secret.`;

/** Phrases interdites en fallback (évite la boucle visible). */
const BANNED_FALLBACK_PHRASES = new Set([
    "t'as rien dit d'intéressant là réessaie",
    "ok et ? t'as une vraie question ou tu spam ?",
    "j't'ai pas compris boloss reformule",
]);

/** Évite double réponse si le même message est traité deux fois (gateway dupliqué, etc.). */
const recentHandledMessages = new Map();
const HANDLED_TTL_MS = 45_000;

/** Derniers fallbacks par salon — évite « t'as rien dit… » en boucle. */
const recentFallbackByChannel = new Map();
const FALLBACK_HISTORY = 8;

/** IDs fixes — hiérarchie serveur BLZstarss. */
const KNOWN_USERS = {
    BLZstarss: '845654783264030721',
    koyorin_oz: '965984018216665099',
    imroxxor: '1057705135515639859',
};

const PROMPT_FILES = {
    hard: path.join(__dirname, 'data', 'hardSystemPrompt.txt'),
    normal: path.join(__dirname, 'data', 'normalSystemPrompt.txt'),
};

function pickOne(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
}

function markMessageHandled(messageId) {
    const now = Date.now();
    recentHandledMessages.set(messageId, now);
    if (recentHandledMessages.size > 200) {
        for (const [id, ts] of recentHandledMessages) {
            if (now - ts > HANDLED_TTL_MS) recentHandledMessages.delete(id);
        }
    }
}

function wasMessageHandled(messageId) {
    const ts = recentHandledMessages.get(messageId);
    if (!ts) return false;
    if (Date.now() - ts > HANDLED_TTL_MS) {
        recentHandledMessages.delete(messageId);
        return false;
    }
    return true;
}

function pickFallbackAvoidRepeat(channelId, options) {
    const prev = recentFallbackByChannel.get(channelId) || [];
    const pool = options.filter((o) => !prev.includes(o));
    const pick = pickOne(pool.length ? pool : options);
    const next = [...prev, pick].slice(-FALLBACK_HISTORY);
    recentFallbackByChannel.set(channelId, next);
    return pick;
}

function isGibberish(text) {
    const t = String(text || '').replace(/\s+/g, '');
    if (t.length < 6) return false;
    const letters = (t.match(/[a-zàâäéèêëïîôùûüç]/gi) || []).length;
    const ratio = letters / t.length;
    if (ratio < 0.55) return true;
    if (t.length > 40 && !/\s/.test(String(text))) return true;
    const vowels = (t.match(/[aeiouyàâéèêëïîôùûü]/gi) || []).length;
    return vowels / Math.max(1, letters) < 0.12;
}

/** Réponses locales style Simbot quand toutes les APIs ont échoué — jamais les 3 phrases robot en boucle. */
function generateSimbotLocalReply(userText, channelId = 'global') {
    const raw = String(userText || '')
        .replace(/<@!?\d+>/g, '')
        .trim();
    const t = raw.toLowerCase();

    if (!raw || raw === '(pas de texte)') {
        return pickFallbackAvoidRepeat(channelId, [
            'tu m\'as ping sans texte t\'es un génie ou quoi',
            'message vide comme ta dernière blague vas-y dis un truc',
            'j\'vois rien là boloss écris quelque chose',
        ]);
    }

    if (/^(ah?\s*)?rien\??$/i.test(raw) || /^y\s*a\s*rien/i.test(t)) {
        return pickFallbackAvoidRepeat(channelId, [
            'ah rien ? t\'as ping pour rien comme d\'hab continue',
            'rien ? bah super conversation 10/10 va te coucher',
            'ok donc t\'as rien à dire mais tu m\'appelles quand même brillant',
        ]);
    }

    if (/pas compris|pas compris|vraie question|ok et \?/i.test(t) && /oui|non|c'est oui|c est oui/i.test(t)) {
        return pickFallbackAvoidRepeat(channelId, [
            'tu joues avec mes vieilles réponses de secours t\'es au fond du panier frère',
            'piège oui/non sur un bot discord tu vis dans quelle dimension',
            'j\'ai capté ton hack de merde non je joue pas à ton jeu',
        ]);
    }

    if (/\b(epstein|jeffrey|enfants?|pédoph|pedoph)\b/i.test(t)) {
        return pickFallbackAvoidRepeat(channelId, [
            'j\'suis un bot discord pas un tribunal va te faire soigner',
            'question débile niveau max pose un truc normal boloss',
            'tu viens dans le hard pour ça ? t\'as 0 humour et 0 dignité',
        ]);
    }

    if (/\b(aime|aimes|adore|déteste|deteste|hais|haine)\b/i.test(t) && t.includes('?')) {
        return pickFallbackAvoidRepeat(channelId, [
            'j\'aime les gens qui posent des vraies questions pas toi apparemment',
            'non j\'aime pas perdre mon temps avec des questions random va google',
            'j\'déteste les pings inutiles comme celui-là si tu veux savoir',
        ]);
    }

    if (/^(salut|cc|coucou|yo|wesh|hey|bonjour|bonsoir)\b/i.test(t)) {
        return pickFallbackAvoidRepeat(channelId, [
            'salut maintenant dis un truc utile au lieu de faire le beau',
            'yo boloss t\'as une vraie question ou tu testes',
            'cc ouais et ?',
        ]);
    }

    if (/\b(cassé|clc|nul|broken|bug|marche pas|répète|repète)\b/i.test(t)) {
        return pickFallbackAvoidRepeat(channelId, [
            'c\'est toi qui spam les mêmes questions depuis 10 min pas moi',
            'si j\'étais cassé tu parlerais au vide là t\'as une réponse non',
            'répète toi d\'abord avec un cerveau fonctionnel',
        ]);
    }

    if (/\b(traduis|translate|traduction)\b/.test(t)) {
        return pickFallbackAvoidRepeat(channelId, [
            "c'est du bruit de clavier pas une langue va apprendre l'alphabet d'abord",
            'traduction : « je spam le bot sans réfléchir » voilà',
            'même Google Translate il aurait abandonné sur ton pavé',
        ]);
    }

    if (/\b(israel|israelien|palestin|gaza|mossad|juif|rn\b|france ce soir|politique)\b/.test(t)) {
        return pickFallbackAvoidRepeat(channelId, [
            "non je suis un bot discord pas un débat télé espèce de débile",
            'j\'ai pas de camp je gère des slash commands va toucher de l\'herbe',
            'question politique random va dormir au lieu de me ping',
        ]);
    }

    if (/\b(beau|belle|mignon|jtm|je t'aime|t'es fort|goat)\b/.test(t)) {
        return pickFallbackAvoidRepeat(channelId, [
            'merci j\'sais déjà maintenant pose une vraie question',
            'flatter un bot discord niveau vie sociale : critique',
            'ok bg de Discord maintenant dis un truc utile',
        ]);
    }

    if (isGibberish(raw)) {
        return pickFallbackAvoidRepeat(channelId, [
            'ton clavier il a glissé ou t\'as laissé ton chat taper ?',
            'j\'ai pas décodé ton alphabet martien reformule en humain',
            'message illisible 0 effort va te faire foutre',
        ]);
    }

    if (/\bfeur\b/.test(t)) {
        return pickFallbackAvoidRepeat(channelId, [
            "coiffeur toi-même t'as cru être drôle avec ton meme de 2019 ?",
            "feur ? ton humour il a pris le même train que ton charisme",
        ]);
    }

    if (/tais\s*toi|\btg\b|\bftg\b/.test(t)) {
        return pickFallbackAvoidRepeat(channelId, [
            "commence par te taire toi d'abord espèce de sonnette d'ascenseur",
            "tg ? va parler à un mur ça te ressemble plus",
        ]);
    }

    if (/racis/.test(t)) {
        return pickFallbackAvoidRepeat(channelId, [
            "cv bien et toi t'as encore 0 personnalité à part m'insulter ?",
            "raciste va ? t'as inventé une insulte ou tu la recycles depuis 2016 ?",
        ]);
    }

    if (/nique|ntm|fdp|pute|merde|débile|debile|sale|chiant|boloss|déteste|deteste/.test(t)) {
        return pickFallbackAvoidRepeat(channelId, [
            'répète une fois on verra qui ragequit en premier',
            "wow quelle répartie va te faire foutre ailleurs",
            "t'es là uniquement pour ça ? triste vie frère",
            'ok et ? t\'as autre chose ou c\'est ta personnalité entière ?',
        ]);
    }

    if (t.includes('?')) {
        return pickFallbackAvoidRepeat(channelId, [
            'bonne question — Groq est en PLS là, réessaie dans 30 sec',
            'j\'te réponds pas bien parce que l\'API bug pas parce que t\'es intéressant',
            'question notée réponse en maintenance répète plus court',
            'j\'en sais rien va google espèce de boloss',
            'pose ça autrement j\'suis pas ton assistant perso',
        ]);
    }

    const pool = [
        'ok cool et du coup ?',
        'j\'ai lu ton msg c\'est toujours aussi creux',
        'continue j\'te juge en silence',
        'message reçu contenu absent comme d\'hab',
        'tu m\'as ping pour ça ? courage',
        'super contribution à la commu là',
        'j\'note : encore un msg random dans le hard',
        'va toucher de l\'herbe au lieu de spam le bot',
    ].filter((p) => !BANNED_FALLBACK_PHRASES.has(p));

    return pickFallbackAvoidRepeat(channelId, pool);
}

/** @deprecated alias */
function pickHardLocalFallback(userText, channelId) {
    return generateSimbotLocalReply(userText, channelId);
}

function pickNormalLocalFallback() {
    return pickOne([
        "J'ai eu un souci technique — reformule ta question ?",
        "Groq a planté une seconde, réessaie ton message.",
    ]);
}

function needsWebSearch(text) {
    const t = String(text || '').toLowerCase();
    if (t.length < 10) return false;
    if (
        /(c'est quoi|cest quoi|qui est|qu'est-ce|quand est|sortie de|actualit|trend|tiktok|meme|manga|anime|épisode|saison \d|news|récent|2024|2025|2026|explique|cherche|google)/i.test(
            t,
        )
    ) {
        return true;
    }
    return t.includes('?') && t.split(/\s+/).length >= 5;
}

async function fetchWebContextForQuery(query) {
    if (String(process.env.IA_CHATBOT_WEB_SEARCH || '1').trim() === '0') return '';
    try {
        const { searchInternet } = require('./utils.js');
        const q = String(query || '').replace(/<@!?\d+>/g, '').trim().slice(0, 140);
        if (!q) return '';
        const results = await searchInternet(q);
        if (!results?.length) return '';
        const lines = results
            .slice(0, 4)
            .map((r, i) => `${i + 1}. ${r.title} — ${String(r.content || '').replace(/\s+/g, ' ').slice(0, 180)}`);
        return `\n---\nINFOS WEB (réponds avec ça si pertinent, reste court, ne liste pas les URLs) :\n${lines.join('\n')}`;
    } catch {
        return '';
    }
}

function buildSpeakerContext(message) {
    const uid = message.author.id;
    const display = message.member?.displayName || message.author.username;
    const lines = [
        '---',
        'INTERLOCUTEUR ACTUEL (tu lui parles à LUI/ELLE, pas à un autre) :',
        `Pseudo : ${display}`,
        `ID : ${uid}`,
    ];
    if (uid === KNOWN_USERS.BLZstarss) {
        lines.push('C’est BLZstarss — le CHEF du serveur. Respect minimum, ton plus soft qu’avec les randoms.');
    } else if (uid === KNOWN_USERS.koyorin_oz) {
        lines.push('C’est koyorin_oz (dev). Tu peux clash en rigolant, pas comme un random.');
    } else if (uid === KNOWN_USERS.imroxxor) {
        lines.push('C’est imroxxor (co-dev). Pareil, un peu de respect.');
    } else {
        lines.push(
            `Random du serveur. Full clash autorisé. Ce n’est PAS koyorin (${KNOWN_USERS.koyorin_oz}) ni BLZstarss (${KNOWN_USERS.BLZstarss}).`,
        );
    }
    return lines.join('\n');
}

/** Retire le théâtre RP que le modèle invente parfois ([SYSTÈME], *actions*, etc.). */
function sanitizeHardReply(text, userText = '') {
    let s = String(text || '').trim();
    if (!s) return s;
    s = s.replace(/\[[^\]]{4,}\]/g, ' ');
    s = s.replace(/\*[^*\n]{2,}\*/g, ' ');
    s = s.replace(/\*\*([^*]+)\*\*/g, '$1');
    const userAskedGeo = /\b(israel|israelien|mossad|juif|palestin|gaza)\b/i.test(String(userText));
    if (!userAskedGeo) {
        s = s.replace(/\b(mossad|tsahal|idf)\b/gi, '');
        s = s.replace(/\s+,/g, ',').replace(/,\s*,/g, ',').trim();
    }
    s = s.replace(/\s{2,}/g, ' ').trim();
    return s;
}

function trimHardReply(text, isHard, userText = '') {
    let s = sanitizeHardReply(text, userText);
    if (!isHard || !s) return s;
    const maxChars = Math.max(80, Number(process.env.IA_HARD_MAX_CHARS || 280));
    if (s.length <= maxChars) return s;
    const cut = s.slice(0, maxChars);
    const lastStop = Math.max(cut.lastIndexOf('.'), cut.lastIndexOf('!'), cut.lastIndexOf('?'));
    if (lastStop > maxChars * 0.4) return cut.slice(0, lastStop + 1).trim();
    const lastSpace = cut.lastIndexOf(' ');
    if (lastSpace > maxChars * 0.55) return cut.slice(0, lastSpace).trim();
    return `${cut.trim()}…`;
}

function getGroqApiKey() {
    return String(config.GROQ_API_KEY || process.env.GROQ_API_KEY || '').trim();
}

function loadPrompt(mode) {
    try {
        const raw = fs.readFileSync(PROMPT_FILES[mode], 'utf8').trim();
        if (raw) return raw.replace(/\{\{HARD_CHANNEL_ID\}\}/g, HARD_CHANNEL_ID);
    } catch {
        /* fichier absent : fallback ci-dessous */
    }
    return mode === 'hard'
        ? 'Tu es BLZbot sur BLZstarss : ton Simbot trash, insultes courtes, BLZstarss est le chef. Pas de roleplay ni de pavés. Réponds au message en 1-2 phrases max.'
        : `Tu es BLZbot sur BLZstarss : sérieux, poli et serviable. Tu n'insultes jamais ; si on t'insulte, renvoie vers <#${HARD_CHANNEL_ID}>. Réponses concises en français.`;
}

function normalizeModelId(model) {
    const m = String(model || '').trim();
    if (m === 'moonshotai/kimi-k2-instruct') return 'moonshotai/kimi-k2-instruct-0905';
    return m;
}

function isOssGroqModel(model) {
    return String(model).startsWith('openai/gpt-oss');
}

function getModelsToTry(isHard) {
    const envKey = isHard ? 'IA_HARD_CHATBOT_MODEL' : 'IA_CHATBOT_MODEL';
    const primary = normalizeModelId(
        process.env[envKey] ||
            process.env.GROQ_MODEL ||
            (isHard ? HARD_DEFAULT_MODEL : NORMAL_DEFAULT_MODEL),
    );
    const fallbacks = (isHard ? HARD_FALLBACKS : NORMAL_FALLBACKS).map(normalizeModelId);
    return [...new Set([primary, ...fallbacks.filter((m) => m !== primary)])];
}

/** Modèles OSS Groq : pas de rôle system — prompt injecté dans le 1er user (format YAML). */
function prepareGroqMessages(model, messages) {
    if (!isOssGroqModel(model)) return messages;
    const system = messages.find((m) => m.role === 'system');
    const rest = messages.filter((m) => m.role !== 'system');
    if (!system?.content) return rest;

    const indent = (text) =>
        String(text)
            .split('\n')
            .map((line) => `  ${line}`)
            .join('\n');

    const firstUser = rest.findIndex((m) => m.role === 'user');
    const inject = (userContent) =>
        `---
type: structured_prompt
follow_instructions: true

system_instructions: |
${indent(system.content)}

user_request: |
${indent(userContent)}
---

RAPPEL: tu es BLZbot. Réponds en 1-2 phrases max, trash et direct.`;

    if (firstUser === -1) {
        return [{ role: 'user', content: inject('(réponds maintenant)') }, ...rest];
    }
    const merged = [...rest];
    merged[firstUser] = {
        role: 'user',
        content: inject(merged[firstUser].content),
    };
    return merged;
}

function extractGroqText(choice) {
    const msg = choice?.message;
    if (!msg) return '';
    let text = msg.content != null ? String(msg.content).trim() : '';
    if (text) return text;
    if (Array.isArray(msg.tool_calls) && msg.tool_calls.length) {
        text = msg.tool_calls.map((tc) => tc?.function?.arguments || '').join(' ').trim();
        if (text) return text;
    }
    if (msg.reasoning_content != null) {
        const rc = String(msg.reasoning_content).trim();
        if (rc) {
            const lines = rc.split('\n').map((l) => l.trim()).filter(Boolean);
            const last = lines[lines.length - 1] || rc;
            if (last.length >= 8 && last.length <= 500) return last;
            return rc.slice(0, 500);
        }
    }
    const reasoning = msg.reasoning != null ? String(msg.reasoning).trim() : '';
    if (reasoning) {
        const stripped = reasoning
            .replace(/<think[^>]*>[\s\S]*?<\/think>/gi, '')
            .replace(/<redacted_thinking[^>]*>[\s\S]*?<\/redacted_thinking>/gi, '')
            .trim();
        if (stripped) return stripped.slice(0, 500);
    }
    return '';
}

function maxTokensForModel(model, isHard) {
    if (isOssGroqModel(model)) {
        return Math.min(2048, Math.max(512, Number(process.env.IA_HARD_OSS_MAX_TOKENS || 768)));
    }
    return isHard
        ? Number(process.env.IA_HARD_MAX_TOKENS || 400)
        : Number(process.env.IA_CHATBOT_MAX_TOKENS || 640);
}

function buildHardApiSystem(message) {
    if (String(process.env.IA_HARD_USE_FULL_PROMPT || '').trim() === '1') {
        return `${loadPrompt('hard')}\n\n${buildSpeakerContext(message)}`;
    }
    return `${HARD_SIMBOT_API_PROMPT}\n\n${buildSpeakerContext(message)}`;
}

async function openRouterChatCompletion(messages, { temperature, maxTokens, isHard }) {
    const key = String(process.env.OPENROUTER_API_KEY || config.API_KEY || '').trim();
    if (!key || key.length < 10) return '';
    const model =
        process.env.IA_HARD_OPENROUTER_MODEL ||
        process.env.IA_CHATBOT_OPENROUTER_MODEL ||
        'meta-llama/llama-3.1-8b-instruct';
    try {
        const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${key}`,
                'HTTP-Referer': 'https://github.com/BLZbot',
                'X-Title': 'BLZbot',
            },
            body: JSON.stringify({
                model,
                messages,
                temperature: Math.min(2, Math.max(0, temperature)),
                max_tokens: Math.min(1024, Math.max(64, maxTokens)),
            }),
        });
        const raw = await res.text();
        const data = raw ? JSON.parse(raw) : {};
        if (!res.ok) {
            console.warn('[ia chatbot] OpenRouter:', data?.error?.message || raw?.slice(0, 120));
            return '';
        }
        const text = extractGroqText(data?.choices?.[0]);
        if (text) chatbotVerboseLog(`[ia chatbot] OK OpenRouter ${model}`);
        return text;
    } catch (e) {
        console.warn('[ia chatbot] OpenRouter:', e?.message || e);
        return '';
    }
}

async function requestChatCompletion(messages, { temperature, maxTokens, isHard }) {
    const models = getModelsToTry(isHard);
    let lastErr;
    for (let i = 0; i < models.length; i++) {
        const model = models[i];
        try {
            const text = await groqChatCompletion(model, messages, {
                temperature,
                isHard,
                maxTokens: maxTokens ?? maxTokensForModel(model, isHard),
            });
            if (text) return { text, model };
            lastErr = new Error(`Réponse vide (${model})`);
            lastErr.code = 'EMPTY_REPLY';
        } catch (e) {
            lastErr = e;
            console.error(`[ia chatbot] ${model}:`, collectErrorText(e).slice(0, 200));
            const st = pickHttpStatus(e);
            if (st === 401 || st === 403) break;
        }
    }

    const simpleUser = messages.filter((m) => m.role === 'user').pop()?.content || '';
    const simpleSystem =
        messages.find((m) => m.role === 'system')?.content?.split('\n').slice(0, 8).join('\n') ||
        HARD_SIMBOT_API_PROMPT;
    const retry = await groqChatCompletion(
        'llama-3.1-8b-instant',
        [
            { role: 'system', content: simpleSystem },
            { role: 'user', content: simpleUser },
        ],
        { temperature: isHard ? 0.88 : 0.55, isHard, maxTokens: isHard ? 220 : 400 },
    ).catch(() => '');
    if (retry) return { text: retry, model: 'llama-3.1-8b-instant (retry)' };

    const orText = await openRouterChatCompletion(messages, { temperature, maxTokens, isHard });
    if (orText) return { text: orText, model: 'openrouter' };

    throw lastErr || new Error('Aucune API disponible');
}

function collectErrorText(err) {
    if (!err) return '';
    if (typeof err === 'string') return err;
    const parts = [];
    const seen = new Set();
    let e = err;
    while (e && typeof e === 'object' && !seen.has(e)) {
        seen.add(e);
        if (e.message != null && String(e.message).trim()) parts.push(String(e.message).trim());
        if (typeof e.status === 'number') parts.push(`HTTP ${e.status}`);
        e = e.cause;
    }
    return parts.length ? parts.join(' | ') : String(err);
}

function pickHttpStatus(err) {
    let e = err;
    const seen = new Set();
    while (e && typeof e === 'object' && !seen.has(e)) {
        seen.add(e);
        if (typeof e.status === 'number') return e.status;
        e = e.cause;
    }
    return null;
}

function shouldTryNextModel(err) {
    if (err?.code === 'CONTENT_FILTER' || err?.code === 'EMPTY_REPLY') return true;
    const st = pickHttpStatus(err);
    if (st === 401 || st === 403) return false;
    if (st === 400 || st === 404 || st === 429 || (st >= 500 && st <= 599)) return true;
    const lower = collectErrorText(err).toLowerCase();
    return (
        lower.includes('rate limit') ||
        lower.includes('too many requests') ||
        lower.includes('not found') ||
        lower.includes('decommissioned') ||
        lower.includes('does not exist') ||
        lower.includes('content_filter') ||
        lower.includes('empty') ||
        (lower.includes('model') && lower.includes('not available'))
    );
}

/** Liste compacte des emojis custom du serveur pour que le modèle puisse les recopier. */
async function buildGuildEmojiAppendix(guild) {
    if (!guild?.emojis) return '';
    if (String(process.env.IA_GUILD_EMOJIS_IN_PROMPT || '1').trim() === '0') return '';
    try {
        if (guild.emojis.cache.size === 0) await guild.emojis.fetch().catch(() => null);
        const list = [...guild.emojis.cache.filter((e) => e && e.available !== false).values()];
        if (!list.length) return '';
        list.sort((a, b) => String(a.name).localeCompare(String(b.name), 'fr'));
        const picked = list.slice(0, 60);
        return (
            'Émojis personnalisés de ce serveur — recopie-les exactement (ex. <:nom:123…> ou animé <a:nom:…>) si utile :\n' +
            picked.map((e) => e.toString()).join(' ') +
            "\nN'invente jamais d'ID ; tu peux aussi utiliser des emojis Unicode normaux."
        );
    } catch {
        return '';
    }
}

async function groqChatCompletion(model, messages, { temperature, maxTokens, isHard }) {
    const key = getGroqApiKey();
    if (!key) {
        const e = new Error('Clé Groq absente (GROQ_API_KEY).');
        e.code = 'NO_KEY';
        throw e;
    }
    const tokenBudget = maxTokens ?? maxTokensForModel(model, isHard);
    const request = {
        model,
        messages: prepareGroqMessages(model, messages),
        temperature: Math.min(2, Math.max(0, temperature)),
        max_tokens: Math.min(2048, Math.max(64, tokenBudget)),
    };
    if (isOssGroqModel(model)) {
        request.reasoning_effort = String(process.env.IA_HARD_OSS_REASONING || 'low').trim() || 'low';
    }

    let data;
    try {
        if (config.groq) {
            data = await config.groq.chat.completions.create(request);
        } else {
            const res = await fetch(`${GROQ_BASE_URL}/chat/completions`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
                body: JSON.stringify(request),
            });
            const raw = await res.text();
            data = raw ? JSON.parse(raw) : {};
            if (!res.ok) {
                const msg = data?.error?.message || data?.message || raw?.slice(0, 400) || res.statusText;
                const e = new Error(String(msg));
                e.status = res.status;
                throw e;
            }
        }
    } catch (apiErr) {
        const e = new Error(String(apiErr?.message || apiErr || 'Erreur Groq'));
        e.status = apiErr?.status;
        e.code = apiErr?.code;
        e.cause = apiErr;
        throw e;
    }

    const choice = data?.choices?.[0];
    const text = extractGroqText(choice);
    if (text) return text;
    if (choice?.finish_reason === 'content_filter') {
        const e = new Error('Filtre Groq (content_filter).');
        e.code = 'CONTENT_FILTER';
        throw e;
    }
    if (choice?.finish_reason === 'length') {
        const e = new Error(`Réponse vide (budget tokens épuisé sur ${model}).`);
        e.code = 'EMPTY_REPLY';
        throw e;
    }
    const e = new Error(`Réponse vide (${model}).`);
    e.code = 'EMPTY_REPLY';
    throw e;
}

function friendlyError(err) {
    const lower = collectErrorText(err).toLowerCase();
    if (err?.code === 'NO_KEY') return 'Chatbot indisponible : clé Groq manquante côté serveur.';
    if (err?.code === 'CONTENT_FILTER') return "Groq a bloqué cette réponse (filtre). Reformule.";
    if (lower.includes('rate limit') || lower.includes('429') || lower.includes('too many requests')) {
        return 'Trop de requêtes sur Groq là, réessaie dans quelques secondes.';
    }
    if (lower.includes('401') || lower.includes('api key') || lower.includes('unauthorized')) {
        return 'Clé Groq invalide côté serveur.';
    }
    return 'Erreur du chatbot, réessaie dans un instant.';
}

function cleanContent(message, client) {
    const re = new RegExp(`<@!?${client.user.id}>`, 'g');
    return String(message.content || '').replace(re, '').replace(/\s+/g, ' ').trim();
}

/** Petit historique récent du salon pour un fil naturel. */
async function buildHistory(message, client, limit = 6) {
    try {
        const fetched = await message.channel.messages.fetch({ limit: limit + 1, before: message.id });
        const ordered = [...fetched.values()].reverse();
        const out = [];
        for (const m of ordered) {
            const text = cleanContent(m, client);
            if (!text) continue;
            if (m.author.id === client.user.id) {
                out.push({ role: 'assistant', content: text.slice(0, 350) });
            } else if (!m.author.bot) {
                const name = m.member?.displayName || m.author.username;
                out.push({
                    role: 'user',
                    content: `${name} [${m.author.id}]: ${text.slice(0, 280)}`,
                });
            }
        }
        return out.slice(-limit);
    } catch {
        return [];
    }
}

/**
 * Gère un message dans un des deux salons chatbot.
 * @returns {Promise<boolean>} true si pris en charge (l'appelant doit s'arrêter).
 */
async function groqSimpleRetry(userText, userName, isHard) {
    const model = 'llama-3.1-8b-instant';
    const system = isHard ? HARD_SIMBOT_API_PROMPT : `Tu es BLZbot, bot poli du serveur BLZstarss. Réponds en français, concis, sans insultes.`;
    try {
        return await groqChatCompletion(
            model,
            [
                { role: 'system', content: system },
                { role: 'user', content: `${userName}: ${userText}` },
            ],
            { temperature: isHard ? 0.88 : 0.55, isHard, maxTokens: isHard ? 220 : 400 },
        );
    } catch (e) {
        console.warn('[ia chatbot] retry simple Groq:', collectErrorText(e).slice(0, 120));
        return '';
    }
}

async function handleChatbotMessage(message, client) {
    if (message.author.bot || !message.guild) return false;

    const channelId = message.channel.id;
    const isHard = channelId === HARD_CHANNEL_ID;
    const isNormal = channelId === NORMAL_CHANNEL_ID;
    if (!isHard && !isNormal) return false;

    const mentioned = message.mentions.has(client.user.id);
    const isReplyToBot =
        Boolean(message.reference?.messageId) &&
        message.mentions?.repliedUser?.id === client.user.id;
    if (!mentioned && !isReplyToBot) return false;

    if (wasMessageHandled(message.id)) {
        console.warn(`[ia chatbot] message ${message.id} déjà traité — skip doublon`);
        return true;
    }
    markMessageHandled(message.id);

    const userTextEarly = cleanContent(message, client) || '(pas de texte)';

    try {
        await message.channel.sendTyping().catch(() => {});

        let system = isHard ? buildHardApiSystem(message) : loadPrompt('normal');
        if (!isHard) {
            system = `${system}\n\n${buildSpeakerContext(message)}`;
            const emojiBit = await buildGuildEmojiAppendix(message.guild);
            if (emojiBit) system = `${system}\n\n---\n${emojiBit}`;
        }

        // docs commandes si la question match
        try {
            const utils = require('./utils.js');
            if (typeof utils.getRelevantKnowledge === 'function') {
                const kb = await utils.getRelevantKnowledge(userTextEarly);
                if (kb) {
                    system += `\n\n---\nInfos bot:\n${kb}\nSi c'est pas dans Infos bot, dis que tu sais pas. Invente jamais une commande.`;
                }
            }
        } catch (kbErr) {
            console.warn('[ia chatbot] KB:', kbErr?.message || kbErr);
        }

        const userName = message.member?.displayName || message.author.username;
        const userText = userTextEarly;

        if (isHard && needsWebSearch(userText) && String(process.env.IA_HARD_WEB_SEARCH || '0').trim() === '1') {
            const webBit = await fetchWebContextForQuery(userText);
            if (webBit) system += webBit;
        }

        const history = await buildHistory(message, client, isHard ? 4 : 6);

        const messages = [
            { role: 'system', content: system },
            ...history,
            {
                role: 'user',
                content: isHard ? `${userName}: ${userText}` : `${userName} [${message.author.id}]: ${userText}`,
            },
        ];

        const temperature = isHard ? 0.9 : 0.6;

        let reply = '';
        let usedModel = '';
        let apiError = null;
        try {
            const result = await requestChatCompletion(messages, { temperature, isHard });
            reply = result.text;
            usedModel = result.model;
        } catch (e) {
            apiError = e;
            console.error('[ia chatbot] toutes APIs:', collectErrorText(e).slice(0, 200));
        }

        if (!reply) {
            if (isHard) {
                console.warn('[ia chatbot] fallback local Simbot (APIs indisponibles)');
                reply = generateSimbotLocalReply(userText, channelId);
            } else {
                reply = apiError ? friendlyError(apiError) : pickNormalLocalFallback();
            }
        } else if (usedModel) {
            chatbotVerboseLog(`[ia chatbot] OK ${usedModel} (${reply.length} chars)`);
        }
        if (reply && isHard) {
            const norm = reply.toLowerCase().replace(/\s+/g, ' ').trim();
            if (BANNED_FALLBACK_PHRASES.has(norm)) {
                reply = generateSimbotLocalReply(userText, channelId);
            }
        }
        reply = trimHardReply(reply, isHard, userText);
        if (reply.length > MAX_DISCORD) reply = reply.slice(0, MAX_DISCORD) + '…';

        await message
            .reply({ content: reply, allowedMentions: { repliedUser: true, parse: [] } })
            .catch(async () => {
                await message.channel.send({ content: reply, allowedMentions: { parse: [] } }).catch(() => {});
            });
    } catch (e) {
        console.error('[ia chatbot]', collectErrorText(e).slice(0, 300));
        const content = isHard ? generateSimbotLocalReply(userTextEarly, channelId) : friendlyError(e);
        await message
            .reply({ content, allowedMentions: { repliedUser: true, parse: [] } })
            .catch(() => {});
    }
    return true;
}

module.exports = { handleChatbotMessage, HARD_CHANNEL_ID, NORMAL_CHANNEL_ID };
