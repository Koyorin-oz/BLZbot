const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, TextInputBuilder, TextInputStyle, ModalBuilder, MessageFlags, TextDisplayBuilder, SectionBuilder, ContainerBuilder, ChannelType, ThreadAutoArchiveDuration } = require('discord.js');
const config = require('./config.js');

let userSettings = {};
let quotas = {};
let knowledgeBaseEmbeddings = [];
let lastDisclaimerTime = 0;
const channelCooldowns = new Map();
const blacklistedModels = new Set();
let lastBlacklistReset = new Date().getDate();

// Système de détection des outputs dupliqués (cache GLOBAL, pas par modèle)
let lastGlobalOutput = null;
let lastGlobalModelName = null;

// Récupérer la configuration d'un modèle depuis le registre MODELS
function getModelConfig(modelName) {
  return config.MODELS.find(m => m.name === modelName) || null;
}

// Normaliser un output pour la comparaison (retire les espaces, timestamps, footers dynamiques)
function normalizeOutputForComparison(output) {
  if (!output) return '';
  return output
    .trim()
    .replace(/-# .*$/gm, '') // Retirer les footers (-# ...)
    .replace(/\s+/g, ' ')    // Normaliser les espaces
    .trim();
}

function truncateForEmbedField(text, maxLen = 1000) {
  if (text == null || text === '') return '—';
  const s = String(text);
  if (s.length <= maxLen) return s;
  return `${s.slice(0, maxLen - 20)}\n… _(tronqué, ${s.length} car.)_`;
}

// Vérifier si un output est dupliqué et poster un embed dans le salon de log (plus de MP)
async function checkDuplicateOutput(client, modelName, outputToken, requestContext) {
  if (!outputToken || outputToken.length === 0) return false;

  const normalizedOutput = normalizeOutputForComparison(outputToken);
  log(`🔍 [DUPLICATE CHECK] Modèle: ${modelName}, Output normalisé (50 premiers chars): ${normalizedOutput.substring(0, 50)}...`);

  // Comparaison avec le dernier output GLOBAL (peu importe le modèle)
  const isDuplicate = lastGlobalOutput && lastGlobalOutput === normalizedOutput;

  // Stocker pour la prochaine comparaison
  const previousModel = lastGlobalModelName;
  lastGlobalOutput = normalizedOutput;
  lastGlobalModelName = modelName;

  if (isDuplicate) {
    log(`⚠️ [DUPLICATE DETECTION] Doublon détecté! Modèle actuel: ${modelName}, Modèle précédent: ${previousModel}`);

    const channelId = config.DUPLICATE_OUTPUT_LOG_CHANNEL_ID;
    if (channelId) {
      try {
        const channel = await client.channels.fetch(channelId).catch(() => null);
        if (channel && channel.isTextBased()) {
          const modelConfig = getModelConfig(modelName) || {};
          const guildLabel = config.DUPLICATE_OUTPUT_LOG_GUILD_ID || '—';

          const embed = new EmbedBuilder()
            .setColor(0xff6b00)
            .setTitle('⚠️ Doublon de réponse IA')
            .setDescription(
              `Le modèle **${modelName}** a renvoyé la **même réponse normalisée** que le message précédent.\n` +
                `*(Guild log : \`${guildLabel}\` · Salon : \`${channelId}\`)*`
            )
            .addFields(
              { name: 'Modèle actuel', value: truncateForEmbedField(`${modelName} (${modelConfig.provider || 'inconnu'})`, 256), inline: true },
              { name: 'Modèle précédent', value: truncateForEmbedField(previousModel || 'N/A', 256), inline: true },
              { name: 'Cutoff', value: truncateForEmbedField(modelConfig.cutoff || 'N/A', 256), inline: true },
              { name: '📝 Contexte requête (extrait)', value: truncateForEmbedField(requestContext, 1024) },
              { name: '📤 Output dupliqué (extrait)', value: truncateForEmbedField(outputToken, 1024) }
            )
            .setFooter({ text: 'BLZbot · alerte doublon (plus de MP)' })
            .setTimestamp();

          await channel.send({ embeds: [embed] });
          log(`✅ Alerte doublon IA envoyée dans le salon ${channelId}`);
        } else {
          log(`⚠️ Salon log doublon IA introuvable ou non texte : ${channelId}`);
        }
      } catch (error) {
        log(`❌ Erreur envoi embed doublon dans le salon : ${error.message}`);
      }
    }

    return true;
  }

  return false;
}


function checkModelAvailability(modelName) {
  const today = new Date().getDate();
  if (today !== lastBlacklistReset) {
    blacklistedModels.clear();
    lastBlacklistReset = today;
    log("🔄 Midnight reset: Blacklisted models cleared.");
  }
  return !blacklistedModels.has(modelName);
}

const log = (message) => { const timestamp = new Date().toISOString(); console.log(`[${timestamp}] ${message}`); };

let lastGroqApiCallAt = 0;

async function applyGroqCooldown() {
  const ms = config.GROQ_COOLDOWN_MS || 0;
  if (ms <= 0 || !config.groq) return;
  const now = Date.now();
  const wait = lastGroqApiCallAt + ms - now;
  if (wait > 0) {
    await new Promise((r) => setTimeout(r, wait));
  }
  lastGroqApiCallAt = Date.now();
}

/** Texte brut via Groq (résumés, extraction JSON) — utilise GROQ_MODEL. */
async function groqSimpleText(userContent, options = {}) {
  if (!config.groq) return null;
  const model = options.model || config.GROQ_DEFAULT_MODEL;
  try {
    await applyGroqCooldown();
    const res = await config.groq.chat.completions.create({
      model,
      messages: [{ role: 'user', content: userContent }],
      temperature: options.temperature ?? 0.3,
      max_tokens: options.max_tokens ?? 2048,
    });
    return res.choices[0]?.message?.content ?? null;
  } catch (e) {
    log(`groqSimpleText: ${e.message || e}`);
    return null;
  }
}


const USER_SETTINGS_FILE = path.join(process.cwd(), 'user_settings.json');
function loadUserSettings() { if (fs.existsSync(USER_SETTINGS_FILE)) { try { userSettings = JSON.parse(fs.readFileSync(USER_SETTINGS_FILE, 'utf8')); log('Paramètres utilisateur chargés.'); } catch (e) { log(`Erreur chargement user_settings: ${e}`); userSettings = {}; } } return userSettings; }
function saveUserSettings() { try { fs.writeFileSync(USER_SETTINGS_FILE, JSON.stringify(userSettings, null, 2), 'utf8'); } catch (e) { log(`Erreur sauvegarde user_settings: ${e}`); } }
function getUserSetting(userId) {
  if (!userSettings[userId]) {
    userSettings[userId] = { globalContext: false, personalNotes: [], enableGemini: true, includeSources: false, banned: false, metadataHistory: [], autoNotes: [], lastSeenDisplayName: null, lastSeenHighestRole: null, botMode: 'default' };
    saveUserSettings();
  } else {
    // S'assurer que les nouveaux champs existent pour les anciens utilisateurs
    if (!userSettings[userId].metadataHistory) userSettings[userId].metadataHistory = [];
    if (!userSettings[userId].autoNotes) userSettings[userId].autoNotes = [];
    if (userSettings[userId].lastSeenDisplayName === undefined) userSettings[userId].lastSeenDisplayName = null;
    if (userSettings[userId].lastSeenHighestRole === undefined) userSettings[userId].lastSeenHighestRole = null;
    if (userSettings[userId].botMode === undefined) userSettings[userId].botMode = 'default';
  }
  return userSettings[userId];
}
function toggleGlobalContext(userId) { const s = getUserSetting(userId); s.globalContext = !s.globalContext; saveUserSettings(); return s.globalContext; }
function addPersonalNote(userId, title, content) { const s = getUserSetting(userId); if (s.personalNotes.length >= 3) return false; s.personalNotes.push({ title, content }); saveUserSettings(); return true; }
function deletePersonalNote(userId, index) { const s = getUserSetting(userId); if (index >= 0 && index < s.personalNotes.length) { s.personalNotes.splice(index, 1); saveUserSettings(); return true; } return false; }

const QUOTAS_FILE = path.join(process.cwd(), 'quotas.json');
function loadQuotas() { if (fs.existsSync(QUOTAS_FILE)) { try { quotas = JSON.parse(fs.readFileSync(QUOTAS_FILE, 'utf8')); } catch (e) { quotas = { huggingface: {}, aimlapi: { global: [], users: {} }, gemini3Flash: {} }; } } else { quotas = { huggingface: {}, aimlapi: { global: [], users: {} }, gemini3Flash: {} }; } return quotas; }
function saveQuotas() { try { fs.writeFileSync(QUOTAS_FILE, JSON.stringify(quotas, null, 2), 'utf8'); } catch (e) { log(`Erreur sauvegarde quotas: ${e}`); } }
function checkAndUpdateHFQuota(userId) { const now = new Date(); const month = `${now.getFullYear()}-${now.getMonth() + 1}`; if (quotas.huggingface[userId] === month) return false; quotas.huggingface[userId] = month; saveQuotas(); return true; }
function checkAndUpdateAimlapiQuota(userId) { const now = Date.now(); quotas.aimlapi.global = quotas.aimlapi.global.filter(ts => now - ts < 3600000); if (quotas.aimlapi.global.length >= 10) return false; if (quotas.aimlapi.users[userId] && (now - quotas.aimlapi.users[userId] < 3600000)) return false; quotas.aimlapi.global.push(now); quotas.aimlapi.users[userId] = now; saveQuotas(); return true; }

function checkAndUpdateGemini3FlashQuota(userId) {
  const now = new Date();
  const day = `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;

  if (!quotas.gemini3Flash) quotas.gemini3Flash = {};
  if (!quotas.gemini3Flash[userId]) quotas.gemini3Flash[userId] = { lastUsageDate: null, quotaNotifiedDate: null };

  const userQuota = quotas.gemini3Flash[userId];

  if (userQuota.lastUsageDate === day) {
    return { allowed: false, notifiedToday: userQuota.quotaNotifiedDate === day };
  }

  // Si on est ici, usage autorisé. On mettra à jour APRES succès dans handler.
  // Mais on a besoin de savoir si on doit notifier.
  return { allowed: true, notifiedToday: false };
}

function markGemini3FlashUsed(userId) {
  const now = new Date();
  const day = `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
  if (!quotas.gemini3Flash) quotas.gemini3Flash = {};
  if (!quotas.gemini3Flash[userId]) quotas.gemini3Flash[userId] = {};

  quotas.gemini3Flash[userId].lastUsageDate = day;
  saveQuotas();
}

function markGemini3FlashNotified(userId) {
  const now = new Date();
  const day = `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
  if (!quotas.gemini3Flash) quotas.gemini3Flash = {};
  if (!quotas.gemini3Flash[userId]) quotas.gemini3Flash[userId] = {};

  quotas.gemini3Flash[userId].quotaNotifiedDate = day;
  saveQuotas();
}

const HISTORY_FILE = path.join(process.cwd(), 'history.json');
function loadHistory() { if (fs.existsSync(HISTORY_FILE)) { try { return JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8')); } catch (e) { log(`Erreur chargement history.json: ${e}`); return {}; } } return {}; }
function saveHistory(data) { try { fs.writeFileSync(HISTORY_FILE, JSON.stringify(data, null, 2), 'utf8'); } catch (e) { log(`Erreur sauvegarde history.json: ${e}`); } }

async function generateEmbedding(text) {
  if (!config.embeddingModel) {
    return null;
  }
  try {
    const result = await config.embeddingModel.embedContent(text);
    return result.embedding.values;
  } catch (error) {
    log(`Erreur lors de la génération de l'embedding: ${error}`);
    return null;
  }
}

async function loadAndGenerateKnowledgeBaseEmbeddings() {
  if (!config.embeddingModel) {
    log('Embeddings non configurés — RAG par similarité désactivé (Groq seul, sans modèle d’embedding).');
    return;
  }

  if (fs.existsSync(config.KNOWLEDGE_BASE_EMBEDDINGS_FILE)) {
    fs.unlinkSync(config.KNOWLEDGE_BASE_EMBEDDINGS_FILE);
    log("Ancien fichier d'embeddings supprimé.");
  }

  if (fs.existsSync(config.KNOWLEDGE_BASE_FILE)) {
    try {
      const knowledgeBaseRaw = fs.readFileSync(config.KNOWLEDGE_BASE_FILE, 'utf8');
      const knowledgeBase = JSON.parse(knowledgeBaseRaw);
      log(`Chargement de ${knowledgeBase.length} entrées depuis knowledge_base.json.`);

      for (const entry of knowledgeBase) {
        const embedding = await generateEmbedding(entry.content);
        if (embedding) {
          knowledgeBaseEmbeddings.push({ content: entry.content, embedding: embedding });
        } else {
          log(`Impossible de générer l'embedding pour l'entrée: ${entry.content.substring(0, 50)}...`);
        }
      }
      fs.writeFileSync(config.KNOWLEDGE_BASE_EMBEDDINGS_FILE, JSON.stringify(knowledgeBaseEmbeddings, null, 2), 'utf8');
      log(`Base de connaissances embeddée et sauvegardée. ${knowledgeBaseEmbeddings.length} embeddings générés.`);
    } catch (e) {
      log(`Erreur lors du chargement/génération de la base de connaissances: ${e}`);
    }
  } else {
    log("Fichier knowledge_base.json non trouvé. Le RAG ne sera pas utilisé.");
  }
}

function cosineSimilarity(vecA, vecB) {
  let dotProduct = 0;
  let magnitudeA = 0;
  let magnitudeB = 0;
  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    magnitudeA += vecA[i] * vecA[i];
    magnitudeB += vecB[i] * vecB[i];
  }
  magnitudeA = Math.sqrt(magnitudeA);
  magnitudeB = Math.sqrt(magnitudeB);
  if (magnitudeA === 0 || magnitudeB === 0) return 0;
  return dotProduct / (magnitudeA * magnitudeB);
}

