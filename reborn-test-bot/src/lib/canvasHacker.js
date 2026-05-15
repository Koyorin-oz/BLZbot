const { createCanvas } = require('canvas');

const RARITY_HEX = {
  Commun: '#95a5a6',
  Rare: '#3498db',
  Epique: '#9b59b6',
  Légendaire: '#e67e22',
  Mythique: '#e74c3c',
  Goatesque: '#1abc9c',
  Staresque: '#f1c40f',
};

function rr(ctx, x, y, w, h, rad) {
  const R = Math.min(rad, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + R, y);
  ctx.arcTo(x + w, y, x + w, y + h, R);
  ctx.arcTo(x + w, y + h, x, y + h, R);
  ctx.arcTo(x, y + h, x, y, R);
  ctx.arcTo(x, y, x + w, y, R);
  ctx.closePath();
}

function noiseGrid(ctx, W, H) {
  ctx.save();
  ctx.globalAlpha = 0.07;
  ctx.strokeStyle = '#00ff8844';
  const step = 24;
  for (let x = 0; x < W; x += step) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, H);
    ctx.stroke();
  }
  for (let y = 0; y < H; y += step) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(W, y);
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * Carte « déchiffrage » salon hacker après loot.
 * @param {{ guildName: string, itemName: string, itemId: string, rarity: string }} opts
 */
function renderHackerLootCard(opts) {
  const { guildName, itemName, itemId, rarity } = opts;
  const accent = RARITY_HEX[rarity] || '#2ecc71';
  const W = 900;
  const H = 440;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, '#05080c');
  bg.addColorStop(0.5, '#0a1520');
  bg.addColorStop(1, '#020406');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  noiseGrid(ctx, W, H);

  ctx.fillStyle = 'rgba(0, 255, 136, 0.03)';
  for (let i = 0; i < 40; i += 1) {
    ctx.fillRect(0, (i * 17 + (i % 3) * 4) % H, W, 1);
  }

  ctx.strokeStyle = accent + '99';
  ctx.lineWidth = 2;
  rr(ctx, 28, 28, W - 56, H - 56, 18);
  ctx.stroke();

  ctx.shadowColor = accent;
  ctx.shadowBlur = 28;
  ctx.strokeStyle = accent + '55';
  ctx.lineWidth = 1;
  rr(ctx, 38, 38, W - 76, H - 76, 14);
  ctx.stroke();
  ctx.shadowBlur = 0;

  ctx.fillStyle = '#00ff99';
  ctx.font = 'bold 11px Consolas, monospace';
  ctx.fillText('◆ SALON HACKER // SESSION AUTH', 52, 72);
  ctx.fillStyle = '#6abf8f';
  ctx.font = '12px Consolas, monospace';
  ctx.fillText(`NODE: ${String(guildName).slice(0, 42)}`, 52, 92);

  ctx.fillStyle = '#1b4332';
  rr(ctx, 52, 112, W - 104, 4, 2);
  ctx.fill();
  ctx.fillStyle = accent;
  ctx.fillRect(52, 112, (W - 104) * 0.72, 4);

  ctx.font = 'bold 13px Consolas, monospace';
  ctx.fillStyle = '#8899aa';
  ctx.fillText('[PACKET_DECRYPTED]', 52, 148);

  ctx.fillStyle = '#ecf0f1';
  ctx.font = 'bold 28px "Segoe UI", sans-serif';
  const name = String(itemName || '???').toUpperCase();
  ctx.fillText(name.length > 34 ? `${name.slice(0, 32)}…` : name, 52, 196);

  ctx.fillStyle = accent;
  ctx.font = '13px Consolas, monospace';
  ctx.fillText(`RARETÉ :: ${String(rarity || '?').toUpperCase()}`, 52, 228);

  ctx.fillStyle = '#7f8c9a';
  ctx.font = '14px Consolas, monospace';
  ctx.fillText(`id: ${itemId}`, 52, 258);

  ctx.fillStyle = 'rgba(0, 255, 170, 0.15)';
  rr(ctx, 52, 278, W - 104, 72, 10);
  ctx.fill();
  ctx.strokeStyle = 'rgba(0, 255, 170, 0.25)';
  ctx.stroke();
  ctx.fillStyle = '#a8ffb8';
  ctx.font = '12px Consolas, monospace';
  const lines = [
    '> flux :: loot pondéré hors boutique',
    '> statut :: OBJET_INJECTÉ → inventaire joueur',
    "> prochaine étape :: `/inventaire` pour contrôle",
  ];
  let ly = 302;
  for (const ln of lines) {
    ctx.fillText(ln, 68, ly);
    ly += 22;
  }

  ctx.fillStyle = '#3d5a4a';
  ctx.font = '10px Consolas, monospace';
  ctx.fillText('// cooldown 12h · rôle requis selon config', 52, H - 36);

  return canvas.toBuffer('image/png');
}

/**
 * Petite carte statique refus / cooldown (même esthétique).
 * @param {'denied'|'cooldown'} kind
 * @param {{ waitLabel?: string }} extra
 */
function renderHackerStatusCard(kind, extra = {}) {
  const W = 720;
  const H = 280;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, '#0c0505');
  bg.addColorStop(1, '#1a0a0a');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);
  noiseGrid(ctx, W, H);

  const accent = kind === 'denied' ? '#ff4444' : '#ffaa00';
  ctx.strokeStyle = accent + 'aa';
  ctx.lineWidth = 2;
  rr(ctx, 24, 24, W - 48, H - 48, 14);
  ctx.stroke();

  ctx.fillStyle = accent;
  ctx.font = 'bold 20px "Segoe UI", sans-serif';
  ctx.fillText(kind === 'denied' ? 'ACCES REFUSE' : 'COOLDOWN ACTIF', 48, 88);

  ctx.fillStyle = '#e0e0e0';
  ctx.font = '14px "Segoe UI", sans-serif';
  const msg =
    kind === 'denied'
      ? 'Réservé aux membres avec le rôle Hacker (owners exemptés).'
      : `Prochain tirage dans ${extra.waitLabel || '…'} (limite 12 h).`;
  const words = msg.split(' ');
  let line = '';
  let y = 124;
  const maxW = W - 100;
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width > maxW && line) {
      ctx.fillText(line, 48, y);
      y += 22;
      line = w;
    } else line = test;
  }
  if (line) ctx.fillText(line, 48, y);

  ctx.fillStyle = '#885555';
  ctx.font = '11px Consolas, monospace';
  ctx.fillText('// SALON HACKER — même terminal que le loot', 48, H - 40);

  return canvas.toBuffer('image/png');
}

module.exports = { renderHackerLootCard, renderHackerStatusCard, RARITY_HEX };
