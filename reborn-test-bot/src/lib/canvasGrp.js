const { createCanvas, loadImage } = require('canvas');
const path = require('node:path');
const fs = require('node:fs');

const ASSETS = path.join(__dirname, '..', '..', '..', 'niveau', 'src', 'assets');
const BLZ_BG = path.join(ASSETS, 'blz_bg.png');

const GOLD = '#e8c547';
const GOLD_RGB = [232, 197, 71];
const MUTED = '#9aa4b2';
const TEXT = '#eef2f7';

const RANK_ACCENT = {
  '': '#5c6574',
  bronze: '#b87333',
  argent: '#9ea7b3',
  or: '#d4af37',
  platine: '#6fd3c5',
  diamant: '#7eb8ff',
  goat: '#c792ea',
  star: '#ffd54f',
};

function rgba([r, g, b], a) {
  return `rgba(${r},${g},${b},${a})`;
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

async function loadSafe(urlOrPath) {
  if (!urlOrPath) return null;
  try {
    if (/^https?:\/\//.test(urlOrPath)) return await loadImage(urlOrPath);
    if (fs.existsSync(urlOrPath)) return await loadImage(fs.readFileSync(urlOrPath));
    return null;
  } catch {
    return null;
  }
}

async function drawBackground(ctx, W, H) {
  const bg = await loadSafe(BLZ_BG);
  if (bg) drawImageCover(ctx, bg, 0, 0, W, H);
  else {
    const g = ctx.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, '#141a28');
    g.addColorStop(1, '#0a0d14');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }
  ctx.fillStyle = 'rgba(8, 10, 18, 0.72)';
  ctx.fillRect(0, 0, W, H);
  const vg = ctx.createRadialGradient(W * 0.5, H * 0.35, 40, W * 0.5, H * 0.5, W * 0.9);
  vg.addColorStop(0, rgba(GOLD_RGB, 0.07));
  vg.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, W, H);
}

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

function drawAvatar(ctx, img, cx, cy, r) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.closePath();
  ctx.clip();
  if (img) ctx.drawImage(img, cx - r, cy - r, r * 2, r * 2);
  else {
    ctx.fillStyle = '#1e2433';
    ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
  }
  ctx.restore();
  ctx.lineWidth = 3;
  ctx.strokeStyle = GOLD;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();
}

/** Fraction [0,1] vers le prochain palier GRP (0 = aucun palier atteint). */
function progressToNext(grp, GRP_RANK_KEYS, GRP_THRESHOLDS) {
  const g = typeof grp === 'bigint' ? grp : BigInt(Math.floor(Number(grp)));
  const cur = require('../reborn/grades').grpRankFromTotal(g);
  const idx = cur ? GRP_RANK_KEYS.indexOf(cur) : -1;
  if (idx >= GRP_RANK_KEYS.length - 1) return { frac: 1, low: g, high: g, atMax: true };
  const low = idx < 0 ? 0n : GRP_THRESHOLDS[idx];
  const high = GRP_THRESHOLDS[idx + 1];
  const span = high - low;
  if (span <= 0n) return { frac: 0, low, high, atMax: false };
  const num = Number((g - low) * 10000n / span) / 10000;
  return { frac: Math.max(0, Math.min(1, num)), low, high, atMax: false };
}

/**
 * @param {{ displayName: string, avatarUrl: string | null, guildName: string, season: string, grp: bigint, rankKey: string, rankLabel: string, peaksLine: string, nextLine: string, GRP_RANK_KEYS: string[], GRP_THRESHOLDS: bigint[] }} p
 */
