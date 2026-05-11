/**
 * Parse une durée dans un seul champ : 30min, 7j, 2sem, 1h, 1j12h, etc.
 * Unités : sem · j · h · min / mn / m (minute).
 * @returns {{ ok: true, minutes: number } | { ok: false, error: string }}
 */
function parseMuteDuration(raw) {
  const s0 = String(raw || '').trim().toLowerCase();
  if (!s0) {
    return { ok: false, error: 'Indique une durée (ex. `30min`, `7j`, `2sem`, `1h`).' };
  }
  let s = s0.replace(/\s+/g, '');
  const MAX_MIN = 28 * 24 * 60;

  const take = (re) => {
    const m = s.match(re);
    if (!m) return null;
    const n = parseFloat(String(m[1]).replace(',', '.'));
    if (!Number.isFinite(n) || n <= 0) return null;
    s = s.slice(m[0].length);
    return n;
  };

  let total = 0;
  for (let i = 0; i < 40 && s.length; i++) {
    let n = take(/^(\d+(?:[.,]\d+)?)sem(?:aines?)?/);
    if (n != null) {
      total += n * 7 * 24 * 60;
      continue;
    }
    n = take(/^(\d+(?:[.,]\d+)?)j(?:ours?)?/);
    if (n != null) {
      total += n * 24 * 60;
      continue;
    }
    n = take(/^(\d+(?:[.,]\d+)?)h(?:eures?)?/);
    if (n != null) {
      total += n * 60;
      continue;
    }
    n = take(/^(\d+(?:[.,]\d+)?)min(?:utes?)?/);
    if (n != null) {
      total += n;
      continue;
    }
    n = take(/^(\d+(?:[.,]\d+)?)mn/);
    if (n != null) {
      total += n;
      continue;
    }
    n = take(/^(\d+(?:[.,]\d+)?)m/);
    if (n != null) {
      total += n;
      continue;
    }
    return {
      ok: false,
      error: `Je n’ai pas compris « ${s} » dans \`${s0}\`. Exemples valides : \`45min\`, \`3j\`, \`1sem\`, \`2h30m\`.`,
    };
  }

  const minutes = Math.max(1, Math.floor(total));
  if (minutes > MAX_MIN) {
    return { ok: false, error: `Durée trop longue (max **28 j**, limite Discord).` };
  }
  return { ok: true, minutes };
}

module.exports = { parseMuteDuration };
