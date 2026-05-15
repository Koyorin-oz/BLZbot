const { createCanvas, loadImage } = require('canvas');
const fs = require('node:fs');
const path = require('node:path');

const BLZ_BG = path.join(__dirname, '..', '..', '..', 'niveau', 'src', 'assets', 'blz_bg.png');
const { INDEX_BONUSES } = require('../services/itemMatrix');

function rgba(hex, a) {
  const h = String(hex).replace('#', '');
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

function drawAvatarRing(ctx, img, cx, cy, rOuter, ringColor) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, rOuter, 0, Math.PI * 2);
  ctx.clip();
  if (img) ctx.drawImage(img, cx - rOuter, cy - rOuter, rOuter * 2, rOuter * 2);
  else {
    ctx.fillStyle = '#4a235a';
    ctx.fillRect(cx - rOuter, cy - rOuter, rOuter * 2, rOuter * 2);
  }
  ctx.restore();
  ctx.strokeStyle = ringColor;
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(cx, cy, rOuter + 2, 0, Math.PI * 2);
  ctx.stroke();
}

function milestoneHint(pct, steps, claimedSet) {
  const claimable = steps.find((s) => !claimedSet.has(s.pct) && pct >= s.pct);
  if (claimable) return `▶ Réclame le palier ${claimable.pct} % avec /itemindex reclamer`;
  const upcoming = steps.find((s) => pct < s.pct);
  if (upcoming) return `▶ Prochain palier : ${upcoming.pct} % (encore ${upcoming.pct - pct} %)`;
  return '▶ Catalogue complet — pense à tout réclamer';
}

function stepAccent(i) {
  const hues = ['#e74c3c', '#e67e22', '#f1c40f', '#2ecc71', '#1abc9c', '#3498db', '#9b59b6', '#e91e63', '#00bcd4', '#ff5722'];
  return hues[i % hues.length];
}

/**
 * @param {{ displayName: string, avatarUrl: string, completionPct: number, steps: Array<{pct:number, stars:bigint, chests?:any[], roleNote?:string}>, claimed: number[] }} opts
 */
