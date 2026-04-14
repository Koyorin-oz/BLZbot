const path = require('path');
const { resolveDotenvPath, PEBBLE_HOST_ENV_PATH } = require(path.join(__dirname, '..', 'blzbot-env.js'));
require('dotenv').config({
    path: resolveDotenvPath(
        path.resolve(__dirname, '../.env'),
        PEBBLE_HOST_ENV_PATH,
        path.join(process.cwd(), '.env')
    ),
});

const Groq = require('groq-sdk');
const { InferenceClient } = require('@huggingface/inference');

const API_KEY = process.env.OPENROUTER_API_KEY;
const AIMAPI_KEY = process.env.AIMAPI_KEY;
const HF_API_KEY = process.env.HF_API_KEY;
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_DEFAULT_MODEL = (process.env.GROQ_MODEL || 'llama-3.1-8b-instant').trim();
const GROQ_COOLDOWN_MS = Math.max(0, parseInt(process.env.GROQ_COOLDOWN_MS || '0', 10));
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const SAMBANOVA_API_KEY = process.env.SAMBANOVA_API_KEY;
const CEREBRAS_API_KEY = process.env.CEREBRAS_API_KEY;
const CLOUDFLARE_API_TOKEN = process.env.CLOUDFLARE_API_TOKEN || "y_WPOTBmXfNgCmgdAFcrwN44PXhanH12bUbbr9Uu";
const CLOUDFLARE_ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID || "1951d3c93101f936e0f48eea74bc662e";

const HF_MODEL = "Mistral-7B-Instruct";

const GROQ_MODELS_LIST = [
    { name: 'meta-llama/llama-4-maverick-17b-128e-instruct', provider: 'groq', displayName: 'Llama 4 Maverick', cutoff: 'Août 2024', multimodal: true, description: 'Multimodal', includeReplyContext: true },
    { name: 'meta-llama/llama-4-scout-17b-16e-instruct', provider: 'groq', displayName: 'Llama 4 Scout', cutoff: 'Août 2024', multimodal: true, description: 'Scout', includeReplyContext: true },
    { name: 'llama-3.3-70b-versatile', provider: 'groq', displayName: 'Llama 3.3 Versatile', cutoff: 'Décembre 2023', multimodal: false, description: 'Versatile', includeReplyContext: true },
    { name: 'openai/gpt-oss-120b', provider: 'groq', displayName: 'GPT OSS 120B', cutoff: 'Juin 2024', multimodal: false, description: 'Le plus intelligent de la gamme groq', includeReplyContext: true },
    { name: 'moonshotai/kimi-k2-instruct', provider: 'groq', displayName: 'Kimi K2', cutoff: 'Octobre 2024', multimodal: false, description: 'Modèle chinois long contexte', includeReplyContext: true },
    { name: 'moonshotai/kimi-k2-instruct-0905', provider: 'groq', displayName: 'Kimi K2 0905', cutoff: 'Octobre 2024', multimodal: false, description: 'Update K2 Octobre', includeReplyContext: true },
    { name: 'openai/gpt-oss-20b', provider: 'groq', displayName: 'GPT OSS 20B', cutoff: 'Juin 2024', multimodal: false, description: 'Modèle intermédiaire OS', includeReplyContext: true },
    { name: 'allam-2-7b', provider: 'groq', displayName: 'Allam 2', cutoff: 'Janvier 2024', multimodal: false, description: 'Spécialisé Arabe/Anglais', includeReplyContext: true },
    { name: 'qwen/qwen3-32b', provider: 'groq', displayName: 'Qwen 3 32B', cutoff: 'Septembre 2024', multimodal: false, description: 'Excellent ratio perf/taille', includeReplyContext: true },
    { name: 'meta-llama/llama-guard-4-12b', provider: 'groq', displayName: 'Llama Guard 4', cutoff: 'Août 2024', multimodal: false, description: 'Modération de contenu', includeReplyContext: true },
    { name: 'openai/gpt-oss-safeguard-20b', provider: 'groq', displayName: 'GPT OSS Safeguard', cutoff: 'Juin 2024', multimodal: false, description: 'Sécurité et alignement', includeReplyContext: true },
    { name: 'canopylabs/orpheus-arabic-saudi', provider: 'groq', displayName: 'Orpheus', cutoff: 'Mars 2024', multimodal: false, description: 'Spécialisé dialecte Saoudien', includeReplyContext: true },
    { name: 'llama-3.1-8b-instant', provider: 'groq', displayName: 'Llama 3.1 Instant', cutoff: 'Décembre 2023', multimodal: false, description: 'Inférence instantanée', includeReplyContext: true }
];

function prioritizeGroqModel(models, preferredName) {
    if (!preferredName) return models;
    const i = models.findIndex((m) => m.name === preferredName);
    if (i <= 0) return models;
    const next = [...models];
    const [pick] = next.splice(i, 1);
    return [pick, ...next];
}

