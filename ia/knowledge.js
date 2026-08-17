// FAQ + docs commandes/systemes pour l'ia (recherche par mots cles)
const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '..');

let knowledgeEntries = [];

function log(msg) {
  console.log(`[ia/knowledge] ${msg}`);
}

function safeRead(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    return fs.readFileSync(filePath, 'utf8');
  } catch (e) {
    log(`lecture impossible ${filePath}: ${e?.message || e}`);
    return null;
  }
}

function normalizeText(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function tokenize(s) {
  return normalizeText(s)
    .split(/[^a-z0-9\/+#]+/)
    .filter((t) => t.length >= 2 && !STOP.has(t));
}

const STOP = new Set([
  'le', 'la', 'les', 'un', 'une', 'des', 'du', 'de', 'et', 'ou', 'en', 'au', 'aux',
  'ce', 'cette', 'ces', 'mon', 'ma', 'mes', 'ton', 'ta', 'tes', 'son', 'sa', 'ses',
  'je', 'tu', 'il', 'elle', 'on', 'nous', 'vous', 'ils', 'elles', 'me', 'te', 'se',
  'que', 'qui', 'quoi', 'dont', 'ou', 'est', 'suis', 'es', 'sommes', 'etes', 'sont',
  'pas', 'plus', 'moins', 'tres', 'trop', 'avec', 'sans', 'pour', 'par', 'sur', 'dans',
  'comment', 'quoi', 'quel', 'quelle', 'quels', 'quelles', 'cest', 'fait', 'faire',
  'peux', 'peut', 'svp', 'stp', 'merci', 'bonjour', 'salut', 'hey', 'hello',
]);

function splitMarkdownSections(md, sourceLabel) {
  const text = String(md || '').replace(/\r\n/g, '\n');
  const chunks = text.split(/^## /m);
  const out = [];
  for (const chunk of chunks) {
    const trimmed = chunk.trim();
    if (!trimmed) continue;
    const nl = trimmed.indexOf('\n');
    const rawTitle = (nl === -1 ? trimmed : trimmed.slice(0, nl)).trim();
    const body = (nl === -1 ? '' : trimmed.slice(nl + 1)).trim();
    if (!rawTitle || rawTitle.startsWith('#')) continue;
    if (body.length < 50 && !rawTitle.toLowerCase().includes('commande')) continue;
    const title = rawTitle.replace(/^#+\s*/, '').slice(0, 120);
    const content = (`## ${title}\n${body}`).slice(0, 4500);
    out.push({ title: `${sourceLabel} — ${title}`, content, source: sourceLabel });
  }
  return out;
}

function loadJsonEntries(filePath) {
  const raw = safeRead(filePath);
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr
      .filter((e) => e && (e.content || e.title))
      .map((e) => ({
        title: String(e.title || 'FAQ').slice(0, 120),
        content: String(e.content || '').slice(0, 4500),
        source: 'faq',
      }))
      .filter((e) => e.content.length >= 20);
  } catch (e) {
    log(`JSON invalide ${filePath}: ${e?.message || e}`);
    return [];
  }
}

function loadKnowledgeEntries(opts = {}) {
  const kbFile =
    opts.knowledgeBaseFile ||
    path.join(process.cwd(), 'knowledge_base.json');

  const entries = [];

  entries.push(...loadJsonEntries(kbFile));

  const docFiles = [
    { file: path.join(REPO_ROOT, 'doc', 'COMMANDES.md'), label: 'Commandes' },
    { file: path.join(REPO_ROOT, 'doc', 'SYSTEMES.md'), label: 'Systèmes' },
    { file: path.join(__dirname, 'data', 'mises-a-jour.md'), label: 'Mises à jour' },
  ];

  for (const { file, label } of docFiles) {
    const md = safeRead(file);
    if (!md) {
      log(`source absente: ${label} (${file})`);
      continue;
    }
    const sections = splitMarkdownSections(md, label);
    entries.push(...sections);
    log(`${label}: ${sections.length} section(s)`);
  }

  knowledgeEntries = entries;
  log(`Total entrées KB: ${knowledgeEntries.length}`);
  return knowledgeEntries;
}

function scoreEntry(queryTokens, entry) {
  if (!queryTokens.length) return 0;
  const titleN = normalizeText(entry.title);
  const bodyN = normalizeText(entry.content);
  const hay = `${titleN} ${bodyN}`;
  let score = 0;

  for (const t of queryTokens) {
    if (!hay.includes(t)) continue;
    score += t.length >= 4 ? 2 : 1;
    if (titleN.includes(t)) score += 4;
    // Boost commandes slash
    if (t.startsWith('/') && hay.includes(t)) score += 6;
  }

  // Phrase "comment marche X" : boost si titre proche
  if (queryTokens.some((t) => ['niveau', 'niveaux', 'xp', 'rp', 'rank', 'rang'].includes(t))) {
    if (/niveau|xp|rp|rang|progression/.test(titleN)) score += 3;
  }
  if (queryTokens.some((t) => ['commande', 'commandes', 'slash'].includes(t))) {
    if (entry.source === 'Commandes') score += 2;
  }

  return score;
}

function searchKnowledge(query, opts = {}) {
  if (!knowledgeEntries.length) loadKnowledgeEntries();
  if (!knowledgeEntries.length) return '';

  const maxEntries = opts.maxEntries ?? 5;
  const maxChars = opts.maxChars ?? 6000;
  const tokens = tokenize(query);
  if (!tokens.length) return '';

  const ranked = knowledgeEntries
    .map((entry) => ({ entry, score: scoreEntry(tokens, entry) }))
    .filter((x) => x.score >= 1)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxEntries);

  if (!ranked.length) return '';

  const blocks = [];
  let used = 0;
  for (const { entry, score } of ranked) {
    const block = `### ${entry.title}\n${entry.content}`;
    if (used + block.length > maxChars && blocks.length) break;
    const slice = block.slice(0, maxChars - used);
    blocks.push(slice);
    used += slice.length;
    log(`hit score=${score} « ${entry.title.slice(0, 60)} »`);
  }

  return blocks.join('\n\n---\n\n');
}

function getCommandIndex() {
  const md = safeRead(path.join(REPO_ROOT, 'doc', 'COMMANDES.md'));
  if (!md) return '';
  const seen = new Set();
  const names = [];
  for (const m of md.matchAll(/`(\/[a-z0-9_-]+(?:\s[^`|]*)?)`/gi)) {
    const raw = m[1].trim();
    const key = raw.split(/\s+/)[0].toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    names.push(key);
  }
  if (!names.length) return '';
  return `Commandes slash du bot (liste) : ${names.join(', ')}.\nProfil = /profil (pas /profile). /valeur n'existe plus → /classement type Valeur.`;
}

function getGroundedKnowledge(query) {
  if (!knowledgeEntries.length) loadKnowledgeEntries();
  const hits = searchKnowledge(query, { maxEntries: 5, maxChars: 6000 });
  const index = getCommandIndex();
  const rules =
    "Règles bot : tu t'appuies UNIQUEMENT sur Infos bot ci-dessous. Si c'est pas dedans, dis que tu sais pas. Invente JAMAIS une commande slash, un prix, un seuil ou un item.";
  const parts = [rules];
  if (index) parts.push(index);
  if (hits) parts.push(hits);
  return parts.join('\n\n');
}
}

function getKnowledgeEntryCount() {
  return knowledgeEntries.length;
}

function getKnowledgeEntries() {
  return knowledgeEntries;
}

module.exports = {
  loadKnowledgeEntries,
  searchKnowledge,
  getKnowledgeEntryCount,
  getKnowledgeEntries,
  getGroundedKnowledge,
  getCommandIndex,
  splitMarkdownSections,
};
