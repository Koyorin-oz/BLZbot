/**
 * Carte salon Hacker — même ADN visuel que /profil (blz_bg, panneaux, or).
 */
const { createCanvas, loadImage } = require('canvas');
const fs = require('node:fs');
const path = require('node:path');

const BLZ_BG = path.join(__dirname, '..', '..', '..', 'niveau', 'src', 'assets', 'blz_bg.png');

const T = {
  overlay: 'rgba(0,0,0,0.32)',
  panel: 'rgba(0,0,0,0.58)',
  shell: 'rgba(8, 2, 4, 0.55)',
  glass: 'rgba(255, 248, 245, 0.08)',
  text: '#ffffff',
  sub: '#f2d7d3',
  accent: '#ffd166',
  label: '#e8b83a',
  outline: 'rgba(255,255,255,0.38)',
  outlineWarm: 'rgba(255, 180, 120, 0.3)',
};

/** Anneau + embed Discord (hex sans # pour parseInt). */
const RARITY_RING = {
  Commun: '#94a3b8',
  Rare: '#38bdf8',
  Epique: '#c084fc',
  Légendaire: '#fb923c',
  Mythique: '#f87171',
  Goatesque: '#2dd4bf',
  Staresque: '#facc15',
};

function rr(ctx, x, y, w, h, r) {
  const R = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + R, y);
  ctx.arcTo(x + w, y, x + w, y + h, R);
  ctx.arcTo(x + w, y + h, x, y + h, R);
  ctx.arcTo(x, y + h, x, y, R);
  ctx.arcTo(x, y, x + w, y, R);
  ctx.closePath();
}

async function loadBlz() {
  if (!fs.existsSync(BLZ_BG)) return null;
  try {
    return await loadImage(fs.readFileSync(BLZ_BG));
  } catch {
    return null;
  }
}

async function drawBackdrop(ctx, cw, ch) {
  const bg = await loadBlz();
  if (bg) ctx.drawImage(bg, 0, 0, cw, ch);
  else {
    ctx.fillStyle = '#1a0a0c';
    ctx.fillRect(0, 0, cw, ch);
  }
  ctx.fillStyle = T.overlay;
  ctx.fillRect(0, 0, cw, ch);
}

function statPanel(ctx, x, y, w, h, r) {
  rr(ctx, x, y, w, h, r);
  ctx.fillStyle = T.panel;
  ctx.fill();
  ctx.strokeStyle = T.outline;
  ctx.lineWidth = 2;
  ctx.stroke();
}

function wrapLines(ctx, text, maxW, font) {
  ctx.font = font;
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

function truncate(str, maxLen) {
  const t = String(str);
  if (t.length <= maxLen) return t;
  return `${t.slice(0, maxLen - 1)}…`;
}

function drawLootFace(ctx, W, H, pad, { guildName, itemName, itemId, rarity }) {
  const ring = RARITY_RING[rarity] || T.accent;
  const inset = 26;
  const leftX = pad + inset;
  const rightX = W - pad - inset;
  const cx = W / 2;

  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  ctx.font = '800 11px "Segoe UI", Arial';
  ctx.fillStyle = T.label;
  ctx.fillText('SALON HACKER', leftX, pad + 30);
  ctx.textAlign = 'right';
  ctx.font = '600 12px "Segoe UI", Arial';
  ctx.fillStyle = T.sub;
  ctx.fillText(truncate(guildName, 40), rightX, pad + 30);

  const cardW = Math.min(796, rightX - leftX);
  const cardH = Math.min(336, H - pad * 2 - 100);
  const cardX = (W - cardW) / 2;
  const cardY = pad + 48;

  statPanel(ctx, cardX, cardY, cardW, cardH, 22);

  ctx.save();
  ctx.shadowColor = ring;
  ctx.shadowBlur = 22;
  rr(ctx, cardX + 6, cardY + 6, cardW - 12, cardH - 12, 19);
  ctx.strokeStyle = ring;
  ctx.lineWidth = 2.5;
  ctx.stroke();
  ctx.restore();

  const innerX = cardX + 20;
  const innerY = cardY + 22;
  const innerW = cardW - 40;
  const innerH = cardH - 82;
  rr(ctx, innerX, innerY, innerW, innerH, 16);
  ctx.fillStyle = T.glass;
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.12)';
  ctx.lineWidth = 1;
  ctx.stroke();

  const accentBarX = innerX + 12;
  const accentBarTop = innerY + 14;
  const accentBarH = innerH - 28;
  rr(ctx, accentBarX, accentBarTop, 5, accentBarH, 2);
  ctx.fillStyle = ring;
  ctx.globalAlpha = 0.92;
  ctx.fill();
  ctx.globalAlpha = 1;

  ctx.textAlign = 'center';
  ctx.font = '700 10px "Segoe UI", Arial';
  ctx.fillStyle = T.label;
  ctx.fillText('OBJET OBTENU', cx, innerY + 28);

  const titleFont = '800 30px "Segoe UI", Arial';
  const rawName = String(itemName || '???').toUpperCase();
  ctx.font = titleFont;
  const nameLines = wrapLines(ctx, rawName, innerW - 56, titleFont);
  let ty = innerY + 58;
  ctx.fillStyle = T.text;
  for (const ln of nameLines) {
    ctx.fillText(ln, cx, ty);
    ty += 36;
  }

  const pillW = 176;
  const pillH = 32;
  const pillX = cx - pillW / 2;
  const pillY = ty + 14;
  rr(ctx, pillX, pillY, pillW, pillH, pillH / 2);
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.fill();
  ctx.strokeStyle = ring;
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.font = '700 11px "Segoe UI", Arial';
  ctx.fillStyle = T.accent;
  ctx.fillText(String(rarity || '?').toUpperCase(), cx, pillY + 21);

  ctx.font = '500 12px Consolas, monospace';
  ctx.fillStyle = 'rgba(242,215,211,0.95)';
  ctx.fillText(itemId, cx, pillY + pillH + 28);

  ctx.font = '500 12px "Segoe UI", Arial';
  ctx.fillStyle = T.sub;
  ctx.fillText('Ajouté à ton inventaire', cx, innerY + innerH - 14);

  ctx.font = '500 10px "Segoe UI", Arial';
  ctx.fillStyle = 'rgba(255,245,240,0.35)';
  ctx.fillText('Par Koyorin et Roxxor', cx, H - pad - 12);
}

