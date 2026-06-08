const { createCanvas, loadImage, registerFont } = require('canvas');
const fs = require('node:fs');
const path = require('node:path');
const { diffUntil } = require('./countdown-parse');

const W = 680;
const H = 312;
const CARD_BUILD = 'v2';

const THEME = {
    overlay: 'rgba(12, 8, 10, 0.52)',
    boxFill: 'rgba(0, 0, 0, 0.5)',
    boxStroke: 'rgba(255, 255, 255, 0.14)',
    boxStrokeAccent: 'rgba(255, 215, 0, 0.28)',
    text: '#ffffff',
    sub: 'rgba(242, 215, 211, 0.9)',
    accent: '#ffd166',
    gold: '#FFD700',
    goldSoft: 'rgba(255, 215, 0, 0.12)',
    timer: '#fca5a5',
    urgent: '#ff8a8a',
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

function drawBox(ctx, x, y, w, h, r = 10, accentTop = false) {
    rr(ctx, x, y, w, h, r);
    ctx.fillStyle = THEME.boxFill;
    ctx.fill();
    ctx.strokeStyle = THEME.boxStroke;
    ctx.lineWidth = 1;
    ctx.stroke();
    if (accentTop) {
        ctx.save();
        rr(ctx, x + 1, y + 1, w - 2, h - 2, Math.max(0, r - 1));
        ctx.clip();
        const g = ctx.createLinearGradient(x, y, x + w, y);
        g.addColorStop(0, 'rgba(255, 215, 0, 0)');
        g.addColorStop(0.35, 'rgba(255, 215, 0, 0.55)');
        g.addColorStop(0.65, 'rgba(255, 215, 0, 0.55)');
        g.addColorStop(1, 'rgba(255, 215, 0, 0)');
        ctx.fillStyle = g;
        ctx.fillRect(x, y, w, 3);
        ctx.restore();
    }
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

function truncateText(ctx, text, maxWidth) {
    if (!text) return '';
    let t = text;
    if (ctx.measureText(t).width <= maxWidth) return t;
    const ellipsis = '…';
    while (t.length > 0 && ctx.measureText(t + ellipsis).width > maxWidth) {
        t = t.slice(0, -1);
    }
    return t + ellipsis;
}

function fitFontSize(ctx, text, maxWidth, startSize, minSize, weight = '800') {
    let size = startSize;
    ctx.font = `${weight} ${size}px ${titleFace}, Arial`;
    while (size > minSize && ctx.measureText(text).width > maxWidth - 12) {
        size -= 2;
        ctx.font = `${weight} ${size}px ${titleFace}, Arial`;
    }
    return size;
}

/**
 * Segment timer (valeur + libellé).
 */
function drawTimerSegment(ctx, x, y, w, h, value, label, valueColor, highlight = false) {
    drawBox(ctx, x, y, w, h, 10, highlight);

    if (highlight) {
        ctx.save();
        rr(ctx, x + 2, y + 2, w - 4, h - 4, 8);
        ctx.fillStyle = THEME.goldSoft;
        ctx.fill();
        ctx.restore();
    }

    const cx = x + w / 2;
    const valueSize = fitFontSize(ctx, value, w, h > 120 ? 72 : 56, 28);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = valueColor;
    ctx.fillText(value, cx, y + h * 0.42);

    ctx.font = `600 11px ${textFace}, Arial`;
    ctx.fillStyle = THEME.sub;
    ctx.textBaseline = 'top';
    ctx.fillText(label, cx, y + h * 0.72);
}

function drawPastState(ctx, x, y, w, h) {
    drawBox(ctx, x, y, w, h, 12, true);
    const cx = x + w / 2;
    const cy = y + h / 2;
    const main = "C'EST L'HEURE";
    const size = fitFontSize(ctx, main, w, 64, 36);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = THEME.gold;
    ctx.fillText(main, cx, cy - 10);
    ctx.font = `500 13px ${textFace}, Arial`;
    ctx.fillStyle = THEME.sub;
    ctx.fillText('Le compte à rebours est terminé', cx, cy + size * 0.45);
}

function drawHeader(ctx, x, y, w, h, title, subtitle) {
    drawBox(ctx, x, y, w, h, 10, true);
    const padX = 16;
    const maxW = w - padX * 2;

    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.font = `700 18px ${titleFace}, Arial`;
    ctx.fillStyle = THEME.gold;
    ctx.fillText(truncateText(ctx, title, maxW), x + padX, y + 10);

    if (subtitle) {
        ctx.font = `500 12px ${textFace}, Arial`;
        ctx.fillStyle = THEME.sub;
        ctx.fillText(truncateText(ctx, subtitle, maxW), x + padX, y + 30);
    }
}

/**
 * Carte compte à rebours — blz_bg flouté, segments jours/heures/minutes.
 * @param {{ targetMs: number, title?: string, subtitle?: string }} opts
 * @returns {Promise<Buffer>}
 */
async function buildCountdownCard(opts) {
    const { days, hours, minutes, past } = diffUntil(opts.targetMs);
    const title = (opts.title || '').trim();
    const subtitle = (opts.subtitle || '').trim();

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
    const headerH = title ? (subtitle ? 52 : 44) : 0;
    const headerGap = title ? gap : 0;

    let y = pad;

    if (title) {
        drawHeader(ctx, pad, y, innerW, headerH, title, subtitle);
        y += headerH + headerGap;
    }

    const timerH = H - y - pad - footerH - gap;
    const segGap = 10;

    if (past) {
        drawPastState(ctx, pad, y, innerW, timerH);
    } else if (days >= 1) {
        const segW = (innerW - segGap * 2) / 3;
        const dayStr = String(days);
        const hourStr = String(hours).padStart(2, '0');
        const minStr = String(minutes).padStart(2, '0');

        drawTimerSegment(ctx, pad, y, segW, timerH, dayStr, days > 1 ? 'JOURS' : 'JOUR', THEME.gold, true);
        drawTimerSegment(
            ctx,
            pad + segW + segGap,
            y,
            segW,
            timerH,
            hourStr,
            hours > 1 ? 'HEURES' : 'HEURE',
            THEME.gold,
        );
        drawTimerSegment(
            ctx,
            pad + (segW + segGap) * 2,
            y,
            segW,
            timerH,
            minStr,
            minutes > 1 ? 'MINUTES' : 'MINUTE',
            THEME.gold,
        );

        ctx.textAlign = 'center';
        ctx.font = `600 11px ${textFace}, Arial`;
        ctx.fillStyle = 'rgba(255,255,255,0.42)';
        ctx.textBaseline = 'top';
        ctx.fillText('IL RESTE', W / 2, y + 6);
    } else if (hours > 0) {
        const segW = (innerW - segGap) / 2;
        drawTimerSegment(
            ctx,
            pad,
            y,
            segW,
            timerH,
            `${hours}h`,
            hours > 1 ? 'HEURES' : 'HEURE',
            THEME.timer,
            true,
        );
        drawTimerSegment(
            ctx,
            pad + segW + segGap,
            y,
            segW,
            timerH,
            `${String(minutes).padStart(2, '0')}m`,
            minutes > 1 ? 'MINUTES' : 'MINUTE',
            THEME.timer,
        );
        ctx.textAlign = 'center';
        ctx.font = `600 11px ${textFace}, Arial`;
        ctx.fillStyle = 'rgba(255,255,255,0.42)';
        ctx.textBaseline = 'top';
        ctx.fillText('IL RESTE', W / 2, y + 6);
    } else {
        drawBox(ctx, pad, y, innerW, timerH, 12, true);
        const cx = W / 2;
        const cy = y + timerH / 2;
        const main = `${minutes} min`;
        const size = fitFontSize(ctx, main, innerW, 72, 40);
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = THEME.urgent;
        ctx.fillText(main, cx, cy - 8);
        ctx.font = `600 12px ${textFace}, Arial`;
        ctx.fillStyle = THEME.sub;
        ctx.fillText('AVANT LA RÉOUVERTURE', cx, cy + size * 0.42);
    }

    const footY = H - pad - footerH;
    drawBox(ctx, pad, footY, innerW, footerH, 8);
    ctx.textBaseline = 'middle';
    ctx.font = `500 10px ${textFace}, Arial`;
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.textAlign = 'left';
    ctx.fillText('BLZbot · compte à rebours', pad + 10, footY + footerH / 2);
    ctx.textAlign = 'right';
    ctx.fillText(CARD_BUILD, pad + innerW - 10, footY + footerH / 2);

    return canvas.toBuffer('image/png');
}

module.exports = { buildCountdownCard };
