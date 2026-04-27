const { createCanvas, loadImage } = require('canvas');
const path = require('node:path');
const fs = require('node:fs');

const W = 1500;
const H = 880;
const ASSETS = path.join(__dirname, '..', '..', '..', 'niveau', 'src', 'assets');
const BLZ_BG = path.join(ASSETS, 'blz_bg.png');

const TITLE_COLOR = '#f5c842';
const TITLE_RGB = [245, 200, 66];

const CARD_THEMES = {
  daily: {
    icon: '🌅',
    label: 'QUÊTE QUOTIDIENNE',
    accent: '#FFB867',
    accentRgb: [255, 184, 103],
    glow: '#ff8a3d',
  },
  weekly: {
    icon: '📅',
    label: 'QUÊTE HEBDO',
    accent: '#7DC2FF',
    accentRgb: [125, 194, 255],
    glow: '#3a8bd8',
  },
  selection: {
    icon: '🎲',
    label: 'QUÊTE À CHOIX',
    accent: '#C39BFF',
    accentRgb: [195, 155, 255],
    glow: '#7a4ad9',
  },
};

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

async function drawBackground(ctx) {
  const bg = await loadSafe(BLZ_BG);
  if (bg) drawImageCover(ctx, bg, 0, 0, W, H);
  else {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#1c1024');
    g.addColorStop(1, '#0a0512');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }
  ctx.fillStyle = 'rgba(6, 4, 12, 0.66)';
  ctx.fillRect(0, 0, W, H);

  const vg = ctx.createRadialGradient(W / 2, H / 2, H * 0.42, W / 2, H / 2, W * 0.85);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, 'rgba(0,0,0,0.55)');
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, W, H);
}

function drawAvatarRound(ctx, img, cx, cy, r) {
  const halo = ctx.createRadialGradient(cx, cy, r * 0.6, cx, cy, r * 1.6);
  halo.addColorStop(0, rgba(TITLE_RGB, 0.34));
  halo.addColorStop(1, rgba(TITLE_RGB, 0));
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(cx, cy, r * 1.6, 0, Math.PI * 2);
  ctx.fill();

  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.closePath();
  ctx.clip();
  if (img) ctx.drawImage(img, cx - r, cy - r, r * 2, r * 2);
  else {
    ctx.fillStyle = '#1a1320';
    ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
  }
  ctx.restore();

  ctx.lineWidth = 4;
  ctx.strokeStyle = TITLE_COLOR;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();
}

function drawHeader(ctx, displayName, avatarImg) {
  const headerH = 130;
  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.32)';
  ctx.fillRect(0, 0, W, headerH);

  ctx.font = '700 26px InterBold, Arial, sans-serif';
  ctx.fillStyle = '#e6dcff';
  ctx.textAlign = 'left';
  ctx.fillText(displayName || 'Joueur', 36, 80);

  ctx.font = '900 56px InterBold, Arial, sans-serif';
  ctx.textAlign = 'center';
  const tx = W / 2;
  const ty = 82;
  ctx.shadowColor = rgba(TITLE_RGB, 0.6);
  ctx.shadowBlur = 24;
  ctx.fillStyle = TITLE_COLOR;
  ctx.fillText('QUÊTES — REBORN', tx, ty);
  ctx.shadowBlur = 0;

  ctx.font = '500 18px Inter, Arial, sans-serif';
  ctx.fillStyle = 'rgba(232,222,250,0.78)';
  ctx.fillText('récompenses automatiques dès le seuil atteint', tx, ty + 30);

  drawAvatarRound(ctx, avatarImg, W - 80, 65, 48);
  ctx.restore();
}

function drawProgressBar(ctx, x, y, w, h, ratio, accent, accentRgb) {
  rr(ctx, x, y, w, h, h / 2);
  ctx.fillStyle = 'rgba(255,255,255,0.08)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.18)';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  const r = Math.max(0, Math.min(1, ratio));
  const fw = Math.max(h, w * r);
  if (r > 0) {
    rr(ctx, x, y, fw, h, h / 2);
    const g = ctx.createLinearGradient(x, y, x + fw, y);
    g.addColorStop(0, rgba(accentRgb, 0.95));
    g.addColorStop(1, accent);
    ctx.fillStyle = g;
    ctx.fill();

    ctx.shadowColor = rgba(accentRgb, 0.55);
    ctx.shadowBlur = 14;
    rr(ctx, x, y, fw, h, h / 2);
    ctx.fill();
    ctx.shadowBlur = 0;
  }
}

