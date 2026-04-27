const { createCanvas, loadImage } = require('canvas');
const path = require('node:path');
const fs = require('node:fs');

/* ---------- arbre de compétences (style ARC Raiders) ---------- */

const W = 1500;
const H = 980;
const ASSETS = path.join(__dirname, '..', 'assets');

/**
 * Branches : 5 voies, labels colorés au bout. Les angles sont définis par layout.
 */
const BRANCH = {
  quest:  { label: 'QUÊTE',     color: '#7CFF8B', rgb: [124, 255, 139], icon: '⚔' },
  guild:  { label: 'GUILDE',    color: '#C39BFF', rgb: [195, 155, 255], icon: '⚜' },
  shop:   { label: 'BOUTIQUE',  color: '#FFB867', rgb: [255, 184, 103], icon: '◈' },
  ranked: { label: 'RANKED',    color: '#7DC2FF', rgb: [125, 194, 255], icon: '★' },
  event:  { label: 'ÉVÉNEMENT', color: '#FF7B7B', rgb: [255, 123, 123], icon: '✦' },
};
const ORDER = ['quest', 'guild', 'shop', 'ranked', 'event'];

/**
 * Deux dispositions :
 * - `star` : 5 pétales sur 360°, racine au centre (look ARC Raiders d'origine).
 * - `demi` : 5 branches en demi-cercle au-dessus, racine dorée tout en bas.
 *
 * `angle` est en degrés, 0 = droite, -90 = haut, +90 = bas (repère canvas).
 */
const BRANCH_ANGLES = {
  star: { quest: -162, guild: -90, shop: -18, ranked: 54, event: 126 },
  demi: { quest: -170, guild: -130, shop: -90, ranked: -50, event: -10 },
};
const CENTERS = {
  star: { x: W / 2, y: H / 2 + 80 },
  demi: { x: W / 2, y: H - 140 },
};
// Paramètres organiques par layout : amplitude de la courbure latérale, écart des nœuds, taille.
const LAYOUT_TUNING = {
  star: { bulge: 22, sideMin: 38, sideJitter: 14, alongJitter: 22, firstDist: 112, gap: 58, mainR: 28, capR: 33, sideR: 9 },
  demi: { bulge: 14, sideMin: 40, sideJitter: 14, alongJitter: 20, firstDist: 160, gap: 92, mainR: 32, capR: 38, sideR: 11 },
};
const FIRST_NODE_DIST = 112;
const NODE_GAP = 58;
const NODES_PER_BRANCH = 5;
const TIP_OFFSET = 92;
const MAIN_R = 28;
const CAP_R = 33; // rayon « capstone » du dernier nœud
const SIDE_R = 9;

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

function drawImageCover(ctx, img, x, y, w, h) {
  const iw = img.width;
  const ih = img.height;
  if (!iw || !ih) return;
  const ratio = Math.max(w / iw, h / ih);
  const nw = iw * ratio;
  const nh = ih * ratio;
  ctx.drawImage(img, x + (w - nw) / 2, y + (h - nh) / 2, nw, nh);
}

/** Fond « profil » : `blz_bg.png` plein écran + voile sombre épais pour rester lisible. */
async function drawBgProfil(ctx) {
  const bgPath = path.join(ASSETS, 'blz_bg.png');
  let drawn = false;
  if (fs.existsSync(bgPath)) {
    try {
      const bg = await loadImage(fs.readFileSync(bgPath));
      drawImageCover(ctx, bg, 0, 0, W, H);
      drawn = true;
    } catch {
      /* ignore */
    }
  }
  if (!drawn) {
    // Fallback équivalent au fond /profil sans asset disponible.
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#1c1024');
    g.addColorStop(1, '#0a0512');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }
  // Voile noir global (équivalent THEME.overlay du /profil mais plus marqué pour la lisibilité de l’arbre).
  ctx.fillStyle = 'rgba(6, 4, 12, 0.62)';
  ctx.fillRect(0, 0, W, H);

  // Vignette très douce vers les bords.
  const vg = ctx.createRadialGradient(W / 2, H / 2, H * 0.42, W / 2, H / 2, W * 0.85);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, 'rgba(0,0,0,0.55)');
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, W, H);
}

/** Courbe de Bézier quadratique avec une saillie perpendiculaire pour un trait organique. */
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

/** Spine principale : courbe colorée épaisse quand allumée, fil fin et froid quand verrouillée. */
function drawConnection(ctx, a, b, rgb, lit, bulge = 9) {
  ctx.lineCap = 'round';
  if (lit) {
    // Halo coloré doux (sans devenir néon).
    ctx.strokeStyle = rgba(rgb, 0.18);
    ctx.lineWidth = 13;
    quadStroke(ctx, a.x, a.y, b.x, b.y, bulge);
    // Trait coloré principal — bien marqué, façon ARC Raiders.
    ctx.strokeStyle = rgba(rgb, 0.95);
    ctx.lineWidth = 5;
    quadStroke(ctx, a.x, a.y, b.x, b.y, bulge);
    // Reflet clair central.
    ctx.strokeStyle = 'rgba(255,255,255,0.22)';
    ctx.lineWidth = 1.6;
    quadStroke(ctx, a.x, a.y, b.x, b.y, bulge);
  } else {
    // Verrouillée : fil bleu-gris, fin, sans glow.
    ctx.strokeStyle = 'rgba(170, 178, 205, 0.22)';
    ctx.lineWidth = 1.8;
    quadStroke(ctx, a.x, a.y, b.x, b.y, bulge);
  }
}

