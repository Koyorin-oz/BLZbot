const { createCanvas, loadImage } = require('canvas');
const path = require('node:path');
const fs = require('node:fs');

const W = 1400;
const H = 820;
const ASSETS = path.join(__dirname, '..', 'assets');

const BRANCH = {
  quest: { label: 'Quête', color: '#2ecc71' },
  guild: { label: 'Guilde', color: '#9b59b6' },
  shop: { label: 'Boutique', color: '#e67e22' },
  ranked: { label: 'Ranked', color: '#3498db' },
  event: { label: 'Événement', color: '#e74c3c' },
};
const ORDER = ['quest', 'guild', 'shop', 'ranked', 'event'];

/**
 * Flou : downscale + upscale (compatible sans `ctx.filter` Cairo).
 * @param {import('canvas').CanvasRenderingContext2D} ctx
 * @param {import('canvas').Image} img
 */
function drawBlurredBg(ctx, w, h, img) {
  const div = 10;
  const sw = Math.max(2, Math.floor(w / div));
  const sh = Math.max(2, Math.floor(h / div));
  const { createCanvas: CC } = require('canvas');
  const tmp = CC(sw, sh);
  const t = tmp.getContext('2d');
  t.imageSmoothingEnabled = true;
  t.imageSmoothingQuality = 'high';
  t.drawImage(img, 0, 0, sw, sh);
  const ctx2 = ctx;
  ctx2.imageSmoothingEnabled = true;
  ctx2.imageSmoothingQuality = 'high';
  ctx2.drawImage(tmp, 0, 0, w, h);
  ctx2.fillStyle = 'rgba(6, 8, 18, 0.5)';
  ctx2.fillRect(0, 0, w, h);
}

/**
 * Courbe type « Dying Light » (pas de droites) — quadratique avec saillie.
 */
function strokeCurve(ctx, x0, y0, x1, y1, color, lineW, isLit) {
  const mx = (x0 + x1) / 2;
  const my = (y0 + y1) / 2;
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len = Math.hypot(dx, dy) || 1;
  const bulge = Math.min(56, 12 + len * 0.22);
  const cpx = mx - (dy / len) * bulge;
  const cpy = my + (dx / len) * bulge;
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.quadraticCurveTo(cpx, cpy, x1, y1);
  ctx.strokeStyle = isLit ? color : '#2a2a32';
  ctx.lineWidth = isLit ? 5 : 2.2;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.globalAlpha = isLit ? 0.95 : 0.55;
  if (isLit) {
    ctx.shadowColor = color;
    ctx.shadowBlur = 10;
  }
  ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.globalAlpha = 1;
}

function placeNodes(rootX, rootY) {
  const nodes = /** @type {{x:number,y:number,branch:string,k:number}[]} */ [];
  for (let b = 0; b < 5; b++) {
    const spread = 0.78;
    const a = -Math.PI / 2 - spread / 2 + (spread * b) / 4;
    for (let k = 0; k < 5; k++) {
      const d = 88 + k * 80;
      const wob = Math.sin(b * 1.7 + k * 1.1) * 22;
      const perpA = a + Math.PI / 2;
      const x = rootX + d * Math.cos(a) + wob * Math.cos(perpA);
      const y = rootY + d * Math.sin(a) + wob * Math.sin(perpA);
      nodes.push({ x, y, branch: ORDER[b], k });
    }
  }
  return nodes;
}

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
  const bgPath = path.join(ASSETS, 'blz_bg.png');
  if (fs.existsSync(bgPath)) {
    const bg = await loadImage(fs.readFileSync(bgPath));
    drawBlurredBg(ctx, W, H, bg);
  } else {
    ctx.fillStyle = '#0a0a0c';
    ctx.fillRect(0, 0, W, H);
  }

  const rootX = W / 2;
  const rootY = H - 52;
  const allNodes = placeNodes(rootX, rootY);
  const byBranch = new Map(ORDER.map((b) => [b, allNodes.filter((n) => n.branch === b)]));
  const sOf = (br) => Math.min(5, Math.max(0, Math.floor(steps[br] || 0)));

  ctx.textAlign = 'left';
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.fillRect(0, 0, W, 92);
  ctx.fillStyle = '#e8f0ff';
  ctx.font = 'bold 30px "Segoe UI", sans-serif';
  ctx.fillText('Arbre de compétences REBORN', 36, 44);
  ctx.font = '20px "Segoe UI", sans-serif';
  ctx.fillStyle = '#94a3b8';
  ctx.fillText(
    `Points : ${points}  ·  Coût palier n = n  ·  Courbes & fond profil (flou)`,
    36,
    76,
  );

  for (const br of ORDER) {
    const list = byBranch.get(br) || [];
    const s = sOf(br);
    const { color, label } = BRANCH[br] || { color: '#888', label: br };
    for (let k = 0; k < 5; k++) {
      const p = list[k];
      if (!p) continue;
      const from = k === 0 ? { x: rootX, y: rootY } : list[k - 1];
      const to = p;
      const segmentLit = s > k;
      strokeCurve(ctx, from.x, from.y, to.x, to.y, color, 4, segmentLit);
    }
    if (list[0]) {
      const top = list.reduce((a, p) => (p.y < a.y ? p : a), list[0]);
      const ly = Math.max(100, top.y - 32);
      ctx.textAlign = 'center';
      ctx.fillStyle = color;
      ctx.font = 'bold 20px "Segoe UI", sans-serif';
      ctx.fillText(label, top.x, ly);
      ctx.fillStyle = '#7f8c8d';
      ctx.font = '16px "Segoe UI", sans-serif';
      ctx.fillText(`${s} / 5`, top.x, ly + 20);
    }
  }

  ctx.beginPath();
  ctx.arc(rootX, rootY, 10, 0, Math.PI * 2);
  ctx.fillStyle = '#f8fafc';
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.lineWidth = 2;
  ctx.stroke();

  for (const br of ORDER) {
    const list = byBranch.get(br) || [];
    const s = sOf(br);
    const { color } = BRANCH[br] || { color: '#888' };
    for (const p of list) {
      const unlocked = s > p.k;
      const { x, y } = p;
      ctx.beginPath();
      ctx.arc(x, y, 20, 0, Math.PI * 2);
      ctx.fillStyle = unlocked ? color : '#15151c';
      ctx.fill();
      ctx.strokeStyle = unlocked ? 'rgba(255,255,255,0.85)' : '#3d3d48';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.fillStyle = unlocked ? 'rgba(6,6,8,0.9)' : '#4a4a5c';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = 'bold 14px "Segoe UI", sans-serif';
      if (unlocked) {
        ctx.fillText(String(p.k + 1), x, y + 1);
      } else {
        ctx.font = '14px "Segoe UI", sans-serif';
        ctx.fillText('🔒', x, y + 1);
      }
    }
  }

  ctx.textAlign = 'right';
  ctx.textBaseline = 'top';
  ctx.fillStyle = '#94a3b8';
  ctx.font = '18px "Segoe UI", sans-serif';
  ctx.fillText(displayName, W - 32, 28);
  return canvas.toBuffer('image/png');
}