function drawCard(ctx, x, y, w, h, theme, data) {
  rr(ctx, x, y, w, h, 22);
  const bg = ctx.createLinearGradient(x, y, x, y + h);
  bg.addColorStop(0, 'rgba(28,18,40,0.92)');
  bg.addColorStop(1, 'rgba(14,8,22,0.92)');
  ctx.fillStyle = bg;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = rgba(theme.accentRgb, 0.55);
  ctx.stroke();

  ctx.save();
  rr(ctx, x, y, 6, h, 3);
  const accentBar = ctx.createLinearGradient(x, y, x, y + h);
  accentBar.addColorStop(0, theme.accent);
  accentBar.addColorStop(1, rgba(theme.accentRgb, 0.4));
  ctx.fillStyle = accentBar;
  ctx.fill();
  ctx.restore();

  const iconBoxR = 36;
  const iconCx = x + 70;
  const iconCy = y + h / 2;
  ctx.save();
  const ig = ctx.createRadialGradient(iconCx, iconCy, 4, iconCx, iconCy, iconBoxR);
  ig.addColorStop(0, rgba(theme.accentRgb, 0.55));
  ig.addColorStop(1, rgba(theme.accentRgb, 0));
  ctx.fillStyle = ig;
  ctx.beginPath();
  ctx.arc(iconCx, iconCy, iconBoxR, 0, Math.PI * 2);
  ctx.fill();
  ctx.font = '600 44px "Segoe UI Emoji", Arial';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#fff';
  ctx.fillText(theme.icon, iconCx, iconCy + 2);
  ctx.restore();

  const textX = iconCx + 60;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.font = '700 22px InterBold, Arial';
  ctx.fillStyle = theme.accent;
  ctx.fillText(theme.label, textX, y + 42);

  ctx.font = '600 28px InterBold, Arial';
  ctx.fillStyle = '#f4eeff';
  ctx.fillText(data.title || '—', textX, y + 78);

  ctx.font = '500 18px Inter, Arial';
  ctx.fillStyle = 'rgba(232,222,250,0.78)';
  ctx.fillText(data.subtitle || '', textX, y + 104);

  // Status badge à droite
  if (data.statusText) {
    const bw = 200;
    const bh = 44;
    const bx = x + w - bw - 24;
    const by = y + 24;
    rr(ctx, bx, by, bw, bh, bh / 2);
    if (data.statusOk) {
      ctx.fillStyle = 'rgba(124,255,139,0.18)';
      ctx.fill();
      ctx.strokeStyle = '#7CFF8B';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.fillStyle = '#7CFF8B';
    } else {
      ctx.fillStyle = rgba(theme.accentRgb, 0.16);
      ctx.fill();
      ctx.strokeStyle = theme.accent;
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.fillStyle = theme.accent;
    }
    ctx.font = '700 18px InterBold, Arial';
    ctx.textAlign = 'center';
    ctx.fillText(data.statusText, bx + bw / 2, by + bh / 2 + 6);
    ctx.textAlign = 'left';
  }

  // Progress bar (ou ligne récompense)
  const barX = textX;
  const barY = y + h - 42;
  const barW = w - (textX - x) - 40;
  if (typeof data.progress === 'number' && typeof data.target === 'number') {
    drawProgressBar(ctx, barX, barY, barW, 16, data.progress / data.target, theme.accent, theme.accentRgb);
    ctx.font = '700 16px InterBold, Arial';
    ctx.fillStyle = '#f4eeff';
    ctx.textAlign = 'right';
    ctx.fillText(`${data.progress} / ${data.target}`, barX + barW, barY - 10);
    ctx.textAlign = 'left';
  }

  // Récompense en bas droite
  if (data.rewardText) {
    ctx.font = '700 20px InterBold, Arial';
    ctx.fillStyle = TITLE_COLOR;
    ctx.textAlign = 'right';
    ctx.fillText(data.rewardText, x + w - 24, y + h - 18);
    ctx.textAlign = 'left';
  }
}

function drawFooter(ctx, footerLines) {
  const y0 = H - 90;
  rr(ctx, 32, y0, W - 64, 70, 18);
  ctx.fillStyle = 'rgba(20,12,30,0.85)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(245,200,66,0.45)';
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.font = '600 18px Inter, Arial';
  ctx.fillStyle = '#f4eeff';
  ctx.textAlign = 'left';
  ctx.fillText(footerLines[0] || '', 56, y0 + 28);
  ctx.font = '500 16px Inter, Arial';
  ctx.fillStyle = 'rgba(232,222,250,0.78)';
  ctx.fillText(footerLines[1] || '', 56, y0 + 52);
}

/**
 * Rend la fiche canvas /quetes (page REBORN).
 * @param {object} opts
 * @param {string} opts.displayName
 * @param {string} [opts.avatarUrl]
 * @param {object} opts.summary - retour de quests.summary(uid)
 * @param {{available: boolean, locked: boolean, msLeft: number}} [opts.spawner]
 * @returns {Promise<Buffer>}
 */