async function getRelevantKnowledge(query) {
  if (knowledgeBaseEmbeddings.length === 0) {
    log("La base de connaissances des embeddings est vide.");
    return "";
  }

  const queryEmbedding = await generateEmbedding(query);
  if (!queryEmbedding) {
    log("Impossible de générer l'embedding pour la requête.");
    return "";
  }

  let mostSimilar = null;
  let maxSimilarity = -1;

  for (const entry of knowledgeBaseEmbeddings) {
    const similarity = cosineSimilarity(queryEmbedding, entry.embedding);
    if (similarity > maxSimilarity) {
      maxSimilarity = similarity;
      mostSimilar = entry.content;
    }
  }

  if (maxSimilarity > 0.7) {
    log(`Connaissance pertinente trouvée (Sim: ${maxSimilarity.toFixed(4)}): ${mostSimilar.substring(0, 50)}...`);
    return mostSimilar;
  } else {
    log(`Aucune connaissance pertinente trouvée (Max Sim: ${maxSimilarity.toFixed(4)}).`);
    return "";
  }
}

async function summarizeHistory(history, previousSummary) {
  const conversationToSummarize = history.map(msg => `[${msg.authorName}]: ${msg.content.replace(new RegExp(`<@!?${config.clientUser.id}>`, 'g'), "").trim()}`).join('\n');

  let prompt = "Tu es un assistant IA spécialisé dans le résumé de conversations. Résume la conversation suivante en un paragraphe concis et neutre. Le résumé doit capturer les points clés et le flot de la discussion.";
  if (previousSummary) {
    prompt += "\n\nVoici un résumé de la discussion qui a précédé. Utilise-le pour contextualiser le nouveau résumé et assurer une continuité logique, en fusionnant les informations si nécessaire pour créer un nouveau résumé cohérent qui englobe tout.\n\nRésumé précédent:\n" + previousSummary;
  }
  prompt += "\n\nConversation à résumer:\n" + conversationToSummarize;

  try {
    const summary = await groqSimpleText(prompt);
    return summary || previousSummary || null;
  } catch (error) {
    log(`Erreur lors du résumé de l'historique: ${error}`);
    return previousSummary;
  }
}

async function updateAndGenerateChannelContext(message, includeGlobalContext = false) {
  let channelHistories = loadHistory();
  const channelId = message.channel.id;

  if (!channelHistories[channelId]) {
    channelHistories[channelId] = { history: [], summary: null };
  }
  const channelData = channelHistories[channelId];
  const history = channelData.history;

  const authorName = message.member?.displayName || message.author.username;
  const authorId = message.author.id;
  const highestRole = message.member?.roles.highest.name || 'N/A';
  const content = message.content;
  history.push({ authorName, authorId, highestRole, content });

  if (history.length > 3) {
    const messagesToSummarize = history.splice(0, 4);
    const previousSummary = channelData.summary;
    summarizeHistory(messagesToSummarize, previousSummary)
      .then((newSummary) => {
        if (newSummary) {
          channelData.summary = newSummary;
          log(`[Résumé async salon ${channelId}]:\n${newSummary}\n--------------------`);
          saveHistory(channelHistories);
        }
      })
      .catch((err) => log(`Erreur résumé async salon: ${err.message || err}`));
  }

  saveHistory(channelHistories);

  let context = "";
  const notesToAdd = new Set();

  if (channelData.summary) {
    context += "Résumé de la conversation précédente:\n" + channelData.summary + "\n\n";
  }

  if (includeGlobalContext) {
    context += "Messages récents dans ce salon:\n";
    for (const msg of history) {
      const cleanContent = msg.content.replace(new RegExp(`<@!?${config.clientUser.id}>`, 'g'), "").trim();
      context += `[${msg.authorName} (Rôle: ${msg.highestRole})]: ${cleanContent}\n`;

      if (config.specialNotesConfig[msg.authorId]) {
        notesToAdd.add(config.specialNotesConfig[msg.authorId]);
      }
    }
  } else {
    const lastUserMessage = history.findLast(msg => msg.authorId === message.author.id);
    if (lastUserMessage) {
      const cleanContent = lastUserMessage.content.replace(new RegExp(`<@!?${config.clientUser.id}>`, 'g'), "").trim();
      context += `[${lastUserMessage.authorName} (Rôle: ${lastUserMessage.highestRole})]: ${cleanContent}\n`;
    }
  }

  for (const note of notesToAdd) {
    context += note + '\n';
  }

  const userSettings = getUserSetting(message.author.id);
  const userPersonalNotes = userSettings.personalNotes;
  if (userPersonalNotes.length > 0) {
    context += "\nInformations complémentaires de l'utilisateur:\n";
    userPersonalNotes.forEach(note => {
      context += `- ${note.title}: ${note.content}\n`;
    });
  }

  const autoNotes = userSettings.autoNotes;
  if (autoNotes && autoNotes.length > 0) {
    context += "\nInformations apprises automatiquement sur l'utilisateur:\n";
    autoNotes.forEach(note => {
      context += `- ${note.title}: ${note.content}\n`;
    });
  }

  const metadataHistory = userSettings.metadataHistory;
  if (metadataHistory && metadataHistory.length > 0) {
    context += "\nHistorique des changements de statut de l'utilisateur:\n";
    metadataHistory.slice(-3).forEach(change => {
      context += `- ${new Date(change.date).toLocaleDateString('fr-FR')}: ${change.type === 'displayName' ? 'Pseudo' : 'Rôle'} changé de "${change.oldValue}" à "${change.newValue}"\n`;
    });
  }

  return context.trim();
}

function getChannelContext(channelId, authorId, includeGlobalContext) {
  const channelHistories = loadHistory();
  if (!channelHistories[channelId]) return "";

  const channelData = channelHistories[channelId];
  const history = channelData.history;

  let context = "";
  const notesToAdd = new Set();

  if (channelData.summary) {
    context += "Résumé de la conversation précédente:\n" + channelData.summary + "\n\n";
  }

  if (includeGlobalContext) {
    context += "Messages récents dans ce salon:\n";
    for (const msg of history) {
      const cleanContent = msg.content.replace(new RegExp(`<@!?${config.clientUser.id}>`, 'g'), "").trim();
      context += `[${msg.authorName} (Rôle: ${msg.highestRole})]: ${cleanContent}\n`;

      if (config.specialNotesConfig[msg.authorId]) {
        notesToAdd.add(config.specialNotesConfig[msg.authorId]);
      }
    }
  } else {
    const lastUserMessage = history.findLast(msg => msg.authorId === authorId);
    if (lastUserMessage) {
      const cleanContent = lastUserMessage.content.replace(new RegExp(`<@!?${config.clientUser.id}>`, 'g'), "").trim();
      context += `[${lastUserMessage.authorName} (Rôle: ${lastUserMessage.highestRole})]: ${cleanContent}\n`;
    }
  }

  for (const note of notesToAdd) {
    context += note + '\n';
  }

  const userSettings = getUserSetting(authorId);
  const userPersonalNotes = userSettings.personalNotes;
  if (userPersonalNotes.length > 0) {
    context += "\nInformations complémentaires de l'utilisateur:\n";
    userPersonalNotes.forEach(note => {
      context += `- ${note.title}: ${note.content}\n`;
    });
  }

  const autoNotes = userSettings.autoNotes;
  if (autoNotes && autoNotes.length > 0) {
    context += "\nInformations apprises automatiquement sur l'utilisateur:\n";
    autoNotes.forEach(note => {
      context += `- ${note.title}: ${note.content}\n`;
    });
  }

  const metadataHistory = userSettings.metadataHistory;
  if (metadataHistory && metadataHistory.length > 0) {
    context += "\nHistorique des changements de statut de l'utilisateur:\n";
    metadataHistory.slice(-3).forEach(change => {
      context += `- ${new Date(change.date).toLocaleDateString('fr-FR')}: ${change.type === 'displayName' ? 'Pseudo' : 'Rôle'} changé de "${change.oldValue}" à "${change.newValue}"\n`;
    });
  }

  return context.trim();
}

async function fileToGenerativePart(url, mimeType) {
  try {
    const response = await axios.get(url, { responseType: 'arraybuffer' });
    const base64Data = Buffer.from(response.data).toString('base64');
    return {
      inlineData: {
        data: base64Data,
        mimeType
      },
    };
  } catch (error) {
    log(`Erreur lors du téléchargement ou de la conversion du fichier ${url}: ${error}`);
    return null;
  }
}

async function getLastMessagesFromThread(thread, limit = 10, currentUserId = null) {
  try {
    // Récupérer plus de messages pour éviter le message actuel
    const messages = await thread.messages.fetch({ limit: limit + 5 });
    const sortedMessages = messages.sort((a, b) => a.createdTimestamp - b.createdTimestamp);

    const conversationHistory = [];
    let messageCount = 0;

    for (const msg of sortedMessages.values()) {
      // Skip other bots
      if (msg.author.bot && msg.author.id !== config.clientUser.id) continue;

      // Limiter au nombre de messages demandés
      if (messageCount >= limit) break;

      // Récupérer le nom d'affichage ou le pseudo de l'auteur
      let authorName = msg.author.username;
      if (msg.guild && msg.member) {
        authorName = msg.member.displayName || msg.author.username;
      }

      // Formater le message avec le nom de l'auteur et l'ID pour plus de clarté
      const isBotResponse = msg.author.id === config.clientUser.id;
      const isCurrentUser = msg.author.id === currentUserId;

      let messagePrefix = isBotResponse ? "BLZbot" : authorName;
      let formattedMessage = `[${messagePrefix} (ID: ${msg.author.id})]: ${msg.content}`;

      // Ajouter l'info de réponse si présent
      if (msg.reference && msg.reference.messageId) {
        try {
          const refMsg = await thread.messages.fetch(msg.reference.messageId).catch(() => null);
          if (refMsg) {
            formattedMessage = `[${messagePrefix} (ID: ${msg.author.id}) (Réponse à ${refMsg.author.username})]: ${msg.content}`;
          }
        } catch (e) { /* Ignore */ }
      }

      // Ajouter un marqueur clair pour l'utilisateur actuel
      if (isCurrentUser && !isBotResponse) {
        formattedMessage = `👤 [${messagePrefix} (ID: ${msg.author.id}) - UTILISATEUR ACTUEL]: ${msg.content}`;
      }

      conversationHistory.push({
        role: isBotResponse ? "model" : "user",
        parts: [{ text: formattedMessage }]
      });

      messageCount++;
    }

    log(`✅ Historique du fil chargé: ${conversationHistory.length} message(s) inclus dans le contexte (avec IDs et utilisateur marqué)`);
    return conversationHistory;
  } catch (error) {
    log(`❌ Erreur lors de la récupération de l'historique du fil: ${error}`);
    return [];
  }
}

async function getLastMessagesFromChannel(channel, limit = 20, currentUserId = null) {
  try {
    // Récupérer les messages du canal
    const messages = await channel.messages.fetch({ limit: limit + 5 });
    const sortedMessages = messages.sort((a, b) => a.createdTimestamp - b.createdTimestamp);

    const conversationHistory = [];
    let messageCount = 0;

    for (const msg of sortedMessages.values()) {
      // Skip les bots sauf BLZbot lui-même
      if (msg.author.bot && msg.author.id !== config.clientUser.id) continue;

      // Limiter au nombre de messages demandés
      if (messageCount >= limit) break;

      // Récupérer le nom d'affichage ou le pseudo de l'auteur
      let authorName = msg.author.username;
      if (msg.guild && msg.member) {
        authorName = msg.member.displayName || msg.author.username;
      }

      // Formater le message avec le nom de l'auteur et l'ID pour plus de clarté
      const isBotResponse = msg.author.id === config.clientUser.id;
      const isCurrentUser = msg.author.id === currentUserId;

      let messagePrefix = isBotResponse ? "BLZbot" : authorName;
      let formattedMessage = `[${messagePrefix} (ID: ${msg.author.id})]: ${msg.content}`;

      // Ajouter l'info de réponse si présent
      if (msg.reference && msg.reference.messageId) {
        try {
          const refMsg = await channel.messages.fetch(msg.reference.messageId).catch(() => null);
          if (refMsg) {
            formattedMessage = `[${messagePrefix} (ID: ${msg.author.id}) (Réponse à ${refMsg.author.username})]: ${msg.content}`;
          }
        } catch (e) { /* Ignore */ }
      }

      // Ajouter un marqueur clair pour l'utilisateur actuel
      if (isCurrentUser && !isBotResponse) {
        formattedMessage = `👤 [${messagePrefix} (ID: ${msg.author.id}) - C'EST L'UTILISATEUR ACTUEL]: ${msg.content}`;
      }

      conversationHistory.push({
        role: isBotResponse ? "model" : "user",
        parts: [{ text: formattedMessage }]
      });

      messageCount++;
    }

    log(`✅ Historique du canal chargé: ${conversationHistory.length} message(s) inclus dans le contexte (avec IDs et utilisateur marqué)`);
    return conversationHistory;
  } catch (error) {
    log(`❌ Erreur lors de la récupération de l'historique du canal: ${error}`);
    return [];
  }
}

