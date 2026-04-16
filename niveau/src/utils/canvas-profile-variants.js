/**
 * Aperçus /testprofil (Fiche 1 ou 2) et carte /profil-v2 (Fiche 2).
 * fiche_1 : colonne + grille 2×3 (version actuelle sauvegardée).
 * fiche_2 : 1024×381 — blz_bg + voile léger (fond visible), panneaux noirs semi-transparents.
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

/** Fiche 2 : fond blz_bg plus visible + carrés noirs semi-transparents (type autres modèles). */
const PROFILE_CARD_THEME = Object.freeze({
    /** Plein /profile sur 1200×700 ; fiche 2 seule : overlay plus léger pour laisser le motif ressortir. */
    fiche2BackdropOverlay: 'rgba(0,0,0,0.28)',
    panel: 'rgba(0,0,0,0.56)',
    header: 'rgba(0,0,0,0.52)',
    shell: 'rgba(0,0,0,0.44)',
    text: '#ffffff',
    sub: '#f2d7d3',
    accent: '#ffd166',
    outline: 'rgba(255,255,255,0.38)',
    statFontPx: 20,
});

/** Jaune (staff + libellés grille STARSS, POINTS RP, etc.) — un ton plus soutenu que `accent` (barre / déco). */
const PREVIEW_STAFF_TITLE_COLOR = '#e8b83a';

/** Bump manuel pour vérifier que l’hôte exécute bien ce fichier (pied des cartes + message /testprofil). */
const PROFILE_PREVIEW_BUILD = 'tp20260417';

const PROFILE_PREVIEW_VARIANTS = [
    {
        id: 'fiche_1',
        label: 'Fiche 1 — colonne + 2×3',
        hint: 'Colonne avatar + grille 2×3 + barre sous le bloc principal (version sauvegardée)',
    },
    {
        id: 'fiche_2',
        label: 'Fiche 2 — fond /profile (1024×381)',
        hint: 'Fond blz_bg bien visible, panneaux noirs transparents — grille 3×2',
    },
];

