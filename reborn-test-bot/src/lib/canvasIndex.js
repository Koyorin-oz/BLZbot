const { createCanvas, loadImage } = require('canvas');
const fs = require('node:fs');
const path = require('node:path');

const BLZ_BG = path.join(__dirname, '..', '..', '..', 'niveau', 'src', 'assets', 'blz_bg.png');
const GOLD = '#e8c547';
const MUTED = '#7f8c9a';

function rgba(hex, a) {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${a})`;
}

async function loadSafe(urlOrPath) {
  if (!urlOrPath) return null;
  try {
    if (/^https?:\/\//.test(urlOrPath)) return await loadImage(urlOrPath);
    if (fs.existsSync(String(urlOrPath))) return await loadImage(fs.readFileSync(urlOrPath));
    return null;
  } catch {
    return null;
  }
}

function drawImageCover(ctx, img, x, y, w, h) {
  const iw = img.width;
  const ih = img.height;
  if (!iw || !ih) return;
  const ratio = Math.max(w / iw, h / ih);
  const nw = iw * ratio;
  const nh = ih * ratio;
  ctx.drawImage(img, x + (w - nw) / 2, y + (h - nh) / 2, nw, nh);
}

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

function drawAvatarRing(ctx, img, cx, cy, rOuter) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, rOuter, 0, Math.PI * 2);
  ctx.clip();
  if (img) ctx.drawImage(img, cx - rOuter, cy - rOuter, rOuter * 2, rOuter * 2);
  else {
    ctx.fillStyle = '#2c3e50';
    ctx.fillRect(cx - rOuter, cy - rOuter, rOuter * 2, rOuter * 2);
  }
  ctx.restore();
  ctx.strokeStyle = GOLD;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(cx, cy, rOuter + 1.5, 0, Math.PI * 2);
  ctx.stroke();
}

/**
 * @param {{ displayName: string, avatarUrl: string, completionPct: number, steps: Array<{pct:number, stars:bigint, chests?:any[], roleNote?:string}>, claimed: number[] }} opts
 */
async function renderIndexCard(opts) {
  const { displayName, avatarUrl, completionPct, steps, claimed } = opts;
  const claimedSet = new Set(claimed);
  const W = 928;
  const H = 682;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  const bg = await loadSafe(BLZ_BG);
  if (bg) drawImageCover(ctx, bg, 0, 0, W, H);
  else {
    const g = ctx.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, '#141a28');
    g.addColorStop(1, '#0a0d14');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }
  ctx.fillStyle = 'rgba(10, 14, 22, 0.88)';
  ctx.fillRect(0, 0, W, H);

  const vignette = ctx.createRadialGradient(W * 0.45, H * 0.25, 20, W * 0.5, H * 0.45, W * 0.85);
  vignette.addColorStop(0, rgba('#e8c547', 0.06));
  vignette.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, W, H);

  const avatar = await loadSafe(avatarUrl);
  drawAvatarRing(ctx, avatar, W - 86, 74, 46);

  ctx.fillStyle = '#f4f7fb';
  ctx.font = 'bold 26px "Segoe UI", sans-serif';
  ctx.fillText('Index catalogue', 36, 52);
  ctx.font = '16px "Segoe UI", sans-serif';
  ctx.fillStyle = MUTED;
  ctx.fillText(String(displayName || 'Joueur'), 36, 78);

  ctx.font = 'bold 42px "Segoe UI", sans-serif';
  ctx.fillStyle = GOLD;
  ctx.fillText(`${completionPct} %`, 36, 130);
  ctx.font = '13px "Segoe UI", sans-serif';
  ctx.fillStyle = MUTED;
  ctx.fillText('Complétion du catalogue REBORN', 36, 152);

  const bx = 36;
  const by = 168;
  const bw = W - 72;
  const bh = 26;
  rr(ctx, bx, by, bw, bh, 13);
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.fill();
  const fillRatio = Math.min(1, Math.max(0, completionPct / 100));
  const innerW = Math.max(fillRatio * bw, completionPct > 0 ? 14 : 0);
  const grad = ctx.createLinearGradient(bx, 0, bx + bw, 0);
  grad.addColorStop(0, '#27ae60');
  grad.addColorStop(0.55, '#2ecc71');
  grad.addColorStop(1, '#3498db');
  ctx.fillStyle = grad;
  rr(ctx, bx, by, innerW, bh, 13);
  ctx.fill();
  ctx.fillStyle = '#ecf0f1';
  ctx.font = 'bold 13px Consolas, monospace';
  ctx.textAlign = 'right';
  ctx.fillText(`${completionPct}/100`, bx + bw - 12, by + 17);
  ctx.textAlign = 'left';

  ctx.strokeStyle = rgba(GOLD, 0.35);
  ctx.lineWidth = 1;
  rr(ctx, 28, 210, W - 56, H - 224, 14);
  ctx.stroke();

  ctx.fillStyle = '#bdc3c7';
  ctx.font = 'bold 14px "Segoe UI", sans-serif';
  ctx.fillText('Paliers & récompenses', 44, 232);

  const colGap = 16;
  const colW = (W - 88 - colGap) / 2;
  let i = 0;
  for (const s of steps) {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const x = 44 + col * (colW + colGap);
    const y = 248 + row * 44;
    const done = claimedSet.has(s.pct);
    const reached = completionPct >= s.pct;

    rr(ctx, x, y, colW, 38, 8);
    ctx.fillStyle = done ? 'rgba(39, 174, 96, 0.12)' : reached ? 'rgba(52, 152, 219, 0.08)' : 'rgba(255,255,255,0.03)';
    ctx.fill();
    ctx.strokeStyle = done ? rgba('#2ecc71', 0.5) : reached ? rgba('#3498db', 0.35) : 'rgba(127,140,154,0.2)';
    ctx.stroke();

    const badge = done ? '✓' : reached ? '◆' : '·';
    ctx.font = '16px "Segoe UI", sans-serif';
    ctx.fillStyle = done ? '#2ecc71' : reached ? GOLD : MUTED;
    ctx.fillText(badge, x + 10, y + 25);

    ctx.font = 'bold 13px "Segoe UI", sans-serif';
    ctx.fillStyle = '#ecf0f1';
    ctx.fillText(`${s.pct}%`, x + 34, y + 25);

    const starsTxt = `+${s.stars.toLocaleString('fr-FR')} ★`;
    ctx.font = '12px Consolas, monospace';
    ctx.fillStyle = MUTED;
    ctx.fillText(starsTxt, x + 76, y + 25);

    const chests = (s.chests || [])
      .map((c) => `${c.qty > 1 ? `${c.qty}×` : ''}${c.id}`)
      .join(', ');
    let extra = chests || '';
    if (s.roleNote) extra = extra ? `${extra} · rôle` : 'rôle';
    if (extra) {
      ctx.font = '11px Consolas, monospace';
      ctx.fillStyle = rgba('#e8c547', 0.85);
      const short = extra.length > 28 ? `${extra.slice(0, 26)}…` : extra;
      ctx.fillText(short, x + 200, y + 25);
    }
    i += 1;
  }

  ctx.font = '11px Consolas, monospace';
  ctx.fillStyle = rgba(MUTED, 0.9);
  ctx.fillText('✓ réclamé  ·  ◆ atteignable  ·  · verrouillé', 44, H - 18);

  return canvas.toBuffer('image/png');
}

module.exports = { renderIndexCard };
