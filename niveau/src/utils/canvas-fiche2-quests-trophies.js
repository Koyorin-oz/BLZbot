/**
 * Cartes « Quêtes » et « Trophées » au visuel fiche 2 (blz_bg + panneaux sombres + or).
 */
const { createCanvas, loadImage } = require('canvas');
const fs = require('node:fs');
const path = require('node:path');

const W = 1024;
const H = 520;

const THEME = {
    overlay: 'rgba(0,0,0,0.28)',
    shell: 'rgba(0,0,0,0.44)',
    panel: 'rgba(0,0,0,0.56)',
    text: '#ffffff',
    sub: '#b8c5d3',
    gold: '#e8b83a',
    outline: 'rgba(255,255,255,0.38)',
    rare: '#a78bfa',
    epic: '#c084fc',
    leg: '#fbbf24',
    commun: '#94a3b8',
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

function truncateText(ctx, text, maxWidth) {
    let t = String(text ?? '');
    let width = ctx.measureText(t).width;
    if (width <= maxWidth) return t;
    const ellipsis = '...';
    const ew = ctx.measureText(ellipsis).width;
    while (width > maxWidth - ew && t.length > 0) {
        t = t.substring(0, t.length - 1);
        width = ctx.measureText(t).width;
    }
    return t + ellipsis;
}

async function tryLoadBlzBg() {
    const p = path.join(__dirname, '..', 'assets', 'blz_bg.png');
    if (!fs.existsSync(p)) return null;
    try {
        return await loadImage(fs.readFileSync(p));
    } catch {
        return null;
    }
}

function rarityColor(r) {
    const k = String(r || '').toLowerCase();
    if (k.includes('lég')) return THEME.leg;
    if (k.includes('leg')) return THEME.leg;
    if (k.includes('épique') || k.includes('epic')) return THEME.epic;
    if (k.includes('rare')) return THEME.rare;
    return THEME.commun;
}

async function drawFiche2Frame(ctx) {
    const bg = await tryLoadBlzBg();
    if (bg) ctx.drawImage(bg, 0, 0, W, H);
    else {
        ctx.fillStyle = '#1a0a0c';
        ctx.fillRect(0, 0, W, H);
    }
    ctx.fillStyle = THEME.overlay;
    ctx.fillRect(0, 0, W, H);

    const pad = 14;
    rr(ctx, pad, pad, W - pad * 2, H - pad * 2, 18);
    ctx.fillStyle = THEME.shell;
    ctx.fill();
    ctx.strokeStyle = THEME.outline;
    ctx.lineWidth = 2;
    ctx.stroke();
    return pad;
}

function drawProgress(ctx, x, y, w, h, pct) {
    rr(ctx, x, y, w, h, h / 2);
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fill();
    const p = Math.max(0, Math.min(100, pct));
    const fw = Math.max(h, Math.round((w * p) / 100));
    if (fw > 0) {
        const g = ctx.createLinearGradient(x, 0, x + fw, 0);
        g.addColorStop(0, '#ffcc33');
        g.addColorStop(0.5, '#e8b83a');
        g.addColorStop(1, '#c97816');
        rr(ctx, x, y, fw, h, h / 2);
        ctx.fillStyle = g;
        ctx.fill();
    }
}

/** @param {{ quests: Array<{name:string,description:string,progress:number,goal:any,rarity?:string,isNumeric?:boolean}>, footerNote?: string }} param0 */
async function renderQuestsCardFiche2({ quests, footerNote = '/profil-v2' }) {
    const canvas = createCanvas(W, H);
    const ctx = canvas.getContext('2d');
    const pad = await drawFiche2Frame(ctx);

    const innerX = pad + 16;
    let y = pad + 20;
    const innerW = W - (pad + 16) * 2;

    ctx.font = '700 22px InterBold, Arial';
    ctx.fillStyle = THEME.gold;
    ctx.fillText('Quêtes en cours', innerX, y + 22);
    y += 48;

    const listH = H - y - pad - 28;
    rr(ctx, innerX, y, innerW, listH, 14);
    ctx.fillStyle = THEME.panel;
    ctx.fill();
    ctx.strokeStyle = THEME.outline;
    ctx.lineWidth = 2;
    ctx.stroke();

    const rowH = Math.min(86, Math.floor((listH - 24) / Math.max(1, Math.min(5, quests.length || 1))));
    let ry = y + 14;

    if (!quests.length) {
        ctx.fillStyle = THEME.sub;
        ctx.font = '500 16px Inter, Arial';
        ctx.textAlign = 'center';
        ctx.fillText('Aucune quête en cours — tout est complété.', innerX + innerW / 2, y + listH / 2);
        ctx.textAlign = 'left';
    } else {
        quests.slice(0, 5).forEach((q) => {
            const c = rarityColor(q.rarity);
            ctx.font = '700 14px InterBold, Arial';
            ctx.fillStyle = c;
            ctx.fillText(truncateText(ctx, q.name, innerW - 28), innerX + 14, ry + 16);
            ctx.fillStyle = THEME.sub;
            ctx.font = '500 11px Inter, Arial';
            ctx.fillText(truncateText(ctx, q.description, innerW - 28), innerX + 14, ry + 34);
            if (q.isNumeric !== false && typeof q.goal === 'number') {
                const pct = Math.min(100, Math.floor(((q.progress || 0) / q.goal) * 100));
                drawProgress(ctx, innerX + 14, ry + 48, innerW - 28, 8, pct);
                ctx.fillStyle = THEME.sub;
                ctx.font = '500 10px Inter, Arial';
                ctx.fillText(
                    `${(q.progress || 0).toLocaleString('fr-FR')} / ${q.goal.toLocaleString('fr-FR')}`,
                    innerX + 14,
                    ry + 64
                );
            } else {
                ctx.fillStyle = THEME.gold;
                ctx.font = '600 11px InterBold, Inter, Arial';
                ctx.fillText(`Objectif : ${q.goal}`, innerX + 14, ry + 54);
            }
            ry += rowH;
        });
    }

    ctx.fillStyle = 'rgba(200, 215, 230, 0.45)';
    ctx.font = 'italic 10px Inter, Arial';
    ctx.textAlign = 'right';
    ctx.fillText(`Quêtes — ${footerNote}`, W - pad - 8, H - pad - 8);
    ctx.textAlign = 'left';

    return canvas.toBuffer('image/png');
}

/** @param {{ achievements: Array<{name:string,description:string,rarity?:string}> }} param0 */
async function renderAchievementsCardFiche2({ achievements }) {
    const canvas = createCanvas(W, H);
    const ctx = canvas.getContext('2d');
    const pad = await drawFiche2Frame(ctx);

    const innerX = pad + 16;
    let y = pad + 20;
    const innerW = W - (pad + 16) * 2;

    ctx.font = '700 22px InterBold, Arial';
    ctx.fillStyle = THEME.gold;
    ctx.fillText('Trophées', innerX, y + 22);
    y += 48;

    const listH = H - y - pad - 28;
    rr(ctx, innerX, y, innerW, listH, 14);
    ctx.fillStyle = THEME.panel;
    ctx.fill();
    ctx.strokeStyle = THEME.outline;
    ctx.lineWidth = 2;
    ctx.stroke();

    if (!achievements.length) {
        ctx.fillStyle = THEME.sub;
        ctx.font = '500 16px Inter, Arial';
        ctx.textAlign = 'center';
        ctx.fillText('Aucun trophée pour le moment.', innerX + innerW / 2, y + listH / 2);
        ctx.textAlign = 'left';
    } else {
        const cols = 2;
        const gap = 10;
        const cellW = (innerW - gap * (cols - 1) - 28) / cols;
        const rows = 4;
        const cellH = (listH - gap * (rows - 1) - 28) / rows;
        let i = 0;
        for (let row = 0; row < rows && i < achievements.length; row++) {
            for (let col = 0; col < cols && i < achievements.length; col++) {
                const a = achievements[i++];
                const cx = innerX + 14 + col * (cellW + gap);
                const cy = y + 14 + row * (cellH + gap);
                rr(ctx, cx, cy, cellW, cellH, 10);
                ctx.fillStyle = 'rgba(0,0,0,0.35)';
                ctx.fill();
                ctx.strokeStyle = THEME.outline;
                ctx.lineWidth = 1;
                ctx.stroke();
                const c = rarityColor(a.rarity);
                ctx.font = '700 12px InterBold, Arial';
                ctx.fillStyle = c;
                ctx.fillText(truncateText(ctx, `★ ${a.name}`, cellW - 12), cx + 8, cy + 18);
                ctx.fillStyle = THEME.sub;
                ctx.font = '500 10px Inter, Arial';
                const desc = truncateText(ctx, a.description || '', cellW - 12);
                ctx.fillText(desc, cx + 8, cy + 36);
            }
        }
    }

    ctx.fillStyle = 'rgba(200, 215, 230, 0.45)';
    ctx.font = 'italic 10px Inter, Arial';
    ctx.textAlign = 'right';
    ctx.fillText('Trophées — /profil-v2', W - pad - 8, H - pad - 8);
    ctx.textAlign = 'left';

    return canvas.toBuffer('image/png');
}

module.exports = { renderQuestsCardFiche2, renderAchievementsCardFiche2 };
