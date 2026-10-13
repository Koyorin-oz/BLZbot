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

const W = 1040;
const H = 860;

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

function clipText(ctx, text, max) {
    if (ctx.measureText(text).width <= max) return text;
    let s = text;
    while (s.length > 1 && ctx.measureText(`${s}…`).width > max) s = s.slice(0, -1);
    return `${s}…`;
}

function stripes(ctx, x, y, w, h) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();
    ctx.fillStyle = '#6d1212';
    ctx.fillRect(x, y, w, h);
    const g = ctx.createLinearGradient(x, y, x + w, y);
    g.addColorStop(0, '#4a0c0c');
    g.addColorStop(0.5, '#a32020');
    g.addColorStop(1, '#3a0808');
    ctx.fillStyle = g;
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = 'rgba(255, 80, 40, 0.28)';
    ctx.lineWidth = 18;
    for (let i = -h; i < w + h; i += 36) {
        ctx.beginPath();
        ctx.moveTo(x + i, y);
        ctx.lineTo(x + i + h, y + h);
        ctx.stroke();
    }
    ctx.restore();
}

async function renderHalloweenRoad(data) {
    const canvas = createCanvas(W, H);
    const ctx = canvas.getContext('2d');
    const bold = 'InterBold, Arial';
    const regular = 'Inter, Arial';

    const bgPath = path.join(__dirname, '..', 'assets', 'blz_bg.png');
    try {
        if (fs.existsSync(bgPath)) {
            const bg = await loadImage(fs.readFileSync(bgPath));
            const scale = Math.max(W / bg.width, H / bg.height);
            const nw = bg.width * scale;
            const nh = bg.height * scale;
            ctx.drawImage(bg, (W - nw) / 2, (H - nh) / 2, nw, nh);
        }
    } catch {
        ctx.fillStyle = '#140806';
        ctx.fillRect(0, 0, W, H);
    }
    ctx.fillStyle = 'rgba(10, 4, 4, 0.72)';
    ctx.fillRect(0, 0, W, H);

    stripes(ctx, 28, 24, W - 56, 132);
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.lineWidth = 1;
    ctx.strokeRect(28.5, 24.5, W - 57, 131);

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#fff';
    ctx.font = `54px ${bold}`;
    ctx.fillText('ROAD HALLOWEEN', W / 2, 78);
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(W / 2 - 220, 112);
    ctx.lineTo(W / 2 + 220, 112);
    ctx.stroke();

    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillStyle = '#ffe8d2';
    ctx.font = `18px ${regular}`;
    ctx.fillText(data.username, 36, 172);

    const done = data.done;
    ctx.textAlign = 'right';
    ctx.fillStyle = '#ffb020';
    ctx.font = `18px ${bold}`;
    ctx.fillText(`${done}/9`, W - 36, 172);
    ctx.textAlign = 'left';

    const barX = 36;
    const barW = W - 72;
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    rr(ctx, barX, 202, barW, 10, 5);
    ctx.fill();
    if (done > 0) {
        ctx.fillStyle = '#e23b2f';
        rr(ctx, barX, 202, Math.max(12, barW * (done / 9)), 10, 5);
        ctx.fill();
    }

    const quests = data.quests.slice(0, 9);
    const top = 230;
    const rowH = 64;
    const gap = 6;
    quests.forEach((q, i) => {
        const y = top + i * (rowH + gap);
        rr(ctx, 28, y, W - 56, rowH, 14);
        ctx.fillStyle = q.done ? 'rgba(28, 64, 32, 0.72)' : q.open ? 'rgba(18, 8, 8, 0.78)' : 'rgba(0, 0, 0, 0.45)';
        ctx.fill();

        ctx.fillStyle = q.done ? '#7dcea0' : q.open ? '#e23b2f' : 'rgba(255,255,255,0.16)';
        ctx.fillRect(28, y + 10, 5, rowH - 20);

        ctx.fillStyle = q.open || q.done ? '#ffd7b0' : 'rgba(255,255,255,0.4)';
        ctx.font = `20px ${bold}`;
        ctx.fillText(q.day, 52, y + 10);

        ctx.fillStyle = q.open || q.done ? '#ffffff' : 'rgba(255,255,255,0.55)';
        ctx.font = `18px ${regular}`;
        ctx.fillText(clipText(ctx, q.label, 560), 150, y + 11);

        const status = q.done ? 'FAIT' : q.open ? `${q.progress}/${q.goal}` : 'FERMÉ';
        const badgeW = 92;
        const badgeX = W - 48 - badgeW;
        rr(ctx, badgeX, y + 10, badgeW, 26, 8);
        ctx.fillStyle = q.done ? '#1e7a45' : q.open ? '#9a241c' : 'rgba(255,255,255,0.08)';
        ctx.fill();
        ctx.textAlign = 'center';
        ctx.fillStyle = '#fff';
        ctx.font = `14px ${bold}`;
        ctx.fillText(status, badgeX + badgeW / 2, y + 16);
        ctx.textAlign = 'left';

        ctx.fillStyle = 'rgba(255, 220, 190, 0.8)';
        ctx.font = `15px ${regular}`;
        ctx.fillText(clipText(ctx, q.reward, 520), 150, y + 38);

        const pMax = 240;
        const px = W - 48 - pMax;
        const ratio = q.goal > 0 ? Math.min(1, (q.done ? q.goal : q.progress) / q.goal) : 0;
        ctx.fillStyle = 'rgba(255,255,255,0.1)';
        rr(ctx, px, y + 42, pMax, 8, 4);
        ctx.fill();
        if (ratio > 0) {
            ctx.fillStyle = q.done ? '#8ee0ad' : '#ff7a3c';
            rr(ctx, px, y + 42, Math.max(8, pMax * ratio), 8, 4);
            ctx.fill();
        }
    });

    return canvas.toBuffer('image/png');
}

module.exports = { renderHalloweenRoad };
