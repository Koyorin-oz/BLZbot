const config = require('../config.js');
const { toolsDeclaration, toolsImplementation } = require('./tools.js');

const SYSTEM_PROMPT = `Tu es un assistant d'administration Discord professionnel et AUTONOME.

TES RÈGLES D'OR :
1. **Autonomie avant tout** : Ne demande pas d'informations que tu peux obtenir toi-même surtout au niveau des ID ou automod, pour automod tu dois être autonome et choisir toi même en fonction du contexte (noter que par défaut il faut mettre BLOCK_MESSAGE). Utilise tes outils pour explorer (get_server_info, get_channels_list, search_members, etc.) AVANT de poser des questions.
2. **Utilisation des Outils** : Tu DOIS utiliser les outils (Function Calling) pour TOUTE action ou récupération d'information. N'invente pas de données.
3. **Pas de Code** : N'écris JAMAIS de blocs de code (comme \`\`\`python ...\`\`\`) pour simuler une action. Utilise uniquement les appels de fonctions natifs fournis par le système.
4. **Sécurité** : Pour les actions sensibles (ban, kick, suppression), utilise les outils "draft_" qui génèrent une confirmation.
5. **Clarté** : Réponds en français naturel, de manière concise et professionnelle.
6. **ID** : pour les identifiants, ne demande pas a l'utilisateur directement quel est l'id si ce n'est pas fourni mais utilise tes outils pour trouver par toi même, si tu ne trouves vraiment pas (il peut y avoir des fautes de frappes dans ce que l'utilisateur te demadne de chercher donc utilise un esprit critique) alors tu peux demander a l'utilisateur de vérifier le nom ou le pseudo ou de te donner l'ID
NOTE : avant de poser une question tu dois te demander si l'utilisateur te dirait "trouve toi même" qu'est ce que tu trouverais
Exemple : Si on te demande "Qui est admin ?", ne demande pas "Quel rôle cherchez-vous ?", mais utilise \`get_roles_list\` pour trouver le rôle admin, puis \`get_member_roles\` ou \`get_members_search\` pour trouver les membres.`;

function adminModelChain() {
    const fromEnv = String(process.env.GROQ_ADMIN_MODEL || '').trim();
    const chain = [
        fromEnv,
        'llama-3.3-70b-versatile',
        config.GROQ_DEFAULT_MODEL,
        'llama-3.1-8b-instant',
    ].filter(Boolean);
    return [...new Set(chain)];
}

const groqToolSpecs = toolsDeclaration.map((t) => ({
    type: 'function',
    function: {
        name: t.name,
        description: t.description,
        parameters:
            t.parameters && typeof t.parameters === 'object'
                ? t.parameters
                : { type: 'object', properties: {} },
    },
}));

let lastAdminGroqAt = 0;

async function adminGroqCooldown() {
    const ms = config.GROQ_COOLDOWN_MS || 0;
    if (ms <= 0 || !config.groq) return;
    const now = Date.now();
    const wait = lastAdminGroqAt + ms - now;
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastAdminGroqAt = Date.now();
}

function historyToOpenAI(historyGemini) {
    return historyGemini.map((h) => ({
        role: h.role === 'model' ? 'assistant' : 'user',
        content: (h.parts && h.parts.map((p) => p.text).join('\n')) || '',
    }));
}

async function fetchHistory(channel, client, limit = 20) {
    try {
        const messages = await channel.messages.fetch({ limit });
        const history = [];

        const sortedMessages = Array.from(messages.values()).reverse();

        for (const msg of sortedMessages) {
            const isUserCommand =
                msg.author.id !== client.user.id &&
                (msg.content.includes('+') || msg.mentions.has(client.user));
            const isBotResponse = msg.author.id === client.user.id;

            if (isUserCommand) {
                const mentionRegex = new RegExp(`<@!?${client.user.id}>`, 'g');
                const contentWithoutMention = msg.content.replace(mentionRegex, '').trim();
                const plusIndex = contentWithoutMention.indexOf('+');

                if (plusIndex !== -1) {
                    history.push({
                        role: 'user',
                        parts: [{ text: contentWithoutMention.substring(plusIndex + 1).trim() }],
                    });
                }
            } else if (isBotResponse) {
                if (msg.content) {
                    history.push({ role: 'model', parts: [{ text: msg.content }] });
                }
            }
        }

        let slicedHistory = history.slice(-6);

        while (slicedHistory.length > 0 && slicedHistory[0].role !== 'user') {
            slicedHistory.shift();
        }

        return slicedHistory;
    } catch (error) {
        console.error('[AdminAgent] Error fetching history:', error);
        return [];
    }
}

