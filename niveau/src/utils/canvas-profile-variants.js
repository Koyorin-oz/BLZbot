/**
 * Aperçu /testprofil — une seule fiche compacte type « carte profil » (thème Carmin, stats BLZ).
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

/** Carte large, pas trop haute (profil discret comme le screen). */
const W = 1040;
const H = 520;

const PROFILE_PREVIEW_VARIANTS = [
    {
        id: 'fiche_blz',
        label: 'Fiche compacte BLZ',
        hint: 'Grille 2×3 Starss / RP / rang / niveau / XP / progression — style Carmin',
    },
];

const LEGACY_PROFILE_VARIANT = Object.freeze({
    carmin: 'fiche_blz',
    carmin_atlas: 'fiche_blz',
    carmin_naos: 'fiche_blz',
    carmin_medalion: 'fiche_blz',
    carmin_tribunal: 'fiche_blz',
    aurora: 'fiche_blz',
    nocturne: 'fiche_blz',
    parchment: 'fiche_blz',
    rubis: 'fiche_blz',
    forge: 'fiche_blz',
    banniere: 'fiche_blz',
    monolithe: 'fiche_blz',
    vitres: 'fiche_blz',
    braise: 'fiche_blz',
});

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
    const ew = ctx.measureText(ellipsis).width;
    while (width > maxWidth - ew && text.length > 0) {
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

async function loadAvatar(member) {
    const url = member?.displayAvatarURL({ extension: 'png', size: 256 });
    if (!url) return null;
    try {
        return await loadImage(url);
    } catch {
        return null;
    }
}

/** Fond Carmin distinct (oblique + vignette, moins « radial coin » que l’ancien pack). */
async function drawFicheBackdrop(ctx) {
    const g = ctx.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, '#14080a');
    g.addColorStop(0.45, '#1e0c10');
    g.addColorStop(1, '#0a0406');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    const bg = await tryLoadBlzBg();
    if (bg) {
        ctx.save();
        ctx.globalAlpha = 0.22;
        ctx.drawImage(bg, 0, 0, W, H);
        ctx.restore();
    }

    const ob = ctx.createLinearGradient(0, H, W, 0);
    ob.addColorStop(0, 'rgba(120, 20, 35, 0.38)');
    ob.addColorStop(0.55, 'rgba(40, 8, 14, 0.15)');
    ob.addColorStop(1, 'rgba(20, 6, 10, 0.45)');
    ctx.fillStyle = ob;
    ctx.fillRect(0, 0, W, H);

    const v = ctx.createRadialGradient(W * 0.15, H * 0.85, 0, W * 0.35, H * 0.65, H * 0.9);
    v.addColorStop(0, 'rgba(255, 120, 40, 0.12)');
    v.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = v;
    ctx.fillRect(0, 0, W, H);
}

function glassCell(ctx, x, y, w, h, r) {
    rr(ctx, x, y, w, h, r);
    ctx.fillStyle = 'rgba(255, 248, 245, 0.09)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 200, 160, 0.22)';
    ctx.lineWidth = 1;
    ctx.stroke();
}

/** Police étroite type screen : Arial Narrow si dispo, sinon Inter resserré. */
function setCondensedTitle(ctx, sizePx, weight) {
    ctx.font = `${weight} ${sizePx}px "Arial Narrow", "Franklin Gothic Medium", Arial`;
}

function setCondensedBody(ctx, sizePx, weight) {
    ctx.font = `${weight} ${sizePx}px "Arial Narrow", "Franklin Gothic Medium", Inter, Arial`;
}

function drawCondensedText(ctx, text, x, y, maxW, sizePx, weight, color, scaleX = 0.92) {
    setCondensedBody(ctx, sizePx, weight);
    ctx.fillStyle = color;
    if (scaleX >= 1) {
        ctx.fillText(truncateText(ctx, text, maxW), x, y);
        return;
    }
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(scaleX, 1);
    ctx.fillText(truncateText(ctx, text, maxW / scaleX), 0, 0);
    ctx.restore();
}

