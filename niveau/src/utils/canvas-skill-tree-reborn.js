const { createCanvas, loadImage } = require('canvas');
const path = require('node:path');
const fs = require('node:fs');

const W = 1400;
const H = 800;

const BRANCH = /** @type {const} */ ({
  quest: { label: 'Quête', color: '#2ecc71' },
  guild: { label: 'Guilde', color: '#9b59b6' },
  shop: { label: 'Boutique', color: '#e67e22' },
  ranked: { label: 'Ranked', color: '#3498db' },
  event: { label: 'Événement', color: '#e74c3c' },
});
const ORDER = ['quest', 'guild', 'shop', 'ranked', 'event'];

/**
 * @param {object} opts
 * @param {string} [opts.displayName]
 * @param {number} [opts.points]
 * @param {Record<string, number>} [opts.steps] branch -> 0-5
 */
async function renderSkillTreePng(opts) {
  const { displayName = 'Joueur', points = 0, steps = {} } = opts;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#0a0a0c';
  ctx.fillRect(0, 0, W, H);

  ctx.fillStyle = 'rgba(30, 30, 36, 0.95)';
  ctx.fillRect(0, 0, W, 100);
  ctx.fillStyle = '#ecf0f1';
  ctx.font = 'bold 32px "Segoe UI", sans-serif';
  ctx.fillText('Arbre de compétences REBORN', 40, 50);
  ctx.font = '22px "Segoe UI", sans-serif';
  ctx.fillStyle = '#bdc3c7';
  ctx.fillText(`Points disponibles : ${points} — coût palier n = n points · 5 paliers / branche`, 40, 86);

  const nBranch = ORDER.length;
  const marginX = 100;
  const colW = (W - 2 * marginX) / nBranch;
  const y0 = 200;
  const ySpan = 95;

  for (let c = 0; c < nBranch; c++) {
    const key = ORDER[c];
    const { label, color } = BRANCH[key] || { label: key, color: '#7f8c8d' };
    const s = Math.min(5, Math.max(0, Math.floor(steps[key] || 0)));
    const colCenter = marginX + c * colW + colW / 2;

    ctx.textAlign = 'center';
    ctx.fillStyle = color;
    ctx.font = 'bold 20px "Segoe UI", sans-serif';
    ctx.fillText(label, colCenter, 150);
    ctx.fillStyle = '#7f8c8d';
    ctx.font = '16px "Segoe UI", sans-serif';
    ctx.fillText(`${s} / 5`, colCenter, 176);

    for (let k = 0; k < 5; k++) {
      const unlocked = s > k;
      const cx = colCenter;
      const cy = y0 + k * ySpan;
      if (k > 0) {
        ctx.beginPath();
        ctx.strokeStyle = s >= k ? color : '#333';
        ctx.lineWidth = unlocked ? 4 : 2;
        ctx.moveTo(cx, cy - ySpan + 20);
        ctx.lineTo(cx, cy - 18);
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.arc(cx, cy, 22, 0, Math.PI * 2);
      ctx.fillStyle = unlocked ? color : '#1e1e24';
      ctx.fill();
      ctx.strokeStyle = unlocked ? '#fff' : '#444';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.fillStyle = unlocked ? '#0a0a0c' : '#555';
      ctx.font = 'bold 16px "Segoe UI", sans-serif';
      ctx.fillText(String(k + 1), cx, cy + 6);
    }
  }

  ctx.textAlign = 'right';
  ctx.fillStyle = '#5d6d7e';
  ctx.font = '18px "Segoe UI", sans-serif';
  ctx.fillText(displayName, W - 32, 52);

  return canvas.toBuffer('image/png');
}

/**
 * Même arrière-plan que le profil BLZ (blz_bg) pour une carte type « passeport staff ».
 * @param {object} p
 * @param {import('canvas').Image | null} [p.bgImage] — si déjà loadée
 * @param {string} p.displayName
 * @param {string} p.secu
 * @param {string} p.modScore
 * @param {string} p.candidature
 * @param {string} p.warnsBlock
 */
async function renderPassportCardPng(p) {
  const width = 1200;
  const height = 700;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  const assets = path.join(__dirname, '..', 'assets');
  const bgPath = path.join(assets, 'blz_bg.png');
  let bg;
  if (p.bgImage) {
    bg = p.bgImage;
  } else if (fs.existsSync(bgPath)) {
    bg = await loadImage(fs.readFileSync(bgPath));
  } else {
    const g = ctx.createLinearGradient(0, 0, width, height);
    g.addColorStop(0, '#0f172a');
    g.addColorStop(1, '#1e1b4b');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, width, height);
  }
  if (bg) ctx.drawImage(bg, 0, 0, width, height);

  ctx.fillStyle = 'rgba(5, 8, 20, 0.82)';
  ctx.fillRect(0, 0, width, height);

  const pad = 48;
  ctx.textAlign = 'left';
  ctx.fillStyle = '#e8f4ff';
  ctx.font = 'bold 40px "Segoe UI", sans-serif';
  ctx.fillText('Passeport staff & sécurité', pad, pad + 20);

  ctx.fillStyle = '#7dd3fc';
  ctx.font = '28px "Segoe UI", sans-serif';
  ctx.fillText(p.displayName, pad, pad + 64);

  ctx.fillStyle = '#94a3b8';
  ctx.font = '22px "Segoe UI", sans-serif';
  const body = [
    `Points de sécurité     ${p.secu}   (défaut 10, −warns)`,
    `Tests mod (score)      ${p.modScore} / 100`,
    `Candidature            ${p.candidature}`,
    ``,
    `Derniers warns (aperçu)`,
  ].join('\n');
  const lines = body.split('\n');
  let y = pad + 120;
  for (const line of lines) {
    ctx.fillText(line, pad, y);
    y += 32;
  }
  ctx.fillStyle = '#cbd5e1';
  const warnLines = (p.warnsBlock || 'Aucun.').split('\n').slice(0, 12);
  y += 6;
  for (const w of warnLines) {
    ctx.fillText(w.slice(0, 100), pad + 12, y);
    y += 28;
  }
  y += 16;
  ctx.fillStyle = '#64748b';
  ctx.font = '18px "Segoe UI", sans-serif';
  ctx.fillText('Régén. +2 pts / 30 j (affichage) · Données sandbox REBORN', pad, height - 36);

  return canvas.toBuffer('image/png');
}

module.exports = { renderSkillTreePng, renderPassportCardPng, W, H };
