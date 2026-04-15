/**
 * Nettoie GROQ_API_KEY (.env) : espaces, guillemets, BOM, espaces insécables, zero-width.
 * Un seul caractère parasite suffit à faire répondre Groq en 401.
 */
function normalizeGroqApiKey(raw) {
    if (raw == null || raw === undefined) return '';
    let s = String(raw)
        .replace(/\uFEFF/g, '')
        .replace(/[\u200B-\u200D\u2060]/g, '')
        .replace(/\u00A0/g, ' ')
        .trim();
    if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
        s = s.slice(1, -1).trim();
    }
    return s
        .replace(/\uFEFF/g, '')
        .replace(/[\u200B-\u200D\u2060]/g, '')
        .replace(/\u00A0/g, ' ')
        .trim();
}

module.exports = { normalizeGroqApiKey };
