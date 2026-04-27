const fs = require('fs');
const path = require('path');
const { renderTemplePng } = require('./canvas-skill-tree-reborn');

(async () => {
  const guildIconUrl =
    'https://cdn.discordapp.com/icons/1097110036192448656/5ad8d6bdcfde5986fa9e87b6a46faf17.png?size=256';
  for (const [label, opts] of [
    ['locked', { points: 320, keys: ['arbre_full', 'rp_100k'], templeUnlocked: false }],
    ['unlocked', {
      points: 999,
      keys: ['arbre_full', 'rp_100k', 'diamant', 'codex_full', 'guild_star', 'grp_200k'],
      templeUnlocked: true,
    }],
  ]) {
    const buf = await renderTemplePng({ ...opts, guildIconUrl });
    const out = path.join(__dirname, `_preview_temple_${label}.png`);
    fs.writeFileSync(out, buf);
    console.log('wrote', out, buf.length, 'bytes');
  }
})().catch((e) => { console.error(e); process.exit(1); });