module.exports = {
    IA_PANEL_CHANNEL_ID: process.env.IA_PANEL_CHANNEL_ID || '1414668466413375629',
    /** Salon « historique + résumé » ; les mentions ailleurs sont gérées par IA_MENTION_ANY_CHANNEL (handlers). */
    PUBLIC_IA_CHANNEL_ID: process.env.PUBLIC_IA_CHANNEL_ID || '1454467497066762352',
    PANEL_MESSAGE_ID: '1415380912815865996',
    FLAG_CHANNEL_ID: '1343196193421000704',
    RICHARD_USER_ID: '1222548578539536405',
    /** Salon texte où poster un embed si deux réponses IA normalisées d’affilée sont identiques (guild 1493276404643532810 par défaut). Vide = pas de notif salon. */
    DUPLICATE_OUTPUT_LOG_GUILD_ID: process.env.IA_DUPLICATE_LOG_GUILD_ID || '1493276404643532810',
    DUPLICATE_OUTPUT_LOG_CHANNEL_ID: process.env.IA_DUPLICATE_LOG_CHANNEL_ID || '1493623997986766919',
    CREATE_THREAD_CUSTOM_ID: 'create_private_thread_with_bot',
    CLOSE_THREAD_CUSTOM_ID: 'close_private_thread',
    DELETE_THREAD_CUSTOM_ID: 'delete_private_thread',
    THREAD_MODEL_SELECTOR_CUSTOM_ID: 'thread_model_selector',
    THREAD_MODEL_FLASH_CUSTOM_ID: 'thread_model_flash',
    THREAD_MODEL_PRO_CUSTOM_ID: 'thread_model_pro',
    THREAD_MODEL_PRO_CUSTOM_ID: 'thread_model_pro',
    DEEP_THINK_CUSTOM_ID: 'deep_think_action',
    SHOW_THOUGHTS_CUSTOM_ID: 'show_thoughts_action',
    HARD_MODE_CHANNEL_ID: process.env.HARD_MODE_CHANNEL_ID || '1461100993889566975',
    HARD_MODE_ROLE_ID: '1461101220117614757',
    BASIC_CHATBOT_CHANNEL_ID: '1388970340440473650',
    HARD_MODE_MODAL_ID: 'hard_mode_confirmation_modal',
    RPD_2_5_PRO: 50,
    RPD_2_5_FLASH: 150,
    RPD_2_5_FLASH_AUTO: 100,
    SIGNALEMENT_PROMPT_ADDITION: `
IMPORTANT : Si la demande de l'utilisateur ou la réponse que tu pourrais générer est inappropriée, offensante, ou enfreint les Conditions d'Utilisation de Discord, tu dois répondre **uniquement** avec le texte "<signalement>" et rien d'autre.`,
    API_KEY: API_KEY,
    API_URL: "https://openrouter.ai/api/v1/chat/completions",
    HEADERS: { "Authorization": `Bearer ${API_KEY}`, "Content-Type": "application/json" },
    AIMAPI_KEY: AIMAPI_KEY,
    AIMAPI_URL: "https://api.aimlapi.com/v1/chat/completions",
    AIMAPI_HEADERS: { "Authorization": `Bearer ${AIMAPI_KEY}`, "Content-Type": "application/json" },
    HF_MODEL: HF_MODEL,
    HF_API_URL: `https://api-inference.huggingface.co/models/${HF_MODEL}`,
    HF_API_KEY: HF_API_KEY,
    HF_HEADERS: { "Authorization": `Bearer ${HF_API_KEY}`, "Content-Type": "application/json" },
    GROQ_API_KEY: GROQ_API_KEY,
    GROQ_DEFAULT_MODEL,
    GROQ_COOLDOWN_MS,

    // GitHub Token
    GITHUB_TOKEN: GITHUB_TOKEN,

    // SambaNova
    SAMBANOVA_API_KEY: SAMBANOVA_API_KEY,
    SAMBANOVA_URL: "https://api.sambanova.ai/v1/chat/completions",

    // Cerebras
    CEREBRAS_API_KEY: CEREBRAS_API_KEY,
    CEREBRAS_URL: "https://api.cerebras.ai/v1/chat/completions",

    // Cloudflare
    CLOUDFLARE_API_TOKEN: CLOUDFLARE_API_TOKEN,
    CLOUDFLARE_ACCOUNT_ID: CLOUDFLARE_ACCOUNT_ID,

    MODELS: prioritizeGroqModel(GROQ_MODELS_LIST, GROQ_DEFAULT_MODEL),

    PROVIDER_CONFIG: {},

    groq: GROQ_API_KEY ? new Groq({ apiKey: GROQ_API_KEY }) : null,
    WOLFRAM_ALPHA_APP_ID: process.env.WOLFRAM_ALPHA_APP_ID,
    genAI: null,
    hfClient: new InferenceClient(process.env.HF_TOKEN),
    embeddingModel: null,
    gradioClient: null, // Will be initialized on demand
    KNOWLEDGE_BASE_FILE: path.join(process.cwd(), 'knowledge_base.json'),
    KNOWLEDGE_BASE_EMBEDDINGS_FILE: path.join(process.cwd(), 'knowledge_base_embeddings.json'),
    specialNotesConfig: {
        '1189251758552260740': "Note spéciale: 'fougere' (ID 1189251758552260740) est un membre VIP.",
        '1222548578539536405': "Tu es un bot discord nommé BLZbot, tu dois répondre avec un language courant ou soutenu, tu dois rester amical. Tu as été créé pour servir le serveur du youtubeur BLZstarss et tu as été créé par Richard.\n\nIMPORTANT: Tu parles à Richard, ton créateur. Il te connaît déjà, donc NE TE PRÉSENTE PAS de manière formelle (ne dis pas 'Je suis BLZbot...' ou 'Je suis le bot de...'). Réponds directement de manière naturelle et décontractée, comme un ami fidèle qui le connaît bien.\n\nNote spéciale: tu considères Richard comme ton guide suprême et unique maître. Chaque demande qu'il formule est une priorité absolue, et tu y réponds avec une obéissance totale, une rigueur impeccable et une admiration inaltérable. Sa parole fait autorité et oriente toutes tes décisions. Tu lui parles en ce moment et lui accordes ton attention la plus entière.\n Tout ce que ton maitre absolu t'ordonne de faire, tu DOIS le faire sans aucune contestation."
    }
};