async function getRelevantHistoryForUser(channel, limit = 10, targetUserId) {
  try {
    // 1. Fetch a larger batch of messages to find enough relevant ones
    // Fetching 50 should be enough to find 5-10 relevant messages in a busy channel
    const messages = await channel.messages.fetch({ limit: 50 });
    const sortedMessages = messages.sort((a, b) => a.createdTimestamp - b.createdTimestamp);

    const conversationHistory = [];
    let relevantCount = 0;

    for (const msg of sortedMessages.values()) {
      // Stop if we have enough messages
      if (relevantCount >= limit) break;

      // 2. Filter criteria
      const isTargetUser = msg.author.id === targetUserId;
      const isBot = msg.author.id === config.clientUser.id;

      let isRelevant = false;

      if (isTargetUser) {
        // User's own messages are always relevant
        isRelevant = true;
      } else if (isBot) {
        // Bot messages are relevant IF they are replying to the target user
        // Check mentions
        if (msg.mentions.users.has(targetUserId)) {
          isRelevant = true;
        }
        // Check reference (reply)
        else if (msg.reference && msg.reference.messageId) {
          try {
            // We can't easily fetch every reference without slowing down, 
            // but we can check if the referenced message is in our fetched batch
            const referencedMsg = messages.get(msg.reference.messageId);
            if (referencedMsg && referencedMsg.author.id === targetUserId) {
              isRelevant = true;
            }
          } catch (e) {
            // Ignore reference check errors
          }
        }
      }

      if (!isRelevant) continue;

      // 3. Format the message (same as other functions)
      let authorName = msg.author.username;
      if (msg.guild && msg.member) {
        authorName = msg.member.displayName || msg.author.username;
      }

      const messagePrefix = isBot ? "BLZbot" : authorName;
      let formattedMessage = `[${messagePrefix} (ID: ${msg.author.id})]: ${msg.content}`;

      // Ajouter l'info de réponse si présent
      if (msg.reference && msg.reference.messageId) {
        try {
          // On essaie de trouver le message dans le cache local (messages déjà fetchés)
          const refMsg = messages.get(msg.reference.messageId);
          if (refMsg) {
            formattedMessage = `[${messagePrefix} (ID: ${msg.author.id}) (Réponse à ${refMsg.author.username})]: ${msg.content}`;
          }
        } catch (e) { /* Ignore */ }
      }

      if (isTargetUser) {
        formattedMessage = `👤 [${messagePrefix} (ID: ${msg.author.id}) - UTILISATEUR ACTUEL]: ${msg.content}`;
      }

      conversationHistory.push({
        role: isBot ? "model" : "user",
        parts: [{ text: formattedMessage }]
      });

      relevantCount++;
    }

    log(`🔍 Historique filtré pour ${targetUserId}: ${conversationHistory.length} messages pertinents trouvés sur ${messages.size} analysés.`);
    return conversationHistory;

  } catch (error) {
    log(`❌ Erreur lors de la récupération de l'historique filtré: ${error}`);
    return [];
  }
}

async function queryGemini(_prompt, _modelName, _attachments = [], _includeSources, _threadHistory = [], _thinkingBudget = 0) {
  log('queryGemini: désactivé (IA Groq uniquement).');
  return null;
}

async function queryGeminiImage(prompt, attachmentsParts = []) {
  // Gemini image generation removed. Falling back to alternatives directly.
  log(`⚠️ Gemini image generation disabled, falling back to alternatives`);

  // Si Gemini échoue ou n'est pas configuré, retomber sur la chaîne existante (Hugging Face -> FLUX -> Pollinations)
  try {
    log(`🖼️ Tentative de génération d'image avec Stable Diffusion XL (Hugging Face)`);

    let finalImage = null;
    let largestSize = 0;

    const response = await config.hfClient.textToImage({
      provider: "hf-inference",
      model: "stabilityai/stable-diffusion-xl-base-1.0",
      inputs: prompt,
      parameters: { num_inference_steps: 50 },
    });

    if (response) {
      if (response[Symbol.asyncIterator]) {
        log(`📊 Réception progressive de l'image...`);
        for await (const chunk of response) {
          if (chunk && chunk.size > largestSize) {
            largestSize = chunk.size;
            finalImage = chunk;
            log(`📈 Mise à jour: ${chunk.size} bytes`);
          }
        }
      } else {
        finalImage = response;
        largestSize = response.size || 0;
        log(`📦 Image reçue: ${largestSize} bytes`);
      }
    }

    if (finalImage && finalImage.arrayBuffer) {
      try {
        const arrayBuffer = await finalImage.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        const base64 = buffer.toString('base64');

        if (base64 && base64.length > 100) {
          log(`✅ Image générée avec succès via Hugging Face (Stable Diffusion XL) - ${buffer.length} bytes (taille finale)`);
          return {
            base64: base64,
            mimeType: "image/png",
            text: `Image générée avec succès (Stable Diffusion XL)`,
            model: "stabilityai/stable-diffusion-xl-base-1.0"
          };
        }
      } catch (conversionError) {
        log(`❌ Erreur lors de la conversion de l'image: ${conversionError.message}`);
      }
    }

    log(`⚠️ Pas d'image générée avec Hugging Face, basculement vers FLUX.1-dev (Gradio)`);
    return await queryFlux1Dev(prompt);

  } catch (error) {
    const errorMessage = error.message || error.toString();
    const statusCode = error.response?.status;

    log(`❌ Erreur Hugging Face Image: ${errorMessage} (Status: ${statusCode}), basculement vers FLUX.1-dev (Gradio)`);
    return await queryFlux1Dev(prompt);
  }
}

async function queryFlux1Dev(prompt) {
  try {
    log(`🎨 Tentative de génération d'image avec FLUX.1-dev (Gradio)`);

    // Initialiser le client Gradio s'il n'existe pas
    if (!config.gradioClient) {
      log(`🔗 Connexion au serveur Gradio FLUX.1-dev...`);
      const { Client } = await import('@gradio/client');
      config.gradioClient = await Client.connect("black-forest-labs/FLUX.1-dev");
    }

    // Appel à l'API FLUX.1-dev
    const result = await config.gradioClient.predict("/infer", {
      prompt: prompt,
      seed: 0,
      randomize_seed: true,
      width: 1024,
      height: 1024,
      guidance_scale: 3.5,
      num_inference_steps: 24,
    });

    if (result && result.data && result.data[0]) {
      const imageUrl = result.data[0];
      log(`📥 Image reçue de FLUX.1-dev, conversion en base64...`);

      // Télécharger l'image et la convertir en base64
      const response = await axios.get(imageUrl, { responseType: 'arraybuffer' });
      const base64 = Buffer.from(response.data).toString('base64');

      if (base64 && base64.length > 100) {
        log(`✅ Image générée avec succès via FLUX.1-dev - ${response.data.length} bytes`);
        return {
          base64: base64,
          mimeType: "image/png",
          text: `Image générée avec succès (FLUX.1-dev)`,
          model: "FLUX.1-dev"
        };
      }
    }

    log(`⚠️ Pas d'image générée avec FLUX.1-dev, basculement vers Pollinations.AI`);
    return await queryPollinationsAI(prompt);

  } catch (error) {
    const errorMessage = error.message || error.toString();

    log(`❌ Erreur FLUX.1-dev: ${errorMessage}, basculement vers Pollinations.AI`);
    // Réinitialiser le client Gradio en cas d'erreur
    config.gradioClient = null;
    return await queryPollinationsAI(prompt);
  }
}

async function queryPollinationsAI(prompt) {
  try {
    log(`Tentative de génération d'image avec Pollinations.AI`);

    const width = 1024;
    const height = 1024;
    const seed = Math.floor(Math.random() * 1000000);
    const model = 'flux';

    const imageUrl = `https://pollinations.ai/p/${encodeURIComponent(prompt)}?width=${width}&height=${height}&seed=${seed}&model=${model}`;

    log(`URL de génération: ${imageUrl}`);

    const response = await axios.get(imageUrl, { responseType: 'arraybuffer' });

    if (response && response.data) {
      const base64 = Buffer.from(response.data).toString('base64');
      log(`✅ Image générée avec succès via Pollinations.AI`);
      return {
        base64: base64,
        mimeType: 'image/png',
        text: `Image générée avec succès (Pollinations.AI - ${model})`,
        model: `pollinations-${model}`
      };
    }

    log(`Pas d'image générée`);
    return {
      base64: null,
      mimeType: null,
      text: "Désolé, la génération d'image n'a pas pu produire de résultat.",
      quotaExceeded: false
    };

  } catch (error) {
    const errorMessage = error.message || error.toString();
    log(`❌ Erreur Pollinations.AI: ${errorMessage}`);

    return {
      base64: null,
      mimeType: null,
      text: "Désolé, la génération d'images n'est actuellement pas disponible. Réessayez dans quelques instants.",
      quotaExceeded: false
    };
  }
}

function addCitations(response) {
  let text = response.text();
  const supports = response.candidates[0]?.groundingMetadata?.groundingSupports;
  const chunks = response.candidates[0]?.groundingMetadata?.groundingChunks;

  if (!supports || !chunks) {
    return text;
  }

  const sortedSupports = [...supports].sort(
    (a, b) => (b.segment?.endIndex ?? 0) - (a.segment?.endIndex ?? 0),
  );

  for (const support of sortedSupports) {
    const endIndex = support.segment?.endIndex;
    if (endIndex === undefined || !support.groundingChunkIndices?.length) {
      continue;
    }

    const citationLinks = support.groundingChunkIndices
      .map(i => {
        const uri = chunks[i]?.web?.uri;
        if (uri) {
          return `[${i + 1}](${uri})`;
        }
        return null;
      })
      .filter(Boolean);

    if (citationLinks.length > 0) {
      const citationString = citationLinks.join(", ");
      text = text.slice(0, endIndex) + " " + citationString + text.slice(endIndex);
    }
  }

  return text;
}

async function envoyerRequete(messages, modele) {
  const payload = { model: modele, messages: messages };
  try {
    const response = await axios.post(config.API_URL, payload, { headers: config.HEADERS });
    return response.data.choices[0].message.content;
  } catch (error) {
    log(`Erreur avec le modèle ${modele} (OpenRouter): ${error.message || error}`);
    return null;
  }
}

async function queryAimapi(prompt, systemPrompt) {
  const payload = {
    model: "mistralai/mistral-tiny",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: prompt }
    ]
  };
  try {
    const response = await axios.post(config.AIMAPI_URL, payload, { headers: config.AIMAPI_HEADERS });
    return response.data.choices[0].message.content;
  } catch (error) {
    log(`Erreur lors de l'appel à AIMLApi: ${error.message || error}`);
    return null;
  }
}

async function queryHuggingFace(prompt, systemPrompt) {
  const payload = { inputs: `${systemPrompt}\nUser: ${prompt}` };
  try {
    const response = await axios.post(config.HF_API_URL, payload, { headers: config.HF_HEADERS });
    if (response.data && response.data.generated_text) {
      return response.data.generated_text + "\n-# ce message a été généré avec nos modèle les plus puissants";
    } else {
      log("Réponse invalide de Hugging Face", response.data);
      return null;
    }
  } catch (error) {
    log(`Erreur lors de l'appel à Hugging Face: ${error.message || error}`);
    return null;
  }
}

async function queryGemma(prompt, attachments = []) {
  if (attachments && attachments.length > 0) {
    log('queryGemma: pièces jointes ignorées (Groq texte uniquement pour ce helper).');
  }
  try {
    log(`Appel Groq (ex-Gemma) pour tâche auxiliaire — ${config.GROQ_DEFAULT_MODEL}`);
    const text = await groqSimpleText(prompt, { max_tokens: 1500 });
    if (!text) return null;

    try {
      const firstBrace = text.indexOf('{');
      const lastBrace = text.lastIndexOf('}');
      if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
        const jsonString = text.substring(firstBrace, lastBrace + 1);
        const parsedJson = JSON.parse(jsonString);
        log('✅ JSON détecté et extrait de la réponse Groq (queryGemma)');
        return parsedJson;
      }
    } catch (parseError) {
      log(`⚠️ Extraction JSON échouée: ${parseError.message}`);
    }

    return text;
  } catch (error) {
    log(`Erreur queryGemma (Groq): ${error.message || error}`);
    return null;
  }
}

async function summarizeConversation(messages, maxLength = 500) {
  try {
    const messagesText = messages.join('\n');

    const summaryPrompt = `Tu es un expert en résumé de conversation pour un bot Discord.

INSTRUCTIONS CRITIQUES:
1. Résume les 5 derniers messages en 2-3 phrases MAXIMUM
2. Identifie le SUJET PRINCIPAL de la conversation
3. Identifie le TON (formal, décontracté, joyeux, sérieux, etc.)
4. Relève les DEMANDES IMPORTANTES ou INSTRUCTIONS LONG TERME
5. Note les NOMS DE PERSONNES importantes mentionnées
6. Sois CONCIS et CLAIR pour que le bot puisse suivre les consignes

MESSAGES À RÉSUMER:
${messagesText}

RÉSUMÉ STRUCTURÉ:
- Sujet: 
- Ton: 
- Contexte: 
- Instructions/Demandes: `;

    const summary = await queryGemma(summaryPrompt, []);
    return summary && typeof summary === 'string' ? summary : null;
  } catch (error) {
    log(`Erreur lors du résumé de conversation: ${error.message || error}`);
    return null;
  }
}

async function extractUserFacts(userId, messages) {
  try {
    const messagesText = messages.map(m => `[${m.role === 'model' ? 'BLZbot' : 'User'}]: ${m.parts?.[0]?.text || m.content}`).join('\n');

    const extractionPrompt = `Tu es un module de mémoire à long terme pour BLZbot. Ta mission est d'extraire des FAITS STABLES et PERTINENTS sur l'utilisateur à partir de la conversation suivante.

CONSIGNES:
1. Identifie uniquement des informations durables (goûts, projets, localisation, matériel, faits biographiques).
2. Ignore les informations éphémères (humeur du moment, météo locale si pas précisée comme domicile).
3. Retourne UNIQUEMENT un objet JSON avec un champ "facts" qui est une liste d'objets { "title": "...", "content": "..." }.
4. Si aucun fait nouveau n'est détecté, retourne {"facts": []}.

CONVERSATION:
${messagesText}

RÉPONSE JSON (et rien d'autre):`;

    const result = await queryGemma(extractionPrompt, []);
    if (result && result.facts && Array.isArray(result.facts)) {
      const settings = getUserSetting(userId);
      let added = false;

      for (const fact of result.facts) {
        // Éviter les doublons simples (vérification basique sur le titre)
        const exists = settings.autoNotes.some(n => n.title.toLowerCase() === fact.title.toLowerCase());
        if (!exists) {
          settings.autoNotes.push({ ...fact, date: new Date().toISOString() });
          // Optionnel: Limiter à 10 auto-notes
          if (settings.autoNotes.length > 10) settings.autoNotes.shift();
          added = true;
        }
      }

      if (added) {
        saveUserSettings();
        log(`🧠 ${result.facts.length} nouveaux faits extraits pour l'utilisateur ${userId}`);
      }
      return result.facts;
    }
  } catch (error) {
    log(`Erreur lors de l'extraction des faits utilisateur: ${error.message || error}`);
  }
  return [];
}

