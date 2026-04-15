const { createCanvas, loadImage, registerFont } = require('canvas');
const fs = require('node:fs');
const path = require('node:path');

// Font registration
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
  if (fs.existsSync(path.join(fontsPath, 'NotoSansSymbols2-Regular.ttf'))) {
      registerFont(path.join(fontsPath, 'NotoSansSymbols2-Regular.ttf'), { family: 'NotoSymbols' });
  }
} catch(e) {
    console.error("Could not register fonts", e)
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
  
  const emojiFont = `48px GuildEmoji`;
  const nameFont = `700 38px ${titleFace}, Arial`;
  
  ctx.font = emojiFont;
  ctx.fillStyle = THEME.text;
  ctx.fillText(guild.emoji, 50, 82);
  
  ctx.font = nameFont;
  const guildNameTrunc = truncateText(ctx, guild.name, 280);
  ctx.fillText(guildNameTrunc, 120, 78);

  // ============================================
  // TOP CENTER: Valeur + Upgrade
  // ============================================
  panel(ctx, 444, 24, 330, 100, 24, THEME.header);
  
  ctx.font = `700 28px ${titleFace}`;
  ctx.fillStyle = THEME.accent;
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
    
    // Valeur
    ctx.font = `400 14px ${textFace}`;
    ctx.fillStyle = THEME.sub;
    const mValue = member.total_value || 0;
    const valueStr = mValue >= 1000000 
      ? `${(mValue / 1000000).toFixed(1)}M` 
      : mValue >= 1000 
        ? `${(mValue / 1000).toFixed(1)}K` 
        : mValue.toLocaleString('fr-FR');
        
    ctx.fillText(`💎 ${valueStr}`, 340, yPos);
    
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
  
  // Vérifier si la trésorerie est débloquée (Upgrade 2+)
  if (guild.upgrade_level < 2) {
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
  
  // Vérifier si les guerres sont débloquées (Upgrade 6+)
  if (guild.upgrade_level < 6) {
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

  // Footer - Note pour boutons
  ctx.font = `italic 14px ${textFace}`;
  ctx.fillStyle = THEME.sub;
  ctx.textAlign = 'center';
  ctx.fillText('💡 Utilisez les boutons ci-dessous pour voir la liste complète, les carrières ou les quêtes', W / 2, H - 20);
  ctx.textAlign = 'left';

  return canvas.toBuffer('image/png');
}

module.exports = { renderGuildProfileV2 };