async function renderHackerLootCard(opts) {
  const W = 920;
  const H = 524;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  const pad = 20;

  await drawBackdrop(ctx, W, H);

  const ob = ctx.createLinearGradient(0, H, W, 0);
  ob.addColorStop(0, 'rgba(120, 20, 35, 0.18)');
  ob.addColorStop(1, 'rgba(20, 6, 10, 0.22)');
  ctx.fillStyle = ob;
  ctx.fillRect(0, 0, W, H);

  rr(ctx, pad, pad, W - pad * 2, H - pad * 2, 22);
  ctx.fillStyle = T.shell;
  ctx.fill();
  ctx.strokeStyle = T.outlineWarm;
  ctx.lineWidth = 1.5;
  ctx.stroke();

  const capY = pad + 6;
  const capW = W - pad * 2 - 40;
  const capG = ctx.createLinearGradient(pad + 20, capY, pad + 20 + capW, capY);
  capG.addColorStop(0, 'rgba(255, 209, 102, 0)');
  capG.addColorStop(0.5, 'rgba(255, 209, 102, 0.72)');
  capG.addColorStop(1, 'rgba(255, 209, 102, 0)');
  ctx.fillStyle = capG;
  rr(ctx, pad + 20, capY, capW, 3, 1.5);
  ctx.fill();

  drawLootFace(ctx, W, H, pad, opts);
  return canvas.toBuffer('image/png');
}

function drawStatusFace(ctx, W, H, pad, kind, extra) {
  const inset = 26;
  const leftX = pad + inset;
  const rightX = W - pad - inset;
  const cx = W / 2;
  ctx.textBaseline = 'alphabetic';

  ctx.textAlign = 'left';
  ctx.font = '800 11px "Segoe UI", Arial';
  ctx.fillStyle = T.label;
  ctx.fillText('SALON HACKER', leftX, pad + 30);
  ctx.textAlign = 'right';
  ctx.font = '600 11px "Segoe UI", Arial';
  ctx.fillStyle = T.sub;
  ctx.fillText(kind === 'denied' ? 'Verrou' : 'Délai', rightX, pad + 30);

  const accent = kind === 'denied' ? '#f87171' : T.accent;
  ctx.textAlign = 'center';
  ctx.font = '800 24px "Segoe UI", Arial';
  ctx.fillStyle = accent;
  ctx.fillText(kind === 'denied' ? 'ACCÈS REFUSÉ' : 'COOLDOWN', cx, pad + 88);

  const msg =
    kind === 'denied'
      ? 'Rôle Hacker requis (owners exemptés).'
      : `Prochain tirage · ${extra.waitLabel || '…'}`;

  ctx.font = '500 15px "Segoe UI", Arial';
  ctx.fillStyle = T.text;
  const lines = wrapLines(ctx, msg, W - 88, '500 15px "Segoe UI", Arial');
  let y = pad + 120;
  for (const ln of lines) {
    ctx.fillText(ln, cx, y);
    y += 22;
  }

  ctx.font = '500 10px "Segoe UI", Arial';
  ctx.fillStyle = 'rgba(255,245,240,0.35)';
  ctx.fillText('Par Koyorin et Roxxor', cx, H - pad - 12);
}

async function renderHackerStatusCard(kind, extra = {}) {
  const W = 700;
  const H = 300;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  const pad = 18;

  await drawBackdrop(ctx, W, H);
  rr(ctx, pad, pad, W - pad * 2, H - pad * 2, 18);
  ctx.fillStyle = T.shell;
  ctx.fill();
  ctx.strokeStyle = T.outlineWarm;
  ctx.stroke();

  const capY = pad + 6;
  const capW = W - pad * 2 - 36;
  const capG = ctx.createLinearGradient(pad + 18, capY, pad + 18 + capW, capY);
  capG.addColorStop(0, 'rgba(255, 209, 102, 0)');
  capG.addColorStop(0.5, 'rgba(255, 209, 102, 0.72)');
  capG.addColorStop(1, 'rgba(255, 209, 102, 0)');
  ctx.fillStyle = capG;
  rr(ctx, pad + 18, capY, capW, 3, 1.5);
  ctx.fill();

  drawStatusFace(ctx, W, H, pad, kind, extra);
  return canvas.toBuffer('image/png');
}

module.exports = { renderHackerLootCard, renderHackerStatusCard, RARITY_RING };