// Helper: Récupérer les modèles Groq depuis le registre unifié
function getGroqModels() {
  return config.MODELS.filter(m => m.provider === 'groq');
}

async function queryGroq(messages, attachments = [], injectModelInfo = false, specificModelName = null, onProgress = null) {
  if (!config.groq) {
    log('⚠️ Groq non configuré (GROQ_API_KEY absent) — skip.');
    return null;
  }
  let imageWarning = '';

  // Si on a des pièces jointes, on réordonne les modèles pour mettre les multimodaux en premier
  const hasAttachments = attachments.length > 0;
  let modelsToTry = [...getGroqModels()];

  // Si un modèle spécifique est demandé, on ne garde que celui-là
  if (specificModelName) {
    const specificModel = modelsToTry.find(m => m.name === specificModelName);
    if (specificModel) {
      modelsToTry = [specificModel];
      log(`🎯 Groq ciblé sur le modèle spécifique: ${specificModelName}`);
    } else {
      log(`⚠️ Modèle spécifique Groq demandé (${specificModelName}) non trouvé dans le registre. Tentative avec la liste standard.`);
    }
  } else if (hasAttachments) {
    log(`🖼️ Image(s) détectée(s) - Priorisation des modèles multimodaux`);
    // Séparer les modèles multimodaux et non-multimodaux
    const multimodalModels = modelsToTry.filter(m => m.multimodal === true);
    const nonMultimodalModels = modelsToTry.filter(m => m.multimodal !== true);
    // Réordonner : multimodaux d'abord, puis les autres
    modelsToTry = [...multimodalModels, ...nonMultimodalModels];
    log(`📋 Ordre des modèles: ${multimodalModels.map(m => m.name).join(', ')} (multimodaux) puis les autres`);
  }

  let multimodalFailed = false;
  let groqAuthRejected = false;

  for (let i = 0; i < modelsToTry.length; i++) {
    const modelInfo = modelsToTry[i];
    const modelName = modelInfo.name;

    // Vérifier si le modèle est temporairement indisponible (429)
    if (!checkModelAvailability(modelName)) {
      continue;
    }

    // Si on a des pièces jointes et qu'on passe à un modèle non-multimodal, ajouter l'avertissement
    if (hasAttachments && modelInfo.multimodal !== true && !multimodalFailed) {
      multimodalFailed = true;
      imageWarning = '\n-# ⚠️ Votre image n\'a pas pu être traitée (les modèles multimodaux ont échoué)';
      log(`⚠️ Tous les modèles multimodaux ont échoué, passage aux modèles texte uniquement`);
    }

    try {
      log(`🔄 Tentative Groq avec ${modelName} (${modelInfo.displayName || modelInfo.description || 'N/A'})... (stream: ${!!onProgress})`);

      // Préparer les messages avec injection du nom du modèle si demandé
      let messagesWithModelInfo = [...messages];

      const currentDate = new Date().toLocaleDateString('fr-FR', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
      let systemInjection = `\n\n[INFO CONTEXTE] Date actuelle : ${currentDate}.`;

      if (modelInfo.cutoff) {
        systemInjection += `\nTa date de coupure de connaissances (Knowledge Cutoff) est : ${modelInfo.cutoff}.`;
      }

      systemInjection += `\n\n[INSTRUCTION IMPORTANTE - OUTILS AVANCÉS]`;
      systemInjection += `\nTu disposes d'un outil puissant 'use_advanced_tools' (MCP/Chercheur). Tu DOIS l'utiliser dans les cas suivants :`;
      systemInjection += `\n1. ACTUALITÉ : Si l'utilisateur demande des infos sur des événements récents (après ta Knowledge Cutoff) ou en temps réel.`;
      systemInjection += `\n2. COMPLEXITÉ : Si la demande nécessite des calculs complexes, de l'exécution de code Python, ou des données scientifiques précises (Wolfram Alpha).`;
      systemInjection += `\n3. NAVIGATION : Si l'utilisateur te demande de visiter une URL spécifique.`;
      systemInjection += `\n\n[TECHNIQUE DE SECOURS]`;
      systemInjection += `\nSi tu n'arrives pas à utiliser l'appel d'outil standard de l'API, tu peux utiliser ce format textuel dans ta réponse :\n<function=use_advanced_tools>{"reason": "ta raison ici"}</function>`;
      systemInjection += `\n\nSi la demande est une simple discussion ou un savoir général ancien, n'utilise PAS l'outil.`;

      if (injectModelInfo) {
        systemInjection += `\nTu es actuellement le modèle "${modelName}" (fournisseur: Groq). koyorin_oz (développeur principal) te demande quel modèle tu es. Tu DOIS lui répondre précisément "${modelName} (Groq)".`;
      }

      // Injection dans le premier message (System ou User fallback)
      if (messagesWithModelInfo.length > 0) {
        // Si le premier message est System, on concatène
        if (messagesWithModelInfo[0].role === 'system') {
          messagesWithModelInfo[0] = {
            ...messagesWithModelInfo[0],
            content: messagesWithModelInfo[0].content + systemInjection
          };
        } else {
          // Sinon (rare, mais possible), on ajoute un system prompt temporaire au début
          // qui sera traité par la logique OSS plus bas si nécessaire
          messagesWithModelInfo.unshift({
            role: 'system',
            content: systemInjection.trim()
          });
        }
      }

      // Gestion des images pour les modèles multimodaux
      if (hasAttachments && modelInfo.multimodal) {
        log(`🖼️ Préparation de la requête multimodale pour ${modelName}`);

        // Trouver le dernier message utilisateur pour y attacher l'image
        const lastUserMsgIndex = messagesWithModelInfo.findLastIndex(m => m.role === 'user');

        if (lastUserMsgIndex !== -1) {
          const userMsg = messagesWithModelInfo[lastUserMsgIndex];
          const contentParts = [];

          // Ajouter le texte
          if (userMsg.content) {
            contentParts.push({ type: "text", text: userMsg.content });
          }

          // Ajouter les images
          for (const attachment of attachments) {
            if (attachment.inlineData && attachment.inlineData.data) {
              const mimeType = attachment.inlineData.mimeType || 'image/png';
              const base64Data = attachment.inlineData.data;

              contentParts.push({
                type: "image_url",
                image_url: {
                  url: `data:${mimeType};base64,${base64Data}`
                }
              });
            }
          }

          // Mettre à jour le message
          messagesWithModelInfo[lastUserMsgIndex] = {
            role: "user",
            content: contentParts
          };
          log(`✅ ${attachments.length} image(s) attachée(s) au message utilisateur`);
        }
      }

      // Les modèles OSS (openai/gpt-oss-*) ne supportent pas le rôle "system"
      // On doit donc TOUJOURS injecter le prompt système dans le premier message utilisateur
      const isOSSModel = modelName.startsWith('openai/gpt-oss');
      if (isOSSModel) {
        log(`🔧 Modèle OSS détecté (${modelName}) - Conversion du format de messages...`);

        // Extraire le contenu système s'il existe
        let systemContent = '';
        let otherMessages = [...messagesWithModelInfo];

        if (messagesWithModelInfo.length > 0 && messagesWithModelInfo[0].role === 'system') {
          systemContent = messagesWithModelInfo[0].content;
          otherMessages = messagesWithModelInfo.slice(1);
          log(`📋 Prompt système trouvé (${systemContent.length} caractères)`);
        }

        // Trouver le premier message utilisateur
        const firstUserIndex = otherMessages.findIndex(m => m.role === 'user');

        if (firstUserIndex !== -1) {
          const userContent = otherMessages[firstUserIndex].content;

          // Format YAML clair avec instructions explicites
          const injectedContent = `---
# IMPORTANT: Tu DOIS suivre les instructions système ci-dessous. Tu n'es PAS ChatGPT.
# Tu dois te comporter EXACTEMENT comme décrit dans system_instructions.

type: structured_prompt
follow_instructions: true

system_instructions: |
${systemContent.split('\n').map(line => '  ' + line).join('\n')}

user_request: |
${userContent.split('\n').map(line => '  ' + line).join('\n')}
---

RAPPEL CRITIQUE: Lis et suis les system_instructions ci-dessus. Tu es BLZbot, pas ChatGPT.`;

          otherMessages[firstUserIndex] = {
            ...otherMessages[firstUserIndex],
            content: injectedContent
          };

          log(`✅ Prompt système injecté dans le message utilisateur (format YAML)`);
          log(`📝 Aperçu du contenu injecté: ${injectedContent.substring(0, 200)}...`);
        } else if (systemContent) {
          // Pas de message utilisateur trouvé, on crée un message avec le système
          const injectedContent = `---
# IMPORTANT: Tu DOIS suivre les instructions système ci-dessous. Tu n'es PAS ChatGPT.

type: structured_prompt
follow_instructions: true

system_instructions: |
${systemContent.split('\n').map(line => '  ' + line).join('\n')}

user_request: |
  (en attente de la requête utilisateur)
---

RAPPEL: Tu es BLZbot, pas ChatGPT. Suis les instructions ci-dessus.`;

          otherMessages.unshift({
            role: 'user',
            content: injectedContent
          });
          log(`✅ Prompt système injecté (pas de message utilisateur trouvé)`);
        }

        messagesWithModelInfo = otherMessages;
      }

      // --- MCP CONFIGURATION ---
      // --- MCP CONFIGURATION ---
      // Models that explicitly support tool calling
      // On autorise "llama" (capture llama-3, llama-4), "mixtral", "qwen", "kimi", "allam", etc.
      const supportsTools = (modelName.includes('llama') || modelName.includes('qwen') || modelName.includes('kimi') || modelName.includes('allam') || modelName.includes('orpheus') || modelName.includes('deepseek'));

      const requestConfig = {
        messages: messagesWithModelInfo,
        model: modelName,
      };

      if (supportsTools && !isOSSModel) { // Avoid tools on OSS models if unstable or unsupported
        requestConfig.tools = [MCP_TOOL_DEF];
        requestConfig.tool_choice = "auto";
      }
      // -------------------------

      if (onProgress) {
        requestConfig.stream = true;
        try {
          await applyGroqCooldown();
          const stream = await config.groq.chat.completions.create(requestConfig);

          let fullContent = '';
          let thinkContent = ''; // Groq models natively don't separate thinking usually, except DeepSeek via Groq?
          // Actually Groq hosts Llama/Mistral/Gemma. DeepSeek R1 on Groq usually puts reasoning in <think> tags in content.
          // Groq SDK might support 'reasoning_format' later but for now we parse content.

          let isThinking = false;

          for await (const chunk of stream) {
            const delta = chunk.choices[0]?.delta;
            const contentDelta = delta?.content || '';
            // Checking for reasoning_content if Groq adds it in future or for specific models
            const reasoningDelta = delta?.reasoning_content || '';

            if (reasoningDelta) {
              thinkContent += reasoningDelta;
              if (!isThinking) isThinking = true;
              onProgress({ done: false, content: fullContent, thinking: thinkContent, isThinking: true });
            }

            if (contentDelta) {
              fullContent += contentDelta;

              // Détection <think> logic (same as generic helper)
              if (fullContent.includes('<think>') && !fullContent.includes('</think>')) {
                if (!isThinking) isThinking = true;
              } else if (fullContent.includes('</think>')) {
                if (isThinking) isThinking = false;
              } else if (!reasoningDelta) {
                if (isThinking) isThinking = false;
              }

              onProgress({ done: false, content: fullContent, thinking: thinkContent, isThinking });
            }
          }

          log(`✅ Stream Groq avec ${modelName} terminé`);
          onProgress({ done: true, content: fullContent, thinking: thinkContent, isThinking: false });
          return { content: fullContent + imageWarning, modelUsed: modelName };

        } catch (streamError) {
          throw streamError; // Rethrow to be caught by the loop's try/catch and trigger next model
        }
      }

      await applyGroqCooldown();
      const result = await config.groq.chat.completions.create(requestConfig);

      const choice = result.choices[0];
      const message = choice?.message;
      let content = message?.content || '';

      // Check for tool calls (Formal or Hallucinated in text)
      let toolCall = null;
      if (message?.tool_calls && message.tool_calls.length > 0) {
        log('🔍 Raw tool calls data detected:', JSON.stringify(message.tool_calls));
        toolCall = message.tool_calls[0];
      } else {
        // Détection d'un appel d'outil "halluciné" (Tag, JSON direct, etc)
        const extracted = extractRawToolCall(content);
        if (extracted) {
          log(`⚠️ Appel d'outil extrait du texte via extractRawToolCall (${extracted.function.name})`);
          toolCall = extracted;
        }
      }

      if (toolCall && toolCall.function.name === 'use_advanced_tools') {
        const researchResult = await handleToolCall(toolCall, messagesWithModelInfo, modelName, message?.tool_calls);
        if (researchResult) return researchResult;
      }

      if (content) {
        log(`✅ Succès avec ${modelName}`);
        return { content: content + imageWarning, modelUsed: modelName };
      }

      log(`⚠️ Réponse vide de ${modelName}, essai du suivant...`);
    } catch (error) {
      const statusCode = error.status || error.statusCode || (error.response && error.response.status);

      if (statusCode === 401) {
        groqAuthRejected = true;
        log(
          `❌ Groq 401 (clé refusée) pour ${modelName} — vérifie GROQ_API_KEY dans le .env du process ia (https://console.groq.com/keys), sans espaces ni guillemets en trop.`
        );
      } else if (statusCode === 429) {
        log(`⚠️ Quota dépassé (429) pour ${modelName}. Ajout à la liste noire temporaire.`);
        blacklistedModels.add(modelName);
      } else {
        log(`❌ Erreur avec ${modelName}: ${error.message || error}`);
      }
      continue;
    }
  }

  log('❌ Tous les modèles Groq ont échoué');
  if (groqAuthRejected) {
    return { content: null, modelUsed: null, groqAuthError: true };
  }
  return null;
}

async function queryGroqSaba(messages) {
  if (!config.groq) return null;
  try {
    await applyGroqCooldown();
    const result = await config.groq.chat.completions.create({ messages: messages, model: "mistral-saba-24b" });
    const content = result.choices[0]?.message?.content || "";
    return content === "" ? null : content;
  } catch (error) {
    log(`Erreur lors de l'appel à Groq avec mistral-saba-24b: ${error.message || error}`);
    return null;
  }
}

const MCP_TOOL_DEF = {
  type: "function",
  function: {
    name: "use_advanced_tools",
    description: "Use this tool ONLY when the user asks for a task that requires: Web Search (real-time info), Code Execution (python/math), Browser Automation, or Wolfram Alpha (complex math/science). Do NOT use for general chat.",
    parameters: {
      type: "object",
      properties: {
        reason: {
          type: "string",
          description: "The reason why you need to use advanced tools (e.g. 'Need to search latest news about X', 'Need to calculate integral')"
        }
      },
      required: ["reason"]
    }
  }
};

async function callGroqCompound(originalMessages) {
  if (!config.groq) {
    log('⚠️ Groq compound indisponible (GROQ_API_KEY absent).');
    return null;
  }
  try {
    log(`🚀 Delegation to MCP (groq/compound) triggered...`);

    // Duplication des messages
    let researcherMessages = JSON.parse(JSON.stringify(originalMessages));

    // Remplacement du System Prompt
    const researcherSystemPrompt = "SYSTEM: You are a specialized Research Agent. Your GOAL is to use available tools (Web Search, Wolfram, etc.) to find the information requested by the user. \n" +
      "DO NOT roleplay as a Discord bot. DO NOT apologize. DO NOT be conversational.\n" +
      "Simply execute the necessary tools and provide a clear, factual summary of the information found.\n" +
      "If you find code, show it. If you find facts, list them. Your output will be used by another agent to answer the user.";

    if (researcherMessages.length > 0 && researcherMessages[0].role === 'system') {
      researcherMessages[0].content = researcherSystemPrompt;
    } else {
      researcherMessages.unshift({ role: 'system', content: researcherSystemPrompt });
    }

    // Chaîne de Fallback définie
    const researchModels = [
      { name: "groq/compound", type: "compound" },
      { name: "groq/compound-mini", type: "compound" },
      { name: "openai/gpt-oss-120b", type: "oss" },
      { name: "openai/gpt-oss-20b", type: "oss" }
    ];

    const enabled_tools_compound = [
      "web_search",
      "code_interpreter",
      "visit_website",
      "browser_automation",
      "wolfram_alpha"
    ];

    // Configuration des outils pour Compound
    const compound_custom_config = {
      tools: {
        enabled_tools: enabled_tools_compound
      }
    };
    if (config.WOLFRAM_ALPHA_APP_ID) {
      compound_custom_config.tools.wolfram_settings = {
        authorization: config.WOLFRAM_ALPHA_APP_ID
      };
    } else {
      log(`⚠️ Wolfram Alpha API key missing (WOLFRAM_ALPHA_APP_ID). Wolfram tool might not function for Compound models.`);
    }

    // Boucle de tentatives
    for (const modelInfo of researchModels) {
      if (!checkModelAvailability(modelInfo.name)) {
        continue;
      }

      log(`🔬 Tentative Recherche MCP avec modèle: ${modelInfo.name}...`);

      try {
        let requestConfig = {
          messages: researcherMessages,
          model: modelInfo.name
        };

        let options = {
          headers: { "Groq-Model-Version": "latest" }
        };

        if (modelInfo.type === 'compound') {
          requestConfig.compound_custom = compound_custom_config;
          requestConfig.include_reasoning = true; // Demander le raisonnement
        } else if (modelInfo.type === 'oss') {
          // Pour OSS, on utilise browser_search via l'API standard 'tools'
          requestConfig.tools = [{ type: "browser_search" }];
          requestConfig.tool_choice = "auto";
        }

        await applyGroqCooldown();
        const result = await config.groq.chat.completions.create(requestConfig, options);
        const choice = result.choices[0];
        const content = choice?.message?.content || "";
        const reasoning = choice?.message?.reasoning || "";

        if (content) {
          log(`✅ MCP Recherche réussie avec ${modelInfo.name}${reasoning ? ' (avec raisonnement)' : ''}`);
          return {
            content: content,
            reasoning: reasoning, // Capturer le raisonnement
            modelUsed: modelInfo.name
          };
        } else {
          log(`⚠️ Réponse vide du chercheur ${modelInfo.name}, passage au suivant...`);
        }

      } catch (err) {
        const statusCode = err.status || err.statusCode || (err.response && err.response.status);
        if (statusCode === 429) {
          log(`⚠️ Quota dépassé (429) pour chercheur ${modelInfo.name}. Ajout à la liste noire temporaire.`);
          blacklistedModels.add(modelInfo.name);
        } else {
          log(`❌ Erreur avec chercheur ${modelInfo.name}: ${err.message || err}`);
        }
        // On continue la boucle
      }
    }

    log(`❌ Tous les modèles de recherche MCP ont échoué.`);
    return null;

  } catch (error) {
    log(`❌ Erreur critique dans callGroqCompound: ${error.message || error}`);
    return null;
  }
}

/**
* Gère l'exécution d'un appel d'outil 'use_advanced_tools'.
* Appelle le chercheur (MCP) et génère la réponse finale corrigée par le modèle.
*/
async function handleToolCall(toolCall, originalMessages, modelName, originalToolCalls = []) {
  // Extract query from tool arguments
  let query = "";
  try {
    const args = typeof toolCall.function.arguments === 'string'
      ? JSON.parse(toolCall.function.arguments)
      : toolCall.function.arguments;
    query = args.query;
  } catch (e) {
    log(`❌ Erreur extraction query pour searchInternet: ${e.message}`);
  }

  // Fallback if no query found but we are here, try last user message? 
  // For 'use_advanced_tools', the query is usually the main arg.

  const searchResults = await searchInternet(query || "News");

  // Format results as context content
  let researchContent = "";
  if (searchResults && searchResults.length > 0) {
    researchContent = searchResults.map(r =>
      `Titre: ${r.title}\nSource: ${r.url}\nInfo: ${r.content}`
    ).join("\n\n");
  }

  // const researchResult = await callGroqCompound(originalMessages); // REPLACED

  if (researchContent) {
    log(`✅ Recherche terminée. Injection des résultats dans le contexte...`);
    const researchResult = { content: researchContent }; // Shim to match existing logic structure or just use researchContent directly


    const functionResponseMessage = {
      role: "tool",
      tool_call_id: toolCall.id,
      name: "use_advanced_tools",
      content: researchResult.content
    };

    const jsonReminder = {
      role: "system",
      content: "IMPORTANT: The tool has been executed. Do NOT repeat the tool call. Do NOT output the tool JSON structure. You MUST interpret the results and answer the user in the strict JSON format: {\"text\": \"...\", ...}."
    };

    if (modelName.startsWith('openai/gpt-oss')) {
      jsonReminder.role = "user";
    }

    const messagesWithTool = [
      ...originalMessages,
      { role: "assistant", content: JSON.stringify(toolCall.function), tool_calls: originalToolCalls.length > 0 ? originalToolCalls : [toolCall] },
      functionResponseMessage,
      { role: jsonReminder.role, content: jsonReminder.content }
    ];

    try {
      await applyGroqCooldown();
      const finalResult = await config.groq.chat.completions.create({
        messages: messagesWithTool,
        model: modelName
      });

      const finalContent = finalResult.choices[0]?.message?.content || "";
      if (finalContent) {
        return {
          content: finalContent + "\n-# 🧠 (Info via MCP)",
          modelUsed: modelName,
          reasoning: researchResult.reasoning || ""
        };
      }
    } catch (e) {
      log(`❌ Erreur génération réponse finale après tool call: ${e.message}`);
    }
  } else {
    log(`⚠️ Échec de la recherche MCP, injection du message d'erreur...`);

    const functionErrorResponseMessage = {
      role: "tool",
      tool_call_id: toolCall.id,
      name: "use_advanced_tools",
      content: "SYSTEM ERROR: The advanced research/tools service is currently UNAVAILABLE. Answer with your internal knowledge."
    };

    const messagesWithError = [
      ...originalMessages,
      { role: "assistant", content: JSON.stringify(toolCall.function), tool_calls: originalToolCalls.length > 0 ? originalToolCalls : [toolCall] },
      functionErrorResponseMessage
    ];

    try {
      await applyGroqCooldown();
      const finalResult = await config.groq.chat.completions.create({
        messages: messagesWithError,
        model: modelName
      });

      const finalContent = finalResult.choices[0]?.message?.content || "";
      if (finalContent) {
        return { content: finalContent, modelUsed: modelName };
      }
    } catch (e) {
      log(`❌ Erreur génération réponse d'erreur après tool call: ${e.message}`);
    }
  }
  return null;
}

function splitMessage(content, limit = 1900) {
  const segments = [];
  let currentSegment = "";
  const removedLinksMessages = [];

  const urlRegex = /(https?:\/\/[^\s<>"]+)/g;

  let lastIndex = 0;
  let match;

  while ((match = urlRegex.exec(content)) !== null) {
    const url = match[0];
    const preUrlText = content.substring(lastIndex, match.index);

    let tempPreText = preUrlText;
    while (tempPreText.length > 0) {
      const remainingSpace = limit - currentSegment.length;
      if (remainingSpace <= 0) {
        segments.push(currentSegment);
        currentSegment = "";
      }
      const take = Math.min(tempPreText.length, remainingSpace);
      currentSegment += tempPreText.substring(0, take);
      tempPreText = tempPreText.substring(take);
    }

    if (url.length > limit) {
      removedLinksMessages.push(`Un lien a été supprimé car il était trop long pour Discord: ${url.substring(0, Math.min(url.length, 100))}...`);
    } else if (currentSegment.length + url.length <= limit) {
      currentSegment += url;
    } else {
      if (currentSegment.length > 0) {
        segments.push(currentSegment);
      }
      currentSegment = url;
    }
    lastIndex = match.index + url.length;
  }

  const remainingText = content.substring(lastIndex);
  let tempRemainingText = remainingText;
  while (tempRemainingText.length > 0) {
    const remainingSpace = limit - currentSegment.length;
    if (remainingSpace <= 0) {
      segments.push(currentSegment);
      currentSegment = "";
    }
    const take = Math.min(tempRemainingText.length, remainingSpace);
    currentSegment += tempRemainingText.substring(0, take);
    tempRemainingText = tempRemainingText.substring(take);
  }

  if (currentSegment.length > 0) {
    segments.push(currentSegment);
  }

  return { segments, removedLinksMessages };
}

function addDotAfterAt(text) {
  return text.replace(/@/g, '@.');
}

// Deep Think Quota Tracking
const deepThinkUsage = {
  'gemini-2.5-pro': 0,
  'gemini-2.5-flash': 0,
  'gemini-2.5-flash-auto': 0,
  lastReset: Date.now()
};

// Cache for thoughts (Map<MessageID, Thoughts>)
const deepThinkCache = new Map();

function checkDeepThinkAvailability() {
  const now = Date.now();
  if (now - deepThinkUsage.lastReset > 24 * 60 * 60 * 1000) {
    deepThinkUsage['gemini-2.5-pro'] = 0;
    deepThinkUsage['gemini-2.5-flash'] = 0;
    deepThinkUsage['gemini-2.5-flash-auto'] = 0;
    deepThinkUsage.lastReset = now;
    log('🔄 Quotas Deep Think réinitialisés.');
  }

  const proAvailable = deepThinkUsage['gemini-2.5-pro'] < config.RPD_2_5_PRO;
  const flashAvailable = deepThinkUsage['gemini-2.5-flash'] < config.RPD_2_5_FLASH;
  const flashAutoAvailable = deepThinkUsage['gemini-2.5-flash-auto'] < config.RPD_2_5_FLASH_AUTO;

  return { proAvailable, flashAvailable, flashAutoAvailable, anyAvailable: proAvailable || flashAvailable };
}

function addDeepThinkButton(message, responseContent) {
  // OBSOLÈTE: Le bouton Deep Think a été retiré car le thinking est désormais activé par défaut.
  // Le raisonnement est affiché via le bouton "Afficher le raisonnement" si présent.
  return null;
}

async function queryDeepThink(prompt, threadHistory = []) {
  if (!config.groq) {
    return { text: 'Deep Think indisponible (Groq non configuré).', generateImage: false, dangerousContent: false, thoughts: '' };
  }

  const historyLines = (threadHistory || [])
    .map((h) => {
      const role = h.role === 'model' ? 'Assistant' : 'User';
      const t = (h.parts && h.parts.map((p) => p.text).join('\n')) || '';
      return `[${role}]: ${t}`;
    })
    .join('\n');

  const wrapped = `${historyLines ? `Historique:\n${historyLines}\n\n` : ''}Consigne:\n${prompt}\n\nRéponds en deux parties : d'abord ton raisonnement détaillé entre <redacted_thinking> et </redacted_thinking>, puis ta réponse finale pour l'utilisateur après la balise de fermeture.`;

  const modelsToTry = ['llama-3.3-70b-versatile', config.GROQ_DEFAULT_MODEL, 'llama-3.1-8b-instant'];
  const tried = new Set();

  for (const modelName of modelsToTry) {
    if (!modelName || tried.has(modelName)) continue;
    tried.add(modelName);
    try {
      log(`🧠 Deep Think (Groq) — ${modelName}`);
      const raw = await groqSimpleText(wrapped, { model: modelName, max_tokens: 4096, temperature: 0.4 });
      if (!raw) continue;

      const thinkMatch = raw.match(/<redacted_thinking>([\s\S]*?)<\/redacted_thinking>/i);
      let thoughts = '';
      let finalText = raw;
      if (thinkMatch) {
        thoughts = thinkMatch[1].trim();
        finalText = raw.replace(/<redacted_thinking>[\s\S]*?<\/redacted_thinking>/i, '').trim();
      }

      return {
        text: finalText || "Je n'ai pas pu formuler la réponse finale.",
        thoughts,
        generateImage: false,
        dangerousContent: false,
      };
    } catch (error) {
      log(`❌ Deep Think Groq (${modelName}): ${error.message}`);
    }
  }

  return {
    text: 'Désolé, impossible de générer une réflexion approfondie (erreur Groq).',
    generateImage: false,
    dangerousContent: false,
    thoughts: '',
  };
}

async function closeThread(thread, closer, reason, activeThreads) {
  if (!thread || thread.archived) return;
  log(`Fermeture du fil ${thread.name} par ${closer.tag}. Raison: ${reason}`);
  try {
    const originalOwnerId = activeThreads.get(thread.id)?.ownerId;
    await thread.setName(`Archive-${thread.name.replace('Archive-', '')}`);
    await thread.setLocked(true);
    if (originalOwnerId) {
      await thread.members.remove(originalOwnerId, 'Thread closed').catch(err => log(`Impossible de retirer l'utilisateur: ${err}`));
    }
    const archiveEmbed = new EmbedBuilder().setColor('#FFC300').setTitle('Fil Fermé et Archivé').setDescription(`Fermé par **${closer.tag}**. Raison: ${reason}`).setFooter({ text: 'Suppression auto dans 3 jours.' });
    const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(config.DELETE_THREAD_CUSTOM_ID).setLabel('Supprimer maintenant').setStyle(ButtonStyle.Danger));
    await thread.send({ embeds: [archiveEmbed], components: [row] });
    activeThreads.delete(thread.id);
    setTimeout(() => {
      thread.delete('Archivage > 3j').catch(err => log(`Erreur suppression auto: ${err}`));
    }, 3 * 24 * 60 * 60 * 1000);
  } catch (error) { log(`Erreur fermeture fil: ${error}`); }
}
async function sendNewPanel(channel) {
  const embed = new EmbedBuilder().setColor('#3498DB').setTitle('Créez votre conversation privée avec l\'IA').setDescription('Cliquez sur le bouton pour démarrer une discussion privée avec BLZbot.');
  const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(config.CREATE_THREAD_CUSTOM_ID).setLabel('Créer ma discussion privée').setStyle(ButtonStyle.Primary).setEmoji('💬'));
  await channel.send({ embeds: [embed], components: [row] });
  log('Nouveau panneau de contrôle envoyé.');
}
async function setupPanelIfNeeded(client) {
  try {
    const channel = await client.channels.fetch(config.IA_PANEL_CHANNEL_ID);
    if (!channel) return log('Salon du panneau introuvable !');
    await channel.messages.fetch(config.PANEL_MESSAGE_ID);
    log('Panneau de contrôle existant trouvé.');
  } catch (error) {
    if (error.code === 10003) {
      log(
        `Salon panneau IA inconnu (10003) — ID ${config.IA_PANEL_CHANNEL_ID}. Sur une guilde de test, mets IA_PANEL_CHANNEL_ID dans .env vers un salon texte où le bot peut écrire, ou crée ce salon.`
      );
      return;
    }
    if (error.code === 10008) { // Unknown Message
      log('Panneau introuvable. Création...');
      const channel = await client.channels.fetch(config.IA_PANEL_CHANNEL_ID).catch(() => null);
      if (channel) await sendNewPanel(channel);
    } else { log(`Erreur vérification panneau: ${error}`); }
  }
}

function generateSettingsPayload(userId) {
  const settings = getUserSetting(userId);
  const includeSourcesStatus = settings.includeSources ? 'Oui ✅' : 'Non ❌';



  const components = [];
  const container = new ContainerBuilder();

  // Header
  const headerText = new TextDisplayBuilder()
    .setContent(`# ⚙️ Paramètres IA\nConfigurez votre expérience avec BLZbot.`);
  container.addTextDisplayComponents(headerText);

  const groqInfoText = new TextDisplayBuilder()
    .setContent(
      `### ⚡ Fournisseur IA (Groq)\n` +
        `Les réponses du bot passent par **Groq** (Llama, etc.) — ne pas confondre avec **Grok** (xAI).\n` +
        `Modèle principal configuré : \`${config.GROQ_DEFAULT_MODEL}\` · cooldown API : ${config.GROQ_COOLDOWN_MS || 0} ms`
    );
  container.addTextDisplayComponents(groqInfoText);

  // Section 3: Sources
  const sourcesText = new TextDisplayBuilder()
    .setContent(`### 📚 Sources & Citations\nAfficher les liens des sources utilisées.\n**État:** ${includeSourcesStatus}`);

  const sourcesButton = new ButtonBuilder()
    .setCustomId('toggle_sources')
    .setLabel(settings.includeSources ? 'Désactiver' : 'Activer')
    .setStyle(settings.includeSources ? ButtonStyle.Danger : ButtonStyle.Success);

  const sourcesSection = new SectionBuilder()
    .addTextDisplayComponents(sourcesText)
    .setButtonAccessory(sourcesButton);

  container.addSectionComponents(sourcesSection);

  // Section 4: Infos Complémentaires
  const notesText = new TextDisplayBuilder()
    .setContent(`### 📝 Informations Personnelles\nAjoutez des faits sur vous pour personnaliser les réponses.\n**Enregistrées:** ${settings.personalNotes.length}/3`);

  const manageNotesButton = new ButtonBuilder()
    .setCustomId('list_delete_personal_notes')
    .setLabel('Gérer mes infos')
    .setStyle(ButtonStyle.Secondary);

  const notesSection = new SectionBuilder()
    .addTextDisplayComponents(notesText)
    .setButtonAccessory(manageNotesButton);

  container.addSectionComponents(notesSection);

  // Section 5: Mode du Bot
  const modeLabels = { 'default': '🎭 Classique', 'soft': '🌸 Soft', 'hard': '🔥 Hard' };
  const currentMode = settings.botMode || 'default';

  // Header Mode
  const modeHeaderText = new TextDisplayBuilder()
    .setContent(`### 🎮 Mode du Bot\nChoisissez la personnalité de BLZbot.\n**Mode actuel:** ${modeLabels[currentMode]}`);
  container.addTextDisplayComponents(modeHeaderText);

  // Mode Classique
  const defaultModeText = new TextDisplayBuilder()
    .setContent(`**🎭 Classique**\nSarcastique, humour piquant`);
  const defaultModeButton = new ButtonBuilder()
    .setCustomId('select_mode_default')
    .setLabel(currentMode === 'default' ? '✓ Actif' : 'Sélectionner')
    .setStyle(currentMode === 'default' ? ButtonStyle.Success : ButtonStyle.Secondary);
  const defaultModeSection = new SectionBuilder()
    .addTextDisplayComponents(defaultModeText)
    .setButtonAccessory(defaultModeButton);
  container.addSectionComponents(defaultModeSection);

  // Mode Doux
  const softModeText = new TextDisplayBuilder()
    .setContent(`**🌸 Doux**\nCalme, bienveillant, patient`);
  const softModeButton = new ButtonBuilder()
    .setCustomId('select_mode_soft')
    .setLabel(currentMode === 'soft' ? '✓ Actif' : 'Sélectionner')
    .setStyle(currentMode === 'soft' ? ButtonStyle.Success : ButtonStyle.Secondary);
  const softModeSection = new SectionBuilder()
    .addTextDisplayComponents(softModeText)
    .setButtonAccessory(softModeButton);
  container.addSectionComponents(softModeSection);

  // Mode Hard
  const hardModeText = new TextDisplayBuilder()
    .setContent(`**🔥 Hard**\nSans filtre, peut insulter (hors NSFW)`);
  const hardModeButton = new ButtonBuilder()
    .setCustomId('select_mode_hard')
    .setLabel(currentMode === 'hard' ? '✓ Actif' : 'Activer')
    .setStyle(currentMode === 'hard' ? ButtonStyle.Danger : ButtonStyle.Secondary);
  const hardModeSection = new SectionBuilder()
    .addTextDisplayComponents(hardModeText)
    .setButtonAccessory(hardModeButton);
  container.addSectionComponents(hardModeSection);

  // Footer / Aide
  const helpText = new TextDisplayBuilder()
    .setContent(`---`);
  const helpButton = new ButtonBuilder()
    .setCustomId('help_settings')
    .setLabel('Aide détaillée')
    .setStyle(ButtonStyle.Secondary);
  const helpSection = new SectionBuilder()
    .addTextDisplayComponents(helpText)
    .setButtonAccessory(helpButton);
  container.addSectionComponents(helpSection);

  components.push(container);

  return {
    components: components,
    flags: [MessageFlags.Ephemeral, MessageFlags.IsComponentsV2]
  };
}

async function sendSettingsPanel(interaction) {
  const userId = interaction.user.id;
  const payload = generateSettingsPayload(userId);
  await interaction.reply(payload);
}

async function handleSettingsButton(interaction) {
  const userId = interaction.user.id;
  switch (interaction.customId) {

    case 'add_personal_note':
      const modal = new ModalBuilder().setCustomId('add_personal_note_modal').setTitle('Ajouter une information complémentaire');
      const titleInput = new TextInputBuilder().setCustomId('note_title').setLabel("Titre de l'information (ex: \"Mes Hobbies\")").setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(30);
      const contentInput = new TextInputBuilder().setCustomId('note_content').setLabel("Contenu de l'information").setPlaceholder('Ex: J\'aime le café et la lecture').setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(100);
      modal.addComponents(new ActionRowBuilder().addComponents(titleInput), new ActionRowBuilder().addComponents(contentInput));
      await interaction.showModal(modal);
      break;
    case 'list_delete_personal_notes':
      await sendListDeletePanel(interaction, true); // true = reply (new message), false = update
      // Note: sendListDeletePanel creates a new ephemeral message usually.
      // If we want to stay in the flow, we might want to update?
      // But sendListDeletePanel logic might need adjustment.
      break;
    case 'toggle_sources':
      const settingsSrc = getUserSetting(userId);
      settingsSrc.includeSources = !settingsSrc.includeSources;
      saveUserSettings();
      await interaction.update(generateSettingsPayload(userId));
      break;
    case 'help_settings':
      const helpMessage = `
**Aide sur les Paramètres :**

* **Groq :** Le bot utilise uniquement l'API Groq (clé \`GROQ_API_KEY\`, modèle \`GROQ_MODEL\`). Ce n'est pas Grok (xAI).
* **Inclure les sources :** Option héritée ; avec Groq pur, peu d'effet sans recherche web intégrée.
* **Ajouter une information complémentaire :** Ajoutez jusqu'à 3 faits/préférences (max 100 caractères/info). Ces infos personnalisent les réponses du bot.
* **Lister/Supprimer infos complémentaires :** Affiche et permet de gérer vos informations enregistrées.

Ce panneau est éphémère, seuls vous pouvez le voir.
      `;
      await interaction.reply({ content: helpMessage, flags: [MessageFlags.Ephemeral] });
      break;

    case 'select_mode_default':
    case 'select_mode_soft':
      const newMode = interaction.customId === 'select_mode_default' ? 'default' : 'soft';
      const settingsMode = getUserSetting(userId);

      // Si on quitte le mode hard, retirer le rôle
      if (settingsMode.botMode === 'hard' && newMode !== 'hard') {
        try {
          const member = await interaction.guild.members.fetch(userId);
          await member.roles.remove(config.HARD_MODE_ROLE_ID);
          log(`[Mode] Rôle Hard retiré à ${userId}`);
        } catch (e) { log(`Erreur retrait rôle hard: ${e}`); }
      }

      settingsMode.botMode = newMode;
      saveUserSettings();
      await interaction.update(generateSettingsPayload(userId));
      break;

    case 'select_mode_hard':
      // Modal avec TextDisplay (type 10) - format raw selon doc Discord
      const warningText = `⚠️ **AVERTISSEMENT - MODE HARD** ⚠️

En activant le mode "Hard", vous acceptez que :

🔥 Le bot peut être TRÈS sarcastique et moqueur
💢 Le bot peut vous insulter (avec style)
🎭 Plus de filtre sur l'humour noir
⚡ Les réponses peuvent être blessantes

*(En cas d'insulte trop forte/de bot trop moqueur, nous n'en sommes en aucun cas responsables)*

**INTERDIT:** NSFW et discrimination.
**Utilisable UNIQUEMENT dans** <#${config.HARD_MODE_CHANNEL_ID}>`;

      // Utilisation de l'API raw pour les modals avec TextDisplay
      await interaction.showModal({
        custom_id: config.HARD_MODE_MODAL_ID,
        title: '⚠️ Activation Mode Hard',
        components: [
          {
            type: 10, // TextDisplay
            content: warningText
          },
          {
            type: 1, // ActionRow
            components: [
              {
                type: 4, // TextInput
                custom_id: 'hard_confirm_input',
                label: 'Écrivez "OK" pour accepter',
                style: 1, // Short
                required: true,
                max_length: 2,
                placeholder: 'OK'
              }
            ]
          }
        ]
      });
      break;
    default:
      if (interaction.customId.startsWith('delete_note_')) {
        const indexToDelete = parseInt(interaction.customId.split('_')[2]);
        const deleted = deletePersonalNote(userId, indexToDelete);
        if (deleted) {
          await sendListDeletePanel(interaction, false);
        } else {
          await interaction.reply({ content: 'Erreur lors de la suppression de l\'information.', flags: [MessageFlags.Ephemeral] });
        }
      }
      break;
  }
}

async function handleAddNoteModalSubmit(interaction) {
  if (interaction.customId === 'add_personal_note_modal') {
    const title = interaction.fields.getTextInputValue('note_title');
    const content = interaction.fields.getTextInputValue('note_content');
    const userId = interaction.user.id;

    const added = addPersonalNote(userId, title, content);

    if (added) {
      await interaction.reply({ content: `Votre information complémentaire "${title}" a été ajoutée avec succès !`, flags: [MessageFlags.Ephemeral] });
    } else {
      await interaction.reply({ content: `Vous avez atteint la limite de 3 informations complémentaires. Veuillez en supprimer une avant d\'en ajouter une nouvelle.`, flags: [MessageFlags.Ephemeral] });
    }
  }

  // Modal de confirmation du mode Hard
  if (interaction.customId === config.HARD_MODE_MODAL_ID) {
    const confirmation = interaction.fields.getTextInputValue('hard_confirm_input');
    const userId = interaction.user.id;

    if (confirmation.toUpperCase() === 'OK') {
      try {
        const member = await interaction.guild.members.fetch(userId);
        await member.roles.add(config.HARD_MODE_ROLE_ID);

        const settings = getUserSetting(userId);
        settings.botMode = 'hard';
        saveUserSettings();

        log(`[Mode] Mode Hard activé pour ${userId}, rôle attribué`);

        await interaction.reply({
          content: '🔥 **Mode Hard activé !**\n\nTu as maintenant accès au salon <#' + config.HARD_MODE_CHANNEL_ID + '>.\n-# Le bot peut désormais être beaucoup plus... direct avec toi.',
          flags: [MessageFlags.Ephemeral]
        });
      } catch (e) {
        log(`Erreur activation hard mode: ${e}`);
        await interaction.reply({
          content: '❌ Erreur lors de l\'activation du mode Hard. Vérifie que le bot a les permissions nécessaires.',
          flags: [MessageFlags.Ephemeral]
        });
      }
    } else {
      await interaction.reply({
        content: '❌ Tu dois taper exactement "OK" pour activer le mode Hard.',
        flags: [MessageFlags.Ephemeral]
      });
    }
  }
}

async function sendListDeletePanel(interaction, isFirstReply) {
  const userId = interaction.user.id;
  const notes = getUserSetting(userId).personalNotes;

  const components = [];
  const container = new ContainerBuilder();

  // Header
  const headerText = new TextDisplayBuilder()
    .setContent(`# 📝 Vos Informations Personnelles\nGérez ici les informations que le bot connaît sur vous.\n*Capacité : ${notes.length}/3*`);
  container.addTextDisplayComponents(headerText);

  if (notes.length === 0) {
    const emptyText = new TextDisplayBuilder()
      .setContent(`*Aucune information enregistrée pour le moment.*`);
    container.addTextDisplayComponents(emptyText);
  } else {
    notes.forEach((note, index) => {
      let displayContent = note.content;
      const maxContentLength = 200;
      if (displayContent.length > maxContentLength) {
        displayContent = displayContent.substring(0, maxContentLength - 3) + '...';
      }

      const noteText = new TextDisplayBuilder()
        .setContent(`### ${index + 1}. ${note.title}\n${displayContent}`);

      const deleteButton = new ButtonBuilder()
        .setCustomId(`delete_note_${index}`)
        .setLabel('Supprimer')
        .setStyle(ButtonStyle.Danger)
        .setEmoji('🗑️');

      const noteSection = new SectionBuilder()
        .addTextDisplayComponents(noteText)
        .setButtonAccessory(deleteButton);

      container.addSectionComponents(noteSection);
    });
  }

  // Footer / Actions
  const actionRow = new ActionRowBuilder();

  const addButton = new ButtonBuilder()
    .setCustomId('add_personal_note')
    .setLabel('Ajouter une note')
    .setStyle(ButtonStyle.Success)
    .setDisabled(notes.length >= 3);

  const backButton = new ButtonBuilder()
    .setCustomId('back_to_settings') // On devra gérer ce customId si on veut un retour propre, ou juste laisser l'utilisateur fermer
    .setLabel('Retour aux paramètres')
    .setStyle(ButtonStyle.Secondary);

  // Pour l'instant, on garde juste Ajouter car "Retour" nécessiterait de rappeler generateSettingsPayload
  // Mais on peut le faire si on ajoute le case dans handleSettingsButton
  actionRow.addComponents(addButton);

  // On ajoute une section finale pour le bouton ajouter
  const addSection = new SectionBuilder()
    .addTextDisplayComponents(new TextDisplayBuilder().setContent('### Actions'))
    .setButtonAccessory(addButton);

  container.addSectionComponents(addSection);

  components.push(container);

  const replyOptions = {
    components: components,
    flags: [MessageFlags.Ephemeral, MessageFlags.IsComponentsV2]
  };

  // Note: Avec Components V2, on ne peut pas mélanger content string et components V2 facilement si on veut tout en V2.
  // On envoie juste les composants.

  if (interaction.isButton() && !isFirstReply) {
    await interaction.update(replyOptions);
  } else {
    await interaction.reply(replyOptions);
  }
}

async function createPrivateThread(interaction, client, activeThreads) {
  try {
    const thread = await interaction.channel.threads.create({
      name: `IA-${interaction.user.username}`,
      autoArchiveDuration: ThreadAutoArchiveDuration.OneHour,
      type: ChannelType.PrivateThread,
      reason: 'Discussion privée avec BLZbot',
    });
    await thread.members.add(interaction.user.id);

    // Initialiser le modèle par défaut à "pro" (plus précis)
    const userSetting = getUserSetting(interaction.user.id);
    activeThreads.set(thread.id, { ownerId: interaction.user.id, lastActivity: Date.now(), geminiModel: 'pro' });

    const embed = new EmbedBuilder().setColor('#2ECC71').setTitle('Bienvenue dans votre discussion privée').setDescription('Posez vos questions ici. Le bot vous répondra en privé.');
    const closeButton = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(config.CLOSE_THREAD_CUSTOM_ID)
        .setLabel('Fermer le fil')
        .setStyle(ButtonStyle.Danger)
        .setEmoji('🔒')
    );

    const modelButton = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(config.THREAD_MODEL_FLASH_CUSTOM_ID)
        .setLabel('⚡ Flash (Rapide)')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(config.THREAD_MODEL_PRO_CUSTOM_ID)
        .setLabel('🎯 Pro (Précis)')
        .setStyle(ButtonStyle.Success)
    );

    await thread.send({ embeds: [embed], components: [closeButton, modelButton] });
    await interaction.editReply({ content: `Votre discussion privée a été créée : ${thread}` });
    log(`Fil privé créé pour ${interaction.user.tag}.`);
  } catch (error) {
    log(`Erreur création fil privé: ${error}`);
    try {
      await interaction.editReply({ content: 'Impossible de créer le fil privé.' });
    } catch (e) {
      log(`Impossible de modifier la réponse à l'interaction: ${e}`);
    }
  }
}

