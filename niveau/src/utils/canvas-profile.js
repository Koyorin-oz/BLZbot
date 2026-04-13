const { createCanvas, loadImage, registerFont } = require('canvas');
const fs = require('node:fs');
const path = require('node:path');

let sharpMod = null;
try {
  sharpMod = require('sharp');
} catch {
  /* optionnel : conversion WebP / buffers exotiques */
}

/** PNG 1×1 valide — évite tout crash si les fichiers rank-icons sont absents / LFS / corrompus sur l’hébergeur */
const RANK_ICON_FALLBACK_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhwI/pW7Y1QAAAABJRU5ErkJggg==',
  'base64'
);

let _rankFallbackImage = null;
async function getRankFallbackImage() {
  if (_rankFallbackImage) return _rankFallbackImage;
  _rankFallbackImage = await loadImage(RANK_ICON_FALLBACK_PNG);
  return _rankFallbackImage;
}

const _rankIconBad = new Set();
async function loadRankIconBuffer(iconPath) {
  const useFallbackQuietly = async () => {
    try {
      return await getRankFallbackImage();
    } catch {
      return null;
    }
  };

  if (!iconPath || !fs.existsSync(iconPath)) {
    return useFallbackQuietly();
  }

  const buf = fs.readFileSync(iconPath);
  if (buf.length < 24) {
    return useFallbackQuietly();
  }

  const probe = buf.slice(0, 64).toString('utf8');
  if (probe.includes('version https://git-lfs')) {
    if (!_rankIconBad.has(iconPath)) {
      _rankIconBad.add(iconPath);
      if (process.env.BLZ_COMPACT_LOG !== '1') {
        console.warn(`[profile] Icône rang (LFS non tiré): ${path.basename(iconPath)} — placeholder`);
      }
    }
    return useFallbackQuietly();
  }

  try {
    return await loadImage(buf);
  } catch {
    if (sharpMod) {
      try {
        const png = await sharpMod(buf).png().toBuffer();
        return await loadImage(png);
      } catch {
        /* ignore */
      }
    }
  }

  if (!_rankIconBad.has(iconPath)) {
    _rankIconBad.add(iconPath);
    if (process.env.BLZ_COMPACT_LOG !== '1') {
      console.warn(`[profile] Icône rang illisible pour canvas: ${path.basename(iconPath)} — placeholder`);
    }
  }
  return useFallbackQuietly();
}

try {
  const assetsPath = path.join(__dirname, '..', 'assets');
  if (fs.existsSync(path.join(assetsPath, 'Inter-Bold.ttf'))) {
    registerFont(path.join(assetsPath, 'Inter-Bold.ttf'), { family: 'InterBold' });
  }
  if (fs.existsSync(path.join(assetsPath, 'Inter-Regular.ttf'))) {
    registerFont(path.join(assetsPath, 'Inter-Regular.ttf'), { family: 'Inter' });
  }
  const fontsPath = path.join(__dirname, '..', 'assets', 'fonts');
  if (fs.existsSync(path.join(fontsPath, 'emojis.ttf'))) {
    registerFont(path.join(fontsPath, 'emojis.ttf'), { family: 'GuildEmoji' });
  }
} catch (e) {
  console.error("Could not register fonts", e)
}

