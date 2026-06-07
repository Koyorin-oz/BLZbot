const { createCanvas, loadImage, registerFont } = require('canvas');
const fs = require('node:fs');
const path = require('node:path');
const { diffUntil } = require('./countdown-parse');

const W = 680;
const H = 312;

const THEME = {
    overlay: 'rgba(12, 8, 10, 0.5)',
    boxFill: 'rgba(0, 0, 0, 0.48)',
    boxStroke: 'rgba(255, 255, 255, 0.14)',
    text: '#ffffff',
    sub: 'rgba(242, 215, 211, 0.92)',
    accent: '#ffd166',
    gold: '#FFD700',
    timer: '#fca5a5',
};

try {
    const assetsPath = path.join(__dirname, '..', 'assets');
    if (fs.existsSync(path.join(assetsPath, 'Inter-Bold.ttf'))) {
        registerFont(path.join(assetsPath, 'Inter-Bold.ttf'), { family: 'InterBold' });
    }
    if (fs.existsSync(path.join(assetsPath, 'Inter-Regular.ttf'))) {
        registerFont(path.join(assetsPath, 'Inter-Regular.ttf'), { family: 'Inter' });
    }
} catch {
    /* polices système */
}

const titleFace = 'InterBold';
const textFace = 'Inter';

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

function drawFallbackGradient(ctx) {
    const g = ctx.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, '#2a1214');
    g.addColorStop(0.45, '#4a1e24');
    g.addColorStop(1, '#1a0a0c');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
}

async function loadBgImage() {
    const p = path.join(__dirname, '..', 'assets', 'blz_bg.png');
    if (!fs.existsSync(p)) return null;
    try {
        return await loadImage(fs.readFileSync(p));
    } catch {
        return null;
    }
}

function drawBlurredBackground(ctx, bg) {
    const pad = 28;
    const tmp = createCanvas(W + pad * 2, H + pad * 2);
    const tctx = tmp.getContext('2d');
    drawImageCover(tctx, bg, 0, 0, W + pad * 2, H + pad * 2);

    ctx.save();
    rr(ctx, 0, 0, W, H, 14);
    ctx.clip();
    ctx.filter = 'blur(10px)';
    ctx.drawImage(tmp, -pad, -pad, W + pad * 2, H + pad * 2);
    ctx.filter = 'none';
    ctx.restore();
}

function drawLargeCenteredText(ctx, text, cx, cy, maxWidth, fillStyle, startSize = 64) {
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    let size = startSize;
    ctx.font = `800 ${size}px ${titleFace}, Arial`;
    const padW = 24;
    while (size >= 28 && ctx.measureText(text).width > maxWidth - padW) {
        size -= 2;
        ctx.font = `800 ${size}px ${titleFace}, Arial`;
    }

    ctx.fillStyle = fillStyle;
    ctx.fillText(text, cx, cy);
    ctx.restore();
    return size;
}

function countdownMainLine(days, hours, minutes, past) {
    if (past) return "C'EST L'HEURE";
    if (days >= 1) return String(days);
    if (hours > 0) return `${hours}h ${String(minutes).padStart(2, '0')}m`;
    return `${minutes} min`;
}

function countdownSubLine(days, hours, minutes, past) {
    if (past) return 'Le compte à rebours est terminé';
    if (days >= 1) return days > 1 ? 'JOURS RESTANTS' : 'JOUR RESTANT';
    return 'AVANT LA RÉOUVERTURE';
}

/**
 * Carte compte à rebours — même base visuelle que /daily (blz_bg flouté + boîtes).
 * @param {{ targetMs: number }} opts
 * @returns {Promise<Buffer>}
 */
async function buildCountdownCard(opts) {
    const { days, hours, minutes, past } = diffUntil(opts.targetMs);

    const canvas = createCanvas(W, H);
    const ctx = canvas.getContext('2d');
    const bg = await loadBgImage();

    ctx.save();
    rr(ctx, 0, 0, W, H, 14);
    ctx.clip();
    if (bg) {
        drawBlurredBackground(ctx, bg);
    } else {
        drawFallbackGradient(ctx);
    }
    ctx.restore();

    rr(ctx, 0, 0, W, H, 14);
    ctx.fillStyle = THEME.overlay;
    ctx.fill();

    const pad = 12;
    const gap = 8;
    const innerW = W - pad * 2;
    const footerH = 24;
    const contentH = H - pad * 2 - footerH - gap;

    let y = pad;
    drawBox(ctx, pad, y, innerW, contentH, 10);

    const boxMidX = W / 2;
    const mainText = countdownMainLine(days, hours, minutes, past);
    const subText = countdownSubLine(days, hours, minutes, past);
    const mainColor = past ? THEME.gold : days >= 1 ? THEME.gold : THEME.timer;
    const mainSize = days >= 1 && !past ? 96 : 64;

    const centerY = y + contentH * 0.42;
    const usedSize = drawLargeCenteredText(
        ctx,
        mainText,
        boxMidX,
        centerY,
        innerW - 28,
        mainColor,
        mainSize,
    );

    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.font = `600 13px ${titleFace}, Arial`;
    ctx.fillStyle = THEME.sub;
    ctx.fillText('IL RESTE', boxMidX, y + 22);

    ctx.font = `600 12px ${textFace}, Arial`;
    ctx.fillStyle = THEME.sub;
    ctx.fillText(subText, boxMidX, centerY + usedSize * 0.52 + 10);

    if (!past && days >= 1 && days < 7) {
        ctx.font = `500 11px ${textFace}, Arial`;
        ctx.fillStyle = 'rgba(255,255,255,0.55)';
        ctx.fillText(`soit ${hours}h ${minutes}min de plus`, boxMidX, centerY + usedSize * 0.52 + 28);
    }

    ctx.textAlign = 'left';

    const footY = H - pad - footerH;
    drawBox(ctx, pad, footY, innerW, footerH, 8);
    ctx.textBaseline = 'middle';
    ctx.font = `500 10px ${textFace}, Arial`;
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.textAlign = 'right';
    ctx.fillText('BLZbot · compte à rebours', pad + innerW - 10, footY + footerH / 2);
    ctx.textAlign = 'left';

    return canvas.toBuffer('image/png');
}

module.exports = { buildCountdownCard };