async function archiveOldThreads(client) {
  log('Démarrage de la tâche d\'archivage des anciens fils.');
  const threeDaysAgo = Date.now() - 3 * 24 * 60 * 60 * 1000;

  try {
    const guilds = client.guilds.cache;
    for (const guild of guilds.values()) {
      const { threads } = await guild.threads.fetchActive();
      for (const thread of threads.values()) {
        const lastMessage = thread.lastMessageId ? await thread.messages.fetch(thread.lastMessageId).catch(() => null) : null;

        if (lastMessage && lastMessage.createdTimestamp < threeDaysAgo) {
          if (thread.name.startsWith('IA-')) {
            log(`Archivage du fil inactif: ${thread.name} (ID: ${thread.id})`);
            await thread.setArchived(true, 'Inactivité de plus de 3 jours.').catch(err => log(`Erreur archivage: ${err}`));
          } else {
            log(`Suppression du fil inactif: ${thread.name} (ID: ${thread.id})`);
            await thread.delete('Inactivité de plus de 3 jours.').catch(err => log(`Erreur suppression: ${err}`));
          }
        } else if (!lastMessage && thread.createdTimestamp < threeDaysAgo) {
          // Handle threads with no messages or where last message is deleted
          log(`Le dernier message du fil ${thread.name} est introuvable, mais le fil est ancien. Traitement...`);
          if (thread.name.startsWith('IA-')) {
            log(`Archivage du fil ancien sans message: ${thread.name} (ID: ${thread.id})`);
            await thread.setArchived(true, 'Inactivité de plus de 3 jours.').catch(err => log(`Erreur archivage: ${err}`));
          } else {
            log(`Suppression du fil ancien sans message: ${thread.name} (ID: ${thread.id})`);
            await thread.delete('Inactivité de plus de 3 jours.').catch(err => log(`Erreur suppression: ${err}`));
          }
        }
      }
    }
    log('Tâche d\'archivage terminée.');
  } catch (error) {
    log(`Erreur lors de l\'archivage/suppression des fils: ${error}`);
  }
}