const W = 1200, H = 700;
const THEME = {
  overlay: 'rgba(0,0,0,0.40)',
  panel: 'rgba(0,0,0,0.62)',
  header: 'rgba(0,0,0,0.58)',
  text: '#ffffff',
  sub: '#f2d7d3',
  accent: '#ffd166',
  debtRed: '#ff4444',
  outline: 'rgba(255,255,255,0.43)',
  // Rarity colors for achievements
  commun: '#95a5a6',
  rare: '#3498db',
  epique: '#9b59b6',
  legendaire: '#f39c12',
  mythique: '#e74c3c',
  goatesque: '#00ffff',
  // Part 2 rank colors
  part2_goat: '#C27AED',       // GOAT - Violet/rose
  part2_super: '#9B6DFF',      // SUPER GOAT - Violet planète
  part2_the: '#5DADE2',        // THE GOAT - Bleu cyan couronne
  part2_magnifique: '#6C5CE7'  // MAGNIFIQUE - Bleu/violet diamant
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

function panel(ctx, x, y, w, h, r, fill = THEME.panel) {
  rr(ctx, x, y, w, h, r);
  ctx.fillStyle = fill; ctx.fill();
  ctx.strokeStyle = THEME.outline; ctx.lineWidth = 3; ctx.stroke();
}

function truncateText(ctx, text, maxWidth) {
  let width = ctx.measureText(text).width;
  if (width <= maxWidth) {
    return text;
  }
  const ellipsis = '...';
  const ellipsisWidth = ctx.measureText(ellipsis).width;
  while (width > maxWidth - ellipsisWidth && text.length > 0) {
    text = text.substring(0, text.length - 1);
    width = ctx.measureText(text).width;
  }
  return text + ellipsis;
}

async function loadAssets() {
  const assetsPath = path.join(__dirname, '..', 'assets');
  const bgBuffer = fs.readFileSync(path.join(assetsPath, 'blz_bg.png'));
  const dollarBuffer = fs.readFileSync(path.join(assetsPath, 'dollar.png'));
  const bg = await loadImage(bgBuffer);
  const dollar = await loadImage(dollarBuffer);
  return { bg, dollar };
}

function drawDollarWhite(ctx, img, x, y, size) {
  const off = createCanvas(size, size);
  const o = off.getContext('2d');
  o.drawImage(img, 0, 0, size, size);
  o.globalCompositeOperation = 'source-in';
  o.fillStyle = '#ffffff';
  o.fillRect(0, 0, size, size);
  ctx.drawImage(off, x, y);
}

async function drawRankChip(ctx, text, cx, y, iconPath, glowColor = null, glowIntensity = 1) {
  let icon = null;
  const iconSize = 48;
  const iconPadding = 10;
  try {
    icon = await loadRankIconBuffer(iconPath);
  } catch {
    icon = null;
  }

  const iconWidthWithPadding = icon ? iconSize + iconPadding : 0;

  let fontSize = 32;
  const face = 'InterBold';
  ctx.font = `700 ${fontSize}px ${face}, Arial`;
  const maxW = 460;
  const padX = 22, r = 26, h = 64;

  let textWidth = ctx.measureText(text).width;
  while (textWidth + iconWidthWithPadding + padX * 2 > maxW && fontSize > 18) {
    fontSize -= 1;
    ctx.font = `700 ${fontSize}px ${face}, Arial`;
    textWidth = ctx.measureText(text).width;
  }

  const panelWidth = Math.ceil(Math.min(maxW, textWidth + iconWidthWithPadding + padX * 2));
  const panelX = Math.round(cx - panelWidth / 2);

  const contentWidth = textWidth + iconWidthWithPadding;
  const contentStartX = panelX + (panelWidth - contentWidth) / 2;

  const iconX = contentStartX;
  const textX = contentStartX + iconWidthWithPadding;
  const contentY = y + h / 2;

  panel(ctx, panelX, y, panelWidth, h, r, 'rgba(0,0,0,0.70)');

  // Neon glow for rank chip
  if (glowColor && glowIntensity > 0) {
    const intensitySettings = {
      1: { lineWidth: 2, shadowBlur: 12, passes: 1 },
      2: { lineWidth: 3, shadowBlur: 18, passes: 2 },
      3: { lineWidth: 4, shadowBlur: 25, passes: 2 },
      4: { lineWidth: 5, shadowBlur: 35, passes: 3 }
    };
    const s = intensitySettings[glowIntensity];

    ctx.save();
    ctx.strokeStyle = glowColor;
    ctx.lineWidth = s.lineWidth;
    ctx.shadowColor = glowColor;
    ctx.shadowBlur = s.shadowBlur;
    for (let i = 0; i < s.passes; i++) {
      rr(ctx, panelX, y, panelWidth, h, r);
      ctx.stroke();
    }
    ctx.restore();
  }

  if (icon) {
    ctx.drawImage(icon, iconX, contentY - iconSize / 2, iconSize, iconSize);
  }

  ctx.fillStyle = THEME.text;
  ctx.font = `700 ${fontSize}px ${face}, Arial`;
  ctx.textBaseline = 'middle';
  ctx.fillText(text, textX, contentY);
}

async function renderProfileCard({ user, member, rank, nextRank, highestRoleName, rankIconPath, totalDebt, debtTimeRemaining, battlePassTier, vocalNerfStatus, userId }) {
  const { bg, dollar } = await loadAssets();
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  ctx.drawImage(bg, 0, 0, W, H);
  ctx.fillStyle = THEME.overlay; ctx.fillRect(0, 0, W, H);

  const titleFace = 'InterBold';
  const textFace = 'Inter';

  // Déterminer la couleur et l'intensité du glow Part 2 basée sur le rang RP
  let part2Color = null;
  let part2GlowIntensity = 0; // 0 = pas de glow, 1-4 = intensité croissante
  if (user.part2_rp !== null && user.part2_rp !== undefined) {
    // Couleurs et intensités par rang (du plus bas au plus haut)
    const rankConfig = {
      'GOAT': { color: THEME.part2_goat, intensity: 1 },           // Violet/rose - faible
      'SUPER GOAT': { color: THEME.part2_super, intensity: 2 },    // Violet planète - moyen
      'THE GOAT': { color: THEME.part2_the, intensity: 3 },        // Bleu cyan couronne - fort
      'MAGNIFIQUE': { color: THEME.part2_magnifique, intensity: 4 } // Bleu/violet diamant - très fort
    };

    const config = rankConfig[user.part2_rank] || rankConfig['GOAT'];
    part2Color = config.color;
    part2GlowIntensity = config.intensity;
  }

  // Helper pour dessiner les bordures néon (Part 2) avec intensité variable
  const drawNeonBorder = (x, y, w, h, r) => {
    if (!part2Color || part2GlowIntensity === 0) return;

    // Paramètres selon l'intensité
    const glowSettings = {
      1: { lineWidth: 2, shadowBlur: 12, passes: 1 },   // GOAT - faible
      2: { lineWidth: 3, shadowBlur: 20, passes: 2 },   // SUPER GOAT - moyen
      3: { lineWidth: 4, shadowBlur: 30, passes: 3 },   // THE GOAT - fort
      4: { lineWidth: 5, shadowBlur: 45, passes: 4 }    // MAGNIFIQUE - très fort
    };
    const settings = glowSettings[part2GlowIntensity];

    ctx.save();
    ctx.strokeStyle = part2Color;
    ctx.lineWidth = settings.lineWidth;
    ctx.shadowColor = part2Color;
    ctx.shadowBlur = settings.shadowBlur;

    // Dessiner plusieurs passes pour intensifier le glow
    for (let i = 0; i < settings.passes; i++) {
      rr(ctx, x, y, w, h, r);
      ctx.stroke();
    }
    ctx.restore();
  };

  // Glow global autour du profil (Part 2 uniquement) - DÉSACTIVÉ (Feedback utilisateur)
  /*
  if (part2Color && part2GlowIntensity > 0) {
    ctx.save();
    const globalSettings = {
      1: { lw: 3, blur: 20, passes: 2 },
      2: { lw: 4, blur: 30, passes: 3 },
      3: { lw: 5, blur: 40, passes: 4 },
      4: { lw: 8, blur: 60, passes: 5 }
    };
    const gs = globalSettings[part2GlowIntensity];
    ctx.strokeStyle = part2Color;
    ctx.lineWidth = gs.lw;
    ctx.shadowColor = part2Color;
    ctx.shadowBlur = gs.blur;
    for (let i = 0; i < gs.passes; i++) {
      rr(ctx, 10, 10, W - 20, H - 20, 24);
      ctx.stroke();
    }
    ctx.restore();
  }
  */

  // Header panel
  panel(ctx, 24, 24, W - 48, 160, 36, THEME.header);
  drawNeonBorder(24, 24, W - 48, 160, 36);

  const avatarURL = member?.displayAvatarURL({ extension: 'png', size: 256 });
  let avImg = null; try { avImg = avatarURL ? await loadImage(avatarURL) : null; } catch { }
  const avX = 50, avY = 44, avS = 96;
  ctx.save(); rr(ctx, avX, avY, avS, avS, avS / 2); ctx.clip();
  if (avImg) ctx.drawImage(avImg, avX, avY, avS, avS); else { ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.fillRect(avX, avY, avS, avS); }
  ctx.restore();

  ctx.fillStyle = THEME.text; ctx.font = `700 42px ${titleFace}, Arial`;
  ctx.fillText(member?.displayName ?? 'Utilisateur', 170, 86);

  ctx.fillStyle = THEME.sub; ctx.font = `400 22px ${textFace}, Arial`;
  ctx.fillText(highestRoleName, 170, 114);

  const starsY = 94;
  const starsText = `${user.stars.toLocaleString('fr-FR')} Starss`;
  const starsRightAnchor = W - 50;
  const iconSpacing = 10;
  const iconSize = 28;

  ctx.textAlign = 'right';
  ctx.fillStyle = THEME.text;
  ctx.font = `700 30px ${titleFace}, Arial`;
  ctx.fillText(starsText, starsRightAnchor, starsY);

  const textWidth = ctx.measureText(starsText).width;
  const iconX = starsRightAnchor - textWidth - iconSpacing - iconSize;
  drawDollarWhite(ctx, dollar, iconX, starsY - iconSize, iconSize);

  // Debt indicator below stars if exists
  let extraInfoY = starsY + 28;

  if (totalDebt && totalDebt > 0) {
    ctx.fillStyle = THEME.debtRed;
    ctx.font = `600 20px ${titleFace}, Arial`;
    ctx.fillText(`Endetté: ${totalDebt.toLocaleString('fr-FR')} ⭐`, starsRightAnchor, extraInfoY);
    extraInfoY += 24;

    if (debtTimeRemaining) {
      ctx.font = `400 16px ${textFace}, Arial`;
      ctx.fillText(debtTimeRemaining, starsRightAnchor, extraInfoY);
      extraInfoY += 24;
    }
  }

  // Vocal Nerf Status
  if (vocalNerfStatus) {
    ctx.fillStyle = '#FF5555'; // Light red warning color
    ctx.font = `600 20px ${titleFace}, Arial`;
    ctx.fillText(vocalNerfStatus, starsRightAnchor, extraInfoY);
    extraInfoY += 24;
  }
  ctx.textAlign = 'left';

  const progressRatio = Math.max(0, Math.min(1, user.xp / Math.max(1, user.xp_needed)));
  const x0 = 50, y0 = 198, w = W - 100, h = 32;
  rr(ctx, x0, y0, w, h, 16); ctx.fillStyle = 'rgba(255,255,255,0.43)'; ctx.fill();
  rr(ctx, x0, y0, Math.max(h, Math.round(w * progressRatio)), h, 16); ctx.fillStyle = THEME.accent; ctx.fill();

  // Level Text
  ctx.fillStyle = THEME.text; ctx.font = `700 20px ${titleFace}, Arial`;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.fillText(`Niveau ${user.level}`, x0 + 20, y0 + h / 2);

  // XP Text
  const xpText = `${user.xp.toLocaleString('fr-FR')} / ${user.xp_needed.toLocaleString('fr-FR')}`;
  ctx.font = `700 20px ${titleFace}, Arial`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(0,0,0,0.7)';
  ctx.fillText(xpText, x0 + w / 2, y0 + h / 2 + 1);
  ctx.fillStyle = THEME.text;
  ctx.fillText(xpText, x0 + w / 2, y0 + h / 2);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';

  // Streak sous la barre XP
  {
    const streak = user.streak || 0;
    ctx.fillStyle = THEME.accent;
    ctx.font = `700 22px ${titleFace}, Arial`;
    ctx.fillText(`🔥 Streak: ${streak}`, x0, y0 + h + 26);
  }

  // Points de Comptage (PC) - À droite sous la barre XP
  const pcPoints = user.points_comptage || 0;
  ctx.fillStyle = THEME.accent;
  ctx.font = `700 22px ${titleFace}, Arial`;
  ctx.textAlign = 'right';
  ctx.fillText(`📊 PC: ${pcPoints.toLocaleString('fr-FR')}`, x0 + w, y0 + h + 26);
  ctx.textAlign = 'left';

  // Afficher le rang Part 2 si disponible, sinon Part 1
  const displayRankName = user.part2_rank || rank.name;
  await drawRankChip(ctx, `Rang: ${displayRankName}`, W / 2, 256, rankIconPath, part2Color, part2GlowIntensity);

  // Points text - RANKED V2: Support Part 1 et Part 2
  let pointsText;
  if (user.part2_rp !== null && user.part2_rp !== undefined) {
    // Part 2: Afficher 100k + RP dynamiques
    const totalRP = 100000 + user.part2_rp;
    pointsText = `100k + ${user.part2_rp.toLocaleString('fr-FR')} RP`;
    if (user.part2_rank) {
      pointsText += ` [${user.part2_rank}]`;
    }
  } else if (nextRank) {
    // Part 1: Progression vers le rang suivant
    pointsText = `${user.points.toLocaleString('fr-FR')} / ${nextRank.points.toLocaleString('fr-FR')} Points`;
  } else {
    // Part 1 max
    pointsText = `${user.points.toLocaleString('fr-FR')} Points (Max)`;
  }

  ctx.font = `400 18px ${textFace}, Arial`;
  ctx.fillStyle = THEME.sub;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText(pointsText, W / 2, 256 + 64 + 8);
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';

  // Panel Guilde - DIVISÉ EN DEUX PARTIES
  const guildPanelY = 370;
  const guildPanelH = 280;
  const panelGap = 20; // Espace entre les deux panels
  const leftPanelW = (W - 72 - panelGap) / 2;
  const rightPanelW = leftPanelW;
  const rightPanelX = 36 + leftPanelW + panelGap;

  const guildName = user.guild_name || 'Aucune Guilde';
  const guildEmoji = user.guild_emoji || '🛡️';
  const guildLevel = user.guild_level || 1;
  const guildTreasury = user.guild_treasury || 0;
  const guildTreasuryCapacity = user.guild_treasury_capacity || 0;
  const guildTreasuryIncome = user.guild_treasury_income || 0;
  const guildTotalGenerated = user.guild_total_treasury_generated || 0;
  const guildState = user.guild_state || 'En Paix';
  const guildUpgradeLevel = user.guild_upgrade_level || 1;
  const guildMembers = user.guild_members || 0;
  const guildMemberSlots = user.guild_member_slots || 5;
  const guildWarsWon = user.guild_wars_won || 0;

  // ========== PANEL GAUCHE: INFORMATIONS GÉNÉRALES ==========
  panel(ctx, 36, guildPanelY, leftPanelW, guildPanelH, 36, THEME.panel);
  drawNeonBorder(36, guildPanelY, leftPanelW, guildPanelH, 36); // Réactivé (Aura interne)

  // Title avec emoji
  ctx.font = `700 38px ${titleFace}, GuildEmoji, Arial`;
  ctx.fillStyle = THEME.text;
  const titleText = `${guildEmoji} ${guildName}`;
  const truncatedTitle = truncateText(ctx, titleText, leftPanelW - 70);
  ctx.fillText(truncatedTitle, 70, guildPanelY + 50);

  // État de la guilde (Paix / Guerre)
  const stateY = guildPanelY + 100;
  ctx.font = `600 24px ${titleFace}, Arial`;
  if (guildState === 'En Guerre') {
    ctx.fillStyle = '#ff4444';
    ctx.fillText('⚔️ En Guerre', 70, stateY);
  } else {
    ctx.fillStyle = '#4caf50';
    ctx.fillText('🕊️ En Paix', 70, stateY);
  }

  // Niveau de la guilde
  const levelY = guildPanelY + 145;
  ctx.fillStyle = THEME.accent;
  ctx.font = `700 28px ${titleFace}, Arial`;
  ctx.fillText(`📊 Niveau ${guildLevel}`, 70, levelY);

  // Upgrade de la guilde
  const upgradeY = guildPanelY + 185;
  const upgradeDisplay = guildUpgradeLevel === 10 ? 'X' : guildUpgradeLevel;
  ctx.fillStyle = THEME.text;
  ctx.font = `600 22px ${textFace}, Arial`;
  ctx.fillText(`⚙️ Upgrade: ${upgradeDisplay}/10`, 70, upgradeY);

  // Membres
  const membersY = guildPanelY + 220;
  ctx.fillStyle = THEME.sub;
  ctx.font = `400 20px ${textFace}, Arial`;
  ctx.fillText(`👥 Membres: ${guildMembers}/${guildMemberSlots}`, 70, membersY);

  // Guerres gagnées
  const warsY = guildPanelY + 255;
  ctx.fillStyle = THEME.sub;
  ctx.font = `400 20px ${textFace}, Arial`;
  ctx.fillText(`🏆 Guerres gagnées: ${guildWarsWon}`, 70, warsY);

  // ========== PANEL DROIT: TRÉSORERIE ==========
  panel(ctx, rightPanelX, guildPanelY, rightPanelW, guildPanelH, 36, 'rgba(255, 215, 0, 0.1)'); // Or transparent
  drawNeonBorder(rightPanelX, guildPanelY, rightPanelW, guildPanelH, 36); // Réactivé (Aura interne)

  // Titre Trésorerie
  ctx.fillStyle = THEME.accent;
  ctx.font = `700 32px ${titleFace}, Arial`;
  ctx.fillText('💰 Trésorerie', rightPanelX + 35, guildPanelY + 50);

  // Montant actuel
  const currentY = guildPanelY + 105;
  ctx.fillStyle = THEME.text;
  ctx.font = `400 20px ${textFace}, Arial`;
  ctx.fillText('Actuel:', rightPanelX + 35, currentY);
  ctx.fillStyle = '#ffd700';
  ctx.font = `700 32px ${titleFace}, Arial`;
  ctx.fillText(`${guildTreasury.toLocaleString('fr-FR')} ⭐`, rightPanelX + 35, currentY + 32);

  // Capacité
  const capacityY = guildPanelY + 175;
  ctx.fillStyle = THEME.sub;
  ctx.font = `400 18px ${textFace}, Arial`;
  if (guildTreasuryCapacity > 0) {
    ctx.fillText(`Capacité: ${guildTreasuryCapacity.toLocaleString('fr-FR')} ⭐`, rightPanelX + 35, capacityY);

    // Barre de progression
    const barW = rightPanelW - 70;
    const barH = 16;
    const barX = rightPanelX + 35;
    const barY = capacityY + 8;
    const fillRatio = Math.min(1, guildTreasury / guildTreasuryCapacity);

    rr(ctx, barX, barY, barW, barH, 8);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.2)';
    ctx.fill();

    if (fillRatio > 0) {
      rr(ctx, barX, barY, Math.max(barH, barW * fillRatio), barH, 8);
      ctx.fillStyle = '#ffd700';
      ctx.fill();
    }
  } else {
    ctx.fillText('🔒 Débloquée à l\'Upgrade 2', rightPanelX + 35, capacityY);
  }

  // Revenu journalier
  const incomeY = guildPanelY + 215;
  ctx.fillStyle = THEME.sub;
  ctx.font = `400 18px ${textFace}, Arial`;
  if (guildTreasuryIncome > 0) {
    ctx.fillText(`💵 Revenu/jour: +${guildTreasuryIncome.toLocaleString('fr-FR')} ⭐`, rightPanelX + 35, incomeY);
  } else {
    ctx.fillText(`💵 Revenu/jour: 0 ⭐`, rightPanelX + 35, incomeY);
  }

  // Total généré
  const totalY = guildPanelY + 245;
  ctx.fillStyle = THEME.sub;
  ctx.font = `400 18px ${textFace}, Arial`;
  ctx.fillText(`📈 Total généré: ${guildTotalGenerated.toLocaleString('fr-FR')} ⭐`, rightPanelX + 35, totalY);

  // Badges - Affichés sous l'avatar dans le header
  if (userId) {
    await drawBadges(ctx, userId, 50, 148, avS, false);
  }

  return canvas.toBuffer('image/png');
}

