const { createCanvas, loadImage, registerFont } = require('canvas');
const fs = require('node:fs');
const path = require('node:path');

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
} catch (e) {
    console.error('Could not register fonts', e);
}

const W = 1200;
const H = 800;

/** Thème BLZ : noir / bordeaux / or & jaune — contrasté (plus « lavé »). */
const THEME = {
    overlay: 'rgba(18, 4, 8, 0.58)',
    panel: 'rgba(6, 2, 4, 0.88)',
    panelEdge: 'rgba(12, 4, 6, 0.95)',
    header: 'rgba(32, 10, 16, 0.92)',
    text: '#fff8f0',
    sub: '#f0b8b0',
    accent: '#ffd166',
    accentHot: '#ffcc33',
    outline: 'rgba(255, 200, 80, 0.55)',
    outlineInner: 'rgba(255, 80, 80, 0.22)',
    gold: '#ffc928',
    silver: '#e8e0f0',
    bronze: '#e8a060',
    warRed: '#ff3b3b',
    locked: '#9ca3af',
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

function panelBlz(ctx, x, y, w, h, r, fill = THEME.panel) {
    rr(ctx, x, y, w, h, r);
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.strokeStyle = THEME.outline;
    ctx.lineWidth = 2.5;
    ctx.stroke();
    ctx.save();
    rr(ctx, x + 2, y + 2, w - 4, h - 4, Math.max(0, r - 2));
    ctx.strokeStyle = THEME.outlineInner;
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();
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

async function loadBackgroundAsset() {
    const p = path.join(__dirname, '..', 'assets', 'blz_bg.png');
    if (!fs.existsSync(p)) return null;
    try {
        return await loadImage(fs.readFileSync(p));
    } catch {
        return null;
    }
}

function drawFallbackGradient(ctx) {
    const g = ctx.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, '#140608');
    g.addColorStop(0.35, '#2a1018');
    g.addColorStop(0.7, '#1a080c');
    g.addColorStop(1, '#0a0305');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
}

/**
 * Profil guilde — mise en page en bandeau + colonne membres / colonne stats (thème rouge-noir-or).
 */
async function renderGuildProfileV2({ guild, members, owner, warInfo, totalMembers }) {
    const canvas = createCanvas(W, H);
    const ctx = canvas.getContext('2d');

    const bg = await loadBackgroundAsset();
    if (bg) {
        ctx.drawImage(bg, 0, 0, W, H);
    } else {
        drawFallbackGradient(ctx);
    }
    ctx.fillStyle = THEME.overlay;
    ctx.fillRect(0, 0, W, H);

    const titleFace = 'InterBold';
    const textFace = 'Inter';
    const pad = 22;
    const gap = 16;
    const topH = 118;
    const cardW = (W - pad * 2 - gap * 2) / 3;

    // —— Bandeau 3 blocs : identité | valeur | upgrade & chef ——
    const yTop = 20;
    panelBlz(ctx, pad, yTop, cardW, topH, 22, THEME.header);
    const emojiFont = `52px GuildEmoji`;
    ctx.font = emojiFont;
    ctx.fillStyle = THEME.gold;
    ctx.fillText(guild.emoji, pad + 22, yTop + 72);
    ctx.font = `800 34px ${titleFace}, Arial`;
    ctx.fillStyle = THEME.text;
    const nameTrunc = truncateText(ctx, guild.name, cardW - 100);
    ctx.fillText(nameTrunc, pad + 88, yTop + 68);

    const x2 = pad + cardW + gap;
    panelBlz(ctx, x2, yTop, cardW, topH, 22, THEME.header);
    ctx.font = `800 36px ${titleFace}, Arial`;
    ctx.fillStyle = THEME.accentHot;
    const guildValueDisplay =
        (guild.total_value || 0) >= 1000000
            ? `${((guild.total_value || 0) / 1000000).toFixed(1)}M`
            : (guild.total_value || 0) >= 1000
              ? `${((guild.total_value || 0) / 1000).toFixed(1)}K`
              : (guild.total_value || 0).toLocaleString('fr-FR');
    ctx.fillText(`💎 ${guildValueDisplay}`, x2 + 20, yTop + 58);
    ctx.font = `600 17px ${textFace}, Arial`;
    ctx.fillStyle = THEME.sub;
    ctx.fillText('Valeur totale de la guilde', x2 + 20, yTop + 94);

    const x3 = pad + (cardW + gap) * 2;
    panelBlz(ctx, x3, yTop, cardW, topH, 22, THEME.header);
    const upLabel = guild.upgrade_level === 10 ? 'Upgrade X' : `Upgrade ${guild.upgrade_level}`;
    ctx.font = `700 26px ${titleFace}, Arial`;
    ctx.fillStyle = THEME.accent;
    ctx.fillText(upLabel, x3 + 20, yTop + 52);
    ctx.font = `600 16px ${textFace}, Arial`;
    ctx.fillStyle = THEME.text;
    ctx.fillText(`👥 ${totalMembers} / ${guild.member_slots} membres`, x3 + 20, yTop + 86);
    ctx.font = `500 15px ${textFace}, Arial`;
    ctx.fillStyle = THEME.gold;
    const chefLine = truncateText(ctx, `👑 ${owner.username}`, cardW - 40);
    ctx.fillText(chefLine, x3 + 20, yTop + 112);

    const colLeftW = 430;
    const yMain = yTop + topH + gap;
    const mainH = H - yMain - 36;

    // —— Colonne membres ——
    panelBlz(ctx, pad, yMain, colLeftW, mainH, 22);
    ctx.font = `800 22px ${titleFace}, Arial`;
    ctx.fillStyle = THEME.accent;
    ctx.fillText(`Membres (${totalMembers}/${guild.member_slots})`, pad + 22, yMain + 36);

    const startY = yMain + 58;
    const lineHeight = 52;
    for (let i = 0; i < Math.min(10, members.length); i++) {
        const member = members[i];
        const yRow = startY + i * lineHeight;
        if (i % 2 === 0) {
            rr(ctx, pad + 12, yRow - 20, colLeftW - 24, lineHeight - 4, 10);
            ctx.fillStyle = 'rgba(255, 200, 80, 0.06)';
            ctx.fill();
        }
        let icon = '·';
        if (member.user_id === guild.owner_id) {
            icon = '👑';
            ctx.fillStyle = THEME.gold;
        } else if (guild.sub_chiefs && guild.sub_chiefs.includes(member.user_id)) {
            icon = '⚔️';
            ctx.fillStyle = THEME.silver;
        } else {
            ctx.fillStyle = THEME.text;
        }
        ctx.font = `22px ${textFace}, Arial`;
        ctx.fillText(icon, pad + 22, yRow);

        ctx.font = `700 16px ${textFace}, Arial`;
        ctx.fillStyle = THEME.text;
        const memberName = truncateText(ctx, member.username, 210);
        ctx.fillText(memberName, pad + 54, yRow);

        ctx.font = `600 14px ${textFace}, Arial`;
        ctx.fillStyle = THEME.accent;
        const mValue = member.total_value || 0;
        const valueStr =
            mValue >= 1000000
                ? `${(mValue / 1000000).toFixed(1)}M`
                : mValue >= 1000
                  ? `${(mValue / 1000).toFixed(1)}K`
                  : mValue.toLocaleString('fr-FR');
        ctx.fillText(`💎 ${valueStr}`, pad + colLeftW - 120, yRow);
    }
    if (totalMembers > 10) {
        ctx.font = `italic 14px ${textFace}, Arial`;
        ctx.fillStyle = THEME.sub;
        ctx.fillText(`… et ${totalMembers - 10} autres`, pad + 22, startY + 10 * lineHeight + 8);
    }

    // —— Colonne droite : trésorerie, guerres, infos ——
    const rx = pad + colLeftW + gap;
    const rw = W - rx - pad;
    const hTreasury = Math.round(mainH * 0.38);
    const hWar = Math.round(mainH * 0.34);
    const hInfo = mainH - hTreasury - hWar - gap * 2;

    let y = yMain;
    panelBlz(ctx, rx, y, rw, hTreasury, 20);
    ctx.font = `800 22px ${titleFace}, Arial`;
    ctx.fillStyle = THEME.accentHot;
    ctx.fillText('Trésorerie', rx + 20, y + 34);
    if (guild.upgrade_level < 2) {
        ctx.font = `700 22px ${titleFace}, Arial`;
        ctx.fillStyle = THEME.locked;
        ctx.fillText('🔒 Verrouillé', rx + 20, y + 72);
        ctx.font = `500 16px ${textFace}, Arial`;
        ctx.fillStyle = THEME.sub;
        ctx.fillText('Déblocage à l’Upgrade 2', rx + 20, y + 104);
    } else {
        ctx.font = `700 30px ${titleFace}, Arial`;
        ctx.fillStyle = THEME.text;
        ctx.fillText(
            `${guild.treasury.toLocaleString('fr-FR')} / ${guild.treasury_capacity.toLocaleString('fr-FR')}`,
            rx + 20,
            y + 70
        );
        ctx.font = `600 16px ${textFace}, Arial`;
        ctx.fillStyle = THEME.sub;
        ctx.fillText('⭐ Starss en réserve', rx + 20, y + 102);
        const dailyIncome = guild.level * 100 * (guild.treasury_multiplier_purchased || 1);
        ctx.fillText(`📈 Revenu : ${dailyIncome.toLocaleString('fr-FR')} / jour`, rx + 20, y + 128);
        ctx.fillText(`📊 Total généré : ${(guild.total_treasury_generated || 0).toLocaleString('fr-FR')} ⭐`, rx + 20, y + 154);
    }

    y += hTreasury + gap;
    panelBlz(ctx, rx, y, rw, hWar, 20);
    ctx.font = `800 22px ${titleFace}, Arial`;
    ctx.fillStyle = THEME.warRed;
    ctx.fillText('Guerres', rx + 20, y + 32);
    if (guild.upgrade_level < 6) {
        ctx.font = `700 20px ${titleFace}, Arial`;
        ctx.fillStyle = THEME.locked;
        ctx.fillText('🔒 Verrouillé', rx + 20, y + 68);
        ctx.font = `500 15px ${textFace}, Arial`;
        ctx.fillStyle = THEME.sub;
        ctx.fillText('Déblocage à l’Upgrade 6', rx + 20, y + 96);
    } else {
        ctx.font = `600 17px ${textFace}, Arial`;
        ctx.fillStyle = THEME.text;
        ctx.fillText(`🏆 Victoires : ${guild.wars_won || 0}`, rx + 20, y + 64);
        ctx.fillText(`🔥 70 %+ : ${guild.wars_won_70 || 0}   ⚡ 80 %+ : ${guild.wars_won_80 || 0}   💎 90 %+ : ${guild.wars_won_90 || 0}`, rx + 20, y + 92);
        if (warInfo && warInfo.status === 'ongoing') {
            ctx.font = `700 16px ${titleFace}, Arial`;
            ctx.fillStyle = THEME.warRed;
            ctx.fillText(`⚔️ EN GUERRE — ${warInfo.opponent}`, rx + 20, y + 124);
            ctx.font = `500 14px ${textFace}, Arial`;
            ctx.fillStyle = THEME.sub;
            const hoursLeft = Math.max(1, Math.ceil(warInfo.timeRemaining / (1000 * 60 * 60)));
            ctx.fillText(`Temps restant ≈ ${hoursLeft} h`, rx + 20, y + 148);
        } else {
            ctx.font = `600 15px ${textFace}, Arial`;
            ctx.fillStyle = '#86efac';
            ctx.fillText('🕊️ Aucune guerre en cours', rx + 20, y + 124);
        }
    }

    y += hWar + gap;
    panelBlz(ctx, rx, y, rw, hInfo, 20);
    ctx.font = `800 20px ${titleFace}, Arial`;
    ctx.fillStyle = THEME.accent;
    ctx.fillText('Informations', rx + 20, y + 30);
    ctx.font = `600 15px ${textFace}, Arial`;
    ctx.fillStyle = THEME.text;
    const slotsPercent = Math.min(100, Math.round((totalMembers / Math.max(1, guild.member_slots)) * 100));
    ctx.fillText(`👥 Remplissage : ${totalMembers}/${guild.member_slots} (${slotsPercent} %)`, rx + 20, y + 58);
    const jokersUsed = guild.joker_guilde_uses || 0;
    ctx.fillText(`🃏 Jokers : ${jokersUsed} / 3`, rx + 20, y + 82);
    if (guild.channel_id) {
        ctx.fillStyle = THEME.gold;
        ctx.fillText('💬 Salon privé : actif', rx + 20, y + 106);
    } else {
        ctx.fillStyle = THEME.sub;
        ctx.fillText('💬 Salon privé : Upgrade 5', rx + 20, y + 106);
    }
    const subChiefsCount = (guild.sub_chiefs || []).length;
    ctx.fillStyle = THEME.text;
    ctx.fillText(`⚔️ Sous-chefs : ${subChiefsCount}`, rx + 280, y + 58);
    if (guild.created_at) {
        const createdDate = new Date(guild.created_at).toLocaleDateString('fr-FR');
        ctx.fillStyle = THEME.sub;
        ctx.fillText(`📅 Fondée le ${createdDate}`, rx + 280, y + 82);
    }

    ctx.font = `italic 13px ${textFace}, Arial`;
    ctx.fillStyle = 'rgba(255, 200, 120, 0.75)';
    ctx.textAlign = 'center';
    ctx.fillText('BLZbot — profil guilde · boutons ci-dessous pour liste, carrières & quêtes', W / 2, H - 16);
    ctx.textAlign = 'left';

    return canvas.toBuffer('image/png');
}

module.exports = { renderGuildProfileV2 };