async function renderIndexCard(opts) {
  const { displayName, avatarUrl, completionPct, steps, claimed } = opts;
  const claimedSet = new Set(claimed);
  const pct = Math.min(100, Math.max(0, completionPct | 0));

  const W = 980;
  const H = 920;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  const g0 = ctx.createLinearGradient(0, 0, W, H);
  g0.addColorStop(0, '#2d1b4e');
  g0.addColorStop(0.35, '#162447');
  g0.addColorStop(0.7, '#1f4068');
  g0.addColorStop(1, '#1b3c59');
  ctx.fillStyle = g0;
  ctx.fillRect(0, 0, W, H);

  const orb = ctx.createRadialGradient(W * 0.85, H * 0.12, 0, W * 0.85, H * 0.12, 280);
  orb.addColorStop(0, 'rgba(233, 30, 99, 0.35)');
  orb.addColorStop(0.5, 'rgba(155, 89, 182, 0.12)');
  orb.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = orb;
  ctx.fillRect(0, 0, W, H);

  const orb2 = ctx.createRadialGradient(W * 0.1, H * 0.85, 0, W * 0.1, H * 0.85, 260);
  orb2.addColorStop(0, 'rgba(26, 188, 156, 0.4)');
  orb2.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = orb2;
  ctx.fillRect(0, 0, W, H);

  const bg = await loadSafe(BLZ_BG);
  if (bg) {
    ctx.save();
    ctx.globalAlpha = 0.22;
    drawImageCover(ctx, bg, 0, 0, W, H);
    ctx.restore();
  }

  ctx.strokeStyle = 'rgba(255,255,255,0.12)';
  for (let d = -H; d < W + H; d += 28) {
    ctx.beginPath();
    ctx.moveTo(d, 0);
    ctx.lineTo(d + H, H);
    ctx.stroke();
  }

  const avatar = await loadSafe(avatarUrl);
  const ringColor = pct >= 75 ? '#f1c40f' : pct >= 40 ? '#9b59b6' : '#1abc9c';
  drawAvatarRing(ctx, avatar, 96, 118, 52, ringColor);

  ctx.textAlign = 'left';
  ctx.fillStyle = '#ff6b9d';
  ctx.font = 'bold 15px "Segoe UI", sans-serif';
  ctx.fillText('CATALOGUE REBORN', 176, 78);

  const titleGrad = ctx.createLinearGradient(176, 0, 176 + 400, 0);
  titleGrad.addColorStop(0, '#fff');
  titleGrad.addColorStop(0.5, '#ffeaa7');
  titleGrad.addColorStop(1, '#74b9ff');
  ctx.fillStyle = titleGrad;
  ctx.font = 'bold 34px "Segoe UI", sans-serif';
  ctx.fillText('Index & progression', 176, 118);

  ctx.fillStyle = '#dfe6e9';
  ctx.font = '600 17px "Segoe UI", sans-serif';
  ctx.fillText(String(displayName || 'Joueur'), 176, 148);

  const pctGrad = ctx.createLinearGradient(W - 280, 60, W - 40, 140);
  pctGrad.addColorStop(0, '#fd79a8');
  pctGrad.addColorStop(0.5, '#ffeaa7');
  pctGrad.addColorStop(1, '#55efc4');
  ctx.fillStyle = pctGrad;
  ctx.font = 'bold 56px "Segoe UI", sans-serif';
  ctx.textAlign = 'right';
  ctx.fillText(`${pct}`, W - 48, 128);
  ctx.font = 'bold 28px "Segoe UI", sans-serif';
  ctx.fillStyle = '#fab1a0';
  ctx.fillText('%', W - 42, 128);

  ctx.textAlign = 'left';
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.font = '13px "Segoe UI", sans-serif';
  ctx.fillText('complété', W - 148, 152);

  const bx = 40;
  const by = 196;
  const bw = W - 80;
  const bh = 32;
  rr(ctx, bx, by, bw, bh, 16);
  const track = ctx.createLinearGradient(bx, 0, bx + bw, 0);
  track.addColorStop(0, 'rgba(0,0,0,0.45)');
  track.addColorStop(1, 'rgba(45,52,54,0.5)');
  ctx.fillStyle = track;
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.25)';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  const fillRatio = pct / 100;
  const innerW = Math.max(fillRatio * bw, pct > 0 ? 20 : 0);
  const barG = ctx.createLinearGradient(bx, 0, bx + bw, 0);
  barG.addColorStop(0, '#00cec9');
  barG.addColorStop(0.35, '#6c5ce7');
  barG.addColorStop(0.7, '#fd79a8');
  barG.addColorStop(1, '#ffeaa7');
  ctx.fillStyle = barG;
  rr(ctx, bx + 3, by + 3, Math.max(0, innerW - 6), bh - 6, 13);
  ctx.fill();

  ctx.fillStyle = '#fff';
  ctx.font = 'bold 14px Consolas, monospace';
  ctx.textAlign = 'right';
  ctx.fillText(`${pct} / 100`, bx + bw - 14, by + 21);
  ctx.textAlign = 'left';

  ctx.fillStyle = '#ffeaa7';
  ctx.font = 'bold 18px "Segoe UI", sans-serif';
  ctx.fillText('◆ Paliers & récompenses', 48, 268);

  const padX = 44;
  const colGap = 14;
  const colW = (W - padX * 2 - colGap) / 2;
  let i = 0;
  for (const s of steps) {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const x = padX + col * (colW + colGap);
    const y = 288 + row * 54;
    const done = claimedSet.has(s.pct);
    const reached = pct >= s.pct;
    const accent = stepAccent(i);

    rr(ctx, x, y, colW, 48, 12);
    if (done) {
      const cg = ctx.createLinearGradient(x, y, x + colW, y + 48);
      cg.addColorStop(0, 'rgba(46, 204, 113, 0.45)');
      cg.addColorStop(1, 'rgba(39, 174, 96, 0.25)');
      ctx.fillStyle = cg;
    } else if (reached) {
      const cg = ctx.createLinearGradient(x, y, x + colW, y + 48);
      cg.addColorStop(0, rgba(accent, 0.35));
      cg.addColorStop(1, rgba(accent, 0.12));
      ctx.fillStyle = cg;
    } else {
      ctx.fillStyle = 'rgba(44, 62, 80, 0.55)';
    }
    ctx.fill();
    ctx.strokeStyle = done ? '#2ecc71' : reached ? accent : 'rgba(127,140,154,0.4)';
    ctx.lineWidth = done || reached ? 2 : 1;
    ctx.stroke();

    ctx.font = '18px "Segoe UI", sans-serif';
    ctx.fillStyle = done ? '#2ecc71' : reached ? '#ffeaa7' : '#636e72';
    ctx.fillText(done ? '✓' : reached ? '◆' : '○', x + 12, y + 32);

    ctx.font = 'bold 15px "Segoe UI", sans-serif';
    ctx.fillStyle = '#fff';
    ctx.fillText(`${s.pct}%`, x + 42, y + 31);

    ctx.font = '600 13px Consolas, monospace';
    ctx.fillStyle = '#fdcb6e';
    ctx.fillText(`+${s.stars.toLocaleString('fr-FR')} ★`, x + 96, y + 31);

    const chests = (s.chests || [])
      .map((c) => `${c.qty > 1 ? `${c.qty}×` : ''}${c.id.replace(/_/g, ' ')}`)
      .join(', ');
    let extra = chests || '';
    if (s.roleNote) extra = extra ? `${extra} · rôle` : 'rôle';
    if (extra) {
      ctx.font = '11px Consolas, monospace';
      ctx.fillStyle = rgba('#a29bfe', 0.95);
      const short = extra.length > 32 ? `${extra.slice(0, 30)}…` : extra;
      ctx.fillText(short, x + 210, y + 31);
    }
    i += 1;
  }

  const bonusY = 288 + 5 * 54 + 24;
  ctx.fillStyle = '#74b9ff';
  ctx.font = 'bold 17px "Segoe UI", sans-serif';
  ctx.fillText('⚡ Bonus index actifs (permanents)', 48, bonusY);

  const activeBonuses = INDEX_BONUSES.filter((b) => pct >= b.pct);
  let byLine = bonusY + 28;
  if (!activeBonuses.length) {
    ctx.fillStyle = 'rgba(255,255,255,0.65)';
    ctx.font = '14px "Segoe UI", sans-serif';
    ctx.fillText('Aucun pour l’instant — atteins 10 % pour +1 % XP.', 48, byLine);
    byLine += 24;
  } else {
    for (const b of activeBonuses) {
      rr(ctx, 48, byLine - 4, W - 96, 26, 8);
      ctx.fillStyle = 'rgba(116, 185, 255, 0.2)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(116, 185, 255, 0.45)';
      ctx.stroke();
      ctx.fillStyle = '#dfe6e9';
      ctx.font = '13px "Segoe UI", sans-serif';
      ctx.fillText(`${b.pct}%  →  ${b.label}`, 62, byLine + 14);
      byLine += 34;
    }
  }

  byLine += 12;
  rr(ctx, 40, byLine, W - 80, 56, 12);
  ctx.fillStyle = 'rgba(253, 121, 168, 0.15)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(253, 121, 168, 0.5)';
  ctx.stroke();
  ctx.fillStyle = '#ffeaa7';
  ctx.font = 'bold 14px "Segoe UI", sans-serif';
  ctx.fillText(milestoneHint(pct, steps, claimedSet), 56, byLine + 22);

  byLine += 72;
  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  ctx.font = '12px Consolas, monospace';
  ctx.fillText('✓ réclamé   ·   ◆ atteignable (réclame !)   ·   ○ verrouillé', 48, byLine);
  ctx.fillText('/itemindex matrice  ·  cumul Index × Ranked × Guilde', 48, byLine + 20);

  return canvas.toBuffer('image/png');
}

module.exports = { renderIndexCard };