async function drawBadges(ctx, userId, x, y, w, center = true) {
  const { getUserBadges } = require('../database/db-badges');
  const path = require('node:path');
  const fs = require('node:fs');

  // Récupérer les badges (limiter à 8 pour l'affichage dans le header)
  const badges = getUserBadges(userId, 8);

  if (badges.length === 0) return;

  const badgeSize = 36; // Plus petit pour le header
  const gap = 8;

  const totalWidth = badges.length * badgeSize + (badges.length - 1) * gap;
  let currentX = center ? (x - totalWidth / 2) : x;
  const badgesY = y;
  const assetsPath = path.join(__dirname, '..', 'assets', 'badges');

  for (const badgeData of badges) {
    const badgeId = badgeData.badge_id;
    const badgePath = path.join(assetsPath, `${badgeId}.png`);

    let badgeImg = null;
    try {
      if (fs.existsSync(badgePath)) {
        badgeImg = await loadImage(badgePath);
      }
    } catch (e) {
      // ignore
    }

    if (badgeImg) {
      ctx.drawImage(badgeImg, currentX, badgesY, badgeSize, badgeSize);
    } else {
      // Fallback discret sans fond
      ctx.font = '20px Arial';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('🎖️', currentX + badgeSize / 2, badgesY + badgeSize / 2);
    }

    currentX += badgeSize + gap;
  }

  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
}

