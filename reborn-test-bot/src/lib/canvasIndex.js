/**
 * Carte /itemindex voir — même vocabulaire visuel que /profil (fiche 2 : canvas-profile-variants).
 */
const { createCanvas, loadImage } = require('canvas');
const fs = require('node:fs');
const path = require('node:path');

const { INDEX_BONUSES } = require('../services/itemMatrix');

const BLZ_BG = path.join(__dirname, '..', '..', '..', 'niveau', 'src', 'assets', 'blz_bg.png');

/** Aligné sur PROFILE_CARD_THEME + fiche 1 bordure (canvas-profile-variants.js). */
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

  const W = 1040;
  const H = 720;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  await drawBackdrop(ctx, W, H);

  const ob = ctx.createLinearGradient(0, H, W, 0);
  ob.addColorStop(0, 'rgba(120, 20, 35, 0.22)');
  ob.addColorStop(0.55, 'rgba(40, 8, 14, 0.1)');
  ob.addColorStop(1, 'rgba(20, 6, 10, 0.28)');
  ctx.fillStyle = ob;
  ctx.fillRect(0, 0, W, H);

  const pad = 18;
  const outerR = 22;
  rr(ctx, pad, pad, W - pad * 2, H - pad * 2, outerR);
  ctx.fillStyle = T.shell;
  ctx.fill();
  ctx.strokeStyle = T.outlineWarm;
  ctx.lineWidth = 1.5;
  ctx.stroke();

  const innerPad = 14;
  const x0 = pad + innerPad;
  const y0 = pad + innerPad;
  const innerW = W - pad * 2 - innerPad * 2;
  const innerH = H - pad * 2 - innerPad * 2;

  const colAvatar = 128;
  const gap = 14;
  const mainX = x0 + colAvatar + gap;
  const mainW = innerW - colAvatar - gap;

  glassPanel(ctx, x0, y0, colAvatar, innerH, 16);

  const avatar = await loadSafe(avatarUrl);
  const avR = 40;
  const avCx = x0 + colAvatar / 2;
  const avCy = y0 + 72;
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
  ctx.font = '600 11px "Segoe UI", Arial';
  ctx.fillStyle = T.label;
  ctx.fillText('INDEX', avCx, avCy + avR + 14);

  const sbW = colAvatar - 20;
  const sbX = x0 + 10;
  const sbY = y0 + innerH - 48;
  drawXpBar(ctx, sbX, sbY, sbW, 8, pct / 100);
  ctx.font = '500 10px "Segoe UI", Arial';
  ctx.fillStyle = 'rgba(255, 250, 245, 0.88)';
  ctx.fillText(`${pct} % catalogue`, avCx, sbY + 20);
  ctx.textAlign = 'left';

  ctx.textBaseline = 'alphabetic';
  ctx.font = '700 13px "Segoe UI", Arial';
  ctx.fillStyle = T.label;
  ctx.fillText('CATALOGUE REBORN', mainX, y0 + 22);

  ctx.font = '700 32px "Segoe UI", Arial';
  ctx.fillStyle = T.text;
  ctx.fillText(truncateText(ctx, String(displayName || 'Joueur'), mainW - 200), mainX, y0 + 54);

  ctx.font = '600 36px "Segoe UI", Arial';
  ctx.fillStyle = T.accent;
  ctx.textAlign = 'right';
  ctx.fillText(`${pct} %`, mainX + mainW, y0 + 56);
  ctx.textAlign = 'left';

  const barY = y0 + 68;
  const barW = mainW;
  drawXpBar(ctx, mainX, barY, barW, 12, pct / 100);
  ctx.font = '600 13px "Segoe UI", Arial';
  ctx.fillStyle = T.sub;
  ctx.fillText(`Progression ${pct} / 100`, mainX, barY + 28);

  const gridTop = y0 + 116;
  const cellGap = 10;
  const cellW = (mainW - cellGap) / 2;
  const cellH = 46;
  let idx = 0;
  for (const s of steps) {
    const col = idx % 2;
    const row = Math.floor(idx / 2);
    const cx = mainX + col * (cellW + cellGap);
    const cy = gridTop + row * (cellH + cellGap);
    const done = claimedSet.has(s.pct);
    const reached = pct >= s.pct;

    statPanel(ctx, cx, cy, cellW, cellH, 10);
    if (done) {
      ctx.save();
      rr(ctx, cx, cy, cellW, cellH, 10);
      ctx.clip();
      const gl = ctx.createLinearGradient(cx, cy, cx + cellW, cy);
      gl.addColorStop(0, 'rgba(34, 197, 94, 0.12)');
      gl.addColorStop(1, 'rgba(34, 197, 94, 0.02)');
      ctx.fillStyle = gl;
      ctx.fillRect(cx, cy, cellW, cellH);
      ctx.restore();
      ctx.strokeStyle = 'rgba(74, 222, 128, 0.45)';
      ctx.lineWidth = 1.5;
      rr(ctx, cx, cy, cellW, cellH, 10);
      ctx.stroke();
    } else if (reached) {
      ctx.strokeStyle = 'rgba(251, 191, 36, 0.4)';
      ctx.lineWidth = 1.5;
      rr(ctx, cx, cy, cellW, cellH, 10);
      ctx.stroke();
    }

    ctx.font = '600 14px "Segoe UI", Arial';
    ctx.fillStyle = done ? '#86efac' : reached ? T.accent : T.sub;
    ctx.fillText(done ? 'OK' : reached ? '!' : '·', cx + 12, cy + 30);

    ctx.font = '700 14px "Segoe UI", Arial';
    ctx.fillStyle = T.text;
    ctx.fillText(`${s.pct} %`, cx + 38, cy + 30);

    ctx.font = '600 13px "Segoe UI", Arial';
    ctx.fillStyle = T.label;
    ctx.fillText(`+${s.stars.toLocaleString('fr-FR')} ★`, cx + 92, cy + 30);

    const chests = (s.chests || [])
      .map((c) => `${c.qty > 1 ? `${c.qty}× ` : ''}${c.id.replace(/_/g, ' ')}`)
      .join(', ');
    let extra = chests;
    if (s.roleNote) extra = extra ? `${extra} · rôle` : 'rôle';
    if (extra) {
      ctx.font = '500 11px Consolas, monospace';
      ctx.fillStyle = 'rgba(255, 214, 180, 0.85)';
      ctx.fillText(truncateText(ctx, extra, cellW - 200), cx + 200, cy + 30);
    }
    idx += 1;
  }

  const bonusTop = gridTop + 5 * (cellH + cellGap) + 8;
  statPanel(ctx, mainX, bonusTop, mainW, 120, 12);
  ctx.font = '700 14px "Segoe UI", Arial';
  ctx.fillStyle = T.label;
  ctx.fillText('BONUS INDEX ACTIFS', mainX + 14, bonusTop + 26);

  const activeBonuses = INDEX_BONUSES.filter((b) => pct >= b.pct);
  let ly = bonusTop + 44;
  ctx.font = '600 12px "Segoe UI", Arial';
  if (!activeBonuses.length) {
    ctx.fillStyle = T.sub;
    ctx.fillText('Aucun — atteins 10 % pour +1 % XP', mainX + 14, ly);
  } else {
    const maxL = 6;
    const shown = activeBonuses.slice(0, maxL);
    for (const b of shown) {
      ctx.fillStyle = T.text;
      ctx.fillText(`${b.pct} %`, mainX + 14, ly);
      ctx.fillStyle = T.sub;
      ctx.fillText(`→  ${b.label}`, mainX + 52, ly);
      ly += 18;
    }
    if (activeBonuses.length > maxL) {
      ctx.fillStyle = T.sub;
      ctx.fillText(`+ ${activeBonuses.length - maxL} autres paliers cumulés`, mainX + 14, ly);
    }
  }

  const hintY = bonusTop + 125;
  glassPanel(ctx, mainX, hintY, mainW, 52, 12);
  ctx.font = '600 13px "Segoe UI", Arial';
  ctx.fillStyle = T.text;
  ctx.fillText(milestoneHint(pct, steps, claimedSet), mainX + 14, hintY + 22);
  ctx.font = '500 11px "Segoe UI", Arial';
  ctx.fillStyle = T.sub;
  ctx.fillText('/itemindex matrice · Index × Ranked × Guilde', mainX + 14, hintY + 40);

  ctx.textAlign = 'center';
  ctx.font = '500 10px "Segoe UI", Arial';
  ctx.fillStyle = 'rgba(255,245,240,0.45)';
  ctx.fillText('OK = réclamé  ·  ! = atteignable  ·  · = verrouillé', W / 2, H - pad - 10);
  ctx.fillText('Par Koyorin et Roxxor', W / 2, H - pad - 26);

  return canvas.toBuffer('image/png');
}

module.exports = { renderIndexCard };
