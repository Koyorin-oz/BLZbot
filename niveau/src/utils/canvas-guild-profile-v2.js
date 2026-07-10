const { createCanvas, loadImage, registerFont } = require('canvas');
const fs = require('node:fs');
const path = require('node:path');

// Font registration
const registeredFonts = { Inter: false, InterBold: false, GuildEmoji: false, NotoSymbols: false };
try {
  const assetsPath = path.join(__dirname, '..', 'assets');
  if (fs.existsSync(path.join(assetsPath, 'Inter-Bold.ttf'))) {
      registerFont(path.join(assetsPath, 'Inter-Bold.ttf'), { family: 'InterBold' });
      registeredFonts.InterBold = true;
  }
  if (fs.existsSync(path.join(assetsPath, 'Inter-Regular.ttf'))) {
      registerFont(path.join(assetsPath, 'Inter-Regular.ttf'), { family: 'Inter' });
      registeredFonts.Inter = true;
  }
  const fontsPath = path.join(__dirname, '..', 'assets', 'fonts');
  if (fs.existsSync(path.join(fontsPath, 'emojis.ttf'))) {
      registerFont(path.join(fontsPath, 'emojis.ttf'), { family: 'GuildEmoji' });
      registeredFonts.GuildEmoji = true;
  }
  if (fs.existsSync(path.join(fontsPath, 'NotoSansSymbols2-Regular.ttf'))) {
      registerFont(path.join(fontsPath, 'NotoSansSymbols2-Regular.ttf'), { family: 'NotoSymbols' });
      registeredFonts.NotoSymbols = true;
  }
  
  // Log des fonts manquantes pour debug
  const missing = Object.entries(registeredFonts).filter(([_, loaded]) => !loaded).map(([name]) => name);
  if (missing.length > 0 && process.env.BLZ_COMPACT_LOG !== '1') {
      console.warn(`⚠️ Fonts manquantes pour le rendu de guilde: ${missing.join(', ')}`);
  }
} catch(e) {
    console.error("❌ Erreur lors de l'enregistrement des fonts:", e)
}

const W = 1200, H = 800;
const THEME = {
  overlay: 'rgba(0,0,0,0.40)',
  panel: 'rgba(0,0,0,0.62)',
  header: 'rgba(0,0,0,0.58)',
  text: '#ffffff',
  sub: '#f2d7d3',
  accent: '#ffd166',
  outline: 'rgba(255,255,255,0.43)',
  gold: '#FFD700',
  silver: '#C0C0C0',
  bronze: '#CD7F32'
};

function rr(ctx, x, y, w, h, r){
  const R = Math.min(r, w/2, h/2);
  ctx.beginPath();
  ctx.moveTo(x+R, y);
  ctx.arcTo(x+w, y, x+w, y+h, R);
  ctx.arcTo(x+w, y+h, x, y+h, R);
  ctx.arcTo(x, y+h, x, y, R);
  ctx.arcTo(x, y, x+w, y, R);
  ctx.closePath();
}

function panel(ctx, x,y,w,h,r, fill=THEME.panel){
  rr(ctx,x,y,w,h,r);
  ctx.fillStyle = fill; ctx.fill();
  ctx.strokeStyle = THEME.outline; ctx.lineWidth = 3; ctx.stroke();
}

function truncateText(ctx, text, maxWidth) {
    let width = ctx.measureText(text).width;
    if (width <= maxWidth) return text;
    const ellipsis = '...';
    const ellipsisWidth = ctx.measureText(ellipsis).width;
    while (width > maxWidth - ellipsisWidth && text.length > 0) {
        text = text.substring(0, text.length - 1);
        width = ctx.measureText(text).width;
    }
    return text + ellipsis;
}

async function loadBackgroundAsset(){
  const assetsPath = path.join(__dirname, '..', 'assets');
  const bgBuffer = fs.readFileSync(path.join(assetsPath, 'blz_bg.png'));
  return await loadImage(bgBuffer);
}