async function renderFicheBlz(data) {
    const { user, member, rank, rankIconPath, totalDebt, vocalNerfStatus } = data;
    const displayName = member?.displayName ?? 'Utilisateur';
    const joined = member?.joinedAt
        ? member.joinedAt.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' })
        : '—';

    const xpNeed = Math.max(1, user.xp_needed ?? 1);
    const xpCur = user.xp ?? 0;
    const ratio = Math.max(0, Math.min(1, xpCur / xpNeed));
    const pct = (ratio * 100).toFixed(1);
    const nextLevel = (user.level ?? 1) + 1;

    const canvas = createCanvas(W, H);
    const ctx = canvas.getContext('2d');
    await drawFicheBackdrop(ctx);

    const pad = 18;
    const outerR = 22;
    rr(ctx, pad, pad, W - pad * 2, H - pad * 2, outerR);
    ctx.fillStyle = 'rgba(8, 2, 4, 0.55)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 180, 120, 0.28)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    const innerPad = 14;
    const x0 = pad + innerPad;
    const y0 = pad + innerPad;
    const innerW = W - pad * 2 - innerPad * 2;
    const innerH = H - pad * 2 - innerPad * 2;

    const colAvatar = 128;
    const gap = 14;
    const mainX = x0 + colAvatar + gap;
    const mainW = innerW - colAvatar - gap;

    /* Colonne avatar (modeste, pas énorme) */
    glassCell(ctx, x0, y0, colAvatar, innerH, 16);
    const avImg = await loadAvatar(member);
    const avR = 40;
    const avCx = x0 + colAvatar / 2;
    const avCy = y0 + 88;
    ctx.save();
    ctx.beginPath();
    ctx.arc(avCx, avCy, avR, 0, Math.PI * 2);
    ctx.clip();
    if (avImg) ctx.drawImage(avImg, avCx - avR, avCy - avR, avR * 2, avR * 2);
    else {
        ctx.fillStyle = 'rgba(255,255,255,0.15)';
        ctx.fillRect(avCx - avR, avCy - avR, avR * 2, avR * 2);
    }
    ctx.restore();
    ctx.beginPath();
    ctx.arc(avCx, avCy, avR + 2, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255, 220, 200, 0.45)';
    ctx.lineWidth = 2;
    ctx.stroke();

    /* Titre + membre depuis */
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    setCondensedTitle(ctx, 34, 700);
    ctx.fillStyle = '#ffffff';
    const titleMax = mainW - 84;
    ctx.save();
    ctx.translate(mainX, y0 + 36);
    ctx.scale(0.9, 1);
    ctx.fillText(truncateText(ctx, displayName, titleMax / 0.9), 0, 0);
    ctx.restore();

    setCondensedBody(ctx, 14, 500);
    ctx.fillStyle = 'rgba(255, 245, 240, 0.78)';
    ctx.fillText(`Membre depuis : ${joined}`, mainX, y0 + 58);

    /* Mini vignette rang (coin haut droit) */
    const thumb = 52;
    const thumbX = mainX + mainW - thumb - 4;
    const thumbY = y0 + 6;
    glassCell(ctx, thumbX, thumbY, thumb, thumb, 10);
    if (rankIconPath && fs.existsSync(rankIconPath)) {
        try {
            const ic = await loadImage(fs.readFileSync(rankIconPath));
            const inset = 6;
            ctx.save();
            rr(ctx, thumbX + inset, thumbY + inset, thumb - inset * 2, thumb - inset * 2, 6);
            ctx.clip();
            ctx.drawImage(ic, thumbX + inset, thumbY + inset, thumb - inset * 2, thumb - inset * 2);
            ctx.restore();
        } catch {
            /* ignore */
        }
    }

    /* Grille 2 × 3 */
    const gridTop = y0 + 78;
    const gridH = innerH - 78 - 52 - 28;
    const cellGap = 10;
    const cellW = (mainW - cellGap) / 2;
    const cellH = (gridH - cellGap * 2) / 3;

    const cells = [
        { label: 'STARSS', value: `${(user.stars ?? 0).toLocaleString('fr-FR')} ⭐` },
        { label: 'POINTS RP', value: `${(user.points ?? 0).toLocaleString('fr-FR')} RP` },
        { label: 'RANG ACTUEL', value: rank?.name ?? '—' },
        { label: 'NIVEAU', value: String(user.level ?? 1) },
        {
            label: 'XP',
            value: `${(xpCur).toLocaleString('fr-FR')} / ${(user.xp_needed ?? 0).toLocaleString('fr-FR')}`,
        },
        { label: 'PROGRESSION', value: `${pct} %` },
    ];

    for (let i = 0; i < 6; i++) {
        const col = i % 2;
        const row = Math.floor(i / 2);
        const cx = mainX + col * (cellW + cellGap);
        const cy = gridTop + row * (cellH + cellGap);
        glassCell(ctx, cx, cy, cellW, cellH, 12);
        setCondensedBody(ctx, 10, 600);
        ctx.fillStyle = 'rgba(255, 230, 220, 0.65)';
        ctx.textTransform = 'uppercase';
        ctx.fillText(cells[i].label, cx + 12, cy + 22);
        setCondensedTitle(ctx, 20, 700);
        ctx.fillStyle = '#ffffff';
        ctx.fillText(truncateText(ctx, cells[i].value, cellW - 24), cx + 12, cy + cellH - 14);
    }

    /* Barre progression niveau */
    const barY = y0 + innerH - 46;
    const barW = innerW;
    const barH = 14;
    const barX = x0;
    rr(ctx, barX, barY, barW, barH, barH / 2);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
    ctx.fill();
    const fillW = Math.max(barH, Math.round(barW * ratio));
    const grad = ctx.createLinearGradient(barX, 0, barX + barW, 0);
    grad.addColorStop(0, '#fb923c');
    grad.addColorStop(0.5, '#ef4444');
    grad.addColorStop(1, '#dc2626');
    rr(ctx, barX, barY, fillW, barH, barH / 2);
    ctx.fillStyle = grad;
    ctx.fill();

    setCondensedBody(ctx, 12, 500);
    ctx.fillStyle = 'rgba(255, 250, 245, 0.88)';
    ctx.fillText(`${pct} % vers le niveau ${nextLevel}`, barX, barY + barH + 18);

    if (totalDebt > 0 || vocalNerfStatus) {
        setCondensedBody(ctx, 11, 600);
        ctx.fillStyle = 'rgba(252, 165, 165, 0.95)';
        let ty = barY + barH + 34;
        if (totalDebt > 0) {
            ctx.fillText(`Dette : ${(totalDebt).toLocaleString('fr-FR')} ⭐`, barX, ty);
            ty += 14;
        }
        if (vocalNerfStatus) {
            ctx.fillStyle = 'rgba(253, 224, 71, 0.95)';
            ctx.fillText(truncateText(ctx, vocalNerfStatus, barW), barX, ty);
        }
    }

    ctx.fillStyle = 'rgba(255, 200, 170, 0.75)';
    ctx.font = 'italic 11px "Arial Narrow", Arial';
    ctx.textAlign = 'right';
    ctx.fillText('Aperçu fiche BLZ — /testprofil', W - pad - 8, H - pad - 6);
    ctx.textAlign = 'left';

    return canvas.toBuffer('image/png');
}

async function renderProfilePreviewVariant(data, variant) {
    const v = LEGACY_PROFILE_VARIANT[variant] || variant;
    if (v === 'fiche_blz' || !PROFILE_PREVIEW_VARIANTS.some((x) => x.id === v)) {
        return renderFicheBlz(data);
    }
    return renderFicheBlz(data);
}

function normalizeProfileVariant(v) {
    const resolved = LEGACY_PROFILE_VARIANT[v] || v;
    if (resolved === 'fiche_blz') return 'fiche_blz';
    return 'fiche_blz';
}

module.exports = {
    PROFILE_PREVIEW_VARIANTS,
    renderProfilePreviewVariant,
    normalizeProfileVariant,
};
