const { createCanvas } = require('canvas');

const RARITY_HEX = {
  Commun: '#bdc3c7',
  Rare: '#3498db',
  Epique: '#af7ac5',
  Légendaire: '#f39c12',
  Mythique: '#e74c3c',
  Goatesque: '#1abc9c',
  Staresque: '#f4d03f',
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

function noiseGrid(ctx, W, H, color, alpha) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = color;
  const step = 22;
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

function wrapLines(ctx, text, maxW) {
  const words = String(text).split(/\s+/);
  const lines = [];
  let line = '';
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width > maxW && line) {
      lines.push(line);
      line = w;
    } else line = test;
  }
  if (line) lines.push(line);
  return lines;
}

/**
 * @param {{ guildName: string, itemName: string, itemId: string, rarity: string }} opts
 */
function renderHackerLootCard(opts) {
  const { guildName, itemName, itemId, rarity } = opts;
  const accent = RARITY_HEX[rarity] || '#2ecc71';
  const W = 920;
  const H = 480;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  const cx = W / 2;

  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, '#1a0a2e');
  bg.addColorStop(0.45, '#0f3460');
  bg.addColorStop(1, '#16213e');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  const glowL = ctx.createRadialGradient(0, H * 0.3, 0, 0, H * 0.3, 320);
  glowL.addColorStop(0, 'rgba(0, 255, 200, 0.25)');
  glowL.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = glowL;
  ctx.fillRect(0, 0, W, H);

  const glowR = ctx.createRadialGradient(W, 0, 0, W, 0, 300);
  glowR.addColorStop(0, `${accent}55`);
  glowR.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = glowR;
  ctx.fillRect(0, 0, W, H);

  noiseGrid(ctx, W, H, '#00ffb355', 0.11);

  ctx.strokeStyle = 'rgba(255,255,255,0.15)';
  ctx.lineWidth = 1;
  rr(ctx, 20, 20, W - 40, H - 40, 20);
  ctx.stroke();

  ctx.shadowColor = accent;
  ctx.shadowBlur = 22;
  ctx.strokeStyle = accent;
  ctx.lineWidth = 2.5;
  rr(ctx, 32, 32, W - 64, H - 64, 16);
  ctx.stroke();
  ctx.shadowBlur = 0;

  ctx.textAlign = 'center';
  ctx.fillStyle = '#00ffd0';
  ctx.font = 'bold 11px Consolas, monospace';
  ctx.fillText('◆ SALON HACKER // CANAL SÉCURISÉ', cx, 58);

  ctx.fillStyle = 'rgba(255, 232, 200, 0.85)';
  ctx.font = '12px Consolas, monospace';
  ctx.fillText(`NODE :: ${String(guildName).slice(0, 48)}`, cx, 78);

  const barY = 98;
  const barW = W - 200;
  const barX = (W - barW) / 2;
  rr(ctx, barX, barY, barW, 8, 4);
  ctx.fillStyle = 'rgba(0,0,0,0.4)';
  ctx.fill();
  const pulse = ctx.createLinearGradient(barX, 0, barX + barW, 0);
  pulse.addColorStop(0, accent);
  pulse.addColorStop(0.5, '#00ffd0');
  pulse.addColorStop(1, accent);
  ctx.fillStyle = pulse;
  rr(ctx, barX, barY, barW * 0.78, 8, 4);
  ctx.fill();

  ctx.fillStyle = '#98f5e9';
  ctx.font = 'bold 12px Consolas, monospace';
  ctx.fillText('[ DECRYPT_PAYLOAD_OK ]', cx, 128);

  ctx.fillStyle = '#fff';
  ctx.font = 'bold 30px "Segoe UI", sans-serif';
  const nameUpper = String(itemName || '???').toUpperCase();
  const nameLines = wrapLines(ctx, nameUpper, W - 120);
  let ny = 168;
  for (const ln of nameLines) {
    const lg = ctx.createLinearGradient(cx - 200, 0, cx + 200, 0);
    lg.addColorStop(0, '#ffffff');
    lg.addColorStop(0.5, accent);
    lg.addColorStop(1, '#ffffff');
    ctx.fillStyle = lg;
    ctx.fillText(ln, cx, ny);
    ny += 36;
  }

  ctx.font = 'bold 14px Consolas, monospace';
  ctx.fillStyle = accent;
  ctx.fillText(`◆ RARETÉ  ${String(rarity || '?').toUpperCase()}`, cx, ny + 8);

  ctx.fillStyle = 'rgba(200, 220, 255, 0.75)';
  ctx.font = '13px Consolas, monospace';
  ctx.fillText(`uid.hash  ${itemId}`, cx, ny + 36);

  const boxY = ny + 56;
  const boxH = 96;
  const boxW = W - 120;
  const boxX = (W - boxW) / 2;
  rr(ctx, boxX, boxY, boxW, boxH, 14);
  ctx.fillStyle = 'rgba(0, 40, 35, 0.55)';
  ctx.fill();
  ctx.strokeStyle = `rgba(0, 255, 200, 0.35)`;
  ctx.lineWidth = 1.5;
  ctx.stroke();

  ctx.textAlign = 'left';
  ctx.fillStyle = '#7bed9f';
  ctx.font = '12px Consolas, monospace';
  const lines = [
    '> flux :: loot pondéré (hors boutique)',
    '> inject :: inventaire joueur — OK',
    "> suite :: `/inventaire` pour contrôle",
  ];
  let ly = boxY + 26;
  const lx = boxX + 28;
  for (const ln of lines) {
    ctx.fillText(ln, lx, ly);
    ly += 24;
  }

  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(255, 180, 120, 0.65)';
  ctx.font = '10px Consolas, monospace';
  ctx.fillText('// cooldown 12h · rôle requis selon config', cx, H - 28);

  return canvas.toBuffer('image/png');
}

function renderHackerStatusCard(kind, extra = {}) {
  const W = 720;
  const H = 280;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  const cx = W / 2;

  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, '#2c0a0a');
  bg.addColorStop(1, '#1a0508');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);
  noiseGrid(ctx, W, H, '#ff555544', 0.08);

  const accent = kind === 'denied' ? '#ff6b6b' : '#feca57';
  ctx.strokeStyle = accent + 'cc';
  ctx.lineWidth = 2;
  rr(ctx, 20, 20, W - 40, H - 40, 14);
  ctx.stroke();

  ctx.textAlign = 'center';
  ctx.fillStyle = accent;
  ctx.font = 'bold 22px "Segoe UI", sans-serif';
  ctx.fillText(kind === 'denied' ? 'ACCES REFUSE' : 'COOLDOWN ACTIF', cx, 92);

  ctx.fillStyle = '#ecf0f1';
  ctx.font = '14px "Segoe UI", sans-serif';
  const msg =
    kind === 'denied'
      ? 'Réservé aux membres avec le rôle Hacker (owners exemptés).'
      : `Prochain tirage dans ${extra.waitLabel || '…'} (limite 12 h).`;
  const words = msg.split(' ');
  let line = '';
  let y = 126;
  const maxW = W - 80;
  ctx.textAlign = 'left';
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width > maxW && line) {
      ctx.fillText(line, 48, y);
      y += 22;
      line = w;
    } else line = test;
  }
  if (line) ctx.fillText(line, 48, y);

  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(255,200,200,0.5)';
  ctx.font = '11px Consolas, monospace';
  ctx.fillText('// SALON HACKER', cx, H - 36);

  return canvas.toBuffer('image/png');
}

module.exports = { renderHackerLootCard, renderHackerStatusCard, RARITY_HEX };
