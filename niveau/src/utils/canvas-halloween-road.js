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
} catch {
    /* polices optionnelles */
}

const W = 920;
const H = 720;

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

function cover(ctx, img) {
    const scale = Math.max(W / img.width, H / img.height);
    const nw = img.width * scale;
    const nh = img.height * scale;
    ctx.drawImage(img, (W - nw) / 2, (H - nh) / 2, nw, nh);
}

function clipText(ctx, text, max) {
    if (ctx.measureText(text).width <= max) return text;
    let s = text;
    while (s.length > 1 && ctx.measureText(`${s}…`).width > max) s = s.slice(0, -1);
    return `${s}…`;
}

async function loadBg() {
    const p = path.join(__dirname, '..', 'assets', 'blz_bg.png');
    if (!fs.existsSync(p)) return null;
    try {
        return await loadImage(fs.readFileSync(p));
    } catch {
        return null;
    }
}

/**
 * @param {{ username: string, done: number, quests: { day: string, label: string, reward: string, progress: number, goal: number, done: boolean, open: boolean }[] }} data
 */
async function renderHalloweenRoad(data) {
    const canvas = createCanvas(W, H);
    const ctx = canvas.getContext('2d');
    const bold = 'InterBold, Arial';
    const regular = 'Inter, Arial';

    const bg = await loadBg();
    if (bg) cover(ctx, bg);
    else {
        ctx.fillStyle = '#1a0c08';
        ctx.fillRect(0, 0, W, H);
    }

    ctx.fillStyle = 'rgba(18, 6, 2, 0.62)';
    ctx.fillRect(0, 0, W, H);

    const wash = ctx.createLinearGradient(0, 0, W, H);
    wash.addColorStop(0, 'rgba(230, 126, 34, 0.18)');
    wash.addColorStop(1, 'rgba(88, 24, 69, 0.22)');
    ctx.fillStyle = wash;
    ctx.fillRect(0, 0, W, H);

    ctx.fillStyle = '#ffb020';
    ctx.fillRect(0, 0, W, 6);

    ctx.fillStyle = '#fff6e8';
    ctx.font = `28px ${bold}`;
    ctx.textBaseline = 'top';
    ctx.fillText('Road Halloween', 36, 28);

    ctx.font = `16px ${regular}`;
    ctx.fillStyle = 'rgba(255, 214, 170, 0.9)';
    ctx.fillText(`${data.username}  ·  ${data.done}/9 quêtes`, 36, 64);

    const barX = 620;
    const barW = 250;
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    rr(ctx, barX, 40, barW, 18, 9);
    ctx.fill();
    ctx.fillStyle = '#e67e22';
    rr(ctx, barX, 40, Math.max(8, barW * (data.done / 9)), 18, 9);
    ctx.fill();

    const quests = data.quests.slice(0, 9);
    const top = 108;
    const rowH = 62;
    const gap = 6;
    quests.forEach((q, i) => {
        const y = top + i * (rowH + gap);
        rr(ctx, 28, y, W - 56, rowH, 12);
        ctx.fillStyle = q.done ? 'rgba(46, 120, 50, 0.45)' : q.open ? 'rgba(0,0,0,0.5)' : 'rgba(0,0,0,0.35)';
        ctx.fill();
        ctx.strokeStyle = q.done ? 'rgba(255, 196, 90, 0.7)' : q.open ? 'rgba(230, 126, 34, 0.85)' : 'rgba(255,255,255,0.12)';
        ctx.lineWidth = 1.5;
        ctx.stroke();

        ctx.fillStyle = q.open || q.done ? '#ffcc80' : 'rgba(255,255,255,0.45)';
        ctx.font = `18px ${bold}`;
        ctx.fillText(q.day, 46, y + 12);

        ctx.fillStyle = '#fff';
        ctx.font = `16px ${regular}`;
        ctx.fillText(clipText(ctx, q.label, 430), 130, y + 13);

        const status = q.done ? 'Fait' : q.open ? `${q.progress}/${q.goal}` : 'Fermé';
        ctx.textAlign = 'right';
        ctx.fillStyle = q.done ? '#b6f5c2' : q.open ? '#ffd166' : 'rgba(255,255,255,0.4)';
        ctx.font = `16px ${bold}`;
        ctx.fillText(status, W - 48, y + 12);
        ctx.textAlign = 'left';

        ctx.fillStyle = 'rgba(255, 236, 210, 0.75)';
        ctx.font = `14px ${regular}`;
        ctx.fillText(clipText(ctx, q.reward, 520), 130, y + 36);

        const pMax = 280;
        const ratio = q.goal > 0 ? Math.min(1, q.progress / q.goal) : 0;
        ctx.fillStyle = 'rgba(255,255,255,0.12)';
        rr(ctx, W - 48 - pMax, y + 36, pMax, 8, 4);
        ctx.fill();
        if (ratio > 0) {
            ctx.fillStyle = q.done ? '#7dcea0' : '#e67e22';
            rr(ctx, W - 48 - pMax, y + 36, Math.max(8, pMax * ratio), 8, 4);
            ctx.fill();
        }
    });

    return canvas.toBuffer('image/png');
}

module.exports = { renderHalloweenRoad };