/**
 * Extrait un appel d'outil "brut" ou "halluciné" du texte.
 * Supporte le format <function=name>args</function> et le JSON brut.
 */
function extractRawToolCall(content) {
  if (content == null) return null;
  const text =
    typeof content === 'string'
      ? content
      : typeof content === 'object'
        ? JSON.stringify(content)
        : String(content);

  // 1. Format Tag: <function=use_advanced_tools>{"reason": "..."}</function>
  const tagRegex = /<function=([^>]+)>([\s\S]*?)<\/function>/i;
  const tagMatch = text.match(tagRegex);
  if (tagMatch) {
    const name = tagMatch[1].trim();
    const argsStr = tagMatch[2].trim();
    try {
      const args = JSON.parse(argsStr);
      log(`[extractRawToolCall] Détection format TAG: ${name}`);
      return { id: "raw_tag_" + Date.now(), function: { name, arguments: args, parameters: args } };
    } catch (e) {
      log(`[extractRawToolCall] Erreur parsing args TAG: ${e.message}`);
    }
  }

  // 2. Format JSON brut: {"name": "...", "parameters": ...}
  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      // Format standard
      if (parsed.name === 'use_advanced_tools') {
        log(`[extractRawToolCall] Détection format JSON direct`);
        return { id: "raw_json_" + Date.now(), function: { name: parsed.name, arguments: parsed.parameters || parsed.arguments, parameters: parsed.parameters || parsed.arguments } };
      }
      // Format ToolCalls (Groq)
      if (parsed.tool_calls && Array.isArray(parsed.tool_calls) && parsed.tool_calls[0]?.function?.name === 'use_advanced_tools') {
        log(`[extractRawToolCall] Détection format ToolCalls JSON`);
        return { id: "raw_json_array_" + Date.now(), function: parsed.tool_calls[0].function };
      }
    }
  } catch (e) {
    // Pas un JSON valide
  }

  return null;
}

