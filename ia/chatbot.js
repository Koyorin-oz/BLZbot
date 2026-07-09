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

const HARD_CHANNEL_ID = config.HARD_MODE_CHANNEL_ID;
const NORMAL_CHANNEL_ID = config.BASIC_CHATBOT_CHANNEL_ID;

// Modèles chatbot : hard = persona trash (Kimi K2 0905 / OSS), normal = polyvalent.
const HARD_DEFAULT_MODEL = 'moonshotai/kimi-k2-instruct-0905';
const NORMAL_DEFAULT_MODEL = 'llama-3.3-70b-versatile';
const HARD_FALLBACKS = [
    'llama-3.1-8b-instant',
    'llama-3.3-70b-versatile',
    'openai/gpt-oss-120b',
    'meta-llama/llama-4-maverick-17b-128e-instruct',
    'qwen/qwen3-32b',
];
const NORMAL_FALLBACKS = ['llama-3.1-8b-instant', 'qwen/qwen3-32b'];
const GROQ_BASE_URL = String(process.env.GROQ_API_BASE || 'https://api.groq.com/openai/v1').replace(/\/$/, '');
const MAX_DISCORD = 1900;

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

/** Réponses locales si Groq est down / filtre tout — évite le message d'erreur générique en salon hard. */
function pickHardLocalFallback(userText) {
    const t = String(userText || '')
        .toLowerCase()
        .replace(/<@!?\d+>/g, '')
        .trim();
    if (/\bfeur\b/.test(t)) {
        return pickOne([
            "coiffeur toi-même t'as cru être drôle avec ton meme de 2019 ?",
            "feur ? ton humour il a pris le même train que ton charisme",
            "sale merde ton feur il fait grizz comme un ascenseur en panne",
        ]);
    }
    if (/tais\s*toi|\btg\b|\bftg\b/.test(t)) {
        return pickOne([
            "commence par te taire toi d'abord espèce de sonnette d'ascenseur",
            "tg ? va parler à un mur ça te ressemble plus",
        ]);
    }
    if (/racis/.test(t)) {
        return pickOne([
            "cv bien et toi t'as encore 0 personnalité à part m'insulter ?",
            "raciste va ? t'as inventé une insulte ou tu la recycles depuis 2016 ?",
        ]);
    }
    if (/nique|ntm|fdp|pute|merde|débile|nul|sale|chiant/.test(t)) {
        return pickOne([
            'répète une fois on verra qui ragequit en premier',
            "wow quelle répartie va te faire foutre ailleurs",
            "t'es là uniquement pour ça ? triste vie frère",
        ]);
    }
    return pickOne([
        "t'as rien dit d'intéressant là réessaie",
        "ok et ? t'as une vraie question ou tu spam ?",
        "j't'ai pas compris boloss reformule",
    ]);
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
    if (msg.reasoning_content != null) {
        const rc = String(msg.reasoning_content).trim();
        if (rc) return rc.slice(0, 500);
    }
    const reasoning = msg.reasoning != null ? String(msg.reasoning).trim() : '';
    if (reasoning) {
        const stripped = reasoning
            .replace(/<think[^>]*>[\s\S]*?<\/think>/gi, '')
            .replace(/<redacted_thinking[^>]*>[\s\S]*?<\/redacted_thinking>/gi, '')
            .trim();
        if (stripped) return stripped;
    }
    return '';
}

function maxTokensForModel(model, isHard) {
    if (isOssGroqModel(model)) {
        return Math.min(2048, Math.max(512, Number(process.env.IA_HARD_OSS_MAX_TOKENS || 768)));
    }
    return isHard
        ? Number(process.env.IA_HARD_MAX_TOKENS || 256)
        : Number(process.env.IA_CHATBOT_MAX_TOKENS || 640);
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

    const userTextEarly = cleanContent(message, client) || '(pas de texte)';

    try {
        await message.channel.sendTyping().catch(() => {});

        let system = loadPrompt(isHard ? 'hard' : 'normal');
        system = `${system}\n\n${buildSpeakerContext(message)}`;
        const emojiBit = await buildGuildEmojiAppendix(message.guild);
        if (emojiBit) system = `${system}\n\n---\n${emojiBit}`;

        const userName = message.member?.displayName || message.author.username;
        const userText = userTextEarly;

        if (isHard && needsWebSearch(userText)) {
            const webBit = await fetchWebContextForQuery(userText);
            if (webBit) system += webBit;
        }

        const history = await buildHistory(message, client, isHard ? 2 : 6);

        const messages = [
            { role: 'system', content: system },
            ...history,
            {
                role: 'user',
                content: `${userName} [${message.author.id}]: ${userText}`,
            },
        ];

        const temperature = isHard ? 0.82 : 0.6;

        let reply = '';
        let lastErr;
        const models = getModelsToTry(isHard);
        for (let i = 0; i < models.length; i++) {
            const model = models[i];
            try {
                reply = await groqChatCompletion(model, messages, {
                    temperature,
                    isHard,
                    maxTokens: maxTokensForModel(model, isHard),
                });
                if (reply) break;
                const emptyErr = new Error(`Réponse vide (${model}).`);
                emptyErr.code = 'EMPTY_REPLY';
                lastErr = emptyErr;
                if (i < models.length - 1) continue;
            } catch (e) {
                lastErr = e;
                console.error(`[ia chatbot] ${model}:`, collectErrorText(e).slice(0, 200));
                if (i < models.length - 1 && shouldTryNextModel(e)) continue;
                throw e;
            }
        }
        if (!reply) {
            if (lastErr) throw lastErr;
            reply = isHard ? "T'as rien dit d'intéressant, réessaie." : 'Je n\'ai pas de réponse, reformule ?';
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
        await message.reply(friendlyError(e)).catch(() => {});
    }
    return true;
}

module.exports = { handleChatbotMessage, HARD_CHANNEL_ID, NORMAL_CHANNEL_ID };