async function renderQuetesRebornPng(opts) {
  const { displayName, avatarUrl, summary, spawner = { available: false, locked: true, msLeft: 0 } } = opts;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  await drawBackground(ctx);
  const avatarImg = await loadSafe(avatarUrl || null);
  drawHeader(ctx, displayName, avatarImg);

  const cardX = 36;
  const cardW = W - 72;
  const cardH = 200;
  const gap = 20;
  let cy = 156;

  // Daily
  {
    const done = !!summary.daily_claimed;
    const dailyData = done
      ? {
          title: 'Validée — bravo !',
          subtitle: 'Reviens demain pour une nouvelle daily.',
          statusText: '✅ VALIDÉE',
          statusOk: true,
          rewardText: `+ ${Number(summary.daily_reward).toLocaleString('fr-FR')} starss`,
        }
      : {
          title: `${summary.msgs_today} / ${summary.daily_target} messages aujourd’hui`,
          subtitle: 'Récompense versée automatiquement au seuil.',
          statusText: 'EN COURS',
          statusOk: false,
          progress: summary.msgs_today,
          target: summary.daily_target,
          rewardText: `${Number(summary.daily_reward).toLocaleString('fr-FR')} starss`,
        };
    drawCard(ctx, cardX, cy, cardW, cardH, CARD_THEMES.daily, dailyData);
    cy += cardH + gap;
  }

  // Weekly
  {
    const done = !!summary.weekly_claimed;
    const weeklyData = done
      ? {
          title: 'Hebdo terminée — repos mérité.',
          subtitle: 'Reset chaque lundi à 00:00.',
          statusText: '✅ VALIDÉE',
          statusOk: true,
          rewardText: `+ ${Number(summary.weekly_reward).toLocaleString('fr-FR')} starss`,
        }
      : {
          title: `${summary.week_points} / ${summary.weekly_target} messages cette semaine`,
          subtitle: 'Auto-claim dès que tu atteins l’objectif.',
          statusText: 'EN COURS',
          statusOk: false,
          progress: summary.week_points,
          target: summary.weekly_target,
          rewardText: `${Number(summary.weekly_reward).toLocaleString('fr-FR')} starss`,
        };
    drawCard(ctx, cardX, cy, cardW, cardH, CARD_THEMES.weekly, weeklyData);
    cy += cardH + gap;
  }

  // Selection
  {
    const sid = summary.selection_id || '';
    const ended = /terminée/i.test(summary.selection_line || '');
    let title;
    let subtitle;
    let statusText;
    let statusOk = false;
    if (!sid) {
      title = 'Aucune quête à choix sélectionnée';
      subtitle = 'Choisis-en une dans le menu déroulant ci-dessous.';
      statusText = 'À CHOISIR';
    } else if (ended) {
      title = 'Quête à choix terminée — bien joué !';
      subtitle = 'Tu pourras en prendre une nouvelle au prochain reset.';
      statusText = '✅ VALIDÉE';
      statusOk = true;
    } else {
      title = summary.selection_line.replace(/\*\*/g, '').replace(/—/g, '·');
      subtitle = 'Récompense : auto si « messages », sinon clique sur « Réclamer ».';
      statusText = 'EN COURS';
    }
    drawCard(ctx, cardX, cy, cardW, cardH, CARD_THEMES.selection, {
      title,
      subtitle,
      statusText,
      statusOk,
      rewardText: '',
    });
    cy += cardH + gap;
  }

  // Footer (bonus arbre + spawner)
  const slots = summary.selection_slots ?? 3;
  const skips = `${summary.skips_left ?? 0}/${summary.skips_total ?? 0}`;
  const mult = `×${summary.reward_mult ?? 1}`;
  let spawnerText;
  if (spawner.locked) spawnerText = '🔒 Event Spawner hebdo : palier 5 Événement.';
  else if (spawner.available) spawnerText = '🎁 Event Spawner hebdo disponible !';
  else {
    const h = Math.floor(spawner.msLeft / 3_600_000);
    const m = Math.floor((spawner.msLeft % 3_600_000) / 60_000);
    spawnerText = `🎁 Event Spawner — prochain claim dans ${h}h${String(m).padStart(2, '0')}.`;
  }
  drawFooter(ctx, [
    `✨ Arbre quête : récompenses ${mult}  ·  skips ${skips}  ·  slots ${slots}`,
    spawnerText,
  ]);

  return canvas.toBuffer('image/png');
}

module.exports = { renderQuetesRebornPng };