/**
 * Carte visuelle du temple (même ressource que le profil, flouté).
 * @param {object} p
 * @param {number} p.points
 * @param {string[]} p.keys
 * @param {boolean} p.templeUnlocked
 */
async function renderTemplePng(p) {
  const width = 1100;
  const height = 640;
  const c = createCanvas(width, height);
  const ctx = c.getContext('2d');
  const bgPath = path.join(ASSETS, 'blz_bg.png');
  if (fs.existsSync(bgPath)) {
    const bg = await loadImage(fs.readFileSync(bgPath));
    const div = 10;
    const sw = Math.max(2, Math.floor(width / div));
    const sh = Math.max(2, Math.floor(height / div));
    const { createCanvas: CC } = require('canvas');
    const t = CC(sw, sh);
    t.getContext('2d').drawImage(bg, 0, 0, sw, sh);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(t, 0, 0, width, height);
  } else {
    const g = ctx.createLinearGradient(0, 0, width, height);
    g.addColorStop(0, '#1a1035');
    g.addColorStop(1, '#312e81');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, width, height);
  }
  ctx.fillStyle = 'rgba(4, 6, 20, 0.58)';
  ctx.fillRect(0, 0, width, height);

  const pad = 44;
  ctx.textAlign = 'left';
  ctx.fillStyle = '#e9d5ff';
  ctx.font = 'bold 38px "Segoe UI", sans-serif';
  ctx.fillText('Temple — points de réussite', pad, pad + 6);
  ctx.fillStyle = '#a78bfa';
  ctx.font = '24px "Segoe UI", sans-serif';
  const sub =
    p.templeUnlocked
      ? 'Statut : débloqué (5×5 arbre) — bravo.'
      : 'Statut : verrouillé — finis toutes les branches 5/5 pour le prestige.';
  ctx.fillText(sub, pad, pad + 52);
  ctx.fillStyle = '#cbd5e1';
  ctx.font = '22px "Segoe UI", sans-serif';
  ctx.fillText(`Points comptés :  ${p.points}`, pad, pad + 100);
  ctx.fillStyle = '#94a3b8';
  ctx.font = '18px "Segoe UI", sans-serif';
  const ktxt = p.keys && p.keys.length ? p.keys.join(' · ') : '— (aucune clé sur ce sync)';
  const lines = [
    'Système de gros objectifs, hors monnaie quotidienne. Les « clés » listent ce qui a été coché ici (sandbox).',
    `Détail : ${ktxt}`.slice(0, 900),
  ];
  let y = pad + 150;
  for (const line of lines) {
    for (let i = 0; i < line.length; i += 80) {
      ctx.fillText(line.slice(i, i + 80), pad, y);
      y += 28;
    }
  }
  ctx.textAlign = 'right';
  ctx.fillStyle = '#6b7280';
  ctx.font = '15px "Segoe UI", sans-serif';
  ctx.fillText('REBORN sandbox', width - pad, height - 28);
  return c.toBuffer('image/png');
}

module.exports = { renderSkillTreePng, renderTemplePng, W, H };