// Helper function to draw progress bar
function drawProgressBar(ctx, x, y, width, height, percentage, titleFace) {
  const radius = height / 2;

  // Background bar
  rr(ctx, x, y, width, height, radius);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.2)';
  ctx.fill();

  // Progress bar
  if (percentage > 0) {
    const progressWidth = Math.max(height, (width * percentage) / 100);
    rr(ctx, x, y, progressWidth, height, radius);
    ctx.fillStyle = THEME.accent;
    ctx.fill();
  }

  // Percentage text
  ctx.fillStyle = THEME.text;
  ctx.font = `700 18px ${titleFace}, Arial`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
  ctx.fillText(`${percentage}%`, x + width / 2 + 1, y + height / 2 + 1);
  ctx.fillStyle = THEME.text;
  ctx.fillText(`${percentage}%`, x + width / 2, y + height / 2);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
}

// Render quests view (pending quests only)
async function renderQuestsCard({ quests }) {
  const { bg } = await loadAssets();
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  ctx.drawImage(bg, 0, 0, W, H);
  ctx.fillStyle = THEME.overlay; ctx.fillRect(0, 0, W, H);

  const titleFace = 'InterBold';
  const textFace = 'Inter';

  // Title panel
  panel(ctx, 24, 24, W - 48, 100, 36, THEME.header);
  ctx.textAlign = 'center';
  ctx.fillStyle = THEME.text;
  ctx.font = `700 48px ${titleFace}, Arial`;
  ctx.fillText('🎯 Quêtes à Faire', W / 2, 86);
  ctx.textAlign = 'left';

  // Quests panel
  panel(ctx, 24, 140, W - 48, H - 164, 36, THEME.panel);

  const startY = 190;
  const questHeight = 105; // Plus d'espace entre les quêtes
  const maxQuests = 5; // Réduit pour avoir plus d'espace vertical

  if (quests.length === 0) {
    ctx.fillStyle = THEME.sub;
    ctx.font = `400 32px ${textFace}, Arial`;
    ctx.textAlign = 'center';
    ctx.fillText('Aucune quête en cours', W / 2, 350);
    ctx.fillText('Toutes les quêtes sont terminées !', W / 2, 400);
    ctx.textAlign = 'left';
  } else {
    quests.slice(0, maxQuests).forEach((quest, i) => {
      const y = startY + (i * questHeight);

      // Quest name with rarity color
      const rarityKey = quest.rarity?.toLowerCase() || 'commune';
      const rarityColor = THEME[rarityKey] || THEME.commun;

      ctx.fillStyle = rarityColor;
      ctx.font = `700 22px ${titleFace}, Arial`;
      const questName = truncateText(ctx, quest.name, 500);
      ctx.fillText(`${questName}`, 60, y);

      // Quest description
      ctx.fillStyle = THEME.sub;
      ctx.font = `400 18px ${textFace}, Arial`;
      const description = truncateText(ctx, quest.description, 1000);
      ctx.fillText(description, 60, y + 25);

      // Progress bar or status
      if (quest.isNumeric !== false && typeof quest.goal === 'number') {
        const percentage = Math.min(Math.floor((quest.progress / quest.goal) * 100), 100);

        // Progress bar
        drawProgressBar(ctx, 60, y + 35, 1050, 28, percentage, titleFace);

        // Progress numbers
        ctx.fillStyle = THEME.sub;
        ctx.font = `400 16px ${textFace}, Arial`;
        ctx.fillText(`${quest.progress.toLocaleString('fr-FR')} / ${quest.goal.toLocaleString('fr-FR')}`, 65, y + 82);
      } else {
        // For non-numeric quests, show the goal text
        ctx.fillStyle = THEME.accent;
        ctx.font = `600 20px ${titleFace}, Arial`;
        ctx.fillText(`Objectif: ${quest.goal}`, 60, y + 55);
      }
    });
  }

  return canvas.toBuffer('image/png');
}