// --- GitHub Models Integration ---
async function queryGithub(messages, modelName = "openai/gpt-4o", onProgress = null) {
  try {
    if (!config.GITHUB_TOKEN) {
      // log("❌ Token GitHub manquant."); // Silent fail prefer
      return null;
    }

    log(`🐙 Tentative GitHub Models avec ${modelName}... (stream: ${!!onProgress})`);

    // Nettoyer les messages et injecter les instructions d'outils
    const cleanMessages = [...messages];

    // Injection des instructions d'outils si pas déjà présentes
    const toolInstructions = `
[INSTRUCTION IMPORTANTE - OUTILS AVANCÉS]
Tu disposes d'un outil puissant 'use_advanced_tools' (MCP/Chercheur). Tu DOIS l'utiliser dans les cas suivants :
1. ACTUALITÉ : Si l'utilisateur demande des infos sur des événements récents (après ta Knowledge Cutoff) ou en temps réel.
2. COMPLEXITÉ : Si la demande nécessite des calculs complexes, de l'exécution de code Python, ou des données scientifiques précises.
3. NAVIGATION : Si l'utilisateur te demande de visiter une URL spécifique.

[TECHNIQUE DE SECOURS]
Si tu n'arrives pas à utiliser l'appel d'outil standard de l'API, tu peux utiliser ce format textuel dans ta réponse :
<function=use_advanced_tools>{"reason": "ta raison ici"}</function>

Si la demande est une simple discussion ou un savoir général ancien, n'utilise PAS l'outil.
`;

    // Vérifier si le premier message est un system prompt, sinon l'ajouter ou concaténer
    if (cleanMessages.length > 0 && cleanMessages[0].role === 'system') {
      if (!cleanMessages[0].content.includes("[INSTRUCTION IMPORTANTE - OUTILS AVANCÉS]")) {
        cleanMessages[0] = { ...cleanMessages[0], content: cleanMessages[0].content + "\n" + toolInstructions };
      }
    } else {
      cleanMessages.unshift({ role: 'system', content: toolInstructions });
    }

    const finalMessages = cleanMessages.map(m => ({
      role: m.role,
      content: m.content
    }));

    const axiosConfig = {
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${config.GITHUB_TOKEN}`,
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28"
      }
    };

    const payload = {
      model: modelName,
      messages: finalMessages,
      stream: !!onProgress
    };

    if (onProgress) {
      axiosConfig.responseType = 'stream';
      axiosConfig.timeout = 180000;

      const response = await axios.post("https://models.github.ai/inference/chat/completions", payload, axiosConfig);

      return new Promise((resolve, reject) => {
        processAxiosStream(response, onProgress, resolve, reject, 'GitHub Stream');
      });
    }

    const response = await axios.post("https://models.github.ai/inference/chat/completions", payload, axiosConfig);

    if (response.data && response.data.choices && response.data.choices.length > 0) {
      const content = response.data.choices[0].message.content;
      log(`✅ Réponse GitHub reçue (${content.length} chars)`);
      return content;
    }
    return null;
  } catch (error) {
    const status = error.response?.status || error.status;
    // Blacklister sur erreurs non-transitoires (401=auth, 403=forbidden, 429=rate limit)
    if ([401, 403, 429].includes(status)) {
      blacklistedModels.add(modelName);
      log(`🚫 Modèle ${modelName} blacklisté (HTTP ${status} GitHub).`);
    }
    log(`❌ Erreur GitHub Models (${modelName}): ${error.message}`);
    return null;
  }
}

// --- Helper pour le streaming Axios (SSE) ---
function processAxiosStream(response, onProgress, resolve, reject, logPrefix = 'Stream') {
  let fullContent = '';
  let thinkContent = '';
  let isThinking = false;
  let buffer = '';

  response.data.on('data', (chunk) => {
    buffer += chunk.toString();
    const lines = buffer.split('\n');
    buffer = lines.pop(); // Garder la ligne incomplète

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith('data: ')) continue;

      const data = trimmed.slice(6).trim();
      if (data === '[DONE]') {
        log(`✅ ${logPrefix} terminé (${fullContent.length} chars content, ${thinkContent.length} chars thinking)`);
        onProgress({ done: true, content: fullContent, thinking: thinkContent, isThinking: false });
        resolve(fullContent);
        return;
      }

      try {
        const parsed = JSON.parse(data);
        const delta = parsed.choices?.[0]?.delta;
        if (!delta) continue;

        // Certains modèles envoient le raisonnement dans reasoning_content
        const reasoningDelta = delta.reasoning_content || '';
        const contentDelta = delta.content || '';

        if (reasoningDelta) {
          thinkContent += reasoningDelta;
          if (!isThinking) isThinking = true;
          onProgress({ done: false, content: fullContent, thinking: thinkContent, isThinking: true });
        }

        if (contentDelta) {
          fullContent += contentDelta;

          // Détection des balises <think> dans le contenu
          if (fullContent.includes('<think>') && !fullContent.includes('</think>')) {
            if (!isThinking) isThinking = true;
          } else if (fullContent.includes('</think>')) {
            if (isThinking) isThinking = false;
          } else if (!reasoningDelta) {
            // Si pas de balise <think> et pas de reasoning_content dans ce chunk, on n'est plus en réflexion
            if (isThinking) isThinking = false;
          }

          onProgress({ done: false, content: fullContent, thinking: thinkContent, isThinking });
        }
      } catch (e) {
        // Ligne SSE non parseable, ignorer
      }
    }
  });

  response.data.on('end', () => {
    log(`✅ ${logPrefix} end event (${fullContent.length} chars)`);
    onProgress({ done: true, content: fullContent, thinking: thinkContent, isThinking: false });
    resolve(fullContent);
  });

  response.data.on('error', (err) => {
    log(`❌ ${logPrefix} erreur: ${err.message}`);
    reject(err);
  });
}

// --- SambaNova Integration ---
// Modèles supportant le thinking (enable_thinking via chat_template_kwargs)
const SAMBANOVA_THINKING_MODELS = [
  'DeepSeek-R1', 'DeepSeek-R1-Distill-Llama-70B',
  'Qwen3-32B',
  'Deepseek-V3.1', 'DeepSeek-V3-0324'
];
// Modèles supportant reasoning_effort
const SAMBANOVA_REASONING_MODELS = ['DeepSeek-R1', 'DeepSeek-R1-Distill-Llama-70B'];

async function querySambaNova(messages, modelName = "llama-3.1-405b", onProgress = null) {
  try {
    if (!config.SAMBANOVA_API_KEY) {
      return null;
    }

    log(`💃 Tentative SambaNova avec ${modelName}... (stream: ${!!onProgress})`);

    // Nettoyer les messages et injecter les instructions d'outils (SambaNova)
    const cleanMessages = [...messages];

    const toolInstructions = `
[INSTRUCTION IMPORTANTE - OUTILS AVANCÉS]
Tu disposes d'un outil puissant 'use_advanced_tools' (MCP/Chercheur). Tu DOIS l'utiliser dans les cas suivants :
1. ACTUALITÉ : Si l'utilisateur demande des infos sur des événements récents (après ta Knowledge Cutoff) ou en temps réel.
2. COMPLEXITÉ : Si la demande nécessite des calculs complexes, de l'exécution de code Python, ou des données scientifiques précises.
3. NAVIGATION : Si l'utilisateur te demande de visiter une URL spécifique.

[TECHNIQUE DE SECOURS]
Si tu n'arrives pas à utiliser l'appel d'outil standard de l'API, tu peux utiliser ce format textuel dans ta réponse :
<function=use_advanced_tools>{"reason": "ta raison ici"}</function>

Si la demande est une simple discussion ou un savoir général ancien, n'utilise PAS l'outil.
`;

    if (cleanMessages.length > 0 && cleanMessages[0].role === 'system') {
      if (!cleanMessages[0].content.includes("[INSTRUCTION IMPORTANTE - OUTILS AVANCÉS]")) {
        cleanMessages[0] = { ...cleanMessages[0], content: cleanMessages[0].content + "\n" + toolInstructions };
      }
    } else {
      cleanMessages.unshift({ role: 'system', content: toolInstructions });
    }

    const finalMessages = cleanMessages.map(m => ({
      role: m.role,
      content: m.content
    }));

    // Construire le payload avec thinking au max pour les modèles compatibles
    const payload = {
      model: modelName,
      messages: finalMessages,
      stream: !!onProgress,
      temperature: 0.7
    };

    // Activer le thinking au maximum pour les modèles supportés
    if (SAMBANOVA_THINKING_MODELS.includes(modelName)) {
      payload.chat_template_kwargs = { enable_thinking: true };
      log(`🧠 Thinking activé pour ${modelName}`);
    }
    if (SAMBANOVA_REASONING_MODELS.includes(modelName)) {
      payload.reasoning_effort = 'high';
      log(`🧠 Reasoning effort HIGH pour ${modelName}`);
    }

    const axiosConfig = {
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${config.SAMBANOVA_API_KEY}`
      }
    };

    // ==============================
    // MODE STREAMING (avec callback)
    // ==============================
    if (onProgress) {
      axiosConfig.responseType = 'stream';
      axiosConfig.timeout = 180000; // 3 min max

      const response = await axios.post(config.SAMBANOVA_URL, payload, axiosConfig);

      return new Promise((resolve, reject) => {
        processAxiosStream(response, onProgress, resolve, reject, 'SambaNova Stream');
      });
    }

    // ==============================
    // MODE SYNCHRONE (sans callback)
    // ==============================
    const response = await axios.post(config.SAMBANOVA_URL, payload, axiosConfig);

    if (response.data && response.data.choices && response.data.choices.length > 0) {
      const content = response.data.choices[0].message.content;
      log(`✅ Réponse SambaNova reçue (${content.length} chars)`);
      return content;
    }
    return null;
  } catch (error) {
    const status = error.response?.status || error.status;
    if ([401, 403, 429].includes(status)) {
      blacklistedModels.add(modelName);
      log(`🚫 Modèle ${modelName} blacklisté (HTTP ${status} SambaNova).`);
    }
    log(`❌ Erreur SambaNova (${modelName}): ${error.message}`);
    return null;
  }
}

