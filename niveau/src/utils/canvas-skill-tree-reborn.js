const { createCanvas, loadImage } = require('canvas');
const path = require('node:path');
const fs = require('node:fs');

const W = 1400;
const H = 820;
const ASSETS = path.join(__dirname, '..', 'assets');

const BRANCH = {
  quest: { label: 'QUÊTE', color: '#7CFF8B', rgb: [124, 255, 139], icon: '⚔' },
  guild: { label: 'GUILDE', color: '#C39BFF', rgb: [195, 155, 255], icon: '⚜' },
  shop: { label: 'BOUTIQUE', color: '#FFB867', rgb: [255, 184, 103], icon: '◈' },
  ranked: { label: 'RANKED', color: '#7DC2FF', rgb: [125, 194, 255], icon: '★' },
  event: { label: 'ÉVÉNEMENT', color: '#FF7B7B', rgb: [255, 123, 123], icon: '✦' },
};
const ORDER = ['quest', 'guild', 'shop', 'ranked', 'event'];

const ROOT = { x: W / 2, y: H - 88 };
const SPREAD_DEG = 78;
const NODE_GAP = 108;
const MAIN_R = 26;
const SIDE_R = 11;

/* ---------- helpers ---------- */

function mulberry32(seed) {
  let a = seed | 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function rgba([r, g, b], a) {
  return `rgba(${r},${g},${b},${a})`;
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

function drawBackground(ctx) {
  // Fond profond : dégradé radial centré bas (focal point sur la racine).
  const g = ctx.createRadialGradient(W / 2, H * 0.92, 30, W / 2, H * 0.92, W);
  g.addColorStop(0, '#1a1322');
  g.addColorStop(0.4, '#0d0a14');
  g.addColorStop(1, '#040308');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  // Vignette pour cadrer le sujet.
  const vg = ctx.createRadialGradient(W / 2, H / 2, H * 0.4, W / 2, H / 2, W * 0.75);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, 'rgba(0,0,0,0.7)');
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, W, H);

  // Pluie d’étoiles fixes (déterministe, discrète).
  const rnd = mulberry32(0xb7e1);
  for (let i = 0; i < 140; i++) {
    const x = rnd() * W;
    const y = rnd() * H;
    const r = 0.3 + rnd() * 1.2;
    const a = 0.05 + rnd() * 0.18;
    ctx.fillStyle = `rgba(230, 220, 255, ${a})`;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
}

async function drawBlurredAtmosphere(ctx) {
  const bgPath = path.join(ASSETS, 'blz_bg.png');
  if (!fs.existsSync(bgPath)) return;
  try {
    const bg = await loadImage(fs.readFileSync(bgPath));
    const div = 24;
    const sw = Math.max(2, Math.floor(W / div));
    const sh = Math.max(2, Math.floor(H / div));
    const tmp = createCanvas(sw, sh);
    const t = tmp.getContext('2d');
    t.imageSmoothingEnabled = true;
    t.imageSmoothingQuality = 'high';
    t.drawImage(bg, 0, 0, sw, sh);
    ctx.save();
    ctx.globalAlpha = 0.18;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(tmp, 0, 0, W, H);
    ctx.restore();
    ctx.fillStyle = 'rgba(8, 6, 14, 0.55)';
    ctx.fillRect(0, 0, W, H);
  } catch {
    /* ignore */
  }
}

/**
 * Courbe de Bézier quadratique avec une saillie perpendiculaire pour un trait organique.
 */
function quadStroke(ctx, x0, y0, x1, y1, bulge) {
  const mx = (x0 + x1) / 2;
  const my = (y0 + y1) / 2;
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len = Math.hypot(dx, dy) || 1;
  const cpx = mx - (dy / len) * bulge;
  const cpy = my + (dx / len) * bulge;
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.quadraticCurveTo(cpx, cpy, x1, y1);
  ctx.stroke();
}

function drawConnection(ctx, a, b, rgb, lit, intensity = 1, bulge = 22) {
  if (lit) {
    // Halo très large
    ctx.strokeStyle = rgba(rgb, 0.18 * intensity);
    ctx.lineWidth = 22;
    ctx.lineCap = 'round';
    quadStroke(ctx, a.x, a.y, b.x, b.y, bulge);
    // Halo moyen
    ctx.strokeStyle = rgba(rgb, 0.35 * intensity);
    ctx.lineWidth = 12;
    quadStroke(ctx, a.x, a.y, b.x, b.y, bulge);
    // Trait coloré
    ctx.strokeStyle = rgba(rgb, 0.95);
    ctx.lineWidth = 5;
    quadStroke(ctx, a.x, a.y, b.x, b.y, bulge);
    // Liseré clair
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.lineWidth = 1.4;
    quadStroke(ctx, a.x, a.y, b.x, b.y, bulge);
  } else {
    ctx.strokeStyle = 'rgba(180, 180, 200, 0.18)';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    quadStroke(ctx, a.x, a.y, b.x, b.y, bulge);
  }
}

function drawLockGlyph(ctx, cx, cy, size, color) {
  const w = size * 0.7;
  const h = size * 0.5;
  const bx = cx - w / 2;
  const by = cy - h * 0.05;
  // anse
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(1.5, size * 0.13);
  ctx.beginPath();
  ctx.arc(cx, by, w * 0.3, Math.PI, 0);
  ctx.stroke();
  // corps
  rr(ctx, bx, by, w, h, 2);
  ctx.fillStyle = color;
  ctx.fill();
  // trou de serrure (point clair)
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.beginPath();
  ctx.arc(cx, by + h * 0.55, Math.max(1, size * 0.06), 0, Math.PI * 2);
  ctx.fill();
}

function drawMainNode(ctx, n, rgb, color, lit, isCurrent) {
  const { x, y } = n;
  const r = MAIN_R;

  // Halo externe pour nœud allumé
  if (lit) {
    const halo = ctx.createRadialGradient(x, y, r * 0.6, x, y, r * 2.6);
    halo.addColorStop(0, rgba(rgb, 0.55));
    halo.addColorStop(1, rgba(rgb, 0));
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(x, y, r * 2.6, 0, Math.PI * 2);
    ctx.fill();
  }

  // Corps
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  if (lit) {
    const g = ctx.createRadialGradient(x - r * 0.3, y - r * 0.4, r * 0.2, x, y, r);
    g.addColorStop(0, rgba(rgb.map((c) => Math.min(255, c + 50)), 1));
    g.addColorStop(1, color);
    ctx.fillStyle = g;
  } else {
    const g = ctx.createRadialGradient(x - r * 0.3, y - r * 0.4, r * 0.2, x, y, r);
    g.addColorStop(0, '#22202b');
    g.addColorStop(1, '#0d0c12');
    ctx.fillStyle = g;
  }
  ctx.fill();

  // Anneau extérieur
  ctx.lineWidth = lit ? 2.6 : 1.6;
  ctx.strokeStyle = lit ? 'rgba(255,255,255,0.92)' : rgba(rgb, 0.32);
  ctx.stroke();

  // Anneau intérieur fin (pour un côté « médaillon »)
  ctx.beginPath();
  ctx.arc(x, y, r - 5, 0, Math.PI * 2);
  ctx.lineWidth = 1;
  ctx.strokeStyle = lit ? 'rgba(255,255,255,0.35)' : 'rgba(255,255,255,0.05)';
  ctx.stroke();

  // Contenu : numéro ou cadenas
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  if (lit) {
    ctx.fillStyle = 'rgba(8, 6, 14, 0.95)';
    ctx.font = 'bold 17px "Segoe UI", "Helvetica", sans-serif';
    ctx.fillText(String(n.k + 1), x, y + 1);
  } else {
    drawLockGlyph(ctx, x, y, r * 0.95, rgba(rgb, 0.55));
  }

  // Marqueur « prochain palier dispo » : petit cercle pulsant blanc-coloré
  if (isCurrent && !lit) {
    ctx.lineWidth = 2;
    ctx.strokeStyle = rgba(rgb, 0.85);
    ctx.beginPath();
    ctx.arc(x, y, r + 5, 0, Math.PI * 2);
    ctx.stroke();
    ctx.lineWidth = 1.2;
    ctx.strokeStyle = 'rgba(255,255,255,0.8)';
    ctx.beginPath();
    ctx.arc(x, y, r + 9, 0, Math.PI * 2);
    ctx.stroke();
  }
}

function drawSideNode(ctx, p, rgb, color, lit) {
  const { x, y } = p;
  const r = SIDE_R;

  if (lit) {
    const halo = ctx.createRadialGradient(x, y, r * 0.5, x, y, r * 2.4);
    halo.addColorStop(0, rgba(rgb, 0.45));
    halo.addColorStop(1, rgba(rgb, 0));
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(x, y, r * 2.4, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  if (lit) {
    const g = ctx.createRadialGradient(x - r * 0.3, y - r * 0.3, r * 0.15, x, y, r);
    g.addColorStop(0, rgba(rgb.map((c) => Math.min(255, c + 40)), 1));
    g.addColorStop(1, color);
    ctx.fillStyle = g;
  } else {
    ctx.fillStyle = '#13121a';
  }
  ctx.fill();
  ctx.lineWidth = lit ? 1.8 : 1.2;
  ctx.strokeStyle = lit ? 'rgba(255,255,255,0.85)' : rgba(rgb, 0.35);
  ctx.stroke();
}

function drawRoot(ctx) {
  const { x, y } = ROOT;
  // Halo
  const g1 = ctx.createRadialGradient(x, y, 4, x, y, 60);
  g1.addColorStop(0, 'rgba(255,240,200,0.85)');
  g1.addColorStop(0.4, 'rgba(255,210,140,0.35)');
  g1.addColorStop(1, 'rgba(255,210,140,0)');
  ctx.fillStyle = g1;
  ctx.beginPath();
  ctx.arc(x, y, 60, 0, Math.PI * 2);
  ctx.fill();

  // Cœur
  const g2 = ctx.createRadialGradient(x - 4, y - 4, 1, x, y, 14);
  g2.addColorStop(0, '#ffffff');
  g2.addColorStop(1, '#ffd58a');
  ctx.fillStyle = g2;
  ctx.beginPath();
  ctx.arc(x, y, 14, 0, Math.PI * 2);
  ctx.fill();

  ctx.lineWidth = 2;
  ctx.strokeStyle = 'rgba(255,255,255,0.85)';
  ctx.stroke();
}

/* ---------- géométrie de l’arbre ---------- */

function buildLayout() {
  const trees = [];
  const N = ORDER.length;
  const spread = (SPREAD_DEG * Math.PI) / 180;

  for (let i = 0; i < N; i++) {
    const tNorm = N === 1 ? 0 : i / (N - 1) - 0.5;
    const ang = -Math.PI / 2 + spread * tNorm;
    const perp = ang + Math.PI / 2;
    const sign = i < N / 2 ? -1 : i > (N - 1) / 2 ? 1 : 0;
    const rnd = mulberry32(0x99 + i * 17);

    const main = [];
    for (let k = 0; k < 5; k++) {
      const d = 110 + k * NODE_GAP;
      const wob = (rnd() - 0.5) * 24 + Math.sin(i * 1.7 + k * 1.3) * 14;
      const x = ROOT.x + d * Math.cos(ang) + wob * Math.cos(perp);
      const y = ROOT.y + d * Math.sin(ang) + wob * Math.sin(perp);
      main.push({ x, y, k });
    }

    const sides = [];
    for (let k = 0; k < 5; k++) {
      const m = main[k];
      const count = k === 0 ? 0 : (k === 4 ? 2 : (rnd() < 0.7 ? 1 : 2));
      for (let s = 0; s < count; s++) {
        const dir = (s + k + i) % 2 === 0 ? 1 : -1;
        const sa = perp * dir + (rnd() - 0.5) * 0.4;
        const sd = 42 + rnd() * 14;
        // Petit décalage le long du trunk pour que les côtés ne soient pas exactement à la même hauteur
        const along = (rnd() - 0.5) * 24;
        sides.push({
          x: m.x + sd * Math.cos(sa) + along * Math.cos(ang),
          y: m.y + sd * Math.sin(sa) + along * Math.sin(ang),
          parentK: k,
        });
      }
    }

    const tipD = 110 + 4 * NODE_GAP + 92;
    const tipX = ROOT.x + tipD * Math.cos(ang);
    const tipY = ROOT.y + tipD * Math.sin(ang);

    trees.push({ branch: ORDER[i], ang, perp, main, sides, tipX, tipY, sign });
  }

  return trees;
}

/* ---------- rendu principal ---------- */

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

  drawBackground(ctx);
  await drawBlurredAtmosphere(ctx);

  const trees = buildLayout();
  const sOf = (br) => Math.min(5, Math.max(0, Math.floor(steps[br] || 0)));

  // 1) Connexions verrouillées (en arrière-plan)
  for (const tree of trees) {
    const { rgb } = (() => {
      const b = BRANCH[tree.branch];
      return { rgb: b.rgb };
    })();
    const s = sOf(tree.branch);
    // Trunk principal
    for (let k = 0; k < 5; k++) {
      const a = k === 0 ? ROOT : tree.main[k - 1];
      const b = tree.main[k];
      const lit = s > k;
      if (!lit) drawConnection(ctx, a, b, rgb, false);
    }
    // Connexions latérales
    for (const side of tree.sides) {
      const parent = tree.main[side.parentK];
      const lit = s > side.parentK;
      if (!lit) drawConnection(ctx, parent, side, rgb, false, 1, 6);
    }
  }

  // 2) Connexions allumées (par-dessus, plus lumineuses)
  for (const tree of trees) {
    const { rgb } = BRANCH[tree.branch];
    const s = sOf(tree.branch);
    for (let k = 0; k < 5; k++) {
      const a = k === 0 ? ROOT : tree.main[k - 1];
      const b = tree.main[k];
      const lit = s > k;
      if (lit) drawConnection(ctx, a, b, rgb, true);
    }
    for (const side of tree.sides) {
      const parent = tree.main[side.parentK];
      const lit = s > side.parentK;
      if (lit) drawConnection(ctx, parent, side, rgb, true, 0.85, 6);
    }
  }

  // 3) Racine
  drawRoot(ctx);

  // 4) Nœuds latéraux puis principaux (les principaux passent au-dessus)
  for (const tree of trees) {
    const { color, rgb } = BRANCH[tree.branch];
    const s = sOf(tree.branch);
    for (const side of tree.sides) {
      drawSideNode(ctx, side, rgb, color, s > side.parentK);
    }
  }
  for (const tree of trees) {
    const { color, rgb } = BRANCH[tree.branch];
    const s = sOf(tree.branch);
    for (const m of tree.main) {
      const lit = s > m.k;
      const isCurrent = !lit && m.k === s;
      drawMainNode(ctx, m, rgb, color, lit, isCurrent);
    }
  }

  // 5) Étiquettes en bout de branche (label + n/5 stylisé)
  for (const tree of trees) {
    const { color, label, rgb } = BRANCH[tree.branch];
    const s = sOf(tree.branch);

    // Étiquette : label en majuscules + grand chiffre (style « Endurance 12 »)
    ctx.save();
    // Halo doux derrière le texte
    const haloR = 70;
    const halo = ctx.createRadialGradient(tree.tipX, tree.tipY, 4, tree.tipX, tree.tipY, haloR);
    halo.addColorStop(0, rgba(rgb, 0.32));
    halo.addColorStop(1, rgba(rgb, 0));
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(tree.tipX, tree.tipY, haloR, 0, Math.PI * 2);
    ctx.fill();

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = rgba(rgb, 0.6);
    ctx.shadowBlur = 8;
    ctx.fillStyle = color;
    ctx.font = 'bold 18px "Segoe UI", "Helvetica", sans-serif';
    ctx.fillText(label, tree.tipX, tree.tipY - 16);

    ctx.shadowBlur = 12;
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 30px "Segoe UI", "Helvetica", sans-serif';
    ctx.fillText(`${s}/5`, tree.tipX, tree.tipY + 14);
    ctx.restore();
  }

  // 6) Bandeau d’en-tête
  const headH = 88;
  const bandG = ctx.createLinearGradient(0, 0, 0, headH);
  bandG.addColorStop(0, 'rgba(0,0,0,0.78)');
  bandG.addColorStop(1, 'rgba(0,0,0,0.25)');
  ctx.fillStyle = bandG;
  ctx.fillRect(0, 0, W, headH);
  // ligne séparatrice subtile
  ctx.strokeStyle = 'rgba(255,255,255,0.06)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, headH);
  ctx.lineTo(W, headH);
  ctx.stroke();

  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#f3f0ff';
  ctx.font = 'bold 30px "Segoe UI", "Helvetica", sans-serif';
  ctx.fillText('Arbre de compétences REBORN', 36, 42);

  ctx.fillStyle = '#a4a3b8';
  ctx.font = '18px "Segoe UI", "Helvetica", sans-serif';
  ctx.fillText(`Points : ${points}  ·  Coût palier n = n  ·  5 branches × 5 paliers`, 36, 70);

  // Pseudo et résumé à droite du bandeau
  ctx.textAlign = 'right';
  ctx.fillStyle = '#dad6ee';
  ctx.font = 'bold 18px "Segoe UI", "Helvetica", sans-serif';
  ctx.fillText(displayName, W - 32, 42);

  const totalUnlocked = ORDER.reduce((acc, b) => acc + sOf(b), 0);
  ctx.fillStyle = '#7a7993';
  ctx.font = '14px "Segoe UI", "Helvetica", sans-serif';
  ctx.fillText(`Paliers débloqués : ${totalUnlocked} / 25`, W - 32, 66);

  return canvas.toBuffer('image/png');
}

/* ---------- temple (carte secondaire, conservée) ---------- */

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
    const t = createCanvas(sw, sh);
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
  const sub = p.templeUnlocked
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
