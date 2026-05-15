/**
 * Carte /itemindex voir — style /profil, format paysage (bandeau PP + jauge en haut).
 */
const { createCanvas, loadImage } = require('canvas');
const fs = require('node:fs');
const path = require('node:path');

const { INDEX_BONUSES } = require('../services/itemMatrix');

const BLZ_BG = path.join(__dirname, '..', '..', '..', 'niveau', 'src', 'assets', 'blz_bg.png');

const T = {
  overlay: 'rgba(0,0,0,0.28)',
  panel: 'rgba(0,0,0,0.56)',
  shell: 'rgba(8, 2, 4, 0.55)',
  glass: 'rgba(255, 248, 245, 0.09)',
  text: '#ffffff',
  sub: '#f2d7d3',
  accent: '#ffd166',
  label: '#e8b83a',
  outline: 'rgba(255,255,255,0.38)',
  outlineWarm: 'rgba(255, 180, 120, 0.28)',
  barTrack: 'rgba(0,0,0,0.35)',
  bar0: '#fb923c',
  bar1: '#ef4444',
  bar2: '#dc2626',
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

function drawBackdrop(ctx, cw, ch) {
  return loadBlz().then((bg) => {
    if (bg) ctx.drawImage(bg, 0, 0, cw, ch);
    else {
      ctx.fillStyle = '#1a0a0c';
      ctx.fillRect(0, 0, cw, ch);
    }
    ctx.fillStyle = T.overlay;
    ctx.fillRect(0, 0, cw, ch);
  });
}

function statPanel(ctx, x, y, w, h, r) {
  rr(ctx, x, y, w, h, r);
  ctx.fillStyle = T.panel;
  ctx.fill();
  ctx.strokeStyle = T.outline;
  ctx.lineWidth = 2;
  ctx.stroke();
}

function glassPanel(ctx, x, y, w, h, r) {
  rr(ctx, x, y, w, h, r);
  ctx.fillStyle = T.glass;
  ctx.fill();
  ctx.strokeStyle = 'rgba(255, 200, 160, 0.22)';
  ctx.lineWidth = 1;
  ctx.stroke();
}

function drawXpBar(ctx, x, y, w, h, ratio) {
  rr(ctx, x, y, w, h, h / 2);
  ctx.fillStyle = T.barTrack;
  ctx.fill();
  const r = Math.max(0, Math.min(1, ratio));
  if (r > 0) {
    const fw = Math.max(h, Math.round(w * r));
    const g = ctx.createLinearGradient(x, 0, x + fw, 0);
    g.addColorStop(0, T.bar0);
    g.addColorStop(0.55, T.bar1);
    g.addColorStop(1, T.bar2);
    rr(ctx, x, y, fw, h, h / 2);
    ctx.fillStyle = g;
    ctx.fill();
  }
}

function truncateText(ctx, text, maxW) {
  let t = String(text);
  if (ctx.measureText(t).width <= maxW) return t;
  const ell = '…';
  while (t.length > 0 && ctx.measureText(t + ell).width > maxW) t = t.slice(0, -1);
  return t + ell;
}

function milestoneHint(pct, steps, claimedSet) {
  const claimable = steps.find((s) => !claimedSet.has(s.pct) && pct >= s.pct);
  if (claimable) return `Palier ${claimable.pct} % disponible — /itemindex reclamer`;
  const upcoming = steps.find((s) => pct < s.pct);
  if (upcoming) return `Prochain objectif : ${upcoming.pct} % (${upcoming.pct - pct} % restants)`;
  return 'Catalogue à 100 % — vérifie les récompenses non réclamées';
}

/**
 * @param {{ displayName: string, avatarUrl: string, completionPct: number, steps: any[], claimed: number[] }} opts
 */
async function renderIndexCard(opts) {
  const { displayName, avatarUrl, completionPct, steps, claimed } = opts;
  const claimedSet = new Set(claimed);
  const pct = Math.min(100, Math.max(0, completionPct | 0));

  const W = 1240;
  /** Hauteur suffisante pour bandeau + grille 5×2 + panneau bas + légende (évite le crop en bas). */
  const H = 676;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  await drawBackdrop(ctx, W, H);

  const ob = ctx.createLinearGradient(0, H, W, 0);
  ob.addColorStop(0, 'rgba(120, 20, 35, 0.22)');
  ob.addColorStop(0.55, 'rgba(40, 8, 14, 0.1)');
  ob.addColorStop(1, 'rgba(20, 6, 10, 0.28)');
  ctx.fillStyle = ob;
  ctx.fillRect(0, 0, W, H);

  const pad = 16;
  const outerR = 20;
  rr(ctx, pad, pad, W - pad * 2, H - pad * 2, outerR);
  ctx.fillStyle = T.shell;
  ctx.fill();
  ctx.strokeStyle = T.outlineWarm;
  ctx.lineWidth = 1.5;
  ctx.stroke();

  const innerPad = 12;
  const x0 = pad + innerPad;
  const y0 = pad + innerPad;
  const innerW = W - pad * 2 - innerPad * 2;

  const stripH = 154;
  glassPanel(ctx, x0, y0, innerW, stripH, 14);

  const avatar = await loadSafe(avatarUrl);
  const avR = 44;
  const avCx = x0 + 24 + avR;
  const avCy = y0 + stripH / 2 - 6;
  ctx.save();
  ctx.beginPath();
  ctx.arc(avCx, avCy, avR, 0, Math.PI * 2);
  ctx.clip();
  if (avatar) ctx.drawImage(avatar, avCx - avR, avCy - avR, avR * 2, avR * 2);
  else {
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.fillRect(avCx - avR, avCy - avR, avR * 2, avR * 2);
  }
  ctx.restore();
  ctx.beginPath();
  ctx.arc(avCx, avCy, avR + 2, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(255, 220, 200, 0.45)';
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.font = '700 12px "Segoe UI", Arial';
  ctx.fillStyle = T.label;
  ctx.fillText('INDEX', avCx, avCy + avR + 16);

  const textColX = x0 + 24 + avR * 2 + 28;
  const textRightLimit = x0 + innerW - 120;
  ctx.textAlign = 'left';
  ctx.font = '700 14px "Segoe UI", Arial';
  ctx.fillStyle = T.label;
  ctx.fillText('CATALOGUE REBORN', textColX, y0 + 32);

  ctx.font = '700 30px "Segoe UI", Arial';
  ctx.fillStyle = T.text;
  ctx.fillText(truncateText(ctx, String(displayName || 'Joueur'), textRightLimit - textColX - 20), textColX, y0 + 64);

  ctx.font = '600 16px "Segoe UI", Arial';
  ctx.fillStyle = T.sub;
  ctx.fillText(`Progression ${pct} / 100`, textColX, y0 + 90);

  ctx.textAlign = 'right';
  ctx.font = '700 40px "Segoe UI", Arial';
  ctx.fillStyle = T.accent;
  ctx.fillText(`${pct} %`, x0 + innerW - 22, y0 + 68);
  ctx.textAlign = 'left';

  const barPadX = textColX;
  const barH = 38;
  const barY = y0 + stripH - barH - 12;
  const barW = x0 + innerW - barPadX - 20;
  drawXpBar(ctx, barPadX, barY, barW, barH, pct / 100);
  ctx.font = '600 13px Consolas, monospace';
  ctx.fillStyle = 'rgba(255, 250, 245, 0.92)';
  ctx.textAlign = 'right';
  ctx.fillText(`${pct} / 100`, x0 + innerW - 22, barY + barH / 2 + 5);
  ctx.textAlign = 'left';

  const gridTop = y0 + stripH + 14;
  const cellGap = 12;
  const cellW = (innerW - cellGap) / 2;
  const cellH = 54;
  const mainX = x0;

  let idx = 0;
  for (const s of steps) {
    const col = idx % 2;
    const row = Math.floor(idx / 2);
    const cx = mainX + col * (cellW + cellGap);
    const cy = gridTop + row * (cellH + cellGap);
    const done = claimedSet.has(s.pct);
    const reached = pct >= s.pct;

    statPanel(ctx, cx, cy, cellW, cellH, 12);
    if (done) {
      ctx.save();
      rr(ctx, cx, cy, cellW, cellH, 12);
      ctx.clip();
      const gl = ctx.createLinearGradient(cx, cy, cx + cellW, cy);
      gl.addColorStop(0, 'rgba(34, 197, 94, 0.14)');
      gl.addColorStop(1, 'rgba(34, 197, 94, 0.02)');
      ctx.fillStyle = gl;
      ctx.fillRect(cx, cy, cellW, cellH);
      ctx.restore();
      ctx.strokeStyle = 'rgba(74, 222, 128, 0.45)';
      ctx.lineWidth = 2;
      rr(ctx, cx, cy, cellW, cellH, 12);
      ctx.stroke();
    } else if (reached) {
      ctx.strokeStyle = 'rgba(251, 191, 36, 0.45)';
      ctx.lineWidth = 2;
      rr(ctx, cx, cy, cellW, cellH, 12);
      ctx.stroke();
    }

    const midY = cy + cellH / 2 + 6;
    ctx.font = '700 17px "Segoe UI", Arial';
    ctx.fillStyle = done ? '#86efac' : reached ? T.accent : T.sub;
    ctx.fillText(done ? 'OK' : reached ? '!' : '·', cx + 14, midY);

    ctx.font = '700 17px "Segoe UI", Arial';
    ctx.fillStyle = T.text;
    ctx.fillText(`${s.pct} %`, cx + 44, midY);

    ctx.font = '700 15px "Segoe UI", Arial';
    ctx.fillStyle = T.label;
    ctx.fillText(`+${s.stars.toLocaleString('fr-FR')} ★`, cx + 108, midY);

    const chests = (s.chests || [])
      .map((c) => `${c.qty > 1 ? `${c.qty}× ` : ''}${c.id.replace(/_/g, ' ')}`)
      .join(', ');
    let extra = chests;
    if (s.roleNote) extra = extra ? `${extra} · rôle` : 'rôle';
    if (extra) {
      ctx.font = '600 12px Consolas, monospace';
      ctx.fillStyle = 'rgba(255, 214, 180, 0.9)';
      ctx.fillText(truncateText(ctx, extra, cellW - 268), cx + 260, midY);
    }
    idx += 1;
  }

  const activeBonuses = INDEX_BONUSES.filter((b) => pct >= b.pct);
  const gridBottom = gridTop + 5 * (cellH + cellGap);
  const bottomY = gridBottom + 10;
  const bottomGap = 12;
  const halfW = (innerW - bottomGap) / 2;
  const bottomH = 78;

  statPanel(ctx, x0, bottomY, halfW, bottomH, 12);
  ctx.font = '700 15px "Segoe UI", Arial';
  ctx.fillStyle = T.label;
  ctx.fillText('BONUS INDEX ACTIFS', x0 + 16, bottomY + 26);

  let ly = bottomY + 44;
  ctx.font = '600 14px "Segoe UI", Arial';
  const maxL = 2;
  const shownBonuses = activeBonuses.slice(0, maxL);
  if (!activeBonuses.length) {
    ctx.fillStyle = T.sub;
    ctx.fillText('Aucun — atteins 10 % pour +1 % XP', x0 + 16, ly);
  } else {
    for (const b of shownBonuses) {
      ctx.fillStyle = T.text;
      ctx.fillText(`${b.pct} %`, x0 + 16, ly);
      ctx.fillStyle = T.sub;
      ctx.fillText(`→  ${truncateText(ctx, b.label, halfW - 90)}`, x0 + 56, ly);
      ly += 20;
    }
    if (activeBonuses.length > maxL) {
      ctx.fillStyle = T.sub;
      ctx.fillText(`+ ${activeBonuses.length - maxL} autres paliers`, x0 + 16, ly);
    }
  }

  const hintX = x0 + halfW + bottomGap;
  glassPanel(ctx, hintX, bottomY, halfW, bottomH, 12);
  ctx.font = '600 14px "Segoe UI", Arial';
  ctx.fillStyle = T.text;
  ctx.fillText(truncateText(ctx, milestoneHint(pct, steps, claimedSet), halfW - 28), hintX + 16, bottomY + 32);
  ctx.font = '600 13px "Segoe UI", Arial';
  ctx.fillStyle = T.sub;
  ctx.fillText('/itemindex matrice · Index × Ranked × Guilde', hintX + 16, bottomY + 56);

  ctx.textAlign = 'center';
  ctx.font = '500 11px "Segoe UI", Arial';
  ctx.fillStyle = 'rgba(255,245,240,0.45)';
  ctx.fillText('OK = réclamé  ·  ! = atteignable  ·  · = verrouillé', W / 2, H - pad - 8);
  ctx.fillText('Par Koyorin et Roxxor', W / 2, H - pad - 22);

  return canvas.toBuffer('image/png');
}

module.exports = { renderIndexCard };
