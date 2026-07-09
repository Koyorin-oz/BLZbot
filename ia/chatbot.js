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

const DEFAULT_MODEL = 'llama-3.3-70b-versatile';
const BUILTIN_FALLBACKS = ['llama-3.1-8b-instant', 'openai/gpt-oss-120b'];
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

/** Heuristique : enrichir avec une recherche web légère (SearXNG). */
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
        'INTERLOCUTEUR ACTUEL (réponds à LUI/ELLE uniquement) :',
        `Pseudo affiché : ${display}`,
        `ID Discord : ${uid}`,
    ];
    if (uid === KNOWN_USERS.koyorin_oz) {
        lines.push('C’est koyorin_oz (créateur) — tu peux le respecter un minimum tout en restant hard.');
    } else {
        lines.push(`Ce n’est PAS koyorin_oz (koyorin = ${KNOWN_USERS.koyorin_oz}). Ne confonds pas les pseudos.`);
    }
    return lines.join('\n');
}

/** Coupe les réponses trop longues pour le salon hard. */
function trimHardReply(text, isHard) {
    let s = String(text || '').trim();
    if (!isHard || !s) return s;
    const maxChars = Math.max(120, Number(process.env.IA_HARD_MAX_CHARS || 420));
    if (s.length <= maxChars) return s;
    const cut = s.slice(0, maxChars);
    const lastStop = Math.max(cut.lastIndexOf('.'), cut.lastIndexOf('!'), cut.lastIndexOf('?'));
    if (lastStop > maxChars * 0.45) return cut.slice(0, lastStop + 1);
    return `${cut}…`;
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
        ? 'Tu es BLZbot en mode hard sur BLZstarss : cash, sarcastique, tu insultes mais tu réponds toujours au message. Réponses courtes en français.'
        : `Tu es BLZbot sur BLZstarss : sérieux, poli et serviable. Tu n'insultes jamais ; si on t'insulte, renvoie vers <#${HARD_CHANNEL_ID}>. Réponses concises en français.`;
}

function getModelsToTry() {
    const primary = String(process.env.IA_CHATBOT_MODEL || process.env.GROQ_MODEL || DEFAULT_MODEL).trim() || DEFAULT_MODEL;
    return [...new Set([primary, ...BUILTIN_FALLBACKS.filter((m) => m !== primary)])];
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
    const st = pickHttpStatus(err);
    if (st === 401 || st === 403) return false;
    if (st === 400 || st === 404 || st === 429) return true;
    const lower = collectErrorText(err).toLowerCase();
    return (
        lower.includes('rate limit') ||
        lower.includes('too many requests') ||
        lower.includes('not found') ||
        lower.includes('decommissioned') ||
        lower.includes('does not exist') ||
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

async function groqChatCompletion(model, messages, { temperature, maxTokens }) {
    const key = getGroqApiKey();
    if (!key) {
        const e = new Error('Clé Groq absente (GROQ_API_KEY).');
        e.code = 'NO_KEY';
        throw e;
    }
    let res;
    try {
        res = await fetch(`${GROQ_BASE_URL}/chat/completions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
            body: JSON.stringify({
                model,
                messages,
                temperature: Math.min(2, Math.max(0, temperature)),
                max_tokens: Math.min(2048, Math.max(64, maxTokens)),
            }),
        });
    } catch (netErr) {
        const e = new Error(String(netErr?.message || netErr || 'Erreur réseau'));
        e.cause = netErr;
        throw e;
    }

    const body = await res.text();
    let data = {};
    if (body) {
        try {
            data = JSON.parse(body);
        } catch {
            data = { _raw: body.slice(0, 500) };
        }
    }
    if (!res.ok) {
        const msg = data?.error?.message || data?.message || body?.slice(0, 400) || res.statusText;
        const e = new Error(String(msg));
        e.status = res.status;
        throw e;
    }
    const choice = data?.choices?.[0];
    const text = choice?.message?.content != null ? String(choice.message.content).trim() : '';
    if (text) return text;
    if (choice?.finish_reason === 'content_filter') {
        const e = new Error('Filtre Groq (content_filter).');
        e.code = 'CONTENT_FILTER';
        throw e;
    }
    return '';
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

    try {
        await message.channel.sendTyping().catch(() => {});

        let system = loadPrompt(isHard ? 'hard' : 'normal');
        system = `${system}\n\n${buildSpeakerContext(message)}`;
        const emojiBit = await buildGuildEmojiAppendix(message.guild);
        if (emojiBit) system = `${system}\n\n---\n${emojiBit}`;

        const userName = message.member?.displayName || message.author.username;
        const userText = cleanContent(message, client) || '(pas de texte)';

        if (isHard && needsWebSearch(userText)) {
            const webBit = await fetchWebContextForQuery(userText);
            if (webBit) system += webBit;
        }

        const history = await buildHistory(message, client, isHard ? 4 : 6);

        const messages = [
            { role: 'system', content: system },
            ...history,
            {
                role: 'user',
                content: `${userName} [${message.author.id}]: ${userText}`,
            },
        ];

        const temperature = isHard ? 0.95 : 0.6;
        const maxTokens = isHard
            ? Number(process.env.IA_HARD_MAX_TOKENS || 220)
            : Number(process.env.IA_CHATBOT_MAX_TOKENS || 640);

        let reply = '';
        let lastErr;
        const models = getModelsToTry();
        for (let i = 0; i < models.length; i++) {
            try {
                reply = await groqChatCompletion(models[i], messages, { temperature, maxTokens });
                if (reply) break;
                if (i < models.length - 1) continue;
            } catch (e) {
                lastErr = e;
                if (i < models.length - 1 && shouldTryNextModel(e)) continue;
                throw e;
            }
        }
        if (!reply) {
            if (lastErr) throw lastErr;
            reply = isHard ? "T'as rien dit d'intéressant, réessaie." : 'Je n\'ai pas de réponse, reformule ?';
        }
        reply = trimHardReply(reply, isHard);
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
