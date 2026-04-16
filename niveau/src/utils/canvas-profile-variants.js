/**
 * Aperçus /testprofil — fiches BLZ Carmin.
 * fiche_1 : colonne + grille 2×3 (version actuelle sauvegardée).
 * fiche_2 : dimensions ref. PNG 1024×381, layout 3×2 + colonne avatar (identique au screen de référence).
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

const W = 1040;
const H = 520;
/** Fiche 2 — même taille que l’asset de référence (1024×381). */
const W2 = 1024;
const H2 = 381;

const PROFILE_PREVIEW_VARIANTS = [
    {
        id: 'fiche_1',
        label: 'Fiche 1 — colonne + 2×3',
        hint: 'Colonne avatar + grille 2×3 + barre sous le bloc principal (version sauvegardée)',
    },
    {
        id: 'fiche_2',
        label: 'Fiche 2 — ref. screen (1024×381)',
        hint: 'Même ratio et style que le PNG de référence : colonne avatar, grille 3×2, barre or→brique',
    },
];

const LEGACY_PROFILE_VARIANT = Object.freeze({
    fiche_blz: 'fiche_1',
    carmin: 'fiche_1',
    carmin_atlas: 'fiche_1',
    carmin_naos: 'fiche_1',
    carmin_medalion: 'fiche_1',
    carmin_tribunal: 'fiche_1',
    aurora: 'fiche_1',
    nocturne: 'fiche_1',
    parchment: 'fiche_1',
    rubis: 'fiche_1',
    forge: 'fiche_1',
    banniere: 'fiche_1',
    monolithe: 'fiche_1',
    vitres: 'fiche_1',
    braise: 'fiche_1',
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

/** Fond fiche 1 (oblique + vignette chaude). */
async function drawBackdrop1(ctx) {
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

/** Fond fiche 2 — bruns saturés + léger relief (moins « gris / lavé » que la ref. plate). */
async function drawBackdrop2(ctx, cw, ch) {
    const g = ctx.createRadialGradient(cw * 0.48, ch * 0.4, 0, cw * 0.5, ch * 0.48, Math.hypot(cw, ch) * 0.78);
    g.addColorStop(0, '#6b4538');
    g.addColorStop(0.28, '#523028');
    g.addColorStop(0.65, '#3d201c');
    g.addColorStop(1, '#1c0c0a');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, cw, ch);

    const warm = ctx.createRadialGradient(cw * 0.2, ch * 0.85, 0, cw * 0.35, ch * 0.55, ch * 0.9);
    warm.addColorStop(0, 'rgba(180, 70, 45, 0.14)');
    warm.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = warm;
    ctx.fillRect(0, 0, cw, ch);

    const bg = await tryLoadBlzBg();
    if (bg) {
        ctx.save();
        ctx.globalAlpha = 0.1;
        ctx.drawImage(bg, 0, 0, cw, ch);
        ctx.restore();
    }

    ctx.strokeStyle = 'rgba(40, 18, 14, 0.2)';
    ctx.lineWidth = 1;
    for (let d = -ch; d < cw + ch; d += 28) {
        ctx.beginPath();
        ctx.moveTo(d, 0);
        ctx.lineTo(d + ch * 0.9, ch);
        ctx.stroke();
    }

    const edge = ctx.createLinearGradient(0, 0, cw, ch);
    edge.addColorStop(0, 'rgba(0,0,0,0.14)');
    edge.addColorStop(0.4, 'rgba(0,0,0,0)');
    edge.addColorStop(1, 'rgba(0,0,0,0.2)');
    ctx.fillStyle = edge;
    ctx.fillRect(0, 0, cw, ch);
}

function glassCell(ctx, x, y, w, h, r) {
    rr(ctx, x, y, w, h, r);
    ctx.fillStyle = 'rgba(255, 248, 245, 0.09)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 200, 160, 0.22)';
    ctx.lineWidth = 1;
    ctx.stroke();
}

/** Cellules type ref. 2 — brun semi-transparent (fiche 1 / ancien). */
function simbaCell(ctx, x, y, w, h, r) {
    rr(ctx, x, y, w, h, r);
    ctx.fillStyle = 'rgba(77, 42, 36, 0.58)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(120, 70, 60, 0.35)';
    ctx.lineWidth = 1;
    ctx.stroke();
}

/** Cellules fiche 2 — ton brique plus riche + contraste sur le fond. */
function refStatCell(ctx, x, y, w, h, r) {
    rr(ctx, x, y, w, h, r);
    const cg = ctx.createLinearGradient(x, y, x, y + h);
    cg.addColorStop(0, '#7a4a3e');
    cg.addColorStop(0.55, '#5c3228');
    cg.addColorStop(1, '#4a261e');
    ctx.fillStyle = cg;
    ctx.fill();
    ctx.strokeStyle = 'rgba(220, 140, 100, 0.28)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.35)';
    ctx.lineWidth = 1;
    rr(ctx, x + 0.5, y + 0.5, w - 1, h - 1, Math.max(0, r - 0.5));
    ctx.stroke();
    ctx.save();
    rr(ctx, x + 1, y + 1, w - 2, h - 2, Math.max(0, r - 1));
    ctx.clip();
    const hi = ctx.createLinearGradient(x, y, x, y + h * 0.4);
    hi.addColorStop(0, 'rgba(255, 200, 170, 0.1)');
    hi.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = hi;
    ctx.fillRect(x, y, w, h * 0.45);
    ctx.restore();
}

function setCondensedTitle(ctx, sizePx, weight) {
    ctx.font = `${weight} ${sizePx}px "Arial Narrow", "Franklin Gothic Medium", Arial`;
}

function setCondensedBody(ctx, sizePx, weight) {
    ctx.font = `${weight} ${sizePx}px "Arial Narrow", "Franklin Gothic Medium", Inter, Arial`;
}

function drawXpBarGradient(ctx, x, y, w, h, ratio, c0, c1, c2, track) {
    rr(ctx, x, y, w, h, h / 2);
    ctx.fillStyle = track;
    ctx.fill();
    const r = Math.max(0, Math.min(1, ratio));
    if (r > 0) {
        const fw = Math.max(h, Math.round(w * r));
        const g = ctx.createLinearGradient(x, 0, x + fw, 0);
        g.addColorStop(0, c0);
        g.addColorStop(0.55, c1);
        g.addColorStop(1, c2);
        rr(ctx, x, y, fw, h, h / 2);
        ctx.fillStyle = g;
        ctx.fill();
    }
}

async function renderFiche1(data) {
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
    await drawBackdrop1(ctx);

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

    glassCell(ctx, x0, y0, colAvatar, innerH, 16);
    const avImg = await loadAvatar(member);
    const avR = 40;
    const avCx = x0 + colAvatar / 2;
    const avCy = y0 + 72;
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

    /* Mini barre XP en bas de la colonne gauche */
    const sbW = colAvatar - 20;
    const sbX = x0 + 10;
    const sbY = y0 + innerH - 42;
    drawXpBarGradient(ctx, sbX, sbY, sbW, 8, ratio, '#fb923c', '#ef4444', '#dc2626', 'rgba(0,0,0,0.35)');
    setCondensedBody(ctx, 10, 500);
    ctx.fillStyle = 'rgba(255, 250, 245, 0.88)';
    ctx.textAlign = 'center';
    ctx.fillText(`${pct} % vers le niveau ${nextLevel}`, x0 + colAvatar / 2, sbY + 22);
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
            value: `${xpCur.toLocaleString('fr-FR')} / ${(user.xp_needed ?? 0).toLocaleString('fr-FR')}`,
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
        ctx.fillText(cells[i].label, cx + 12, cy + 22);
        setCondensedTitle(ctx, 20, 700);
        ctx.fillStyle = '#ffffff';
        ctx.fillText(truncateText(ctx, cells[i].value, cellW - 24), cx + 12, cy + cellH - 14);
    }

    const barY = y0 + innerH - 46;
    const barH = 14;
    rr(ctx, mainX, barY, mainW, barH, barH / 2);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
    ctx.fill();
    const fillW = Math.max(barH, Math.round(mainW * ratio));
    const grad = ctx.createLinearGradient(mainX, 0, mainX + mainW, 0);
    grad.addColorStop(0, '#fb923c');
    grad.addColorStop(0.5, '#ef4444');
    grad.addColorStop(1, '#dc2626');
    rr(ctx, mainX, barY, fillW, barH, barH / 2);
    ctx.fillStyle = grad;
    ctx.fill();

    setCondensedBody(ctx, 12, 500);
    ctx.fillStyle = 'rgba(255, 250, 245, 0.88)';
    ctx.fillText(`${pct} % vers le niveau ${nextLevel}`, mainX, barY + barH + 18);

    if (totalDebt > 0 || vocalNerfStatus) {
        setCondensedBody(ctx, 11, 600);
        let ty = barY + barH + 34;
        if (totalDebt > 0) {
            ctx.fillStyle = 'rgba(252, 165, 165, 0.95)';
            ctx.fillText(`Dette : ${totalDebt.toLocaleString('fr-FR')} ⭐`, mainX, ty);
            ty += 14;
        }
        if (vocalNerfStatus) {
            ctx.fillStyle = 'rgba(253, 224, 71, 0.95)';
            ctx.fillText(truncateText(ctx, vocalNerfStatus, mainW), mainX, ty);
        }
    }

    ctx.fillStyle = 'rgba(255, 200, 170, 0.75)';
    ctx.font = 'italic 11px "Arial Narrow", Arial';
    ctx.textAlign = 'right';
    ctx.fillText('Fiche 1 — /testprofil', W - pad - 8, H - pad - 6);
    ctx.textAlign = 'left';

    return canvas.toBuffer('image/png');
}

async function renderFiche2(data) {
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

    const canvas = createCanvas(W2, H2);
    const ctx = canvas.getContext('2d');
    await drawBackdrop2(ctx, W2, H2);

    const pad = 12;
    const outerR = 16;
    const cardW = W2 - pad * 2;
    const cardH = H2 - pad * 2;
    rr(ctx, pad, pad, cardW, cardH, outerR);
    const cardG = ctx.createLinearGradient(pad, pad, pad + cardW, pad + cardH);
    cardG.addColorStop(0, '#4a2e28');
    cardG.addColorStop(0.5, '#3d2420');
    cardG.addColorStop(1, '#321c18');
    ctx.fillStyle = cardG;
    ctx.fill();
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.5)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.save();
    rr(ctx, pad + 0.5, pad + 0.5, cardW - 1, cardH - 1, outerR - 0.5);
    ctx.strokeStyle = 'rgba(255, 160, 120, 0.12)';
    ctx.stroke();
    ctx.restore();

    const innerPad = 10;
    const x0 = pad + innerPad;
    const y0 = pad + innerPad;
    const innerW = W2 - pad * 2 - innerPad * 2;
    const innerH = H2 - pad * 2 - innerPad * 2;

    const leftW = Math.round(innerW * 0.292);
    const gap = 11;
    const mainX = x0 + leftW + gap;
    const mainW = innerW - leftW - gap;

    /* Colonne avatar — plus sombre et chaude pour se détacher de la carte */
    rr(ctx, x0, y0, leftW, innerH, 14);
    const leftG = ctx.createLinearGradient(x0, y0, x0 + leftW, y0);
    leftG.addColorStop(0, '#3a1814');
    leftG.addColorStop(1, '#28100c');
    ctx.fillStyle = leftG;
    ctx.fill();
    ctx.strokeStyle = 'rgba(180, 90, 70, 0.22)';
    ctx.lineWidth = 1;
    ctx.stroke();

    const avImg = await loadAvatar(member);
    const avR = Math.min(leftW * 0.36, innerH * 0.34);
    const avCx = x0 + leftW / 2;
    const avCy = y0 + innerH * 0.5;
    ctx.save();
    ctx.beginPath();
    ctx.arc(avCx, avCy, avR, 0, Math.PI * 2);
    ctx.clip();
    if (avImg) ctx.drawImage(avImg, avCx - avR, avCy - avR, avR * 2, avR * 2);
    else {
        ctx.fillStyle = 'rgba(255,255,255,0.1)';
        ctx.fillRect(avCx - avR, avCy - avR, avR * 2, avR * 2);
    }
    ctx.restore();
    ctx.beginPath();
    ctx.arc(avCx, avCy, avR + 1.5, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(245, 228, 210, 0.55)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    setCondensedTitle(ctx, 28, 700);
    ctx.fillStyle = '#ffffff';
    const thumb = 48;
    const titleMax = mainW - thumb - 10;
    ctx.save();
    ctx.translate(mainX, y0 + 30);
    ctx.scale(0.92, 1);
    ctx.fillText(truncateText(ctx, displayName, titleMax / 0.92), 0, 0);
    ctx.restore();

    setCondensedBody(ctx, 12, 500);
    ctx.fillStyle = 'rgba(255, 236, 220, 0.95)';
    ctx.fillText(`Membre depuis : ${joined}`, mainX, y0 + 50);

    const thumbX = mainX + mainW - thumb;
    const thumbY = y0 + 4;
    rr(ctx, thumbX, thumbY, thumb, thumb, 10);
    ctx.fillStyle = '#2a1814';
    ctx.fill();
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.35)';
    ctx.stroke();
    if (rankIconPath && fs.existsSync(rankIconPath)) {
        try {
            const ic = await loadImage(fs.readFileSync(rankIconPath));
            const inset = 4;
            ctx.save();
            rr(ctx, thumbX + inset, thumbY + inset, thumb - inset * 2, thumb - inset * 2, 7);
            ctx.clip();
            ctx.drawImage(ic, thumbX + inset, thumbY + inset, thumb - inset * 2, thumb - inset * 2);
            ctx.restore();
        } catch {
            /* ignore */
        }
    }

    const gridTop = y0 + 64;
    const bottomBlock = 48;
    const gridH = innerH - 64 - bottomBlock;
    const gGap = 10;
    const cellW = (mainW - gGap * 2) / 3;
    const cellH = (gridH - gGap) / 2;

    const cells = [
        { label: 'STARSS', value: `${(user.stars ?? 0).toLocaleString('fr-FR')} ⭐` },
        { label: 'POINTS RP', value: `${(user.points ?? 0).toLocaleString('fr-FR')} RP` },
        { label: 'RANG ACTUEL', value: rank?.name ?? '—' },
        { label: 'NIVEAU', value: String(user.level ?? 1) },
        {
            label: 'LEVEL POINTS',
            value: `${xpCur.toLocaleString('fr-FR')}/${(user.xp_needed ?? 0).toLocaleString('fr-FR')}`,
        },
        { label: 'PROGRESSION', value: `${pct}%` },
    ];

    for (let i = 0; i < 6; i++) {
        const col = i % 3;
        const row = Math.floor(i / 3);
        const cx = mainX + col * (cellW + gGap);
        const cy = gridTop + row * (cellH + gGap);
        refStatCell(ctx, cx, cy, cellW, cellH, 12);
        setCondensedBody(ctx, 9, 600);
        ctx.fillStyle = 'rgba(255, 255, 255, 0.88)';
        ctx.fillText(cells[i].label, cx + 10, cy + 18);
        setCondensedTitle(ctx, 17, 700);
        ctx.fillStyle = '#ffffff';
        ctx.fillText(truncateText(ctx, cells[i].value, cellW - 18), cx + 10, cy + cellH - 12);
    }

    const barY = y0 + innerH - 36;
    const barH = 12;
    rr(ctx, mainX, barY, mainW, barH, barH / 2);
    ctx.fillStyle = '#2a1a18';
    ctx.fill();
    const fillW = Math.max(barH, Math.round(mainW * ratio));
    const lg = ctx.createLinearGradient(mainX, 0, mainX + mainW, 0);
    lg.addColorStop(0, '#f0b45b');
    lg.addColorStop(0.55, '#d07048');
    lg.addColorStop(1, '#b34a33');
    rr(ctx, mainX, barY, fillW, barH, barH / 2);
    ctx.fillStyle = lg;
    ctx.fill();

    setCondensedBody(ctx, 11, 500);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(`${pct}% vers le niveau ${nextLevel}`, mainX, barY + barH + 15);

    if (totalDebt > 0 || vocalNerfStatus) {
        setCondensedBody(ctx, 9, 600);
        let ty = barY + barH + 26;
        if (totalDebt > 0) {
            ctx.fillStyle = 'rgba(252, 165, 165, 0.95)';
            ctx.fillText(`Dette : ${totalDebt.toLocaleString('fr-FR')} ⭐`, mainX, ty);
            ty += 12;
        }
        if (vocalNerfStatus) {
            ctx.fillStyle = 'rgba(253, 224, 71, 0.95)';
            ctx.fillText(truncateText(ctx, vocalNerfStatus, mainW), mainX, ty);
        }
    }

    return canvas.toBuffer('image/png');
}

async function renderProfilePreviewVariant(data, variant) {
    const v = LEGACY_PROFILE_VARIANT[variant] || variant;
    if (v === 'fiche_2') return renderFiche2(data);
    return renderFiche1(data);
}

function normalizeProfileVariant(v) {
    const resolved = LEGACY_PROFILE_VARIANT[v] || v;
    const allowed = PROFILE_PREVIEW_VARIANTS.map((x) => x.id);
    if (allowed.includes(resolved)) return resolved;
    return 'fiche_1';
}

module.exports = {
    PROFILE_PREVIEW_VARIANTS,
    renderProfilePreviewVariant,
    normalizeProfileVariant,
};
