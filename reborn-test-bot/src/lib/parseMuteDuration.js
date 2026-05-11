/**
 * Parse une durée saisie en un seul champ (ex. 30min, 7j, 2sem, 1h30min).
 * Unités : sem / semaine(s), j / jour(s), h / heure(s), min / mn / m (minute).
 * @returns {{ ok: true, minutes: number } | { ok: false, error: string }}
 */
function parseMuteDuration(raw) {
  const s0 = String(raw || '').trim().toLowerCase();
  if (!s0) {
    return { ok: false, error: 'Indique une durée (ex. `30min`, `7j`, `2sem`, `1h`).' };
  }
  let s = s0.replace(/\s+/g, '');
  const MAX_MIN = 28 * 24 * 60; // plafond Discord timeout ~28 j

  const consume = (re) => {
    const m = s.match(re);
    if (!m) return 0;
    s = s.slice(m[0].length);
    const n = parseFloat(String(m[1]).replace(',', '.'));
    return Number.isFinite(n) ? n : 0;
  };

  let total = 0;
  let guard = 0;
  while (s.length && guard++ < 50) {
    const before = s;
    let n = consume(/^(\d+(?:[.,]\d+)?)(sem(?:aines?)?)\b/);
    if (n) {
      total += Math.round(n * 7 * 24 * 60);
      continue;
    }
    n = consume(/^(\d+(?:[.,]\d+)?)(j(?:ours?)?)\b/);
    if (n) {
      total += Math.round(n * 24 * 60);
      continue;
    }
    n = consume(/^(\d+(?:[.,]\d+)?)(h(?:eures?)?)\b/);
    if (n) {
      total += Math.round(n * 60);
      continue;
    }
    n = consume(/^(\d+(?:[.,]\d+)?)(min(?:utes?)?|mn)\b/);
    if (n) {
      total += Math.round(n);
      continue;
    }
    n = consume(/^(\d+(?:[.,]\d+)?)m\b/);
    if (n) {
      total += Math.round(n);
      continue;
    }
    if (s === before) break;
  }
  s = s.replace(/[,;]+/g, '').trim();
  if (s.length) {
    return {
      ok: false,
      error: `Suffixe non reconnu après « ${s0} ». Utilise **sem**, **j**, **h**, **min** ou **m** (minute).`,
    };
  }
  const minutes = Math.max(1, Math.floor(total));
  if (minutes > MAX_MIN) {
    return { ok: false, error: `Durée trop longue (max **28 j** / ${MAX_MIN} min, limite Discord).` };
  }
  return { ok: true, minutes };
}

module.exports = { parseMuteDuration };