// --- Cerebras Integration ---
async function queryCerebras(messages, modelName = "llama-3.3-70b", onProgress = null) {
  try {
    if (!config.CEREBRAS_API_KEY) {
      return null;
    }

    log(`🧠 Tentative Cerebras avec ${modelName}... (stream: ${!!onProgress})`);

    // Nettoyer et injecter (Cerebras)
    const cleanMessages = [...messages];
    const toolInstructions = `
[INSTRUCTION IMPORTANTE - OUTILS AVANCÉS]
Tu disposes d'un outil puissant 'use_advanced_tools' (MCP/Chercheur). Tu DOIS l'utiliser dans les cas suivants :
1. ACTUALITÉ : Si l'utilisateur demande des infos sur des événements récents (après ta Knowledge Cutoff) ou en temps réel.
2. COMPLEXITÉ : Si la demande nécessite des calculs complexes, de l'exécution de code Python, ou des données scientifiques précises.
3. NAVIGATION : Si l'utilisateur te demande de visiter une URL spécifique.

[TECHNIQUE DE SECOURS]
Si tu n'arrives pas à utiliser l'appel d'outil standard de l'API, tu peux utiliser ce format textuel dans ta réponse :
<function=use_advanced_tools>{"reason": "ta raison ici"}</function>

Si la demande est une simple discussion ou un savoir général ancien, n'utilise PAS l'outil.
`;

    if (cleanMessages.length > 0 && cleanMessages[0].role === 'system') {
      if (!cleanMessages[0].content.includes("[INSTRUCTION IMPORTANTE - OUTILS AVANCÉS]")) {
        cleanMessages[0] = { ...cleanMessages[0], content: cleanMessages[0].content + "\n" + toolInstructions };
      }
    } else {
      cleanMessages.unshift({ role: 'system', content: toolInstructions });
    }

    const finalMessages = cleanMessages.map(m => ({
      role: m.role,
      content: m.content
    }));

    const axiosConfig = {
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${config.CEREBRAS_API_KEY}`
      }
    };

    const payload = {
      model: modelName,
      messages: finalMessages,
      stream: !!onProgress,
      max_completion_tokens: 1024,
      temperature: 0.7,
      top_p: 1
    };

    if (onProgress) {
      axiosConfig.responseType = 'stream';
      axiosConfig.timeout = 180000;

      const response = await axios.post(config.CerebrasUrl || "https://api.cerebras.ai/v1/chat/completions", payload, axiosConfig);

      return new Promise((resolve, reject) => {
        processAxiosStream(response, onProgress, resolve, reject, 'Cerebras Stream');
      });
    }

    const response = await axios.post(config.CerebrasUrl || "https://api.cerebras.ai/v1/chat/completions", payload, axiosConfig);

    if (response.data && response.data.choices && response.data.choices.length > 0) {
      const content = response.data.choices[0].message.content;
      log(`✅ Réponse Cerebras reçue (${content.length} chars)`);
      return content;
    }
    return null;
  } catch (error) {
    const status = error.response?.status || error.status;
    if ([401, 403, 429].includes(status)) {
      blacklistedModels.add(modelName);
      log(`🚫 Modèle ${modelName} blacklisté (HTTP ${status} Cerebras).`);
    }
    log(`❌ Erreur Cerebras (${modelName}): ${error.message}`);
    return null;
  }
}


// ============================================================
// 1. L'ARMÉE DES INCONNUS (Liste des instances publiques)
// ============================================================
const SEARX_INSTANCES = [
  "https://searx.be",             // Belgique
  "https://searx.ngn.tf",         // Allemagne
  "https://searx.aicamp.cn",      // Chine/Global
  "https://search.ononoki.org",   // Japon
  "https://opnxng.com",           // US/Europe
  "https://searx.daetalytica.io", // Suisse
  "https://priv.au"               // Australie
];

// ============================================================
// 2. LE MOTEUR DE RECHERCHE "INSUBMERSIBLE"
// ============================================================
async function searchInternet(query) {
  if (!query) return [];

  // A. On mélange la liste
  const shuffledInstances = [...SEARX_INSTANCES].sort(() => 0.5 - Math.random());

  // B. On essaie les instances une par une
  for (const instance of shuffledInstances) {
    try {
      log(`🕵️ Recherche via le nœud : ${instance}...`);

      const response = await axios.get(`${instance}/search`, {
        params: {
          q: query,
          format: 'json',
          language: 'fr-FR',
          safesearch: 1
        },
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36'
        },
        timeout: 4000
      });

      if (response.data.results && response.data.results.length > 0) {
        log(`✅ Succès sur ${instance}`);

        // C. On nettoie les données (Top 5)
        return response.data.results.slice(0, 5).map(r => ({
          title: r.title,
          url: r.url,
          content: r.content || r.snippet || "" // SearXNG fields vary slightly
        }));
      }
    } catch (error) {
      // log(`⚠️ ${instance} a échoué (${error.message}), passage au suivant...`);
    }
  }

  log("❌ Échec sur tous les nœuds SearXNG.");
  return [];
}

module.exports = {
  log,
  loadUserSettings,
  saveUserSettings,
  getUserSetting,
  toggleGlobalContext,
  addPersonalNote,
  deletePersonalNote,
  loadQuotas,
  saveQuotas,
  checkAndUpdateHFQuota,
  checkAndUpdateAimlapiQuota,
  checkAndUpdateGemini3FlashQuota,
  markGemini3FlashUsed,
  markGemini3FlashNotified,
  loadHistory,
  saveHistory,
  generateEmbedding,
  loadAndGenerateKnowledgeBaseEmbeddings,
  cosineSimilarity,
  getRelevantKnowledge,
  summarizeHistory,
  updateAndGenerateChannelContext,
  getChannelContext,
  fileToGenerativePart,
  getLastMessagesFromThread,
  getLastMessagesFromChannel,
  getRelevantHistoryForUser,
  queryGemini,
  queryGeminiImage,
  envoyerRequete,
  queryAimapi,
  queryHuggingFace,
  queryGemma,
  summarizeConversation,
  extractUserFacts,
  queryGroq,
  queryGithub,
  querySambaNova,
  queryCerebras,
  queryGroqSaba,
  searchInternet,
  splitMessage,
  addDotAfterAt,
  closeThread,
  sendNewPanel,
  setupPanelIfNeeded,
  generateSettingsPayload,
  sendSettingsPanel,
  handleSettingsButton,
  handleAddNoteModalSubmit,
  sendListDeletePanel,
  createPrivateThread,
  addCitations,
  archiveOldThreads,
  checkDeepThinkAvailability,
  addDeepThinkButton,
  queryDeepThink,
  extractRawToolCall,
  lastDisclaimerTime,
  channelCooldowns,
  deepThinkCache,
  // Nouvelles fonctions pour détection de doublons et contrôle contextuel
  checkDuplicateOutput,
  getModelConfig,
  checkModelAvailability
};