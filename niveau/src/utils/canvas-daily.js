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
} catch (e) {
    console.error('Could not register fonts', e);
}

/** Carte plus étroite qu’une bannière — mieux lisible dans le fil Discord */
const W = 680;
const H = 300;

const THEME = {
    overlay: 'rgba(12, 8, 10, 0.55)',
    panel: 'rgba(0, 0, 0, 0.38)',
    text: '#ffffff',
    sub: 'rgba(242, 215, 211, 0.9)',
    accent: '#ffd166',
    outline: 'rgba(255, 255, 255, 0.3)',
    gold: '#FFD700',
    success: '#4ade80',
    error: '#ff6b6b',
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

function drawImageCover(ctx, img, dx, dy, dw, dh) {
    const sw = img.width;
    const sh = img.height;
    const scale = Math.max(dw / sw, dh / sh);
    const nw = sw * scale;
    const nh = sh * scale;
    const ox = dx + (dw - nw) / 2;
    const oy = dy + (dh - nh) / 2;
    ctx.drawImage(img, ox, oy, nw, nh);
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

async function loadBgImage() {
    const assetsPath = path.join(__dirname, '..', 'assets');
    const p = path.join(assetsPath, 'blz_bg.png');
    if (!fs.existsSync(p)) return null;
    try {
        return await loadImage(fs.readFileSync(p));
    } catch {
        return null;
    }
}

function drawFallbackGradient(ctx) {
    const g = ctx.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, '#2a1214');
    g.addColorStop(0.45, '#4a1e24');
    g.addColorStop(1, '#1a0a0c');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
}

function drawNeonBorder(ctx, x, y, w, h, r, color = '#ffd166') {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.shadowColor = color;
    ctx.shadowBlur = 10;
    rr(ctx, x, y, w, h, r);
    ctx.stroke();
    ctx.restore();
}

/**
 * @param {object | null} user — ligne `users` (stars, xp, xp_needed, level) pour l’en-tête
 */
async function renderDailyCard({
    user = null,
    username = 'Utilisateur',
    displayName = 'Utilisateur',
    highestRoleName = 'Membre',
    avatarURL = null,
    rewardName = '',
    rewardType = '',
    rewardAmount = null,
    rewardEmoji = '🎁',
    remainingTime = '',
    doubleDailyCount = 0,
    isSuccess = true,
}) {
    void username;
    const canvas = createCanvas(W, H);
    const ctx = canvas.getContext('2d');

    const bg = await loadBgImage();

    ctx.save();
    rr(ctx, 0, 0, W, H, 14);
    ctx.clip();
    if (bg) {
        drawImageCover(ctx, bg, 0, 0, W, H);
    } else {
        drawFallbackGradient(ctx);
    }
    ctx.restore();

    rr(ctx, 0, 0, W, H, 14);
    ctx.fillStyle = THEME.overlay;
    ctx.fill();

    const inset = 8;
    rr(ctx, inset, inset, W - inset * 2, H - inset * 2, 12);
    ctx.fillStyle = THEME.panel;
    ctx.fill();
    ctx.strokeStyle = THEME.outline;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    drawNeonBorder(ctx, inset, inset, W - inset * 2, H - inset * 2, 12);

    const titleFace = 'InterBold';
    const textFace = 'Inter';

    let avImg = null;
    if (avatarURL) {
        try {
            avImg = await loadImage(avatarURL);
        } catch {
            /* ignore */
        }
    }

    const avS = 50;
    const avX = 16;
    const avY = 24;

    ctx.save();
    rr(ctx, avX, avY, avS, avS, avS / 2);
    ctx.clip();
    if (avImg) {
        ctx.drawImage(avImg, avX, avY, avS, avS);
    } else {
        ctx.fillStyle = THEME.accent;
        ctx.fillRect(avX, avY, avS, avS);
        ctx.font = '30px Arial';
        ctx.fillStyle = '#2a1214';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('👤', avX + avS / 2, avY + avS / 2);
    }
    ctx.restore();

    ctx.strokeStyle = THEME.gold;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(avX + avS / 2, avY + avS / 2, avS / 2 + 1, 0, Math.PI * 2);
    ctx.stroke();

    const textX = avX + avS + 12;
    const textRight = W - 16;

    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillStyle = THEME.text;
    ctx.font = `700 20px ${titleFace}, Arial`;
    ctx.fillText(truncateText(ctx, displayName, textRight - textX - 120), textX, 26);
    ctx.fillStyle = THEME.sub;
    ctx.font = `400 12px ${textFace}, Arial`;
    ctx.fillText(highestRoleName, textX, 48);

    if (user && typeof user.stars === 'number') {
        ctx.textAlign = 'right';
        ctx.fillStyle = THEME.text;
        ctx.font = `700 18px ${titleFace}, Arial`;
        const starsText = `${user.stars.toLocaleString('fr-FR')} ⭐`;
        ctx.fillText(starsText, textRight, 30);
        ctx.textAlign = 'left';
    }

    const barY = 74;
    const barH = 16;
    const barX = textX;
    const barW = textRight - barX;

    if (user && typeof user.xp === 'number' && typeof user.xp_needed === 'number') {
        const ratio = Math.max(0, Math.min(1, user.xp / Math.max(1, user.xp_needed)));
        rr(ctx, barX, barY, barW, barH, barH / 2);
        ctx.fillStyle = 'rgba(255,255,255,0.18)';
        ctx.fill();
        if (ratio > 0) {
            const fillW = Math.max(barH, Math.round(barW * ratio));
            rr(ctx, barX, barY, fillW, barH, barH / 2);
            ctx.fillStyle = THEME.accent;
            ctx.fill();
        }
        ctx.fillStyle = THEME.text;
        ctx.font = `700 12px ${titleFace}, Arial`;
        ctx.textBaseline = 'middle';
        ctx.textAlign = 'left';
        ctx.fillText(`Niveau ${user.level ?? 1}`, barX + 10, barY + barH / 2);
        ctx.textAlign = 'center';
        const xpTxt = `${(user.xp ?? 0).toLocaleString('fr-FR')} / ${(user.xp_needed ?? 0).toLocaleString('fr-FR')}`;
        ctx.font = `600 11px ${textFace}, Arial`;
        ctx.fillText(xpTxt, barX + barW / 2, barY + barH / 2);
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
    }

    const contentTop = user && typeof user.xp === 'number' ? 98 : 78;

    if (isSuccess) {
        const rowY = contentTop + 18;
        ctx.font = '28px Arial';
        ctx.textBaseline = 'middle';
        ctx.fillText(rewardEmoji, textX + 12, rowY);

        ctx.font = `700 18px ${titleFace}, Arial`;
        ctx.fillStyle = THEME.accent;
        const rewardTrunc = truncateText(ctx, rewardName, textRight - textX - 130);
        ctx.fillText(rewardTrunc, textX + 48, rowY);

        if (rewardAmount !== null && rewardType !== 'item') {
            ctx.font = `600 16px ${titleFace}, Arial`;
            ctx.fillStyle = THEME.gold;
            let amountText = '';
            switch (rewardType) {
                case 'stars':
                    amountText = `+${rewardAmount.toLocaleString('fr-FR')} ⭐`;
                    break;
                case 'xp':
                    amountText = `+${rewardAmount.toLocaleString('fr-FR')} XP`;
                    break;
                case 'points':
                    amountText = `+${rewardAmount.toLocaleString('fr-FR')} RP`;
                    break;
            }
            ctx.textAlign = 'right';
            ctx.fillText(amountText, textRight, rowY);
            ctx.textAlign = 'left';
        }

        ctx.font = `600 12px ${titleFace}, Arial`;
        ctx.fillStyle = THEME.success;
        ctx.textBaseline = 'alphabetic';
        ctx.fillText('Récompense journalière réclamée', textX, H - 22);
    } else {
        ctx.textBaseline = 'middle';
        ctx.font = `700 30px ${titleFace}, Arial`;
        ctx.fillStyle = THEME.error;
        ctx.fillText(remainingTime, textX, contentTop + 28);

        ctx.font = `500 13px ${textFace}, Arial`;
        ctx.fillStyle = THEME.sub;
        ctx.fillText('Temps restant avant la prochaine récompense (minuit)', textX, contentTop + 58);

        ctx.textBaseline = 'alphabetic';
        if (doubleDailyCount > 0) {
            ctx.font = `600 11px ${titleFace}, Arial`;
            ctx.fillStyle = THEME.gold;
            ctx.fillText(`Double Daily en stock : ${doubleDailyCount} — /inventaire`, textX, H - 36);
        } else {
            ctx.font = `500 11px ${textFace}, Arial`;
            ctx.fillStyle = THEME.sub;
            ctx.fillText('Double Daily via quêtes et événements', textX, H - 36);
        }
    }

    ctx.font = `500 10px ${textFace}, Arial`;
    ctx.fillStyle = 'rgba(255,255,255,0.42)';
    ctx.textAlign = 'right';
    ctx.fillText('Daily — BLZbot', textRight, H - 18);
    ctx.textAlign = 'left';

    return canvas.toBuffer('image/png');
}

module.exports = { renderDailyCard };