async function renderGrpVoirCard(p) {
  const W = 1120;
  const H = 620;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  await drawBackground(ctx, W, H);

  const accent = RANK_ACCENT[p.rankKey] || RANK_ACCENT[''];
  const avatar = p.avatarUrl ? await loadSafe(p.avatarUrl).catch(() => null) : null;

  rr(ctx, 0, 0, 8, H, 0);
  ctx.fillStyle = accent;
  ctx.fillRect(0, 0, 8, H);

  const pad = 48;
  const avR = 52;
  const avX = pad + avR;
  const avY = pad + avR + 8;
  drawAvatar(ctx, avatar, avX, avY, avR);

  ctx.textAlign = 'left';
  ctx.fillStyle = MUTED;
  ctx.font = '600 14px "Segoe UI", sans-serif';
  ctx.fillText('Guild Ranked Points', pad + avR * 2 + 28, pad + 8);

  ctx.fillStyle = TEXT;
  ctx.font = '700 34px "Segoe UI", sans-serif';
  const title = (p.displayName || 'Joueur').slice(0, 28);
  ctx.fillText(title, pad + avR * 2 + 28, pad + 42);

  ctx.fillStyle = MUTED;
  ctx.font = '500 15px "Segoe UI", sans-serif';
  ctx.fillText(p.guildName.slice(0, 48), pad + avR * 2 + 28, pad + 72);

  const boxY = pad + avR * 2 + 36;
  rr(ctx, pad, boxY, W - pad * 2, 200, 18);
  ctx.fillStyle = 'rgba(20, 26, 40, 0.88)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(232,197,71,0.25)';
  ctx.lineWidth = 1;
  ctx.stroke();

  const grpStr = p.grp.toLocaleString('fr-FR');
  ctx.fillStyle = GOLD;
  ctx.font = '800 56px "Segoe UI", sans-serif';
  ctx.fillText(grpStr, pad + 28, boxY + 78);

  ctx.fillStyle = MUTED;
  ctx.font = '600 16px "Segoe UI", sans-serif';
  ctx.fillText('GRP total', pad + 28, boxY + 118);

  ctx.textAlign = 'right';
  ctx.fillStyle = TEXT;
  ctx.font = '700 22px "Segoe UI", sans-serif';
  ctx.fillText(p.rankLabel, W - pad - 28, boxY + 62);
  ctx.fillStyle = MUTED;
  ctx.font = '600 13px "Segoe UI", sans-serif';
  ctx.fillText('Palier', W - pad - 28, boxY + 88);
  ctx.textAlign = 'left';

  const barY = boxY + 148;
  const barX = pad + 28;
  const barW = W - pad * 2 - 56;
  const barH = 10;
  const { frac, atMax } = progressToNext(p.grp, p.GRP_RANK_KEYS, p.GRP_THRESHOLDS);
  rr(ctx, barX, barY, barW, barH, 5);
  ctx.fillStyle = 'rgba(255,255,255,0.08)';
  ctx.fill();
  const fillW = atMax ? barW : Math.max(4, barW * frac);
  const gBar = ctx.createLinearGradient(barX, 0, barX + barW, 0);
  gBar.addColorStop(0, accent);
  gBar.addColorStop(1, GOLD);
  ctx.fillStyle = gBar;
  rr(ctx, barX, barY, fillW, barH, 5);
  ctx.fill();

  const metaY = boxY + 200;
  ctx.fillStyle = MUTED;
  ctx.font = '500 15px "Segoe UI", sans-serif';
  ctx.fillText(`Saison ${p.season}`, pad + 28, metaY);

  ctx.fillStyle = TEXT;
  ctx.font = '500 15px "Segoe UI", sans-serif';
  const peaks = p.peaksLine.slice(0, 120);
  ctx.fillText(`Pics : ${peaks}`, pad + 28, metaY + 26);

  ctx.fillStyle = MUTED;
  ctx.font = 'italic 14px "Segoe UI", sans-serif';
  const next = p.nextLine.slice(0, 140);
  ctx.fillText(next, pad + 28, metaY + 54);

  return canvas.toBuffer('image/png');
}

/**
 * @param {{ guildName: string, season: string, rows: { rank: number, username: string, grp: bigint, rankLabel: string }[] }} p
 */
async function renderGrpLeaderboardCard(p) {
  const rowH = 36;
  const headerH = 120;
  const H = Math.min(980, headerH + Math.max(1, p.rows.length) * rowH + 80);
  const W = 900;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  await drawBackground(ctx, W, H);

  rr(ctx, 0, 0, 6, H, 0);
  ctx.fillStyle = GOLD;
  ctx.fillRect(0, 0, 6, H);

  ctx.fillStyle = TEXT;
  ctx.font = '700 28px "Segoe UI", sans-serif';
  ctx.fillText('Classement GRP', 40, 52);

  ctx.fillStyle = MUTED;
  ctx.font = '500 15px "Segoe UI", sans-serif';
  ctx.fillText(`${p.guildName} · saison ${p.season}`, 40, 82);

  let y = headerH;
  ctx.font = '600 13px "Segoe UI", sans-serif';
  ctx.fillStyle = MUTED;
  ctx.fillText('#', 44, y);
  ctx.fillText('Joueur', 88, y);
  ctx.textAlign = 'right';
  ctx.fillText('GRP', W - 200, y);
  ctx.fillText('Palier', W - 48, y);
  ctx.textAlign = 'left';
  y += 8;
  ctx.strokeStyle = 'rgba(255,255,255,0.12)';
  ctx.beginPath();
  ctx.moveTo(40, y);
  ctx.lineTo(W - 40, y);
  ctx.stroke();
  y += 22;

  if (!p.rows.length) {
    ctx.fillStyle = MUTED;
    ctx.font = '500 16px "Segoe UI", sans-serif';
    ctx.fillText('Aucune donnée pour cette saison.', 44, y + 24);
    return canvas.toBuffer('image/png');
  }

  for (const r of p.rows) {
    rr(ctx, 36, y - 6, W - 72, rowH - 4, 8);
    ctx.fillStyle = 'rgba(18, 22, 34, 0.55)';
    ctx.fill();

    ctx.fillStyle = GOLD;
    ctx.font = '700 15px "Segoe UI", sans-serif';
    ctx.fillText(String(r.rank), 48, y + 16);

    ctx.fillStyle = TEXT;
    ctx.font = '600 15px "Segoe UI", sans-serif';
    const un = r.username.slice(0, 22);
    ctx.fillText(un, 88, y + 16);

    ctx.textAlign = 'right';
    ctx.fillStyle = TEXT;
    ctx.font = '700 15px "Segoe UI", sans-serif';
    ctx.fillText(r.grp.toLocaleString('fr-FR'), W - 200, y + 16);
    ctx.fillStyle = MUTED;
    ctx.font = '500 14px "Segoe UI", sans-serif';
    ctx.fillText(r.rankLabel, W - 48, y + 16);
    ctx.textAlign = 'left';

    y += rowH;
  }

  ctx.fillStyle = MUTED;
  ctx.font = 'italic 12px "Segoe UI", sans-serif';
  ctx.fillText('Top 15 approximatif sur ce serveur.', 40, H - 36);

  return canvas.toBuffer('image/png');
}

module.exports = { renderGrpVoirCard, renderGrpLeaderboardCard };