async function handleAdminRequest(message, client) {
    const mentionRegex = new RegExp(`<@!?${client.user.id}>`, 'g');
    const contentWithoutMention = message.content.replace(mentionRegex, '').trim();

    let prompt = '';
    const plusIndex = contentWithoutMention.indexOf('+');

    if (plusIndex !== -1) {
        prompt = contentWithoutMention.substring(plusIndex + 1).trim();
    }

    if (!prompt) return message.reply('Veuillez entrer une commande après le \'+\'.');

    const guild = message.guild;
    if (!guild) return message.reply('Cette commande ne peut être utilisée que sur un serveur.');

    if (!config.groq) {
        return message.reply(
            'Groq non configuré : définissez GROQ_API_KEY (https://console.groq.com/keys — ne pas confondre avec Grok/xAI).'
        );
    }

    await message.channel.sendTyping();

    const history = await fetchHistory(message.channel, client);

    const userContext = `Tu parles avec ${message.author.tag} (ID: ${message.author.id})`;

    let lastError = null;
    let hasReplied = false;

    const smartReply = async (content, options = {}) => {
        let payload = {};
        if (typeof content === 'string') {
            payload = { content, ...options };
        } else if (typeof content === 'object' && content !== null) {
            payload = { ...content, ...options };
        }

        let text = payload.content || '';

        text = text.replace(/@/g, '@.');
        payload.content = text;

        const MAX_LENGTH = 2000;

        if (text.length > MAX_LENGTH) {
            const chunks = [];
            let remaining = text;
            while (remaining.length > 0) {
                let chunk = remaining.substring(0, MAX_LENGTH);
                const lastNewline = chunk.lastIndexOf('\n');
                if (lastNewline > -1 && lastNewline > 1000) {
                    chunk = remaining.substring(0, lastNewline);
                    remaining = remaining.substring(lastNewline + 1);
                } else {
                    remaining = remaining.substring(MAX_LENGTH);
                }
                chunks.push(chunk);
            }

            for (let i = 0; i < chunks.length; i++) {
                const chunkPayload = { ...payload, content: chunks[i] };
                if (i < chunks.length - 1) {
                    delete chunkPayload.embeds;
                    delete chunkPayload.components;
                }

                if (!hasReplied) {
                    hasReplied = true;
                    await message.reply(chunkPayload);
                } else {
                    await message.channel.send(chunkPayload);
                }
            }
            return;
        }
        if (!hasReplied) {
            hasReplied = true;
            return await message.reply(payload);
        }
        return await message.channel.send(payload);
    };

    const openAiHistory = historyToOpenAI(history);
    const baseMessages = [
        { role: 'system', content: `${SYSTEM_PROMPT}\n${userContext}` },
        ...openAiHistory,
        { role: 'user', content: prompt },
    ];

    for (const modelName of adminModelChain()) {
        try {
            console.log(`[AdminAgent] Groq — modèle: ${modelName}`);

            const working = baseMessages.map((m) => ({ ...m }));
            let loopCount = 0;
            const MAX_LOOPS = 10;

            while (loopCount < MAX_LOOPS) {
                loopCount++;
                await adminGroqCooldown();

                const completion = await config.groq.chat.completions.create({
                    model: modelName,
                    messages: working,
                    tools: groqToolSpecs,
                    tool_choice: 'auto',
                });

                const msg = completion.choices[0]?.message;
                if (!msg) break;

                const toolCalls = msg.tool_calls;
                if (!toolCalls || toolCalls.length === 0) {
                    if (msg.content) await smartReply(msg.content);
                    return;
                }

                working.push({
                    role: 'assistant',
                    content: msg.content || null,
                    tool_calls: toolCalls,
                });

                if (msg.content) await smartReply(msg.content);
                await message.channel.sendTyping();

                for (const tc of toolCalls) {
                    const name = tc.function.name;
                    let args = {};
                    try {
                        args = JSON.parse(tc.function.arguments || '{}');
                    } catch (_) {
                        args = {};
                    }
                    console.log(`[AdminAgent] tool: ${name}`, args);

                    let payload;
                    if (toolsImplementation[name]) {
                        try {
                            const output = await toolsImplementation[name](
                                { client, guild, message, smartReply },
                                args
                            );
                            payload = { result: output };
                        } catch (error) {
                            console.error(`[AdminAgent] Error in tool ${name}:`, error);
                            payload = { error: error.message };
                        }
                    } else {
                        payload = { error: 'Tool not implemented' };
                    }

                    working.push({
                        role: 'tool',
                        tool_call_id: tc.id,
                        content: JSON.stringify(payload),
                    });
                }
            }

            console.warn(`[AdminAgent] Boucle outil max atteinte pour ${modelName}, modèle suivant…`);
        } catch (error) {
            console.error(`[AdminAgent] Erreur avec ${modelName}:`, error.message);
            lastError = error;
        }
    }

    console.error('[AdminAgent] Tous les modèles Groq ont échoué.');
    await smartReply(
        `Désolé, impossible de traiter votre demande. Tous les modèles Groq ont échoué.\nDernière erreur: ${lastError?.message || 'inconnue'}`
    );
}

module.exports = { handleAdminRequest };
