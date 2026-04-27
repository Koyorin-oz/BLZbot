/**
 * Mise en page alignée sur `modération/src/utils/canvas-staff-v2.js` (profil-staff v2),
 * adaptée au passeport REBORN (sécu, tests, candidature, warns).
 */
const { createCanvas, loadImage, registerFont } = require('canvas');
const fs = require('node:fs');
const path = require('node:path');

const W = 1024;
const H = 468;

const THEME = {
  overlay: 'rgba(0,0,0,0.40)',
  shell: 'rgba(0,0,0,0.44)',
  panel: 'rgba(0,0,0,0.56)',
  header: 'rgba(0,0,0,0.52)',
  text: '#ffffff',
  sub: '#b8c5d3',
  accent: '#e8b83a',
  roleLavender: '#a5b4fc',
  warn: '#ef4444',
  ok: '#22c55e',
  outline: 'rgba(255,255,255,0.38)',
};

const CREDIT = 'Passeport REBORN · layout profil-staff';

try {
  const inter = path.join(__dirname, '..', 'assets');
  if (fs.existsSync(path.join(inter, 'Inter-Bold.ttf'))) {
    registerFont(path.join(inter, 'Inter-Bold.ttf'), { family: 'InterBold' });
  }
  if (fs.existsSync(path.join(inter, 'Inter-Regular.ttf'))) {
    registerFont(path.join(inter, 'Inter-Regular.ttf'), { family: 'Inter' });
  }
} catch {
  /* ignore */
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

function truncateText(ctx, text, maxWidth) {
  let t = String(text ?? '');
  let width = ctx.measureText(t).width;
  if (width <= maxWidth) return t;
  const ellipsis = '...';
  const ew = ctx.measureText(ellipsis).width;
  while (width > maxWidth - ew && t.length > 0) {
    t = t.substring(0, t.length - 1);
    width = ctx.measureText(t).width;
  }
  return t + ellipsis;
}

async function loadCardBackground() {
  const modP = path.join(__dirname, '..', '..', 'modération', 'src', 'assets', 'profile.png');
  if (fs.existsSync(modP)) {
    try {
      return await loadImage(fs.readFileSync(modP));
    } catch {
      /* fall through */
    }
  }
  const blz = path.join(__dirname, '..', 'assets', 'blz_bg.png');
  if (fs.existsSync(blz)) {
    try {
      return await loadImage(fs.readFileSync(blz));
    } catch {
      return null;
    }
  }
  return null;
}

async function loadAvatarUrl(url) {
  if (!url) return null;
  try {
    return await loadImage(url);
  } catch {
    return null;
  }
}

/**
 * @param {object} data
 * @param {import('discord.js').GuildMember | null} data.member
 * @param {string} [data.displayName]
 * @param {number | string} data.secuPoints
 * @param {number | string} data.modScore
 * @param {string} data.candidature
 * @param {{ degree: number, modId: string, reason?: string }[]} [data.warns]
 */
async function renderPassportCardStaffStyle(data) {
  const bg = await loadCardBackground();
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  if (bg) {
    ctx.drawImage(bg, 0, 0, W, H);
  } else {
    ctx.fillStyle = '#1a2528';
    ctx.fillRect(0, 0, W, H);
  }
  ctx.fillStyle = THEME.overlay;
  ctx.fillRect(0, 0, W, H);

  const pad = 12;
  const outerR = 16;
  const cardW = W - pad * 2;
  const cardH = H - pad * 2;
  rr(ctx, pad, pad, cardW, cardH, outerR);
  ctx.fillStyle = THEME.shell;
  ctx.fill();
  ctx.strokeStyle = THEME.outline;
  ctx.lineWidth = 2;
  ctx.stroke();

  const innerPad = 10;
  const x0 = pad + innerPad;
  const y0 = pad + innerPad;
  const innerW = W - pad * 2 - innerPad * 2;
  const innerH = H - pad * 2 - innerPad * 2;

  const leftW = Math.round(innerW * 0.26);
  const gap = 11;
  const mainX = x0 + leftW + gap;
  const mainW = innerW - leftW - gap;

  rr(ctx, x0, y0, leftW, innerH, 14);
  ctx.fillStyle = THEME.header;
  ctx.fill();
  ctx.strokeStyle = THEME.outline;
  ctx.lineWidth = 2;
  ctx.stroke();

  const avUrl = data.member?.displayAvatarURL?.({ extension: 'png', size: 256 });
  const avImg = await loadAvatarUrl(avUrl);
  const avR = Math.min(leftW * 0.34, innerH * 0.28);
  const avCx = x0 + leftW / 2;
  const avCy = y0 + innerH * 0.42;
  ctx.save();
  ctx.beginPath();
  ctx.arc(avCx, avCy, avR, 0, Math.PI * 2);
  ctx.clip();
  if (avImg) ctx.drawImage(avImg, avCx - avR, avCy - avR, avR * 2, avR * 2);
  else {
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.fillRect(avCx - avR, avCy - avR, avR * 2, avR * 2);
  }
  ctx.restore();
  ctx.beginPath();
  ctx.arc(avCx, avCy, avR + 2, 0, Math.PI * 2);
  ctx.strokeStyle = THEME.outline;
  ctx.lineWidth = 2;
  ctx.stroke();

  const headH = 88;
  rr(ctx, mainX, y0, mainW, headH, 12);
  ctx.fillStyle = THEME.header;
  ctx.fill();
  ctx.strokeStyle = THEME.outline;
  ctx.lineWidth = 2;
  ctx.stroke();

  const displayName = data.displayName || data.member?.displayName || 'Membre';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.font = '700 34px InterBold, Arial';
  ctx.fillStyle = THEME.text;
  const nameMax = mainW - 220;
  ctx.fillText(truncateText(ctx, displayName, nameMax), mainX + 12, y0 + 38);

  ctx.font = '600 20px Inter, Arial';
  ctx.fillStyle = THEME.roleLavender;
  ctx.fillText('Passeport REBORN · staff & sécu', mainX + 12, y0 + 68);

  const warnsCount = (data.warns || []).length;
  ctx.textAlign = 'right';
  ctx.font = '600 17px InterBold, Inter, Arial';
  ctx.fillStyle = warnsCount > 0 ? THEME.warn : THEME.sub;
  ctx.fillText(`Warns (serveur) : ${warnsCount}`, mainX + mainW - 12, y0 + 36);
  ctx.fillStyle = THEME.sub;
  ctx.font = '500 16px Inter, Arial';
  ctx.fillText('Candidature & tests', mainX + mainW - 12, y0 + 62);
  ctx.textAlign = 'left';

  const statsY = y0 + headH + 10;
  const statsH = 158;
  rr(ctx, mainX, statsY, mainW, statsH, 12);
  ctx.fillStyle = THEME.panel;
  ctx.fill();
  ctx.strokeStyle = THEME.outline;
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.font = '700 22px InterBold, Arial';
  ctx.fillStyle = THEME.accent;
  ctx.fillText('Synthèse', mainX + 12, statsY + 28);

  const col1 = mainX + 12;
  const col2 = mainX + mainW / 2 + 4;
  const l1 = statsY + 54;
  const l2 = statsY + 82;
  const l3 = statsY + 110;
  const l4 = statsY + 138;
  ctx.font = '600 16px Inter, Arial';
  ctx.fillStyle = THEME.text;
  ctx.fillText(`Points de sécurité : ${data.secuPoints ?? '—'}`, col1, l1);
  ctx.fillText(`Score tests mod : ${data.modScore ?? 0} / 100`, col1, l2);
  const cand = String(data.candidature || 'aucune');
  ctx.fillText(`Candidature : ${truncateText(ctx, cand, 240)}`, col1, l3);
  ctx.fillStyle = THEME.sub;
  ctx.font = '500 15px Inter, Arial';
  ctx.fillText('+2 pts / 30 j si baisse (rappel)', col2, l1);
  ctx.fillText('Cible : futurs modérateurs & suivi', col2, l2);
  ctx.fillText('REBORN MAJ (sandbox)', col2, l3);

  const bottomY = statsY + statsH + 8;
  const bottomH = innerH - (bottomY - y0) - 4;
  const halfW = (mainW - 10) / 2;

  function drawPanel(px, title) {
    rr(ctx, px, bottomY, halfW, bottomH, 12);
    ctx.fillStyle = THEME.panel;
    ctx.fill();
    ctx.strokeStyle = THEME.outline;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.font = '700 20px InterBold, Arial';
    ctx.fillStyle = THEME.accent;
    ctx.fillText(title, px + 10, bottomY + 28);
  }

  drawPanel(mainX, 'Derniers warns');
  const warns = (data.warns || []).slice(0, 4);
  let wy = bottomY + 50;
  ctx.font = '500 15px Inter, Arial';
  if (!warns.length) {
    ctx.fillStyle = THEME.sub;
    ctx.fillText('Aucun sur ce serveur.', mainX + 10, wy);
  } else {
    for (const wv of warns) {
      const line = `−${wv.degree} <@${wv.modId}>${wv.reason ? ` — ${String(wv.reason).slice(0, 24)}` : ''}`;
      ctx.fillStyle = THEME.text;
      ctx.font = '600 14px Inter, Arial';
      ctx.fillText(truncateText(ctx, line, halfW - 20), mainX + 10, wy);
      wy += 22;
      if (wy > bottomY + bottomH - 12) break;
    }
  }

  const px2 = mainX + halfW + 10;
  drawPanel(px2, 'Rôle (rappel)');
  ctx.textAlign = 'left';
  ctx.fillStyle = THEME.sub;
  ctx.font = '500 15px Inter, Arial';
  const help = [
    'Cette fiche sert surtout au recrutement :',
    'candidature, tests, warns & sécu.',
  ];
  let hy = bottomY + 50;
  for (const h of help) {
    ctx.fillText(truncateText(ctx, h, halfW - 20), px2 + 10, hy);
    hy += 20;
  }

  ctx.textAlign = 'right';
  ctx.fillStyle = 'rgba(200, 215, 230, 0.5)';
  ctx.font = 'italic 9px Inter, Arial';
  ctx.fillText(CREDIT, W - pad - 6, H - pad - 4);
  ctx.textAlign = 'left';

  return canvas.toBuffer('image/png');
}

module.exports = { renderPassportCardStaffStyle, W, H };
