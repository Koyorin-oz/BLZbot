/** Préfixe emoji pour descriptions slash (style modération BLZ). */
function d(emoji, text) {
  const t = String(text || '').trim();
  if (!emoji) return t;
  return `${emoji} ${t}`;
}

module.exports = { d };
