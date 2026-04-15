/**
 * Aperçus visuels pour /testprofil (ne remplace pas renderProfileCard).
 * 10 styles : aurora, nocturne, parchment + 7 thèmes BLZ (fonds / vitrages proches du /profile).
 */
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
    /* ignore */
}

const W = 1200;
const H = 700;

const PROFILE_PREVIEW_VARIANTS = [
    { id: 'aurora', label: 'Aurora', hint: 'Glacier, verre, dégradé froid' },
    { id: 'nocturne', label: 'Nocturne', hint: 'Grille cyber, néons cyan / magenta' },
    { id: 'parchment', label: 'Parchemin', hint: 'Ton chaud, contraste type carte RPG' },
];

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

async function tryLoadBlzBg() {
    const p = path.join(__dirname, '..', 'assets', 'blz_bg.png');
    if (!fs.existsSync(p)) return null;
    try {
        return await loadImage(fs.readFileSync(p));
    } catch {
        return null;
    }
}

function drawXpBar(ctx, x, y, w, h, ratio, fill, track) {
    rr(ctx, x, y, w, h, h / 2);
    ctx.fillStyle = track;
    ctx.fill();
    const r = Math.max(0, Math.min(1, ratio));
    if (r > 0) {
        const fw = Math.max(h, Math.round(w * r));
        rr(ctx, x, y, fw, h, h / 2);
        ctx.fillStyle = fill;
        ctx.fill();
    }
}

async function loadAvatar(member) {
    const url = member?.displayAvatarURL({ extension: 'png', size: 256 });
    if (!url) return null;
    try {
        return await loadImage(url);
    } catch {
        return null;
    }
}

/**
 * @param {object} data — même forme que les champs utiles de renderProfileCard
 * @param {'aurora'|'nocturne'|'parchment'} variant
 */
