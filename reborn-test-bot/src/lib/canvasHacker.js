/**
 * Carte salon Hacker — même ADN visuel que /profil (blz_bg, panneaux, or).
 * Centré, lisible, sans esthétique « terminal néon ».
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

const RARITY_RING = {
  Commun: '#9ca3af',
  Rare: '#60a5fa',
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

function renderLoot(ctx, W, H, { guildName, itemName, itemId, rarity }) {
  const pad = 22;
  const cx = W / 2;

  const ring = RARITY_RING[rarity] || T.accent;

  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';

  ctx.font = '700 12px "Segoe UI", Arial';
  ctx.fillStyle = T.label;
  ctx.fillText('SALON HACKER', cx, pad + 28);

  ctx.font = '500 13px "Segoe UI", Arial';
  ctx.fillStyle = T.sub;
  ctx.fillText(truncate(ctx, String(guildName), 50), cx, pad + 48);

  const cardW = Math.min(640, W - 80);
  const cardH = 268;
  const cardX = (W - cardW) / 2;
  const cardY = pad + 62;

  statPanel(ctx, cardX, cardY, cardW, cardH, 18);
  ctx.shadowColor = ring;
  ctx.shadowBlur = 18;
  rr(ctx, cardX + 3, cardY + 3, cardW - 6, cardH - 6, 16);
  ctx.strokeStyle = ring;
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.shadowBlur = 0;

  const innerY = cardY + 28;
  ctx.font = '700 11px "Segoe UI", Arial';
  ctx.fillStyle = T.label;
  ctx.fillText('OBJET OBTENU', cx, innerY);

  const titleFont = '700 26px "Segoe UI", Arial';
  const nameLines = wrapLines(ctx, String(itemName || '???').toUpperCase(), cardW - 80, titleFont);
  let ty = innerY + 36;
  ctx.font = titleFont;
  ctx.fillStyle = T.text;
  for (const ln of nameLines) {
    ctx.fillText(ln, cx, ty);
    ty += 32;
  }

  const pillW = 160;
  const pillH = 28;
  const pillX = cx - pillW / 2;
  const pillY = ty + 12;
  rr(ctx, pillX, pillY, pillW, pillH, pillH / 2);
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.fill();
  ctx.strokeStyle = ring;
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.font = '600 12px "Segoe UI", Arial';
  ctx.fillStyle = T.accent;
  ctx.fillText(String(rarity || '?').toUpperCase(), cx, pillY + 19);

  ctx.font = '500 13px Consolas, monospace';
  ctx.fillStyle = 'rgba(242,215,211,0.85)';
  ctx.fillText(itemId, cx, pillY + pillH + 28);

  ctx.font = '500 13px "Segoe UI", Arial';
  ctx.fillStyle = T.sub;
  ctx.fillText("Ajouté à ton inventaire — commande /inventaire", cx, cardY + cardH - 22);

  ctx.textAlign = 'center';
  ctx.font = '500 10px "Segoe UI", Arial';
  ctx.fillStyle = 'rgba(255,245,240,0.4)';
  ctx.fillText('Loot pondéré (hors boutique) · Cooldown 12 h', cx, H - pad - 12);
  ctx.fillText('Par Koyorin et Roxxor', cx, H - pad - 28);
}

function truncate(ctx, s, maxLen) {
  const t = String(s);
  if (t.length <= maxLen) return t;
  return `${t.slice(0, maxLen - 1)}…`;
}

function renderHackerLootCard(opts) {
  const W = 920;
  const H = 480;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  return (async () => {
    await drawBackdrop(ctx, W, H);

    const ob = ctx.createLinearGradient(0, H, W, 0);
    ob.addColorStop(0, 'rgba(120, 20, 35, 0.2)');
    ob.addColorStop(1, 'rgba(20, 6, 10, 0.25)');
    ctx.fillStyle = ob;
    ctx.fillRect(0, 0, W, H);

    const pad = 18;
    rr(ctx, pad, pad, W - pad * 2, H - pad * 2, 20);
    ctx.fillStyle = T.shell;
    ctx.fill();
    ctx.strokeStyle = T.outlineWarm;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    renderLoot(ctx, W, H, opts);
    return canvas.toBuffer('image/png');
  })();
}

function renderStatus(ctx, W, H, kind, extra) {
  const cx = W / 2;
  const pad = 24;
  ctx.textAlign = 'center';

  ctx.font = '700 12px "Segoe UI", Arial';
  ctx.fillStyle = T.label;
  ctx.fillText('SALON HACKER', cx, pad + 32);

  const accent = kind === 'denied' ? '#f87171' : T.accent;
  ctx.font = '700 22px "Segoe UI", Arial';
  ctx.fillStyle = accent;
  ctx.fillText(kind === 'denied' ? 'Accès refusé' : 'Patience…', cx, pad + 72);

  const msg =
    kind === 'denied'
      ? 'Tu dois avoir le rôle Hacker sur ce serveur (sauf owners).'
      : `Prochain tirage dans ${extra.waitLabel || '…'}`;

  ctx.font = '500 15px "Segoe UI", Arial';
  ctx.fillStyle = T.text;
  const lines = wrapLines(ctx, msg, W - 100, '500 15px "Segoe UI", Arial');
  let y = pad + 108;
  for (const ln of lines) {
    ctx.fillText(ln, cx, y);
    y += 22;
  }

  ctx.font = '500 12px "Segoe UI", Arial';
  ctx.fillStyle = T.sub;
  ctx.fillText(kind === 'denied' ? '/hacker une fois le rôle obtenu' : 'Limite : 12 h entre deux récompenses', cx, H - 36);
}

function renderHackerStatusCard(kind, extra = {}) {
  const W = 720;
  const H = 300;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  return (async () => {
    await drawBackdrop(ctx, W, H);
    const pad = 16;
    rr(ctx, pad, pad, W - pad * 2, H - pad * 2, 18);
    ctx.fillStyle = T.shell;
    ctx.fill();
    ctx.strokeStyle = T.outlineWarm;
    ctx.stroke();
    renderStatus(ctx, W, H, kind, extra);
    return canvas.toBuffer('image/png');
  })();
}

module.exports = {
  renderHackerLootCard,
  renderHackerStatusCard,
  RARITY_RING,
};
