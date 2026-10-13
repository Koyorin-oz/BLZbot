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
    /* polices système */
}

const titleFace = 'InterBold';
const textFace = 'Inter';

const PAD = 12;
const GAP = 8;
const COLS = 3;
const HEADER_H = 56;
const BAR_H = 26;
const CARD_H = 124;
const FOOTER_H = 24;
const W = 760;
const H = PAD + HEADER_H + GAP + BAR_H + GAP + CARD_H * 3 + GAP * 2 + GAP + FOOTER_H + PAD;

const THEME = {
    overlay: 'rgba(12, 8, 10, 0.52)',
    boxFill: 'rgba(0, 0, 0, 0.5)',
    boxStroke: 'rgba(255, 255, 255, 0.14)',
    text: '#ffffff',
    sub: 'rgba(242, 215, 211, 0.9)',
    dim: 'rgba(255, 255, 255, 0.38)',
    pumpkin: '#ff8a3d',
    gold: '#FFD700',
    success: '#4ade80',
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

function drawBox(ctx, x, y, w, h, r = 10, accent = null) {
    rr(ctx, x, y, w, h, r);
    ctx.fillStyle = THEME.boxFill;
    ctx.fill();
    ctx.strokeStyle = THEME.boxStroke;
    ctx.lineWidth = 1;
    ctx.stroke();
    if (!accent) return;
    ctx.save();
    rr(ctx, x + 1, y + 1, w - 2, h - 2, Math.max(0, r - 1));
    ctx.clip();
    const g = ctx.createLinearGradient(x, y, x + w, y);
    g.addColorStop(0, `${accent}00`);
    g.addColorStop(0.35, `${accent}cc`);
    g.addColorStop(0.65, `${accent}cc`);
    g.addColorStop(1, `${accent}00`);
    ctx.fillStyle = g;
    ctx.fillRect(x, y, w, 3);
    ctx.restore();
}

function drawImageCover(ctx, img, dx, dy, dw, dh) {
    const scale = Math.max(dw / img.width, dh / img.height);
    const nw = img.width * scale;
    const nh = img.height * scale;
    ctx.drawImage(img, dx + (dw - nw) / 2, dy + (dh - nh) / 2, nw, nh);
}

function truncate(ctx, text, max) {
    if (ctx.measureText(text).width <= max) return text;
    let s = text;
    while (s.length > 1 && ctx.measureText(`${s}…`).width > max) s = s.slice(0, -1);
    return `${s}…`;
}

function wrap(ctx, text, max, lines = 2) {
    const words = text.split(' ');
    const out = [];
    let cur = '';
    for (const w of words) {
        const next = cur ? `${cur} ${w}` : w;
        if (ctx.measureText(next).width <= max || !cur) {
            cur = next;
        } else {
            out.push(cur);
            cur = w;
        }
    }
    if (cur) out.push(cur);
    if (out.length > lines) {
        out.length = lines;
        out[lines - 1] = truncate(ctx, `${out[lines - 1]} …`, max);
    }
    return out;
}

function bar(ctx, x, y, w, h, ratio, color) {
    rr(ctx, x, y, w, h, h / 2);
    ctx.fillStyle = 'rgba(255,255,255,0.14)';
    ctx.fill();
    if (ratio <= 0) return;
    rr(ctx, x, y, Math.max(h, Math.round(w * Math.min(1, ratio))), h, h / 2);
    ctx.fillStyle = color;
    ctx.fill();
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

function drawCard(ctx, q, x, y, w) {
    const accent = q.done ? THEME.success : q.open ? THEME.pumpkin : null;
    drawBox(ctx, x, y, w, CARD_H, 10, accent);
    const left = x + 12;
    const right = x + w - 12;
    const inner = right - left;
    const active = q.open || q.done;

    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';
    ctx.font = `700 18px ${titleFace}, Arial`;
    ctx.fillStyle = active ? THEME.text : THEME.dim;
    ctx.fillText(q.day, left, y + 12);

    const status = q.done ? 'FAIT' : q.open ? 'EN COURS' : 'FERMÉ';
    ctx.font = `700 10px ${titleFace}, Arial`;
    const sw = ctx.measureText(status).width + 14;
    rr(ctx, right - sw, y + 12, sw, 18, 9);
    ctx.fillStyle = q.done ? 'rgba(74, 222, 128, 0.18)' : q.open ? 'rgba(255, 138, 61, 0.2)' : 'rgba(255,255,255,0.06)';
    ctx.fill();
    ctx.fillStyle = q.done ? THEME.success : q.open ? THEME.pumpkin : THEME.dim;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(status, right - sw / 2, y + 21.5);

    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.font = `400 12px ${textFace}, Arial`;
    ctx.fillStyle = active ? THEME.sub : THEME.dim;
    wrap(ctx, q.label, inner).forEach((line, i) => ctx.fillText(line, left, y + 40 + i * 16));

    ctx.font = `700 13px ${titleFace}, Arial`;
    ctx.fillStyle = active ? THEME.gold : THEME.dim;
    ctx.fillText(truncate(ctx, q.reward, inner), left, y + 76);

    const cur = q.done ? q.goal : Math.min(q.progress, q.goal);
    const txt = `${cur.toLocaleString('fr-FR')} / ${q.goal.toLocaleString('fr-FR')}`;
    ctx.font = `600 10px ${textFace}, Arial`;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'right';
    ctx.fillStyle = active ? THEME.text : THEME.dim;
    const tw = ctx.measureText(txt).width;
    ctx.fillText(txt, right, y + CARD_H - 17);
    ctx.textAlign = 'left';
    bar(ctx, left, y + CARD_H - 21, inner - tw - 10, 8, q.goal ? cur / q.goal : 0, q.done ? THEME.success : THEME.pumpkin);
}

/**
 * @param {{ username: string, displayName?: string, avatarURL?: string, done: number, quests: Array<{ day: string, label: string, reward: string, progress: number, goal: number, done: boolean, open: boolean }> }} data
 */
async function renderHalloweenRoad(data) {
    const canvas = createCanvas(W, H);
    const ctx = canvas.getContext('2d');

    const bg = await loadBg();
    ctx.save();
    rr(ctx, 0, 0, W, H, 14);
    ctx.clip();
    if (bg) {
        drawImageCover(ctx, bg, 0, 0, W, H);
    } else {
        const g = ctx.createLinearGradient(0, 0, W, H);
        g.addColorStop(0, '#2a1214');
        g.addColorStop(0.45, '#4a1e24');
        g.addColorStop(1, '#1a0a0c');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, W, H);
    }
    ctx.restore();
    rr(ctx, 0, 0, W, H, 14);
    ctx.fillStyle = THEME.overlay;
    ctx.fill();

    const innerW = W - PAD * 2;
    let y = PAD;

    drawBox(ctx, PAD, y, innerW, HEADER_H, 10, THEME.pumpkin);
    const avS = 44;
    const avX = PAD + 12;
    const avY = y + (HEADER_H - avS) / 2;
    let av = null;
    if (data.avatarURL) {
        try {
            av = await loadImage(data.avatarURL);
        } catch {
            /* ignore */
        }
    }
    ctx.save();
    rr(ctx, avX, avY, avS, avS, avS / 2);
    ctx.clip();
    if (av) {
        ctx.drawImage(av, avX, avY, avS, avS);
    } else {
        ctx.fillStyle = THEME.pumpkin;
        ctx.fillRect(avX, avY, avS, avS);
    }
    ctx.restore();
    ctx.strokeStyle = 'rgba(255,255,255,0.28)';
    ctx.lineWidth = 1.25;
    ctx.beginPath();
    ctx.arc(avX + avS / 2, avY + avS / 2, avS / 2 + 0.5, 0, Math.PI * 2);
    ctx.stroke();

    const textX = avX + avS + 12;
    const textRight = PAD + innerW - 12;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = THEME.text;
    ctx.font = `700 19px ${titleFace}, Arial`;
    ctx.fillText(truncate(ctx, data.displayName || data.username, textRight - textX - 200), textX, y + HEADER_H * 0.38);
    ctx.fillStyle = THEME.sub;
    ctx.font = `400 12px ${textFace}, Arial`;
    ctx.fillText('Road Halloween 2026', textX, y + HEADER_H * 0.68);

    ctx.textAlign = 'right';
    ctx.fillStyle = THEME.pumpkin;
    ctx.font = `800 26px ${titleFace}, Arial`;
    ctx.fillText(`${data.done}/9`, textRight, y + HEADER_H * 0.42);
    ctx.fillStyle = THEME.sub;
    ctx.font = `400 11px ${textFace}, Arial`;
    ctx.fillText('quêtes validées', textRight, y + HEADER_H * 0.76);
    y += HEADER_H + GAP;

    drawBox(ctx, PAD, y, innerW, BAR_H, 10);
    const bx = PAD + 10;
    const bw = innerW - 20;
    const by = y + (BAR_H - 14) / 2;
    bar(ctx, bx, by, bw, 14, data.done / 9, data.done >= 9 ? THEME.success : THEME.pumpkin);
    ctx.fillStyle = THEME.text;
    ctx.font = `700 11px ${titleFace}, Arial`;
    ctx.textAlign = 'left';
    ctx.fillText('Progression', bx + 8, by + 7);
    ctx.textAlign = 'center';
    ctx.font = `600 10px ${textFace}, Arial`;
    ctx.fillText(data.done >= 9 ? 'Road parfaite — choisis ton bonus' : `${9 - data.done} restante${9 - data.done > 1 ? 's' : ''}`, bx + bw / 2, by + 7);
    y += BAR_H + GAP;

    const cardW = (innerW - GAP * (COLS - 1)) / COLS;
    data.quests.slice(0, 9).forEach((q, i) => {
        const cx = PAD + (i % COLS) * (cardW + GAP);
        const cy = y + Math.floor(i / COLS) * (CARD_H + GAP);
        drawCard(ctx, q, cx, cy, cardW);
    });
    y += CARD_H * 3 + GAP * 2 + GAP;

    drawBox(ctx, PAD, y, innerW, FOOTER_H, 8);
    ctx.textBaseline = 'middle';
    ctx.font = `500 10px ${textFace}, Arial`;
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.textAlign = 'left';
    ctx.fillText('Chaque quête reste ouverte jusqu\'à 12h le lendemain', PAD + 14, y + FOOTER_H / 2);
    ctx.textAlign = 'right';
    ctx.fillText('BLZbot · Halloween', PAD + innerW - 14, y + FOOTER_H / 2);

    return canvas.toBuffer('image/png');
}

module.exports = { renderHalloweenRoad };