async function renderProfilePreviewVariant(data, variant) {
    const {
        user,
        member,
        rank,
        nextRank,
        highestRoleName,
        rankIconPath,
        totalDebt,
        debtTimeRemaining,
        vocalNerfStatus,
    } = data;

    const titleFace = 'InterBold';
    const textFace = 'Inter';
    const displayName = member?.displayName ?? 'Utilisateur';
    const ratioXp = user.xp_needed > 0 ? user.xp / user.xp_needed : 0;

    if (variant === 'aurora') {
        const canvas = createCanvas(W, H);
        const ctx = canvas.getContext('2d');
        const g = ctx.createLinearGradient(0, 0, W, H);
        g.addColorStop(0, '#0a1628');
        g.addColorStop(0.45, '#152238');
        g.addColorStop(1, '#1e1035');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, W, H);
        const bg = await tryLoadBlzBg();
        if (bg) {
            ctx.save();
            ctx.globalAlpha = 0.22;
            ctx.drawImage(bg, 0, 0, W, H);
            ctx.restore();
        }

        const colW = 340;
        rr(ctx, 28, 28, colW, H - 56, 28);
        ctx.fillStyle = 'rgba(255,255,255,0.06)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(130,200,255,0.45)';
        ctx.lineWidth = 2;
        ctx.stroke();

        const avImg = await loadAvatar(member);
        const avS = 200;
        const avX = 28 + (colW - avS) / 2;
        const avY = 60;
        ctx.save();
        rr(ctx, avX, avY, avS, avS, avS / 2);
        ctx.clip();
        if (avImg) ctx.drawImage(avImg, avX, avY, avS, avS);
        else {
            ctx.fillStyle = 'rgba(180,220,255,0.3)';
            ctx.fillRect(avX, avY, avS, avS);
        }
        ctx.restore();

        ctx.fillStyle = '#e8f4ff';
        ctx.font = `700 32px ${titleFace}, Arial`;
        ctx.textAlign = 'center';
        ctx.fillText(truncateText(ctx, displayName, colW - 40), 28 + colW / 2, avY + avS + 36);
        ctx.font = `400 18px ${textFace}, Arial`;
        ctx.fillStyle = 'rgba(200,230,255,0.85)';
        ctx.fillText(truncateText(ctx, highestRoleName, colW - 40), 28 + colW / 2, avY + avS + 64);

        const gx = 400;
        const gw = W - gx - 40;
        let y = 48;
        const panel = (h) => {
            rr(ctx, gx, y, gw, h, 20);
            ctx.fillStyle = 'rgba(255,255,255,0.07)';
            ctx.fill();
            ctx.strokeStyle = 'rgba(160,210,255,0.35)';
            ctx.lineWidth = 1.5;
            ctx.stroke();
            const top = y;
            y += h + 18;
            return top;
        };

        const p1 = panel(120);
        ctx.textAlign = 'left';
        ctx.fillStyle = '#7dd3fc';
        ctx.font = `700 22px ${titleFace}, Arial`;
        ctx.fillText('Progression', gx + 24, p1 + 36);
        ctx.fillStyle = '#f0f9ff';
        ctx.font = `600 18px ${textFace}, Arial`;
        ctx.fillText(`Niveau ${user.level ?? 1}`, gx + 24, p1 + 68);
        drawXpBar(ctx, gx + 24, p1 + 82, gw - 48, 14, ratioXp, '#38bdf8', 'rgba(255,255,255,0.12)');
        ctx.font = `500 14px ${textFace}, Arial`;
        ctx.fillStyle = 'rgba(226,232,240,0.9)';
        ctx.fillText(`${(user.xp ?? 0).toLocaleString('fr-FR')} / ${(user.xp_needed ?? 0).toLocaleString('fr-FR')} XP`, gx + 24, p1 + 108);

        const p2 = panel(100);
        ctx.fillStyle = '#a5b4fc';
        ctx.font = `700 22px ${titleFace}, Arial`;
        ctx.fillText('Économie', gx + 24, p2 + 34);
        ctx.fillStyle = '#fff';
        ctx.font = `600 17px ${textFace}, Arial`;
        ctx.fillText(`⭐ ${(user.stars ?? 0).toLocaleString('fr-FR')} Starss`, gx + 24, p2 + 64);
        ctx.fillText(`🏆 ${(user.points ?? 0).toLocaleString('fr-FR')} RP — ${rank?.name ?? 'Rang'}`, gx + 24, p2 + 88);

        const p3 = panel(140);
        ctx.fillStyle = '#c4b5fd';
        ctx.font = `700 22px ${titleFace}, Arial`;
        ctx.fillText('Rang suivant', gx + 24, p3 + 32);
        ctx.fillStyle = '#e2e8f0';
        ctx.font = `500 15px ${textFace}, Arial`;
        if (nextRank) {
            const need = Math.max(0, (nextRank.points ?? 0) - (user.points ?? 0));
            ctx.fillText(`${nextRank.name} — encore ${need.toLocaleString('fr-FR')} RP`, gx + 24, p3 + 62);
        } else {
            ctx.fillText('Rang maximal atteint', gx + 24, p3 + 62);
        }
        if (rankIconPath && fs.existsSync(rankIconPath)) {
            try {
                const ic = await loadImage(fs.readFileSync(rankIconPath));
                ctx.drawImage(ic, gx + gw - 88, p3 + 24, 64, 64);
            } catch {
                /* ignore */
            }
        }

        if (totalDebt > 0) {
            ctx.fillStyle = 'rgba(254,202,202,0.95)';
            ctx.font = `600 15px ${textFace}, Arial`;
            ctx.fillText(`Dette: ${totalDebt.toLocaleString('fr-FR')} ⭐${debtTimeRemaining ? ` — ${debtTimeRemaining}` : ''}`, gx + 24, p3 + 100);
        }
        if (vocalNerfStatus) {
            ctx.fillStyle = 'rgba(251,191,36,0.95)';
            ctx.font = `500 13px ${textFace}, Arial`;
            ctx.fillText(truncateText(ctx, vocalNerfStatus, gw - 48), gx + 24, p3 + 122);
        }

        ctx.fillStyle = 'rgba(148,163,184,0.9)';
        ctx.font = `italic 13px ${textFace}, Arial`;
        ctx.textAlign = 'right';
        ctx.fillText('Aperçu Aurora — /testprofil', W - 32, H - 24);
        ctx.textAlign = 'left';
        return canvas.toBuffer('image/png');
    }

    if (variant === 'nocturne') {
        const canvas = createCanvas(W, H);
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#050508';
        ctx.fillRect(0, 0, W, H);
        ctx.strokeStyle = 'rgba(0,240,255,0.12)';
        ctx.lineWidth = 1;
        for (let x = 0; x < W; x += 48) {
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, H);
            ctx.stroke();
        }
        for (let y = 0; y < H; y += 48) {
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(W, y);
            ctx.stroke();
        }

        const avImg = await loadAvatar(member);
        rr(ctx, 40, 40, 320, 320, 24);
        ctx.strokeStyle = '#00f0ff';
        ctx.lineWidth = 3;
        ctx.stroke();
        ctx.fillStyle = 'rgba(0,0,0,0.45)';
        ctx.fill();
        ctx.save();
        rr(ctx, 56, 56, 288, 288, 20);
        ctx.clip();
        if (avImg) ctx.drawImage(avImg, 56, 56, 288, 288);
        else ctx.fillRect(56, 56, 288, 288);
        ctx.restore();

        ctx.fillStyle = '#fff';
        ctx.font = `800 40px ${titleFace}, Arial`;
        ctx.fillText(truncateText(ctx, displayName, 500), 400, 100);
        ctx.fillStyle = '#ff00aa';
        ctx.font = `700 20px ${textFace}, Arial`;
        ctx.fillText(highestRoleName, 400, 140);

        const bx = 400;
        const by = 180;
        const bw = W - bx - 48;
        rr(ctx, bx, by, bw, 200, 16);
        ctx.fillStyle = 'rgba(255,0,170,0.08)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,0,170,0.5)';
        ctx.stroke();
        ctx.fillStyle = '#00f0ff';
        ctx.font = `700 20px ${titleFace}, Arial`;
        ctx.fillText('NIVEAU & XP', bx + 20, by + 36);
        ctx.fillStyle = '#e2e8f0';
        ctx.font = `600 26px ${textFace}, Arial`;
        ctx.fillText(`${user.level ?? 1}`, bx + 20, by + 76);
        drawXpBar(ctx, bx + 80, by + 58, bw - 100, 18, ratioXp, '#00f0ff', 'rgba(255,255,255,0.1)');
        ctx.font = `500 14px ${textFace}, Arial`;
        ctx.fillText(`${(user.xp ?? 0).toLocaleString('fr-FR')} / ${(user.xp_needed ?? 0).toLocaleString('fr-FR')} XP`, bx + 80, by + 100);

        rr(ctx, bx, by + 220, bw, 200, 16);
        ctx.fillStyle = 'rgba(0,240,255,0.06)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(0,240,255,0.45)';
        ctx.stroke();
        ctx.fillStyle = '#00f0ff';
        ctx.font = `700 20px ${titleFace}, Arial`;
        ctx.fillText('STARSS · RP · RANG', bx + 20, by + 256);
        ctx.fillStyle = '#fff';
        ctx.font = `600 18px ${textFace}, Arial`;
        ctx.fillText(`⭐ ${(user.stars ?? 0).toLocaleString('fr-FR')}`, bx + 20, by + 300);
        ctx.fillText(`🏆 ${(user.points ?? 0).toLocaleString('fr-FR')} RP`, bx + 260, by + 300);
        ctx.fillText(`${rank?.name ?? ''}`, bx + 20, by + 340);
        if (nextRank) {
            ctx.fillStyle = 'rgba(226,232,240,0.8)';
            ctx.font = `500 14px ${textFace}, Arial`;
            const need = Math.max(0, (nextRank.points ?? 0) - (user.points ?? 0));
            ctx.fillText(`→ ${nextRank.name} (${need.toLocaleString('fr-FR')} RP)`, bx + 20, by + 372);
        }

        if (totalDebt > 0) {
            ctx.fillStyle = '#f87171';
            ctx.font = `600 14px ${textFace}, Arial`;
            ctx.fillText(`Dette ${totalDebt.toLocaleString('fr-FR')} ⭐`, bx + 20, by + 400);
        }
        if (vocalNerfStatus) {
            ctx.fillStyle = '#fbbf24';
            ctx.font = `500 12px ${textFace}, Arial`;
            ctx.fillText(truncateText(ctx, vocalNerfStatus, bw - 40), bx + 20, by + 420);
        }

        ctx.fillStyle = 'rgba(148,163,184,0.8)';
        ctx.font = `italic 13px ${textFace}, Arial`;
        ctx.textAlign = 'right';
        ctx.fillText('Aperçu Nocturne — /testprofil', W - 32, H - 22);
        ctx.textAlign = 'left';
        return canvas.toBuffer('image/png');
    }

    /* parchment */
    const canvas = createCanvas(W, H);
    const ctx = canvas.getContext('2d');
    const pg = ctx.createLinearGradient(0, 0, W, H);
    pg.addColorStop(0, '#f0e6d2');
    pg.addColorStop(0.5, '#e5d4bc');
    pg.addColorStop(1, '#d4c4a8');
    ctx.fillStyle = pg;
    ctx.fillRect(0, 0, W, H);

    rr(ctx, 32, 32, W - 64, H - 64, 20);
    ctx.fillStyle = 'rgba(255,252,245,0.55)';
    ctx.fill();
    ctx.strokeStyle = '#5c4033';
    ctx.lineWidth = 4;
    ctx.stroke();
    ctx.strokeStyle = 'rgba(92,64,51,0.35)';
    ctx.lineWidth = 1;
    rr(ctx, 44, 44, W - 88, H - 88, 16);
    ctx.stroke();

    const avImg = await loadAvatar(member);
    const avS = 140;
    ctx.save();
    rr(ctx, 72, 72, avS, avS, avS / 2);
    ctx.clip();
    if (avImg) ctx.drawImage(avImg, 72, 72, avS, avS);
    else {
        ctx.fillStyle = '#c4a574';
        ctx.fillRect(72, 72, avS, avS);
    }
    ctx.restore();
    ctx.strokeStyle = '#4a3020';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(72 + avS / 2, 72 + avS / 2, avS / 2 + 2, 0, Math.PI * 2);
    ctx.stroke();

    ctx.fillStyle = '#2a1810';
    ctx.font = `700 38px ${titleFace}, Arial`;
    ctx.fillText(truncateText(ctx, displayName, 600), 240, 110);
    ctx.font = `600 20px ${textFace}, Arial`;
    ctx.fillStyle = '#5c4033';
    ctx.fillText(highestRoleName, 240, 148);

    const boxX = 240;
    const boxY = 190;
    const boxW = W - boxX - 60;
    rr(ctx, boxX, boxY, boxW, 120, 14);
    ctx.fillStyle = 'rgba(74,48,32,0.08)';
    ctx.fill();
    ctx.strokeStyle = '#5c4033';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = '#3d2918';
    ctx.font = `700 18px ${titleFace}, Arial`;
    ctx.fillText('Niveau & expérience', boxX + 20, boxY + 32);
    drawXpBar(ctx, boxX + 20, boxY + 48, boxW - 40, 16, ratioXp, '#8b5a2b', 'rgba(74,48,32,0.15)');
    ctx.font = `600 15px ${textFace}, Arial`;
    ctx.fillText(`${(user.xp ?? 0).toLocaleString('fr-FR')} / ${(user.xp_needed ?? 0).toLocaleString('fr-FR')} XP`, boxX + 20, boxY + 88);

    const y2 = boxY + 140;
    rr(ctx, boxX, y2, boxW / 2 - 12, 160, 14);
    ctx.fillStyle = 'rgba(74,48,32,0.08)';
    ctx.fill();
    ctx.strokeStyle = '#5c4033';
    ctx.stroke();
    ctx.fillStyle = '#3d2918';
    ctx.font = `700 17px ${titleFace}, Arial`;
    ctx.fillText('Fortune', boxX + 18, y2 + 30);
    ctx.font = `600 22px ${textFace}, Arial`;
    ctx.fillText(`⭐ ${(user.stars ?? 0).toLocaleString('fr-FR')}`, boxX + 18, y2 + 68);

    rr(ctx, boxX + boxW / 2 + 12, y2, boxW / 2 - 12, 160, 14);
    ctx.fillStyle = 'rgba(74,48,32,0.08)';
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#3d2918';
    ctx.font = `700 17px ${titleFace}, Arial`;
    ctx.fillText('Honneur (RP)', boxX + boxW / 2 + 30, y2 + 30);
    ctx.font = `600 20px ${textFace}, Arial`;
    ctx.fillText(`${(user.points ?? 0).toLocaleString('fr-FR')}`, boxX + boxW / 2 + 30, y2 + 68);
    ctx.font = `500 15px ${textFace}, Arial`;
    ctx.fillText(rank?.name ?? '', boxX + boxW / 2 + 30, y2 + 98);
    if (nextRank) {
        const need = Math.max(0, (nextRank.points ?? 0) - (user.points ?? 0));
        ctx.font = `500 13px ${textFace}, Arial`;
        ctx.fillStyle = '#5c4033';
        ctx.fillText(`Prochain : ${nextRank.name} (${need.toLocaleString('fr-FR')} RP)`, boxX + boxW / 2 + 30, y2 + 128);
    }

    if (totalDebt > 0) {
        ctx.fillStyle = '#8b2942';
        ctx.font = `600 14px ${textFace}, Arial`;
        ctx.fillText(`Dette : ${totalDebt.toLocaleString('fr-FR')} ⭐`, 72, 260);
    }
    if (vocalNerfStatus) {
        ctx.fillStyle = '#7a5c1a';
        ctx.font = `500 13px ${textFace}, Arial`;
        ctx.fillText(truncateText(ctx, vocalNerfStatus, boxW), 72, 288);
    }

    ctx.fillStyle = 'rgba(60,40,25,0.65)';
    ctx.font = `italic 13px ${textFace}, Arial`;
    ctx.textAlign = 'right';
    ctx.fillText('Aperçu Parchemin — /testprofil', W - 48, H - 40);
    ctx.textAlign = 'left';
    return canvas.toBuffer('image/png');
}

function normalizeProfileVariant(v) {
    const allowed = PROFILE_PREVIEW_VARIANTS.map((x) => x.id);
    if (allowed.includes(v)) return v;
    return 'aurora';
}

module.exports = {
    PROFILE_PREVIEW_VARIANTS,
    renderProfilePreviewVariant,
    normalizeProfileVariant,
};