/** Liaisons côté (toujours fines, légèrement teintées si parent allumé). */
function drawSideConnection(ctx, parent, side, rgb, lit) {
  ctx.lineCap = 'round';
  ctx.strokeStyle = lit ? rgba(rgb, 0.45) : 'rgba(170, 178, 205, 0.22)';
  ctx.lineWidth = lit ? 2 : 1.4;
  ctx.beginPath();
  ctx.moveTo(parent.x, parent.y);
  ctx.lineTo(side.x, side.y);
  ctx.stroke();
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

/** Petite plaque-chip "k/5" sous le nœud, façon ARC Raiders. */
function drawTierChip(ctx, x, y, text, rgb, color, lit) {
  ctx.font = 'bold 12px "Segoe UI", "Helvetica", sans-serif';
  const tw = ctx.measureText(text).width;
  const bw = Math.max(28, tw + 14);
  const bh = 18;
  const bx = x - bw / 2;
  const by = y;

  ctx.fillStyle = lit ? 'rgba(0,0,0,0.82)' : 'rgba(0,0,0,0.62)';
  rr(ctx, bx, by, bw, bh, 9);
  ctx.fill();
  ctx.lineWidth = 1;
  ctx.strokeStyle = lit ? rgba(rgb, 0.85) : rgba(rgb, 0.32);
  ctx.stroke();

  ctx.fillStyle = lit ? color : rgba(rgb, 0.55);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x, by + bh / 2 + 1);
}

/**
 * Nœud principal : disque coloré (allumé) ou disque sombre + cadenas (verrouillé).
 * Le 5ᵉ nœud (capstone) est légèrement plus gros, comme dans ARC Raiders.
 */
function drawMainNode(ctx, n, rgb, color, icon, lit, isCurrent, isCapstone, sizes = {}) {
  const { x, y } = n;
  const mainR = sizes.mainR ?? MAIN_R;
  const capR = sizes.capR ?? CAP_R;
  const r = isCapstone ? capR : mainR;

  // Halo coloré doux (allumé).
  if (lit) {
    const halo = ctx.createRadialGradient(x, y, r * 0.6, x, y, r * 2.05);
    halo.addColorStop(0, rgba(rgb, 0.32));
    halo.addColorStop(0.6, rgba(rgb, 0.12));
    halo.addColorStop(1, rgba(rgb, 0));
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(x, y, r * 2.05, 0, Math.PI * 2);
    ctx.fill();
  }

  // Corps du nœud.
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  if (lit) {
    const g = ctx.createRadialGradient(x - r * 0.3, y - r * 0.4, r * 0.18, x, y, r);
    g.addColorStop(0, rgba(rgb.map((c) => Math.min(255, c + 35)), 1));
    g.addColorStop(1, color);
    ctx.fillStyle = g;
  } else {
    const g = ctx.createRadialGradient(x - r * 0.3, y - r * 0.4, r * 0.18, x, y, r);
    g.addColorStop(0, '#1c1828');
    g.addColorStop(1, '#0c0a14');
    ctx.fillStyle = g;
  }
  ctx.fill();

  // Anneau extérieur (relief).
  ctx.lineWidth = lit ? 2.2 : isCurrent ? 2 : 1.4;
  ctx.strokeStyle = lit
    ? 'rgba(255,255,255,0.85)'
    : isCurrent
    ? rgba(rgb, 0.78)
    : rgba(rgb, 0.30);
  ctx.stroke();

  // Anneau intérieur (médaillon).
  ctx.beginPath();
  ctx.arc(x, y, r - 5, 0, Math.PI * 2);
  ctx.lineWidth = 1;
  ctx.strokeStyle = lit ? 'rgba(255,255,255,0.32)' : 'rgba(255,255,255,0.06)';
  ctx.stroke();

  // Marqueur « prochain palier achetable » : double anneau coloré.
  if (isCurrent && !lit) {
    ctx.beginPath();
    ctx.arc(x, y, r + 5, 0, Math.PI * 2);
    ctx.lineWidth = 2;
    ctx.strokeStyle = rgba(rgb, 0.62);
    ctx.stroke();
  }

  // Icône au centre — sombre sur nœud allumé, teintée sur nœud verrouillé.
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const iconLit = Math.round(r * (isCapstone ? 0.91 : 0.93));
  const iconLock = Math.round(r * 0.78);
  if (lit) {
    ctx.fillStyle = 'rgba(10, 8, 20, 0.92)';
    ctx.font = `bold ${iconLit}px "Segoe UI Symbol", "Segoe UI", "Helvetica", sans-serif`;
    ctx.fillText(icon, x, y + 1);
  } else {
    ctx.fillStyle = rgba(rgb, 0.55);
    ctx.font = `bold ${iconLock}px "Segoe UI Symbol", "Segoe UI", "Helvetica", sans-serif`;
    ctx.fillText(icon, x, y + 1);
    // Petit cadenas en surimpression bas-droite (très discret).
    drawLockGlyph(ctx, x + r * 0.55, y + r * 0.55, r * 0.55, rgba(rgb, 0.55));
  }

  // Chip k/5 sous le nœud — pas sur le capstone (le label de bout de branche affiche déjà n/5).
  if (!isCapstone) {
    drawTierChip(ctx, x, y + r + 9, `${n.k + 1}/5`, rgb, color, lit);
  }
}