const LEGACY_PROFILE_VARIANT = Object.freeze({
    fiche_blz: 'fiche_1',
    carmin: 'fiche_1',
    carmin_atlas: 'fiche_2',
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

async function tryLoadProfileCornerB() {
    const p = path.join(__dirname, '..', 'assets', 'profile-corner-b.png');
    if (!fs.existsSync(p)) return null;
    try {
        return await loadImage(fs.readFileSync(p));
    } catch {
        return null;
    }
}

/** Badges « exclusifs » (DB) — mêmes fichiers que /profile. */
async function loadUserBadgeImages(userId, limit = 8) {
    if (!userId) return [];
    const { getUserBadges } = require('../database/db-badges');
    const rows = getUserBadges(userId, limit);
    const dir = path.join(__dirname, '..', 'assets', 'badges');
    const out = [];
    for (const row of rows) {
        const fp = path.join(dir, `${row.badge_id}.png`);
        if (!fs.existsSync(fp)) continue;
        try {
            out.push(await loadImage(fs.readFileSync(fp)));
        } catch {
            /* ignore */
        }
    }
    return out;
}

/** Dernière case fiche 2 : guilde (nom + emoji, paix/guerre, niveau). */
function drawFiche2GuildCell(ctx, cx, cy, cw, ch, user, previewHasGuild) {
    const padX = 12;
    let ly = cy + 10;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';

    if (!previewHasGuild) {
        ctx.font = '700 15px InterBold, Arial';
        ctx.fillStyle = PREVIEW_STAFF_TITLE_COLOR;
        ctx.fillText(truncateText(ctx, user.guild_name || 'Aucune guilde', cw - padX * 2), cx + padX, ly);
        ctx.font = '500 12px Inter, Arial';
        ctx.fillStyle = PROFILE_CARD_THEME.sub;
        ctx.fillText('—', cx + padX, ly + 22);
        ctx.textBaseline = 'alphabetic';
        return;
    }

    const gName = user.guild_name || 'Guilde';
    let gEmoji = user.guild_emoji || '⚔️';
    if (typeof gEmoji === 'string' && gEmoji.includes('<')) gEmoji = '⚔️';

    ctx.font = '700 15px InterBold, Arial';
    ctx.fillStyle = PREVIEW_STAFF_TITLE_COLOR;
    const emojiSlot = 28;
    const nameMax = Math.max(40, cw - padX * 2 - emojiSlot);
    const nameStr = truncateText(ctx, gName, nameMax);
    ctx.fillText(nameStr, cx + padX, ly);
    const nw = ctx.measureText(nameStr).width;
    ctx.font = '18px "Segoe UI Emoji", "Apple Color Emoji", Arial';
    ctx.fillText(gEmoji, cx + padX + nw + 6, ly - 1);

    ly += 22;
    const atWar = String(user.guild_state || '').includes('Guerre');
    ctx.font = '600 13px InterBold, Inter, Arial';
    ctx.fillStyle = atWar ? '#ef4444' : '#22c55e';
    ctx.fillText(atWar ? 'En guerre' : 'En paix', cx + padX, ly);

    ly += 20;
    ctx.font = '700 13px InterBold, Arial';
    ctx.fillStyle = PREVIEW_STAFF_TITLE_COLOR;
    ctx.fillText(`Niveau ${user.guild_level ?? 1}`, cx + padX, ly);
    ctx.textBaseline = 'alphabetic';
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

/** Fond fiche 2 — blz_bg plein cadre + voile plus léger que /profile pour que le motif ressorte. */
async function drawBackdrop2(ctx, cw, ch) {
    const bg = await tryLoadBlzBg();
    if (bg) {
        ctx.drawImage(bg, 0, 0, cw, ch);
    } else {
        ctx.fillStyle = '#1a0a0c';
        ctx.fillRect(0, 0, cw, ch);
    }
    ctx.fillStyle = PROFILE_CARD_THEME.fiche2BackdropOverlay;
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

/** Cellules fiche 2 — panneau semi-transparent (moins noir que l’overlay /profile seul). */
function refStatCell(ctx, x, y, w, h, r) {
    rr(ctx, x, y, w, h, r);
    ctx.fillStyle = PROFILE_CARD_THEME.panel;
    ctx.fill();
    ctx.strokeStyle = PROFILE_CARD_THEME.outline;
    ctx.lineWidth = 2;
    ctx.stroke();
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
    const { user, member, rank, rankIconPath, totalDebt, vocalNerfStatus, invokerStaffTitle, invokerMember, invokerUser } =
        data;
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
    const avatarForLeft = invokerStaffTitle ? invokerMember || invokerUser || member : member;
    const avImg = await loadAvatar(avatarForLeft);
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

    if (invokerStaffTitle) {
        const staffMax = colAvatar - 12;
        setCondensedBody(ctx, 12, 600);
        ctx.fillStyle = PREVIEW_STAFF_TITLE_COLOR;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillText(truncateText(ctx, invokerStaffTitle, staffMax), avCx, avCy + avR + 8);
        ctx.textAlign = 'left';
        ctx.textBaseline = 'alphabetic';
    }

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
        ctx.fillStyle = PREVIEW_STAFF_TITLE_COLOR;
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
    ctx.fillText(`Fiche 1 — /testprofil · ${PROFILE_PREVIEW_BUILD}`, W - pad - 8, H - pad - 6);
    ctx.textAlign = 'left';

    return canvas.toBuffer('image/png');
}

async function renderFiche2(data) {
    const {
        user,
        member,
        rank,
        rankIconPath,
        totalDebt,
        vocalNerfStatus,
        invokerStaffTitle,
        invokerMember,
        invokerUser,
        previewHasGuild,
    } = data;
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
    ctx.fillStyle = PROFILE_CARD_THEME.shell;
    ctx.fill();
    ctx.strokeStyle = PROFILE_CARD_THEME.outline;
    ctx.lineWidth = 2;
    ctx.stroke();

    const innerPad = 10;
    const x0 = pad + innerPad;
    const y0 = pad + innerPad;
    const innerW = W2 - pad * 2 - innerPad * 2;
    const innerH = H2 - pad * 2 - innerPad * 2;

    const leftW = Math.round(innerW * 0.292);
    const gap = 11;
    const mainX = x0 + leftW + gap;
    const mainW = innerW - leftW - gap;

    /* Colonne avatar — même « header » que /profile */
    rr(ctx, x0, y0, leftW, innerH, 14);
    ctx.fillStyle = PROFILE_CARD_THEME.header;
    ctx.fill();
    ctx.strokeStyle = PROFILE_CARD_THEME.outline;
    ctx.lineWidth = 2;
    ctx.stroke();

    const avatarForLeft = invokerStaffTitle ? invokerMember || invokerUser || member : member;
    const avImg = await loadAvatar(avatarForLeft);
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
    ctx.arc(avCx, avCy, avR + 2, 0, Math.PI * 2);
    ctx.strokeStyle = PROFILE_CARD_THEME.outline;
    ctx.lineWidth = 2;
    ctx.stroke();

    if (invokerStaffTitle) {
        const staffMax = leftW - 16;
        ctx.font = '600 12px InterBold, Inter, Arial';
        ctx.fillStyle = PREVIEW_STAFF_TITLE_COLOR;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillText(truncateText(ctx, invokerStaffTitle, staffMax), avCx, avCy + avR + 10);
        ctx.textAlign = 'left';
        ctx.textBaseline = 'alphabetic';
    }

    const [cornerBImg, badgeImgs] = await Promise.all([
        tryLoadProfileCornerB(),
        loadUserBadgeImages(data.userId, 8),
    ]);

    const thumb = 48;
    const thumbX = mainX + mainW - thumb;
    const thumbY = y0 + 4;
    const rowRightLimit = thumbX - 10;

    const badgeSize = 26;
    const badgeGap = 5;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.font = '700 34px InterBold, Arial';
    ctx.fillStyle = PROFILE_CARD_THEME.text;

    let maxB = Math.min(badgeImgs.length, 8);
    let nameDraw = displayName;
    for (;;) {
        const badgeBlock = maxB > 0 ? maxB * (badgeSize + badgeGap) - badgeGap : 0;
        const nameAvail = rowRightLimit - mainX - badgeBlock - (maxB > 0 ? 10 : 0);
        nameDraw = truncateText(ctx, displayName, Math.max(48, nameAvail));
        const nw = ctx.measureText(nameDraw).width;
        if (nw + badgeBlock + (maxB > 0 ? 10 : 0) <= rowRightLimit - mainX || maxB === 0) break;
        maxB -= 1;
    }
    ctx.fillText(nameDraw, mainX, y0 + 32);
    const nameW = ctx.measureText(nameDraw).width;
    let bx = mainX + nameW + 10;
    const badgeY = y0 + 8;
    for (let bi = 0; bi < maxB; bi++) {
        ctx.drawImage(badgeImgs[bi], bx, badgeY, badgeSize, badgeSize);
        bx += badgeSize + badgeGap;
    }

    ctx.font = '500 14px Inter, Arial';
    ctx.fillStyle = PROFILE_CARD_THEME.sub;
    ctx.fillText(`Membre depuis : ${joined}`, mainX, y0 + 54);

    rr(ctx, thumbX, thumbY, thumb, thumb, 10);
    ctx.fillStyle = PROFILE_CARD_THEME.header;
    ctx.fill();
    ctx.strokeStyle = PROFILE_CARD_THEME.outline;
    ctx.lineWidth = 2;
    ctx.stroke();
    const cornerInset = 4;
    const innerS = thumb - cornerInset * 2;
    try {
        if (cornerBImg) {
            ctx.save();
            rr(ctx, thumbX + cornerInset, thumbY + cornerInset, innerS, innerS, 7);
            ctx.clip();
            ctx.drawImage(cornerBImg, thumbX + cornerInset, thumbY + cornerInset, innerS, innerS);
            ctx.restore();
        } else if (rankIconPath && fs.existsSync(rankIconPath)) {
            const ic = await loadImage(fs.readFileSync(rankIconPath));
            ctx.save();
            rr(ctx, thumbX + cornerInset, thumbY + cornerInset, innerS, innerS, 7);
            ctx.clip();
            ctx.drawImage(ic, thumbX + cornerInset, thumbY + cornerInset, innerS, innerS);
            ctx.restore();
        }
    } catch {
        /* ignore */
    }

    const gridTop = y0 + 70;
    const bottomBlock = 52;
    const gridH = innerH - 70 - bottomBlock;
    const gGap = 10;
    const cellW = (mainW - gGap * 2) / 3;
    const cellH = (gridH - gGap) / 2;

    const cells = [
        { label: 'STARSS', value: `${(user.stars ?? 0).toLocaleString('fr-FR')} ⭐` },
        { label: 'POINTS RP', value: `${(user.points ?? 0).toLocaleString('fr-FR')} RP` },
        { label: 'RANG ACTUEL', value: rank?.name ?? '—' },
        { label: 'NIVEAU', value: String(user.level ?? 1) },
        {
            label: 'XP',
            value: `${xpCur.toLocaleString('fr-FR')} / ${(user.xp_needed ?? 0).toLocaleString('fr-FR')}`,
        },
    ];

    for (let i = 0; i < 5; i++) {
        const col = i % 3;
        const row = Math.floor(i / 3);
        const cx = mainX + col * (cellW + gGap);
        const cy = gridTop + row * (cellH + gGap);
        refStatCell(ctx, cx, cy, cellW, cellH, 12);
        const statPx = PROFILE_CARD_THEME.statFontPx;
        const labelY = cy + 4 + statPx;
        const valueY = cy + 8 + statPx * 2;
        ctx.textBaseline = 'alphabetic';
        ctx.font = `700 ${statPx}px InterBold, Arial`;
        ctx.fillStyle = PREVIEW_STAFF_TITLE_COLOR;
        ctx.fillText(cells[i].label, cx + 12, labelY);
        ctx.fillStyle = PROFILE_CARD_THEME.text;
        ctx.fillText(truncateText(ctx, cells[i].value, cellW - 20), cx + 12, valueY);
    }
    {
        const col = 2;
        const row = 1;
        const cx = mainX + col * (cellW + gGap);
        const cy = gridTop + row * (cellH + gGap);
        refStatCell(ctx, cx, cy, cellW, cellH, 12);
        drawFiche2GuildCell(ctx, cx, cy, cellW, cellH, user, Boolean(previewHasGuild));
    }

    const barY = y0 + innerH - 38;
    const barH = 14;
    rr(ctx, mainX, barY, mainW, barH, barH / 2);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
    ctx.fill();
    const fillW = Math.max(barH, Math.round(mainW * ratio));
    if (ratio > 0 && ratio < 0.12) {
        const cx = mainX + Math.max(barH * 0.5, fillW);
        const cy = barY + barH / 2;
        ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
        ctx.fillRect(mainX + barH * 0.35, cy - 2, Math.max(0, cx - mainX - barH * 0.5), 4);
        ctx.beginPath();
        ctx.arc(cx, cy, barH / 2 + 2, 0, Math.PI * 2);
        ctx.fillStyle = PROFILE_CARD_THEME.accent;
        ctx.fill();
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
        ctx.lineWidth = 1;
        ctx.stroke();
    } else if (fillW > 0) {
        const lg = ctx.createLinearGradient(mainX, 0, mainX + fillW, 0);
        lg.addColorStop(0, '#ffcc33');
        lg.addColorStop(0.45, '#f5a623');
        lg.addColorStop(1, '#e65c00');
        rr(ctx, mainX, barY, fillW, barH, barH / 2);
        ctx.fillStyle = lg;
        ctx.fill();
    }

    ctx.font = '500 13px Inter, Arial';
    ctx.fillStyle = PROFILE_CARD_THEME.sub;
    ctx.fillText(`${pct}% vers le niveau ${nextLevel}`, mainX, barY + barH + 17);

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

    ctx.fillStyle = 'rgba(242, 215, 211, 0.55)';
    ctx.font = 'italic 11px Inter, Arial';
    ctx.textAlign = 'right';
    ctx.fillText(`Fiche 2 — /profil-v2 · ${PROFILE_PREVIEW_BUILD}`, W2 - pad - 6, H2 - pad - 4);
    ctx.textAlign = 'left';

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
    PROFILE_PREVIEW_BUILD,
    PROFILE_PREVIEW_VARIANTS,
    renderProfilePreviewVariant,
    normalizeProfileVariant,
};
