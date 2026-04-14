// Smoke test Groq (pas Gemini / pas Grok xAI)
import 'dotenv/config';
import Groq from 'groq-sdk';

const key = process.env.GROQ_API_KEY;
const model = process.env.GROQ_MODEL || 'llama-3.1-8b-instant';

if (!key) {
  console.error('Erreur : GROQ_API_KEY absente (https://console.groq.com/keys).');
  process.exit(1);
}

async function main() {
  const groq = new Groq({ apiKey: key });
  const r = await groq.chat.completions.create({
    model,
    messages: [{ role: 'user', content: 'Réponds en une courte phrase pour confirmer que Groq répond.' }],
  });
  console.log(r.choices[0]?.message?.content || '(vide)');
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
