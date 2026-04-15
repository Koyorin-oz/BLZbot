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

const W = 680;
const H = 312;

/** Incrémente si tu veux vérifier visuellement que le bon fichier est déployé (texte en bas à droite). */
const DAILY_CARD_BUILD = 'v3';

const THEME = {
    overlay: 'rgba(12, 8, 10, 0.5)',
    boxFill: 'rgba(0, 0, 0, 0.48)',
    boxStroke: 'rgba(255, 255, 255, 0.14)',
    text: '#ffffff',
    sub: 'rgba(242, 215, 211, 0.92)',
    accent: '#ffd166',
    success: '#4ade80',
    error: '#ff6b6b',
    gold: '#FFD700',
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

/** Panneau type « boîte » — pas de contour jaune, lisible sur le fond */
function drawBox(ctx, x, y, w, h, r = 10) {
    rr(ctx, x, y, w, h, r);
    ctx.fillStyle = THEME.boxFill;
    ctx.fill();
    ctx.strokeStyle = THEME.boxStroke;
    ctx.lineWidth = 1;
    ctx.stroke();
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

    const pad = 12;
    const gap = 8;
    const rBox = 10;
    const titleFace = 'InterBold';
    const textFace = 'Inter';

    const hasXpBar =
        user && typeof user.xp === 'number' && typeof user.xp_needed === 'number';

    const headerH = 56;
    const xpBoxH = hasXpBar ? 26 : 0;
    const footerH = 24;

    let y = pad;
    const innerW = W - pad * 2;

    // —— Boîte en-tête (avatar + pseudo + Starss) ——
    drawBox(ctx, pad, y, innerW, headerH, rBox);

    let avImg = null;
    if (avatarURL) {
        try {
            avImg = await loadImage(avatarURL);
        } catch {
            /* ignore */
        }
    }

    const avS = 44;
    const avX = pad + 12;
    const avY = y + (headerH - avS) / 2;

    ctx.save();
    rr(ctx, avX, avY, avS, avS, avS / 2);
    ctx.clip();
    if (avImg) {
        ctx.drawImage(avImg, avX, avY, avS, avS);
    } else {
        ctx.fillStyle = THEME.accent;
        ctx.fillRect(avX, avY, avS, avS);
        ctx.font = '26px Arial';
        ctx.fillStyle = '#2a1214';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('👤', avX + avS / 2, avY + avS / 2);
    }
    ctx.restore();

    ctx.strokeStyle = 'rgba(255,255,255,0.28)';
    ctx.lineWidth = 1.25;
    ctx.beginPath();
    ctx.arc(avX + avS / 2, avY + avS / 2, avS / 2 + 0.5, 0, Math.PI * 2);
    ctx.stroke();

    const textX = avX + avS + 12;
    const textRight = pad + innerW - 12;

    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = THEME.text;
    ctx.font = `700 19px ${titleFace}, Arial`;
    ctx.fillText(truncateText(ctx, displayName, textRight - textX - 110), textX, y + headerH * 0.38);

    ctx.fillStyle = THEME.sub;
    ctx.font = `400 12px ${textFace}, Arial`;
    ctx.fillText(highestRoleName, textX, y + headerH * 0.68);

    if (user && typeof user.stars === 'number') {
        ctx.textAlign = 'right';
        ctx.fillStyle = THEME.text;
        ctx.font = `700 17px ${titleFace}, Arial`;
        ctx.fillText(`${user.stars.toLocaleString('fr-FR')} ⭐`, textRight, y + headerH / 2);
        ctx.textAlign = 'left';
    }

    y += headerH + gap;

    // —— Boîte barre XP ——
    if (hasXpBar) {
        drawBox(ctx, pad, y, innerW, xpBoxH, rBox);
        const barPadX = 10;
        const barPadY = 6;
        const barX = pad + barPadX;
        const barW = innerW - barPadX * 2;
        const barH = 14;
        const barY = y + (xpBoxH - barH) / 2;
        const ratio = Math.max(0, Math.min(1, user.xp / Math.max(1, user.xp_needed)));

        rr(ctx, barX, barY, barW, barH, barH / 2);
        ctx.fillStyle = 'rgba(255,255,255,0.14)';
        ctx.fill();
        if (ratio > 0) {
            const fillW = Math.max(barH, Math.round(barW * ratio));
            rr(ctx, barX, barY, fillW, barH, barH / 2);
            ctx.fillStyle = THEME.accent;
            ctx.fill();
        }
        ctx.fillStyle = THEME.text;
        ctx.font = `700 11px ${titleFace}, Arial`;
        ctx.textBaseline = 'middle';
        ctx.textAlign = 'left';
        ctx.fillText(`Niveau ${user.level ?? 1}`, barX + 8, barY + barH / 2);
        ctx.textAlign = 'center';
        const xpTxt = `${(user.xp ?? 0).toLocaleString('fr-FR')} / ${(user.xp_needed ?? 0).toLocaleString('fr-FR')}`;
        ctx.font = `600 10px ${textFace}, Arial`;
        ctx.fillText(xpTxt, barX + barW / 2, barY + barH / 2);
        ctx.textAlign = 'left';
        y += xpBoxH + gap;
    }

    // —— Boîte contenu principal (récompense ou cooldown), centrée verticalement ——
    const footerTop = H - pad - footerH;
    const contentH = footerTop - gap - y;
    drawBox(ctx, pad, y, innerW, contentH, rBox);

    const boxLeft = pad + 14;
    const boxRight = pad + innerW - 14;
    const boxMidX = (boxLeft + boxRight) / 2;
    const boxMidY = y + contentH / 2;

    if (isSuccess) {
        const rowY = boxMidY;
        ctx.textBaseline = 'middle';
        ctx.textAlign = 'left';
        ctx.font = '26px Arial';
        ctx.fillText(rewardEmoji, boxLeft, rowY);

        ctx.font = `700 17px ${titleFace}, Arial`;
        ctx.fillStyle = THEME.accent;
        const rewardTrunc = truncateText(ctx, rewardName, boxRight - boxLeft - 100);
        ctx.fillText(rewardTrunc, boxLeft + 40, rowY);

        if (rewardAmount !== null && rewardType !== 'item') {
            ctx.font = `600 15px ${titleFace}, Arial`;
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
            ctx.fillText(amountText, boxRight, rowY);
            ctx.textAlign = 'left';
        }

        ctx.font = `600 11px ${titleFace}, Arial`;
        ctx.fillStyle = THEME.success;
        ctx.textBaseline = 'alphabetic';
        ctx.fillText('Récompense journalière réclamée', boxLeft, y + contentH - 12);
    } else {
        const subFull = 'Temps restant avant la prochaine récompense (minuit)';
        ctx.textAlign = 'center';
        ctx.font = `700 24px ${titleFace}, Arial`;
        ctx.fillStyle = THEME.error;
        ctx.textBaseline = 'bottom';
        ctx.fillText(remainingTime, boxMidX, boxMidY - 4);

        ctx.font = `500 12px ${textFace}, Arial`;
        ctx.fillStyle = THEME.sub;
        ctx.textBaseline = 'top';
        const subLine = truncateText(ctx, subFull, innerW - 40);
        ctx.fillText(subLine, boxMidX, boxMidY + 6);

        ctx.textAlign = 'left';
    }

    // —— Pied de carte ——
    const footY = footerTop;
    drawBox(ctx, pad, footY, innerW, footerH, 8);
    ctx.textBaseline = 'middle';
    ctx.font = `500 10px ${textFace}, Arial`;
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    if (isSuccess) {
        ctx.textAlign = 'right';
        ctx.fillText(`BLZbot · ${DAILY_CARD_BUILD}`, boxRight, footY + footerH / 2);
    } else {
        ctx.textAlign = 'left';
        const hint =
            doubleDailyCount > 0
                ? `Double Daily : ${doubleDailyCount} — /inventaire`
                : 'Double Daily via quêtes et événements';
        ctx.fillText(truncateText(ctx, hint, innerW - 120), boxLeft, footY + footerH / 2);
        ctx.textAlign = 'right';
        ctx.fillText(`BLZbot · ${DAILY_CARD_BUILD}`, boxRight, footY + footerH / 2);
    }
    ctx.textAlign = 'left';

    return canvas.toBuffer('image/png');
}

module.exports = { renderDailyCard };
