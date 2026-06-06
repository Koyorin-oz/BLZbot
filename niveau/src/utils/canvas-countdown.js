const { createCanvas, registerFont } = require('canvas');
const fs = require('node:fs');
const path = require('node:path');
const { diffUntil } = require('./countdown-parse');

let fontBold = 'sans-serif';
let fontRegular = 'sans-serif';
try {
    const fontsDir = path.join(__dirname, '..', 'assets', 'fonts');
    const popBold = path.join(fontsDir, 'Poppins-Bold.ttf');
    const popReg = path.join(fontsDir, 'Poppins-Regular.ttf');
    if (fs.existsSync(popBold)) {
        registerFont(popBold, { family: 'CountdownBold' });
        fontBold = '"CountdownBold", sans-serif';
    }
    if (fs.existsSync(popReg)) {
        registerFont(popReg, { family: 'Countdown' });
        fontRegular = '"Countdown", sans-serif';
    }
} catch {
    /* polices système */
}

function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
}

function drawStarField(ctx, w, h) {
    ctx.save();
    for (let i = 0; i < 80; i++) {
        const x = (i * 137.508) % w;
        const y = (i * 97.317) % h;
        const r = (i % 3) + 0.6;
        ctx.globalAlpha = 0.15 + (i % 5) * 0.08;
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
    }
    ctx.restore();
}

/**
 * @param {{ title: string, subtitle?: string, targetMs: number }} opts
 * @returns {Promise<Buffer>}
 */
async function buildCountdownCard(opts) {
    const title = String(opts.title || 'Réouverture').trim();
    const subtitle = String(opts.subtitle || '').trim();
    const { days, hours, minutes, past } = diffUntil(opts.targetMs);

    const W = 1280;
    const H = 720;
    const canvas = createCanvas(W, H);
    const ctx = canvas.getContext('2d');

    const bg = ctx.createLinearGradient(0, 0, W, H);
    bg.addColorStop(0, '#0b1026');
    bg.addColorStop(0.55, '#141b3d');
    bg.addColorStop(1, '#1a1448');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);
    drawStarField(ctx, W, H);

    roundRect(ctx, 48, 48, W - 96, H - 96, 36);
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.font = `600 34px ${fontRegular}`;
    ctx.fillText('BLZ · COMPTE À REBOURS', W / 2, 130);

    ctx.fillStyle = '#ffffff';
    ctx.font = `700 52px ${fontBold}`;
    const titleLines = wrapText(ctx, title, W - 200, 52);
    let ty = 200;
    for (const line of titleLines.slice(0, 2)) {
        ctx.fillText(line, W / 2, ty);
        ty += 58;
    }

    if (subtitle) {
        ctx.fillStyle = 'rgba(255,255,255,0.7)';
        ctx.font = `500 28px ${fontRegular}`;
        ctx.fillText(subtitle.length > 90 ? `${subtitle.slice(0, 87)}…` : subtitle, W / 2, ty + 20);
        ty += 36;
    }

    const blockY = Math.max(ty + 40, 300);

    if (past) {
        ctx.fillStyle = '#f1c40f';
        ctx.font = `800 96px ${fontBold}`;
        ctx.fillText("C'EST L'HEURE", W / 2, blockY + 80);
        ctx.fillStyle = 'rgba(255,255,255,0.85)';
        ctx.font = `500 36px ${fontRegular}`;
        ctx.fillText('Le compte à rebours est terminé', W / 2, blockY + 150);
    } else if (days >= 1) {
        ctx.fillStyle = 'rgba(255,255,255,0.8)';
        ctx.font = `600 42px ${fontRegular}`;
        ctx.fillText('IL RESTE', W / 2, blockY);

        ctx.fillStyle = '#5dade2';
        ctx.font = `900 220px ${fontBold}`;
        ctx.fillText(String(days), W / 2, blockY + 200);

        ctx.fillStyle = '#ffffff';
        ctx.font = `800 72px ${fontBold}`;
        ctx.fillText(days > 1 ? 'JOURS' : 'JOUR', W / 2, blockY + 290);

        if (days < 7) {
            ctx.fillStyle = 'rgba(255,255,255,0.65)';
            ctx.font = `500 30px ${fontRegular}`;
            ctx.fillText(`soit encore ${hours}h ${minutes}min`, W / 2, blockY + 350);
        }
    } else {
        ctx.fillStyle = 'rgba(255,255,255,0.8)';
        ctx.font = `600 42px ${fontRegular}`;
        ctx.fillText('PLUS QUE', W / 2, blockY);

        const main = hours > 0 ? `${hours}h ${minutes}min` : `${minutes} min`;
        ctx.fillStyle = '#e74c3c';
        ctx.font = `900 140px ${fontBold}`;
        ctx.fillText(main, W / 2, blockY + 170);

        ctx.fillStyle = 'rgba(255,255,255,0.75)';
        ctx.font = `500 32px ${fontRegular}`;
        ctx.fillText('avant le grand jour', W / 2, blockY + 240);
    }

    const paris = new Intl.DateTimeFormat('fr-FR', {
        timeZone: 'Europe/Paris',
        dateStyle: 'full',
        timeStyle: 'short',
    }).format(new Date(opts.targetMs));
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.font = `500 24px ${fontRegular}`;
    ctx.fillText(`Cible (Paris) : ${paris}`, W / 2, H - 72);

    return canvas.toBuffer('image/png');
}

function wrapText(ctx, text, maxWidth, fontSize) {
    const words = text.split(/\s+/);
    const lines = [];
    let line = '';
    for (const w of words) {
        const test = line ? `${line} ${w}` : w;
        if (ctx.measureText(test).width > maxWidth && line) {
            lines.push(line);
            line = w;
        } else {
            line = test;
        }
    }
    if (line) lines.push(line);
    return lines;
}

module.exports = { buildCountdownCard };