/** Nœud latéral décoratif (allumé quand le nœud principal parent l’est). */
function drawSideNode(ctx, p, rgb, color, lit, sizes = {}) {
  const { x, y } = p;
  const r = sizes.sideR ?? SIDE_R;

  if (lit) {
    const halo = ctx.createRadialGradient(x, y, r * 0.5, x, y, r * 2);
    halo.addColorStop(0, rgba(rgb, 0.25));
    halo.addColorStop(1, rgba(rgb, 0));
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(x, y, r * 2, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  if (lit) {
    const g = ctx.createRadialGradient(x - r * 0.3, y - r * 0.3, r * 0.15, x, y, r);
    g.addColorStop(0, rgba(rgb.map((c) => Math.min(255, c + 30)), 1));
    g.addColorStop(1, color);
    ctx.fillStyle = g;
  } else {
    ctx.fillStyle = '#161421';
  }
  ctx.fill();
  ctx.lineWidth = lit ? 1.4 : 1;
  ctx.strokeStyle = lit ? 'rgba(255,255,255,0.65)' : rgba(rgb, 0.32);
  ctx.stroke();
}

/**
 * Cœur central. Trois modes :
 * - `avatarImg === undefined` : petit orbe doré (look « étoile »).
 * - `avatarImg === null` : médaillon vide avec dégradé sombre + ring doré (fallback avatar).
 * - `avatarImg` Image : avatar du membre, anneau doré épais + halo.
 */
function drawRoot(ctx, center, avatarImg) {
  const { x, y } = center;

  if (avatarImg === undefined) {
    // Mode étoile : petit orbe doré.
    const halo = ctx.createRadialGradient(x, y, 4, x, y, 56);
    halo.addColorStop(0, 'rgba(255, 235, 190, 0.55)');
    halo.addColorStop(0.5, 'rgba(255, 200, 130, 0.18)');
    halo.addColorStop(1, 'rgba(255, 210, 140, 0)');
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(x, y, 56, 0, Math.PI * 2);
    ctx.fill();

    ctx.beginPath();
    ctx.arc(x, y, 22, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255, 220, 150, 0.35)';
    ctx.lineWidth = 1;
    ctx.stroke();

    const core = ctx.createRadialGradient(x - 3, y - 3, 1, x, y, 14);
    core.addColorStop(0, '#fff4dc');
    core.addColorStop(1, '#e9b765');
    ctx.fillStyle = core;
    ctx.beginPath();
    ctx.arc(x, y, 14, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = 1.4;
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.stroke();
    return;
  }

  // Mode avatar : médaillon de profil, plus large, avec anneau doré épais.
  const r = 52;

  // Halo doré large.
  const halo = ctx.createRadialGradient(x, y, r * 0.4, x, y, r * 2);
  halo.addColorStop(0, 'rgba(255, 220, 150, 0.55)');
  halo.addColorStop(0.55, 'rgba(255, 195, 110, 0.18)');
  halo.addColorStop(1, 'rgba(255, 210, 140, 0)');
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(x, y, r * 2, 0, Math.PI * 2);
  ctx.fill();

  // Disque médaillon (clip + image ou dégradé fallback).
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.closePath();
  ctx.clip();
  if (avatarImg) {
    ctx.drawImage(avatarImg, x - r, y - r, r * 2, r * 2);
  } else {
    const g = ctx.createLinearGradient(x - r, y - r, x + r, y + r);
    g.addColorStop(0, '#3a2e22');
    g.addColorStop(1, '#1a1410');
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  ctx.restore();

  // Anneau doré épais.
  ctx.beginPath();
  ctx.arc(x, y, r + 1.5, 0, Math.PI * 2);
  ctx.lineWidth = 3.5;
  ctx.strokeStyle = '#f5c842';
  ctx.shadowColor = 'rgba(245, 200, 66, 0.6)';
  ctx.shadowBlur = 12;
  ctx.stroke();
  ctx.shadowBlur = 0;

  // Anneau extérieur fin (effet viseur).
  ctx.beginPath();
  ctx.arc(x, y, r + 9, 0, Math.PI * 2);
  ctx.lineWidth = 1.2;
  ctx.strokeStyle = 'rgba(245, 200, 66, 0.35)';
  ctx.stroke();
}

/* ---------- géométrie de l’arbre ---------- */

function buildLayout(layout = 'star') {
  const center = CENTERS[layout] || CENTERS.star;
  const angles = BRANCH_ANGLES[layout] || BRANCH_ANGLES.star;
  const tune = LAYOUT_TUNING[layout] || LAYOUT_TUNING.star;
  const trees = [];
  for (let i = 0; i < ORDER.length; i++) {
    const branchKey = ORDER[i];
    const ang = ((angles[branchKey] ?? 0) * Math.PI) / 180;
    const perp = ang + Math.PI / 2;
    const rnd = mulberry32(0xa00 + i * 31);

    const main = [];
    for (let k = 0; k < NODES_PER_BRANCH; k++) {
      const d = tune.firstDist + k * tune.gap;
      // Bombement organique : sin sur la longueur + petite oscillation déterministe.
      const t = NODES_PER_BRANCH === 1 ? 0 : k / (NODES_PER_BRANCH - 1);
      const baseCurve = Math.sin(t * Math.PI) * tune.bulge * (i % 2 === 0 ? 1 : -1);
      const wob = (rnd() - 0.5) * (tune.bulge * 0.55);
      const off = baseCurve + wob;
      const x = center.x + d * Math.cos(ang) + off * Math.cos(perp);
      const y = center.y + d * Math.sin(ang) + off * Math.sin(perp);
      main.push({ x, y, k });
    }

    const sides = [];
    for (let k = 0; k < NODES_PER_BRANCH; k++) {
      const m = main[k];
      const count = k === 0 ? 0 : k === NODES_PER_BRANCH - 1 ? 2 : rnd() < 0.55 ? 1 : 2;
      for (let s = 0; s < count; s++) {
        const dir = (s + k + i) % 2 === 0 ? 1 : -1;
        const sa = perp * dir + (rnd() - 0.5) * 0.45;
        const sd = tune.sideMin + rnd() * tune.sideJitter;
        const along = (rnd() - 0.5) * tune.alongJitter;
        sides.push({
          x: m.x + sd * Math.cos(sa) + along * Math.cos(ang),
          y: m.y + sd * Math.sin(sa) + along * Math.sin(ang),
          parentK: k,
        });
      }
    }

    const tipD = tune.firstDist + (NODES_PER_BRANCH - 1) * tune.gap + TIP_OFFSET;
    const tipX = center.x + tipD * Math.cos(ang);
    const tipY = center.y + tipD * Math.sin(ang);

    trees.push({ branch: branchKey, ang, perp, main, sides, tipX, tipY });
  }
  return { center, trees, tune };
}

/* ---------- rendu principal ---------- */

const HEADER_TITLE_COLOR = '#f5c842';
const HEADER_TITLE_RGB = [245, 200, 66];

async function loadAvatarSafe(url) {
  if (!url) return null;
  try {
    return await loadImage(url);
  } catch {
    return null;
  }
}

/** Avatar circulaire avec anneau doré et halo doux. */
function drawAvatarRound(ctx, img, cx, cy, r) {
  // Halo
  const halo = ctx.createRadialGradient(cx, cy, r * 0.6, cx, cy, r * 1.6);
  halo.addColorStop(0, rgba(HEADER_TITLE_RGB, 0.32));
  halo.addColorStop(1, rgba(HEADER_TITLE_RGB, 0));
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(cx, cy, r * 1.6, 0, Math.PI * 2);
  ctx.fill();

  // Cadre cercle (arrière-plan sombre si pas d’avatar)
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.closePath();
  ctx.clip();
  if (img) {
    ctx.drawImage(img, cx - r, cy - r, r * 2, r * 2);
  } else {
    const g = ctx.createLinearGradient(cx - r, cy - r, cx + r, cy + r);
    g.addColorStop(0, '#3a2e22');
    g.addColorStop(1, '#1a1410');
    ctx.fillStyle = g;
    ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
  }
  ctx.restore();

  // Anneau doré
  ctx.beginPath();
  ctx.arc(cx, cy, r + 1, 0, Math.PI * 2);
  ctx.lineWidth = 2.4;
  ctx.strokeStyle = HEADER_TITLE_COLOR;
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(cx, cy, r + 5, 0, Math.PI * 2);
  ctx.lineWidth = 1;
  ctx.strokeStyle = rgba(HEADER_TITLE_RGB, 0.35);
  ctx.stroke();
}

function truncateText(ctx, text, maxWidth) {
  if (!text) return '';
  if (ctx.measureText(text).width <= maxWidth) return text;
  const ell = '…';
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = Math.floor((lo + hi + 1) / 2);
    if (ctx.measureText(text.slice(0, mid) + ell).width <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  return text.slice(0, lo) + ell;
}

function drawHeader(ctx, displayName, points, sOf, avatarImg) {
  const headH = 96;
  const bandG = ctx.createLinearGradient(0, 0, 0, headH);
  bandG.addColorStop(0, 'rgba(0,0,0,0.85)');
  bandG.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = bandG;
  ctx.fillRect(0, 0, W, headH);
  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, headH);
  ctx.lineTo(W, headH);
  ctx.stroke();

  // --- Titre centré, jaune ---
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.shadowColor = 'rgba(245, 200, 66, 0.55)';
  ctx.shadowBlur = 16;
  ctx.fillStyle = HEADER_TITLE_COLOR;
  ctx.font = 'bold 36px "Segoe UI", "Helvetica", sans-serif';
  ctx.fillText('Arbre de compétences', W / 2, 50);
  ctx.shadowBlur = 0;

  // Sous-titre discret sous le titre
  const totalUnlocked = ORDER.reduce((acc, b) => acc + sOf(b), 0);
  ctx.fillStyle = '#cdb88a';
  ctx.font = '14px "Segoe UI", "Helvetica", sans-serif';
  ctx.fillText(
    `REBORN  ·  5 branches × 5 paliers  ·  Coût palier n = n`,
    W / 2,
    74,
  );

  // --- Bloc gauche : stats du joueur ---
  ctx.textAlign = 'left';
  ctx.fillStyle = '#dad6ee';
  ctx.font = 'bold 14px "Segoe UI", "Helvetica", sans-serif';
  ctx.fillText(`Points dispo : ${points}`, 36, 40);
  ctx.fillStyle = '#a4a3b8';
  ctx.font = '13px "Segoe UI", "Helvetica", sans-serif';
  ctx.fillText(`Paliers : ${totalUnlocked} / 25`, 36, 62);

  // --- Bloc droit : pseudo + avatar ---
  const avatarR = 30;
  const avatarCx = W - 36 - avatarR;
  const avatarCy = headH / 2;
  drawAvatarRound(ctx, avatarImg, avatarCx, avatarCy, avatarR);

  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  ctx.font = 'bold 22px "Segoe UI", "Helvetica", sans-serif';
  const nameMaxW = 360;
  const safeName = truncateText(ctx, displayName, nameMaxW);
  ctx.shadowColor = 'rgba(0,0,0,0.85)';
  ctx.shadowBlur = 6;
  ctx.fillStyle = '#ffffff';
  ctx.fillText(safeName, avatarCx - avatarR - 14, avatarCy - 6);

  ctx.shadowBlur = 0;
  ctx.font = '13px "Segoe UI", "Helvetica", sans-serif';
  ctx.fillStyle = '#a4a3b8';
  ctx.fillText('Joueur', avatarCx - avatarR - 14, avatarCy + 16);

  ctx.textBaseline = 'alphabetic';
}

function drawBranchTipLabel(ctx, tree, step) {
  const { tipX, tipY, branch } = tree;
  const { color, label, rgb } = BRANCH[branch];

  // Halo discret derrière le label (uniquement si au moins 1 palier).
  if (step > 0) {
    const haloR = 56;
    const halo = ctx.createRadialGradient(tipX, tipY, 4, tipX, tipY, haloR);
    halo.addColorStop(0, rgba(rgb, 0.18));
    halo.addColorStop(1, rgba(rgb, 0));
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(tipX, tipY, haloR, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = 'rgba(0,0,0,0.85)';
  ctx.shadowBlur = 8;
  ctx.fillStyle = color;
  ctx.font = 'bold 19px "Segoe UI", "Helvetica", sans-serif';
  ctx.fillText(label, tipX, tipY - 14);

  ctx.shadowBlur = 6;
  ctx.fillStyle = step > 0 ? '#f3f0ff' : '#7a7894';
  ctx.font = 'bold 32px "Segoe UI", "Helvetica", sans-serif';
  ctx.fillText(`${step}/5`, tipX, tipY + 18);
  ctx.shadowBlur = 0;
}

/**
 * @param {object} opts
 * @param {string} [opts.displayName]
 * @param {number} [opts.points]
 * @param {Record<string, number>} [opts.steps] branch -> 0-5
 * @param {string} [opts.avatarUrl] URL Discord de l’avatar (PNG/JPG/WebP). Optionnelle.
 * @param {'star' | 'demi'} [opts.layout] disposition (étoile par défaut, demi-cercle bas pour `voir2`)
 */
async function renderSkillTreePng(opts = {}) {
  const { displayName = 'Joueur', points = 0, steps = {}, avatarUrl } = opts;
  const layout = opts.layout === 'demi' ? 'demi' : 'star';

  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  await drawBgProfil(ctx);

  const avatarImg = await loadAvatarSafe(avatarUrl);

  const { center, trees, tune } = buildLayout(layout);
  const sizes = { mainR: tune.mainR, capR: tune.capR, sideR: tune.sideR };
  const sOf = (br) => Math.min(5, Math.max(0, Math.floor(steps[br] || 0)));

  // 1) Liaisons latérales (toujours fines, en arrière-plan).
  for (const tree of trees) {
    const { rgb } = BRANCH[tree.branch];
    const s = sOf(tree.branch);
    for (const side of tree.sides) {
      const parent = tree.main[side.parentK];
      drawSideConnection(ctx, parent, side, rgb, s > side.parentK);
    }
  }

  // 2) Spines verrouillées.
  for (const tree of trees) {
    const { rgb } = BRANCH[tree.branch];
    const s = sOf(tree.branch);
    for (let k = 0; k < NODES_PER_BRANCH; k++) {
      const a = k === 0 ? center : tree.main[k - 1];
      const b = tree.main[k];
      if (!(s > k)) drawConnection(ctx, a, b, rgb, false);
    }
  }

  // 3) Spines allumées (par-dessus, glow coloré).
  for (const tree of trees) {
    const { rgb } = BRANCH[tree.branch];
    const s = sOf(tree.branch);
    for (let k = 0; k < NODES_PER_BRANCH; k++) {
      const a = k === 0 ? center : tree.main[k - 1];
      const b = tree.main[k];
      if (s > k) drawConnection(ctx, a, b, rgb, true);
    }
  }

  // 4) Nœuds latéraux décoratifs.
  for (const tree of trees) {
    const { color, rgb } = BRANCH[tree.branch];
    const s = sOf(tree.branch);
    for (const side of tree.sides) {
      drawSideNode(ctx, side, rgb, color, s > side.parentK, sizes);
    }
  }

  // 5) Cœur central : avatar du membre pour le layout demi, orbe doré pour étoile.
  if (layout === 'demi') {
    drawRoot(ctx, center, avatarImg);
  } else {
    drawRoot(ctx, center);
  }

  // 6) Nœuds principaux (capstone = dernier de la branche, plus gros).
  for (const tree of trees) {
    const { color, rgb, icon } = BRANCH[tree.branch];
    const s = sOf(tree.branch);
    for (const m of tree.main) {
      const lit = s > m.k;
      const isCurrent = !lit && m.k === s;
      const isCapstone = m.k === NODES_PER_BRANCH - 1;
      drawMainNode(ctx, m, rgb, color, icon, lit, isCurrent, isCapstone, sizes);
    }
  }

  // 7) Labels de bout de branche.
  for (const tree of trees) {
    drawBranchTipLabel(ctx, tree, sOf(tree.branch));
  }

  // 8) En-tête.
  drawHeader(ctx, displayName, points, sOf, avatarImg);

  return canvas.toBuffer('image/png');
}

/* ---------- temple (carte céleste sacrée) ---------- */

const TEMPLE_W = 1200;
const TEMPLE_H = 720;

/**
 * Catalogue des « clés » du temple. Les `id` correspondent à ceux émis par
 * `services/temple.js#sync`. Les clés inconnues seront affichées comme
 * « Sceau mystérieux » si jamais le module en émet.
 */
const TEMPLE_KEYS = [
  { id: 'classes', label: 'Maître des Voies', hint: '5/5 sur toutes les branches', glyph: '✦' },
  { id: 'max_rp', label: 'Étoile Pourpre', hint: '≥ 100 000 RP', glyph: '★' },
  { id: 'grp_star', label: 'Astre de Guilde', hint: '≥ 200 000 GRP', glyph: '✸' },
  { id: 'guild_grade_star', label: 'Bannière Étoilée', hint: 'Guilde rang « Star »', glyph: '◈' },
  { id: 'diamond', label: 'Cœur de Diamant', hint: 'Diamant détenu', glyph: '◆' },
  { id: 'index_full', label: 'Codex Complet', hint: 'Index 100 %', glyph: '☷' },
];

// Palette « temple rouge » : on garde le nom `TEMPLE_GOLD` pour éviter
// de toucher à toutes les références — seule la valeur change.
const TEMPLE_GOLD = '#ff4d3a';
const TEMPLE_GOLD_RGB = [255, 77, 58];
const TEMPLE_VERMIL = '#c8221d';
const TEMPLE_VERMIL_RGB = [200, 34, 29];
const TEMPLE_INK = '#1a0606';
const TEMPLE_TEXT_HOT = '#ffd6cf';
const TEMPLE_TEXT_DIM = '#c89890';

function drawCosmicBackground(ctx, w, h) {
  // Dégradé radial très sombre, un peu mauve.
  const g = ctx.createRadialGradient(w / 2, h / 2, 40, w / 2, h / 2, w);
  g.addColorStop(0, '#1a1240');
  g.addColorStop(0.45, '#0d0a26');
  g.addColorStop(1, '#04020a');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);

  // Nébuleuses douces (3 blobs colorés).
  const blobs = [
    { x: w * 0.18, y: h * 0.25, r: 280, c: 'rgba(120, 60, 200, 0.18)' },
    { x: w * 0.85, y: h * 0.78, r: 320, c: 'rgba(212, 73, 62, 0.14)' },
    { x: w * 0.78, y: h * 0.18, r: 240, c: 'rgba(70, 110, 220, 0.16)' },
  ];
  for (const b of blobs) {
    const ng = ctx.createRadialGradient(b.x, b.y, 5, b.x, b.y, b.r);
    ng.addColorStop(0, b.c);
    ng.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = ng;
    ctx.beginPath();
    ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
    ctx.fill();
  }

  // Champ d’étoiles déterministe.
  const rnd = mulberry32(0x7e91);
  for (let i = 0; i < 220; i++) {
    const x = rnd() * w;
    const y = rnd() * h;
    const r = 0.3 + rnd() * 1.4;
    const a = 0.05 + rnd() * 0.55;
    ctx.fillStyle = `rgba(${230 + Math.floor(rnd() * 25)}, ${220 + Math.floor(rnd() * 25)}, 255, ${a})`;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  // Quelques éclats avec « rayons » fins.
  for (let i = 0; i < 6; i++) {
    const x = rnd() * w;
    const y = rnd() * h;
    ctx.strokeStyle = `rgba(255,255,255,${0.05 + rnd() * 0.06})`;
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    const len = 8 + rnd() * 14;
    ctx.moveTo(x - len, y);
    ctx.lineTo(x + len, y);
    ctx.moveTo(x, y - len);
    ctx.lineTo(x, y + len);
    ctx.stroke();
  }

  // Vignette globale.
  const vg = ctx.createRadialGradient(w / 2, h / 2, h * 0.4, w / 2, h / 2, w * 0.85);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, 'rgba(0,0,0,0.7)');
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, w, h);
}

function drawSacredRing(ctx, cx, cy, r) {
  // Anneau extérieur fin doré.
  ctx.save();
  ctx.strokeStyle = rgba(TEMPLE_GOLD_RGB, 0.35);
  ctx.lineWidth = 2.2;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();

  ctx.strokeStyle = rgba(TEMPLE_GOLD_RGB, 0.12);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(cx, cy, r + 12, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx, cy, r - 12, 0, Math.PI * 2);
  ctx.stroke();

  // Tick marks tous les 15°.
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    const long = i % 4 === 0;
    const r1 = r - (long ? 18 : 8);
    const r2 = r - 2;
    ctx.strokeStyle = rgba(TEMPLE_GOLD_RGB, long ? 0.55 : 0.22);
    ctx.lineWidth = long ? 1.6 : 0.8;
    ctx.beginPath();
    ctx.moveTo(cx + r1 * Math.cos(a), cy + r1 * Math.sin(a));
    ctx.lineTo(cx + r2 * Math.cos(a), cy + r2 * Math.sin(a));
    ctx.stroke();
  }
  ctx.restore();
}

function drawProgressArc(ctx, cx, cy, r, ratio) {
  if (ratio <= 0) return;
  ctx.save();
  // Halo de l’arc.
  ctx.strokeStyle = rgba(TEMPLE_GOLD_RGB, 0.18);
  ctx.lineWidth = 14;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + ratio * Math.PI * 2);
  ctx.stroke();
  // Arc principal.
  ctx.strokeStyle = TEMPLE_GOLD;
  ctx.lineWidth = 4;
  ctx.shadowColor = rgba(TEMPLE_GOLD_RGB, 0.7);
  ctx.shadowBlur = 14;
  ctx.beginPath();
  ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + ratio * Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

function drawSanctum(ctx, cx, cy, r, unlocked) {
  // Halo doré central.
  ctx.save();
  if (unlocked) {
    const halo = ctx.createRadialGradient(cx, cy, 4, cx, cy, r * 1.8);
    halo.addColorStop(0, 'rgba(255, 220, 140, 0.65)');
    halo.addColorStop(0.5, 'rgba(255, 150, 90, 0.25)');
    halo.addColorStop(1, 'rgba(255, 100, 60, 0)');
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(cx, cy, r * 1.8, 0, Math.PI * 2);
    ctx.fill();
  } else {
    const dim = ctx.createRadialGradient(cx, cy, 2, cx, cy, r * 1.4);
    dim.addColorStop(0, 'rgba(80, 60, 110, 0.45)');
    dim.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = dim;
    ctx.beginPath();
    ctx.arc(cx, cy, r * 1.4, 0, Math.PI * 2);
    ctx.fill();
  }

  // Disque sombre du sanctuaire.
  const inner = ctx.createRadialGradient(cx - r * 0.25, cy - r * 0.3, r * 0.1, cx, cy, r);
  inner.addColorStop(0, '#1a1530');
  inner.addColorStop(1, '#080514');
  ctx.fillStyle = inner;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();

  // Anneaux concentriques.
  ctx.strokeStyle = rgba(TEMPLE_GOLD_RGB, unlocked ? 0.55 : 0.28);
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();

  ctx.strokeStyle = rgba(TEMPLE_GOLD_RGB, 0.18);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(cx, cy, r - 10, 0, Math.PI * 2);
  ctx.stroke();

  // 4 marqueurs cardinaux.
  for (let i = 0; i < 4; i++) {
    const a = i * (Math.PI / 2) - Math.PI / 2;
    const x = cx + (r - 5) * Math.cos(a);
    const y = cy + (r - 5) * Math.sin(a);
    ctx.fillStyle = rgba(TEMPLE_GOLD_RGB, 0.6);
    ctx.beginPath();
    ctx.arc(x, y, 2.2, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawTorii(ctx, cx, cy, scale, unlocked) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(scale, scale);

  const main = unlocked ? TEMPLE_VERMIL : '#2b1f2a';
  const main2 = unlocked ? '#a83228' : '#1a1218';
  const high = unlocked ? '#ffd9b3' : '#2e2230';

  // Rayons lumineux verticaux derrière le torii (uniquement débloqué).
  if (unlocked) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const rays = ctx.createLinearGradient(0, -120, 0, 120);
    rays.addColorStop(0, 'rgba(255,210,140,0)');
    rays.addColorStop(0.5, 'rgba(255,180,90,0.18)');
    rays.addColorStop(1, 'rgba(255,210,140,0)');
    ctx.fillStyle = rays;
    ctx.fillRect(-12, -120, 24, 240);
    ctx.fillRect(-46, -120, 8, 240);
    ctx.fillRect(38, -120, 8, 240);
    ctx.restore();
  }

  // Plinthes sous les piliers.
  ctx.fillStyle = main2;
  ctx.fillRect(-50, 58, 26, 6);
  ctx.fillRect(24, 58, 26, 6);

  // Piliers (légèrement biseautés vers le haut).
  const drawPillar = (x) => {
    const grad = ctx.createLinearGradient(x, 0, x + 18, 0);
    grad.addColorStop(0, main2);
    grad.addColorStop(0.5, main);
    grad.addColorStop(1, main2);
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(x + 1, -36);
    ctx.lineTo(x + 17, -36);
    ctx.lineTo(x + 18, 58);
    ctx.lineTo(x, 58);
    ctx.closePath();
    ctx.fill();
    if (unlocked) {
      ctx.fillStyle = 'rgba(255, 210, 170, 0.35)';
      ctx.fillRect(x + 2, -36, 1.2, 94);
    }
  };
  drawPillar(-46);
  drawPillar(28);

  // Nuki (poutre intermédiaire).
  ctx.fillStyle = main2;
  ctx.fillRect(-58, -22, 116, 9);

  // Shimaki (poutre sous le toit).
  const shGrad = ctx.createLinearGradient(0, -52, 0, -38);
  shGrad.addColorStop(0, main);
  shGrad.addColorStop(1, main2);
  ctx.fillStyle = shGrad;
  ctx.fillRect(-66, -52, 132, 14);

  // Kasagi (toit principal, légèrement relevé aux extrémités).
  ctx.fillStyle = main;
  ctx.beginPath();
  ctx.moveTo(-78, -64);
  ctx.quadraticCurveTo(-82, -72, -74, -76);
  ctx.lineTo(74, -76);
  ctx.quadraticCurveTo(82, -72, 78, -64);
  ctx.lineTo(66, -54);
  ctx.lineTo(-66, -54);
  ctx.closePath();
  ctx.fill();

  // Liseré clair sur le toit.
  ctx.strokeStyle = high;
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(-78, -64);
  ctx.quadraticCurveTo(-82, -72, -74, -76);
  ctx.lineTo(74, -76);
  ctx.quadraticCurveTo(82, -72, 78, -64);
  ctx.stroke();

  // Sceau central sur le nuki.
  if (unlocked) {
    ctx.fillStyle = '#fff1c2';
    ctx.shadowColor = 'rgba(255, 220, 140, 0.9)';
    ctx.shadowBlur = 8;
  } else {
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
  }
  ctx.beginPath();
  ctx.arc(0, -17, 4, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

function drawConstellationLine(ctx, a, b) {
  ctx.save();
  ctx.strokeStyle = rgba(TEMPLE_GOLD_RGB, 0.18);
  ctx.lineWidth = 6;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
  ctx.strokeStyle = rgba(TEMPLE_GOLD_RGB, 0.85);
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
  ctx.restore();
}

/**
 * Étoile à 5 branches centrée en (cx, cy).
 */
function drawStarShape(ctx, cx, cy, outerR, innerR, points = 5) {
  ctx.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? outerR : innerR;
    const a = -Math.PI / 2 + (i / (points * 2)) * Math.PI * 2;
    const x = cx + r * Math.cos(a);
    const y = cy + r * Math.sin(a);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

function drawKeyStar(ctx, p, angle) {
  const { x, y, lit, label, hint } = p;
  ctx.save();

  // Halo de fond pour les clés acquises.
  if (lit) {
    const halo = ctx.createRadialGradient(x, y, 2, x, y, 60);
    halo.addColorStop(0, rgba(TEMPLE_GOLD_RGB, 0.55));
    halo.addColorStop(0.55, rgba(TEMPLE_GOLD_RGB, 0.18));
    halo.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(x, y, 60, 0, Math.PI * 2);
    ctx.fill();
  }

  // Cercle support.
  ctx.beginPath();
  ctx.arc(x, y, 22, 0, Math.PI * 2);
  if (lit) {
    const g = ctx.createRadialGradient(x - 6, y - 8, 2, x, y, 22);
    g.addColorStop(0, '#fff5d6');
    g.addColorStop(1, '#c79830');
    ctx.fillStyle = g;
  } else {
    ctx.fillStyle = '#15101e';
  }
  ctx.fill();

  ctx.lineWidth = lit ? 1.8 : 1.2;
  ctx.strokeStyle = lit ? 'rgba(255,255,255,0.85)' : rgba(TEMPLE_GOLD_RGB, 0.35);
  ctx.stroke();

  // Étoile au centre (acquise) ou cadenas (verrouillée).
  if (lit) {
    drawStarShape(ctx, x, y, 11, 4.5, 5);
    ctx.fillStyle = '#0e0a16';
    ctx.fill();
    ctx.lineWidth = 0.8;
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.stroke();
  } else {
    drawLockGlyph(ctx, x, y, 18, rgba(TEMPLE_GOLD_RGB, 0.45));
  }

  // Étiquettes (label + hint), positionnées vers l’extérieur de l’anneau.
  const dirX = Math.cos(angle);
  const dirY = Math.sin(angle);
  const lx = x + dirX * 50;
  const ly = y + dirY * 50;

  // Aligner le texte côté extérieur.
  ctx.textAlign = dirX < -0.25 ? 'right' : dirX > 0.25 ? 'left' : 'center';
  ctx.textBaseline = 'middle';

  // Petit trait reliant l’étoile à l’étiquette.
  ctx.strokeStyle = rgba(TEMPLE_GOLD_RGB, lit ? 0.45 : 0.18);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x + dirX * 24, y + dirY * 24);
  ctx.lineTo(x + dirX * 44, y + dirY * 44);
  ctx.stroke();

  // Label
  ctx.shadowColor = 'rgba(0,0,0,0.85)';
  ctx.shadowBlur = 6;
  ctx.fillStyle = lit ? '#ffe8a8' : '#7a7591';
  ctx.font = `bold 16px "Segoe UI", "Helvetica", sans-serif`;
  ctx.fillText(label, lx, ly - 9);

  ctx.shadowBlur = 4;
  ctx.fillStyle = lit ? '#cdb6e0' : '#5a566e';
  ctx.font = `12px "Segoe UI", "Helvetica", sans-serif`;
  ctx.fillText(hint, lx, ly + 9);

  ctx.restore();
}

function drawTempleHeader(ctx, points, unlocked, keysCount, keysTotal) {
  ctx.save();

  // Bandeau en haut, un peu transparent.
  const headH = 84;
  const grad = ctx.createLinearGradient(0, 0, 0, headH);
  grad.addColorStop(0, 'rgba(0,0,0,0.78)');
  grad.addColorStop(1, 'rgba(0,0,0,0.0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, TEMPLE_W, headH);

  ctx.strokeStyle = rgba(TEMPLE_GOLD_RGB, 0.35);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(36, 60);
  ctx.lineTo(TEMPLE_W - 36, 60);
  ctx.stroke();

  // Titre principal.
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#ffe8a8';
  ctx.shadowColor = 'rgba(255, 200, 100, 0.45)';
  ctx.shadowBlur = 10;
  ctx.font = 'bold 32px "Segoe UI", "Helvetica", sans-serif';
  ctx.fillText('Temple de l’Ascension', 36, 42);

  ctx.shadowBlur = 0;
  ctx.fillStyle = '#a89cc8';
  ctx.font = '16px "Segoe UI", "Helvetica", sans-serif';
  ctx.fillText('Carte céleste des grandes réussites — sanctuaire du prestige.', 36, 64);

  // Bandeau d’infos à droite.
  ctx.textAlign = 'right';
  ctx.fillStyle = unlocked ? '#7CFFB8' : '#FFB47A';
  ctx.shadowColor = unlocked ? 'rgba(124,255,184,0.45)' : 'rgba(255,180,122,0.4)';
  ctx.shadowBlur = 10;
  ctx.font = 'bold 22px "Segoe UI", "Helvetica", sans-serif';
  ctx.fillText(unlocked ? 'TEMPLE OUVERT' : 'TEMPLE SCELLÉ', TEMPLE_W - 36, 42);

  ctx.shadowBlur = 0;
  ctx.fillStyle = '#cdb6e0';
  ctx.font = '14px "Segoe UI", "Helvetica", sans-serif';
  ctx.fillText(
    `Points : ${points}  ·  Clés ${keysCount} / ${keysTotal}`,
    TEMPLE_W - 36,
    64,
  );

  ctx.restore();
}

function drawTempleFooter(ctx, unlocked, keysCount, keysTotal) {
  ctx.save();
  const y = TEMPLE_H - 46;
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.fillRect(0, y, TEMPLE_W, 46);
  ctx.strokeStyle = rgba(TEMPLE_GOLD_RGB, 0.28);
  ctx.beginPath();
  ctx.moveTo(36, y);
  ctx.lineTo(TEMPLE_W - 36, y);
  ctx.stroke();

  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#a89cc8';
  ctx.font = '14px "Segoe UI", "Helvetica", sans-serif';
  ctx.fillText(
    unlocked
      ? 'Toutes les voies maîtrisées — le sanctuaire vibre de ta présence.'
      : 'Réunis les clés pour briser les sceaux. Chaque réussite illumine un astre.',
    36,
    y + 23,
  );

  ctx.textAlign = 'right';
  ctx.fillStyle = '#5a566e';
  ctx.fillText(`REBORN sandbox  ·  ${keysCount}/${keysTotal} sceaux`, TEMPLE_W - 36, y + 23);
  ctx.restore();
}

/**
 * Carte « temple céleste » : torii central, 6 clés disposées en constellation,
 * arc de progression doré, fond cosmique.
 *
 * @param {object} p
 * @param {number} [p.points]
 * @param {string[]} [p.keys] ids de clés acquises (cf. `services/temple.js`)
 * @param {boolean} [p.templeUnlocked]
 */
async function renderTemplePng({ points = 0, keys = [], templeUnlocked = false } = {}) {
  const canvas = createCanvas(TEMPLE_W, TEMPLE_H);
  const ctx = canvas.getContext('2d');

  // 1. Fond cosmique.
  drawCosmicBackground(ctx, TEMPLE_W, TEMPLE_H);

  // 2. Anneaux sacrés.
  const cx = TEMPLE_W / 2;
  const cy = TEMPLE_H / 2 + 14;
  const ringR = 250;
  drawSacredRing(ctx, cx, cy, ringR);

  // 3. Calcul des positions des clés (catalogue + clés inconnues éventuelles).
  const earned = new Set(Array.isArray(keys) ? keys : []);
  const slots = TEMPLE_KEYS.map((k) => ({ ...k, lit: earned.has(k.id) }));
  for (const id of earned) {
    if (!TEMPLE_KEYS.some((k) => k.id === id)) {
      slots.push({ id, label: 'Sceau mystérieux', hint: id, glyph: '✧', lit: true });
    }
  }
  const N = slots.length;
  const keyR = ringR - 30;
  const positions = slots.map((s, i) => {
    const angle = -Math.PI / 2 + (i / N) * Math.PI * 2;
    return { ...s, angle, x: cx + keyR * Math.cos(angle), y: cy + keyR * Math.sin(angle) };
  });

  // 4. Lignes de constellation entre clés acquises adjacentes.
  for (let i = 0; i < positions.length; i++) {
    const a = positions[i];
    const b = positions[(i + 1) % positions.length];
    if (a.lit && b.lit) drawConstellationLine(ctx, a, b);
  }

  // 5. Arc de progression doré.
  const ratio = Math.min(1, earned.size / Math.max(1, TEMPLE_KEYS.length));
  drawProgressArc(ctx, cx, cy, ringR, ratio);

  // 6. Sanctuaire central + torii.
  drawSanctum(ctx, cx, cy, 100, templeUnlocked);
  drawTorii(ctx, cx, cy + 6, 1, templeUnlocked);

  // 7. Étoiles des clés (toujours par-dessus le sanctum).
  for (const p of positions) {
    drawKeyStar(ctx, p, p.angle);
  }

  // 8. En-tête + pied.
  drawTempleHeader(ctx, points, templeUnlocked, earned.size, TEMPLE_KEYS.length);
  drawTempleFooter(ctx, templeUnlocked, earned.size, TEMPLE_KEYS.length);

  // Petite signature discrète au coin du sanctuaire.
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = templeUnlocked ? '#ffe8a8' : '#5a566e';
  ctx.shadowColor = templeUnlocked ? 'rgba(255, 200, 100, 0.55)' : 'rgba(0,0,0,0)';
  ctx.shadowBlur = 6;
  ctx.font = `bold 13px "Segoe UI", "Helvetica", sans-serif`;
  ctx.fillText('SANCTVM', cx, cy + 80);
  ctx.restore();

  void TEMPLE_INK;
  return canvas.toBuffer('image/png');
}

module.exports = { renderSkillTreePng, renderTemplePng, W, H };