/**
 * Nouveau canvas de profil de guilde V5
 * @param {Object} guild - Données de la guilde
 * @param {Array} members - Liste des 10 premiers membres (avec username, level)
 * @param {Object} owner - Chef de guilde
 * @param {Object} warInfo - Infos guerre (status, opponent, timeRemaining)
 * @param {Number} totalMembers - Nombre total de membres
 */
async function renderGuildProfileV2({ guild, members, owner, warInfo, totalMembers }){
  const bg = await loadBackgroundAsset();
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  ctx.drawImage(bg, 0, 0, W, H);
  ctx.fillStyle = THEME.overlay; ctx.fillRect(0, 0, W, H);

  const titleFace = 'InterBold';
  const textFace = 'Inter';

  // ============================================
  // TOP LEFT: Nom de guilde + Emoji
  // ============================================
  panel(ctx, 24, 24, 400, 100, 24, THEME.header);
  
  // Utiliser une font avec meilleur support emoji (Noto + Segoe + fallback)
  const emojiFont = `48px GuildEmoji, "Noto Color Emoji", "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", sans-serif`;
  const nameFont = `700 38px ${titleFace}, Arial`;
  
  ctx.font = emojiFont;
  ctx.fillStyle = THEME.text;
  
  // Nettoyer l'emoji (supprimer les emojis Discord custom qui ne s'affichent pas)
  let displayEmoji = guild.emoji || '🏰';
  if (displayEmoji.includes('<:') || displayEmoji.includes('<a:')) {
    displayEmoji = '🏰'; // Fallback si emoji custom Discord
  }
  ctx.fillText(displayEmoji, 50, 82);
  
  ctx.font = nameFont;
  const guildNameTrunc = truncateText(ctx, guild.name, 280);
  ctx.fillText(guildNameTrunc, 120, 78);

  // ============================================
  // TOP CENTER: Valeur + Upgrade (ou stats REBORN)
  // ============================================
  panel(ctx, 444, 24, 330, 100, 24, THEME.header);
  
  ctx.font = `700 28px ${titleFace}`;
  ctx.fillStyle = THEME.accent;
  if (guild.reborn_mode) {
    const gxpN = Number(guild.reborn_gxp || guild.total_value || 0);
    const gxpDisp =
      gxpN >= 1_000_000
        ? `${(gxpN / 1_000_000).toFixed(1)}M`
        : gxpN >= 1000
          ? `${(gxpN / 1000).toFixed(1)}K`
          : gxpN.toLocaleString('fr-FR');
    ctx.fillText(`⚡ ${gxpDisp} GXP`, 470, 65);
    ctx.font = `600 20px ${textFace}`;
    ctx.fillStyle = THEME.sub;
    const gradeLine = guild.reborn_grade_line || `Niveau guilde ${guild.level || 1}`;
    ctx.fillText(truncateText(ctx, gradeLine, 300), 470, 100);
  } else {
    const guildValueDisplay = (guild.total_value || 0) >= 1000000 
      ? `${((guild.total_value || 0) / 1000000).toFixed(1)}M` 
      : (guild.total_value || 0) >= 1000 
        ? `${((guild.total_value || 0) / 1000).toFixed(1)}K` 
        : (guild.total_value || 0).toLocaleString('fr-FR');
    ctx.fillText(`💎 ${guildValueDisplay} valeur`, 470, 65);
    
    ctx.font = `600 22px ${textFace}`;
    ctx.fillStyle = THEME.sub;
    const upgradeName = guild.upgrade_level === 10 ? 'Upgrade X' : `Upgrade ${guild.upgrade_level}`;
    ctx.fillText(upgradeName, 470, 100);
  }

  // ============================================
  // LEFT: Liste des Membres (10 premiers)
  // ============================================
  panel(ctx, 24, 144, 400, 630, 24);
  
  ctx.font = `700 24px ${titleFace}`;
  ctx.fillStyle = THEME.accent;
  ctx.fillText(`👥 Membres (${totalMembers}/${guild.member_slots})`, 50, 185);
  
  ctx.font = `16px ${textFace}`;
  ctx.fillStyle = THEME.text;
  
  const startY = 220;
  const lineHeight = 55;
  
  for (let i = 0; i < Math.min(10, members.length); i++) {
    const member = members[i];
    const yPos = startY + (i * lineHeight);
    
    // Icône de rang
    let icon = '👤';
    if (member.user_id === guild.owner_id) {
      icon = '👑';
      ctx.fillStyle = THEME.gold;
    } else if (guild.sub_chiefs && guild.sub_chiefs.includes(member.user_id)) {
      icon = '⚔️';
      ctx.fillStyle = THEME.silver;
    } else {
      ctx.fillStyle = THEME.text;
    }
    
    ctx.fillText(icon, 50, yPos);
    
    // Nom du membre
    ctx.font = `600 16px ${textFace}`;
    const memberName = truncateText(ctx, member.username, 250);
    ctx.fillText(memberName, 85, yPos);
    
    // Valeur (legacy) ou niveau joueur (REBORN)
    ctx.font = `400 14px ${textFace}`;
    ctx.fillStyle = THEME.sub;
    if (guild.reborn_mode) {
      ctx.fillText(`Nv ${member.level || 1}`, 340, yPos);
    } else {
      const mValue = member.total_value || 0;
      const valueStr = mValue >= 1000000 
        ? `${(mValue / 1000000).toFixed(1)}M` 
        : mValue >= 1000 
          ? `${(mValue / 1000).toFixed(1)}K` 
          : mValue.toLocaleString('fr-FR');
      ctx.fillText(`💎 ${valueStr}`, 340, yPos);
    }
    
    ctx.fillStyle = THEME.text;
  }
  
  // Indication si plus de 10 membres
  if (totalMembers > 10) {
    ctx.font = `italic 14px ${textFace}`;
    ctx.fillStyle = THEME.sub;
    ctx.fillText(`... et ${totalMembers - 10} autres membres`, 50, startY + (10 * lineHeight) + 10);
  }

  // ============================================
  // RIGHT TOP: Trésorerie & Info
  // ============================================
  panel(ctx, 444, 144, 730, 200, 24);
  
  ctx.font = `700 24px ${titleFace}`;
  ctx.fillStyle = THEME.accent;
  ctx.fillText('💰 Trésorerie', 470, 185);
  
  // Vérifier si la trésorerie est débloquée (Upgrade 2+ ou mode REBORN)
  if (!guild.reborn_mode && guild.upgrade_level < 2) {
    ctx.font = `600 24px ${titleFace}`;
    ctx.fillStyle = '#888888';
    ctx.fillText('🔒 Verrouillé', 470, 225);
    
    ctx.font = `400 18px ${textFace}`;
    ctx.fillStyle = THEME.sub;
    ctx.fillText('Déblocage à l\'Upgrade 2', 470, 260);
  } else {
    ctx.font = `600 28px ${titleFace}`;
    ctx.fillStyle = THEME.text;
    const treasuryText = `${guild.treasury.toLocaleString('fr-FR')} / ${guild.treasury_capacity.toLocaleString('fr-FR')}`;
    ctx.fillText(treasuryText, 470, 225);
    
    ctx.font = `400 16px ${textFace}`;
    ctx.fillStyle = THEME.sub;
    ctx.fillText(`⭐ Starss`, 470, 250);
    
    // Revenu passif
    ctx.font = `400 16px ${textFace}`;
    ctx.fillStyle = THEME.sub;
    const dailyIncome = guild.level * 100 * (guild.treasury_multiplier_purchased || 1);
    ctx.fillText(`📈 Revenu: ${dailyIncome.toLocaleString('fr-FR')} starss/jour`, 470, 285);
    
    // Total généré
    ctx.fillText(`📊 Total généré: ${(guild.total_treasury_generated || 0).toLocaleString('fr-FR')} ⭐`, 470, 315);
  }

  // ============================================
  // RIGHT MIDDLE: Statistiques de Guerre
  // ============================================
  panel(ctx, 444, 364, 730, 180, 24);
  
  ctx.font = `700 24px ${titleFace}`;
  ctx.fillStyle = THEME.accent;
  ctx.fillText('⚔️ Guerres', 470, 405);
  
  // Vérifier si les guerres sont débloquées (Upgrade 6+ ou mode REBORN simplifié)
  if (guild.reborn_mode) {
    ctx.font = `400 18px ${textFace}`;
    ctx.fillStyle = THEME.text;
    ctx.fillText('🛡️ Guilde joueur REBORN', 470, 440);
    ctx.fillStyle = THEME.sub;
    ctx.fillText('Guerres legacy : non liées à ce profil', 470, 475);
    ctx.fillText(`Focus / grades / trésorerie : actifs`, 470, 505);
  } else if (guild.upgrade_level < 6) {
    ctx.font = `600 24px ${titleFace}`;
    ctx.fillStyle = '#888888';
    ctx.fillText('🔒 Verrouillé', 470, 450);
    
    ctx.font = `400 18px ${textFace}`;
    ctx.fillStyle = THEME.sub;
    ctx.fillText('Déblocage à l\'Upgrade 6', 470, 485);
  } else {
    ctx.font = `400 18px ${textFace}`;
    ctx.fillStyle = THEME.text;
    
    ctx.fillText(`🏆 Victoires: ${guild.wars_won || 0}`, 470, 440);
    ctx.fillText(`🔥 Victoires 70%+: ${guild.wars_won_70 || 0}`, 470, 470);
    ctx.fillText(`⚡ Victoires 80%+: ${guild.wars_won_80 || 0}`, 720, 470);
    ctx.fillText(`💎 Victoires 90%+: ${guild.wars_won_90 || 0}`, 970, 470);
    
    // Status guerre actuelle
    if (warInfo && warInfo.status === 'ongoing') {
      ctx.font = `600 16px ${textFace}`;
      ctx.fillStyle = '#ff4444';
      ctx.fillText(`⚔️ EN GUERRE contre ${warInfo.opponent}`, 470, 510);
      
      ctx.font = `400 14px ${textFace}`;
      ctx.fillStyle = THEME.sub;
      const hoursLeft = Math.ceil(warInfo.timeRemaining / (1000 * 60 * 60));
      ctx.fillText(`Temps restant: ${hoursLeft}h`, 470, 535);
    } else {
      ctx.font = `400 16px ${textFace}`;
      ctx.fillStyle = THEME.sub;
      ctx.fillText('🕊️ Aucune guerre en cours', 470, 510);
    }
  }

  // ============================================
  // RIGHT BOTTOM: Informations Diverses
  // ============================================
  panel(ctx, 444, 564, 730, 210, 24);
  
  ctx.font = `700 24px ${titleFace}`;
  ctx.fillStyle = THEME.accent;
  ctx.fillText('📊 Informations', 470, 605);
  
  ctx.font = `400 16px ${textFace}`;
  ctx.fillStyle = THEME.text;
  
  // Capacité membres
  const slotsPercent = Math.round((totalMembers / guild.member_slots) * 100);
  ctx.fillText(`👥 Places: ${totalMembers}/${guild.member_slots} (${slotsPercent}%)`, 470, 640);
  
  // Joker utilisés
  const jokersUsed = guild.joker_guilde_uses || 0;
  ctx.fillText(`🃏 Jokers utilisés: ${jokersUsed}/3`, 470, 670);
  
  // Salon privé
  if (guild.channel_id) {
    ctx.fillText(`💬 Salon privé: Actif`, 470, 700);
  } else if (guild.reborn_mode) {
    ctx.fillStyle = THEME.sub;
    const salonHint = guild.reborn_salon_hint || 'Non débloqué (grade Or)';
    ctx.fillText(`💬 Salon: ${salonHint}`, 470, 700);
  } else {
    ctx.fillStyle = THEME.sub;
    ctx.fillText(`💬 Salon privé: Non débloqué (U5)`, 470, 700);
  }
  
  // Chef de guilde
  ctx.fillStyle = THEME.text;
  ctx.fillText(`👑 Chef: ${owner.username}`, 780, 640);
  
  // Sous-chefs
  const subChiefsCount = (guild.sub_chiefs || []).length;
  ctx.fillText(`⚔️ Sous-chefs: ${subChiefsCount}`, 780, 670);
  
  // Date de création
  if (guild.created_at) {
    const createdDate = new Date(guild.created_at).toLocaleDateString('fr-FR');
    ctx.fillStyle = THEME.sub;
    ctx.fillText(`📅 Créée le ${createdDate}`, 780, 700);
  }

  // Ligne optionnelle (ex. sandbox REBORN : grade, GXP guilde, anti-séparation…)
  if (guild.reborn_extras) {
    ctx.font = `600 14px ${textFace}`;
    ctx.fillStyle = '#7bed9f';
    ctx.textAlign = 'left';
    ctx.fillText(truncateText(ctx, String(guild.reborn_extras), 680), 470, 752);
  }

  // Footer - Note pour boutons
  ctx.font = `italic 14px ${textFace}`;
  ctx.fillStyle = THEME.sub;
  ctx.textAlign = 'center';
  const footerTip =
    guild.reborn_footer ||
    '💡 Boutons : liste complète des membres · page Stats pour la progression';
  ctx.fillText(truncateText(ctx, footerTip, 1100), W / 2, H - 20);
  ctx.textAlign = 'left';

  return canvas.toBuffer('image/png');
}