// Render achievements view (completed quests with rarity colors)
async function renderAchievementsCard({ achievements }) {
  const { bg } = await loadAssets();
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  ctx.drawImage(bg, 0, 0, W, H);
  ctx.fillStyle = THEME.overlay; ctx.fillRect(0, 0, W, H);

  const titleFace = 'InterBold';
  const textFace = 'Inter';

  // Title panel
  panel(ctx, 24, 24, W - 48, 100, 36, THEME.header);
  ctx.textAlign = 'center';
  ctx.fillStyle = THEME.text;
  ctx.font = `700 48px ${titleFace}, Arial`;
  ctx.fillText('🏆 Succès Débloqués', W / 2, 86);
  ctx.textAlign = 'left';

  // Achievements panel
  panel(ctx, 24, 140, W - 48, H - 164, 36, THEME.panel);

  const startY = 200;
  const lineHeight = 65;
  const maxAchievements = 8;

  if (achievements.length === 0) {
    ctx.fillStyle = THEME.sub;
    ctx.font = `400 32px ${textFace}, Arial`;
    ctx.textAlign = 'center';
    ctx.fillText('Aucun succès débloqué', W / 2, 350);
    ctx.fillText('Complète des quêtes pour gagner des succès !', W / 2, 400);
    ctx.textAlign = 'left';
  } else {
    achievements.slice(0, maxAchievements).forEach((achievement, i) => {
      const y = startY + (i * lineHeight);

      // Get rarity color
      const rarityKey = achievement.rarity?.toLowerCase() || 'commun';
      const rarityColor = THEME[rarityKey] || THEME.commun;

      // Achievement name with rarity color
      ctx.fillStyle = rarityColor;
      ctx.font = `700 24px ${titleFace}, Arial`;
      const achievementName = truncateText(ctx, achievement.name, 1000);
      ctx.fillText(`⭐ ${achievementName}`, 60, y);

      // Description
      ctx.fillStyle = THEME.sub;
      ctx.font = `400 19px ${textFace}, Arial`;
      const description = truncateText(ctx, achievement.description, 1050);
      ctx.fillText(description, 90, y + 28);
    });
  }

  return canvas.toBuffer('image/png');
}

module.exports = { renderProfileCard, renderQuestsCard, renderAchievementsCard };