/**
 * Page 2 — progression REBORN (ex-embed « Carrières » + `/guilde info`).
 * @param {Object} opts
 * @param {Object} opts.guild - Même objet que page 1 (reborn_mode)
 * @param {Object} opts.owner - Chef { username }
 * @param {Object} opts.stats - Détails progression
 * @param {number} opts.totalMembers
 */
async function renderGuildProfileV2Stats({ guild, owner, stats, totalMembers }) {
  const bg = await loadBackgroundAsset();
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  ctx.drawImage(bg, 0, 0, W, H);
  ctx.fillStyle = THEME.overlay;
  ctx.fillRect(0, 0, W, H);

  const titleFace = 'InterBold';
  const textFace = 'Inter';

  panel(ctx, 24, 24, 1152, 88, 24, THEME.header);
  ctx.font = `700 34px ${titleFace}`;
  ctx.fillStyle = THEME.accent;
  ctx.fillText('📊 Progression & fiche', 48, 62);
  ctx.font = `600 20px ${textFace}`;
  ctx.fillStyle = THEME.sub;
  const sub = truncateText(ctx, `${guild.name} · ${stats.guildId || guild.id}`, 900);
  ctx.fillText(sub, 48, 92);

  panel(ctx, 24, 128, 560, 300, 24);
  ctx.font = `700 24px ${titleFace}`;
  ctx.fillStyle = THEME.accent;
  ctx.fillText('⚡ Économie guilde', 48, 168);
  ctx.font = `400 17px ${textFace}`;
  ctx.fillStyle = THEME.text;
  const linesLeft = [
    `GXP (guilde) : ${stats.gxpFormatted}`,
    `Trésorerie : ${stats.treasuryFormatted} starss`,
    `Niveau guilde : ${stats.guildLevel}`,
    `Grade : ${stats.gradeLabel}${stats.nextGradeLabel ? ` → ${stats.nextGradeLabel}` : ''}`,
    `Membres : ${totalMembers} / ${stats.memberCap}`,
    `Chef : ${owner?.username || '—'}`,
    `GRP chef (serveur) : ${stats.leaderGrpRank || '—'}`,
  ];
  let y = 200;
  for (const line of linesLeft) {
    ctx.fillText(truncateText(ctx, line, 500), 48, y);
    y += 32;
  }

  panel(ctx, 604, 128, 572, 300, 24);
  ctx.font = `700 24px ${titleFace}`;
  ctx.fillStyle = THEME.accent;
  ctx.fillText('🛡️ Protection & salon', 628, 168);
  ctx.font = `400 17px ${textFace}`;
  ctx.fillStyle = THEME.text;
  y = 200;
  const linesRight = [
    `Anti-séparation : ${stats.sepProtected ? 'oui' : 'non'}`,
    stats.sepReason ? `↳ ${stats.sepReason}` : null,
    `Salon privé : ${stats.salonLabel}`,
    `Dernier focus : ${stats.lastFocusLabel}`,
    `ID guilde : ${stats.guildId || guild.id}`,
  ].filter(Boolean);
  for (const line of linesRight) {
    ctx.fillStyle = line.startsWith('↳') ? THEME.sub : THEME.text;
    ctx.fillText(truncateText(ctx, line, 520), 628, y);
    y += 32;
  }

  panel(ctx, 24, 448, 1152, 200, 24);
  ctx.font = `700 24px ${titleFace}`;
  ctx.fillStyle = THEME.accent;
  ctx.fillText('📝 Description', 48, 488);
  ctx.font = `400 17px ${textFace}`;
  ctx.fillStyle = THEME.text;
  const desc = stats.description || 'Aucune description.';
  const descLines = wrapCanvasLines(ctx, desc, 1080, 3);
  y = 520;
  for (const line of descLines) {
    ctx.fillText(line, 48, y);
    y += 28;
  }

  if (stats.rolesLines?.length) {
    panel(ctx, 24, 668, 1152, 108, 24);
    ctx.font = `700 22px ${titleFace}`;
    ctx.fillStyle = THEME.accent;
    ctx.fillText('🎭 Rôles internes', 48, 702);
    ctx.font = `400 16px ${textFace}`;
    ctx.fillStyle = THEME.sub;
    const rolesPreview = stats.rolesLines.slice(0, 3).join('  ·  ');
    ctx.fillText(truncateText(ctx, rolesPreview, 1080), 48, 738);
    if (stats.rolesLines.length > 3) {
      ctx.fillText(`+ ${stats.rolesLines.length - 3} autre(s) — /guilde perm_voir`, 48, 762);
    }
  }

  ctx.font = `italic 14px ${textFace}`;
  ctx.fillStyle = THEME.sub;
  ctx.textAlign = 'center';
  ctx.fillText('◀ Profil pour revenir à la vue membres · Quêtes perso : /quetes', W / 2, H - 20);
  ctx.textAlign = 'left';

  return canvas.toBuffer('image/png');
}

/** Découpe un texte en lignes pour le canvas (max lignes). */
function wrapCanvasLines(ctx, text, maxWidth, maxLines = 4) {
  const words = String(text).replace(/\s+/g, ' ').trim().split(' ');
  const lines = [];
  let cur = '';
  for (const w of words) {
    const test = cur ? `${cur} ${w}` : w;
    if (ctx.measureText(test).width > maxWidth && cur) {
      lines.push(cur);
      cur = w;
      if (lines.length >= maxLines) break;
    } else {
      cur = test;
    }
  }
  if (cur && lines.length < maxLines) lines.push(cur);
  if (lines.length === maxLines && words.length > lines.join(' ').split(' ').length) {
    lines[maxLines - 1] = truncateText(ctx, lines[maxLines - 1], maxWidth - 20) + '…';
  }
  return lines.length ? lines : ['—'];
}

module.exports = { renderGuildProfileV2, renderGuildProfileV2Stats };
