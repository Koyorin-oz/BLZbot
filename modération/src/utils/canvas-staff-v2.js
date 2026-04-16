const { createCanvas, loadImage, registerFont } = require('canvas');
const fs = require('node:fs');
const path = require('node:path');

const W = 1024;
const H = 420;

const THEME = {
    overlay: 'rgba(0,0,0,0.40)',
    shell: 'rgba(0,0,0,0.44)',
    panel: 'rgba(0,0,0,0.56)',
    header: 'rgba(0,0,0,0.52)',
    text: '#ffffff',
    sub: '#b8c5d3',
    accent: '#e8b83a',
    roleLavender: '#a5b4fc',
    warn: '#ef4444',
    ok: '#22c55e',
    outline: 'rgba(255,255,255,0.38)',
};

const STAFF_CARD_BUILD = 'tp20260417';

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

function formatDate(timestamp) {
    if (!timestamp) return '—';
    const date = new Date(timestamp);
    return date.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

async function loadStaffBackground() {
    const assetsPath = path.join(__dirname, '..', 'assets');
    const p = path.join(assetsPath, 'profile.png');
    if (!fs.existsSync(p)) return null;
    try {
        return await loadImage(fs.readFileSync(p));
    } catch {
        return null;
    }
}

async function loadAvatar(member) {
    const url = member?.displayAvatarURL?.({ extension: 'png', size: 256 });
    if (!url) return null;
    try {
        return await loadImage(url);
    } catch {
        return null;
    }
}

function wrapLines(ctx, text, maxWidth, maxLines) {
    const words = String(text || '').split(/\s+/).filter(Boolean);
    if (!words.length) return ['—'];
    const lines = [];
    let line = words[0];
    for (let i = 1; i < words.length; i++) {
        const test = `${line} ${words[i]}`;
        if (ctx.measureText(test).width <= maxWidth) line = test;
        else {
            lines.push(line);
            line = words[i];
            if (lines.length >= maxLines - 1) break;
        }
    }
    lines.push(line);
    if (lines.length > maxLines) return lines.slice(0, maxLines);
    return lines;
}

/**
 * Carte staff compacte (même fond asset que /profilstaff), mise en page proche du profil BLZ v2.
 * @param {object} data — même forme que renderStaffProfileCard (profilstaff)
 */
async function renderStaffProfileCardV2(data) {
    const bg = await loadStaffBackground();
    const canvas = createCanvas(W, H);
    const ctx = canvas.getContext('2d');

    if (bg) {
        ctx.drawImage(bg, 0, 0, W, H);
    } else {
        ctx.fillStyle = '#1a2528';
        ctx.fillRect(0, 0, W, H);
    }
    ctx.fillStyle = THEME.overlay;
    ctx.fillRect(0, 0, W, H);

    const pad = 12;
    const outerR = 16;
    const cardW = W - pad * 2;
    const cardH = H - pad * 2;
    rr(ctx, pad, pad, cardW, cardH, outerR);
    ctx.fillStyle = THEME.shell;
    ctx.fill();
    ctx.strokeStyle = THEME.outline;
    ctx.lineWidth = 2;
    ctx.stroke();

    const innerPad = 10;
    const x0 = pad + innerPad;
    const y0 = pad + innerPad;
    const innerW = W - pad * 2 - innerPad * 2;
    const innerH = H - pad * 2 - innerPad * 2;

    const leftW = Math.round(innerW * 0.26);
    const gap = 11;
    const mainX = x0 + leftW + gap;
    const mainW = innerW - leftW - gap;

    /* Colonne gauche — avatar */
    rr(ctx, x0, y0, leftW, innerH, 14);
    ctx.fillStyle = THEME.header;
    ctx.fill();
    ctx.strokeStyle = THEME.outline;
    ctx.lineWidth = 2;
    ctx.stroke();

    const avImg = await loadAvatar(data.member);
    const avR = Math.min(leftW * 0.34, innerH * 0.28);
    const avCx = x0 + leftW / 2;
    const avCy = y0 + innerH * 0.42;
    ctx.save();
    ctx.beginPath();
    ctx.arc(avCx, avCy, avR, 0, Math.PI * 2);
    ctx.clip();
    if (avImg) ctx.drawImage(avImg, avCx - avR, avCy - avR, avR * 2, avR * 2);
    else {
        ctx.fillStyle = 'rgba(255,255,255,0.12)';
        ctx.fillRect(avCx - avR, avCy - avR, avR * 2, avR * 2);
    }
    ctx.restore();
    ctx.beginPath();
    ctx.arc(avCx, avCy, avR + 2, 0, Math.PI * 2);
    ctx.strokeStyle = THEME.outline;
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.fillStyle = 'rgba(180, 200, 220, 0.55)';
    ctx.font = 'italic 10px Inter, Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillText(`Staff v2 · ${STAFF_CARD_BUILD}`, x0 + leftW / 2, y0 + innerH - 6);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';

    /* Bandeau identité */
    const headH = 76;
    rr(ctx, mainX, y0, mainW, headH, 12);
    ctx.fillStyle = THEME.header;
    ctx.fill();
    ctx.strokeStyle = THEME.outline;
    ctx.lineWidth = 2;
    ctx.stroke();

    const displayName = data.member?.displayName ?? 'Utilisateur';
    ctx.font = '700 26px InterBold, Arial';
    ctx.fillStyle = THEME.text;
    const nameMax = mainW - 200;
    ctx.fillText(truncateText(ctx, displayName, nameMax), mainX + 12, y0 + 34);

    ctx.font = '600 14px Inter, Arial';
    ctx.fillStyle = THEME.roleLavender;
    ctx.fillText(truncateText(ctx, data.staffRole || 'Staff', nameMax), mainX + 12, y0 + 56);

    ctx.textAlign = 'right';
    ctx.font = '600 12px InterBold, Inter, Arial';
    if (data.inSensitivity) {
        ctx.fillStyle = THEME.warn;
        ctx.fillText('Sensibilité : OUI', mainX + mainW - 12, y0 + 28);
        ctx.fillStyle = THEME.sub;
        ctx.font = '500 11px Inter, Arial';
        ctx.fillText(
            data.sensitivityEnd ? `Jusqu'au ${formatDate(data.sensitivityEnd)}` : '—',
            mainX + mainW - 12,
            y0 + 48
        );
    } else {
        ctx.fillStyle = THEME.sub;
        ctx.fillText('Sensibilité : NON', mainX + mainW - 12, y0 + 34);
    }
    ctx.textAlign = 'left';

    /* Statistiques */
    const statsY = y0 + headH + 10;
    const statsH = 128;
    rr(ctx, mainX, statsY, mainW, statsH, 12);
    ctx.fillStyle = THEME.panel;
    ctx.fill();
    ctx.strokeStyle = THEME.outline;
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.font = '700 16px InterBold, Arial';
    ctx.fillStyle = THEME.accent;
    ctx.fillText('Statistiques', mainX + 12, statsY + 22);

    const candAccepted = (data.candidatures || []).filter((c) => c.status === 'accepte').length;
    const candRejected = (data.candidatures || []).filter((c) => c.status === 'refuse').length;
    const modoAccepted = (data.modoTestPeriods || []).filter((p) => p.result === 'accepte').length;
    const modoRejected = (data.modoTestPeriods || []).filter((p) => p.result === 'refuse').length;

    const col1 = mainX + 12;
    const col2 = mainX + mainW / 2 + 4;
    const line1 = statsY + 44;
    const line2 = statsY + 64;
    const line3 = statsY + 86;
    const line4 = statsY + 106;

    ctx.font = '600 12px Inter, Arial';
    ctx.fillStyle = THEME.text;
    ctx.fillText(
        `Historique candidatures : ${(data.candidatures || []).length} (${candAccepted} ✅ / ${candRejected} ❌)`,
        col1,
        line1
    );
    ctx.fillStyle = THEME.accent;
    ctx.font = '600 11px InterBold, Inter, Arial';
    ctx.fillText(`Chances actuelles : ${data.candidatureChances ?? 2}/2`, col1 + 8, line2);

    ctx.font = '600 12px Inter, Arial';
    ctx.fillStyle = THEME.text;
    ctx.fillText(
        `Historique modo tests : ${(data.modoTestPeriods || []).length} (${modoAccepted} ✅ / ${modoRejected} ❌)`,
        col1,
        line3
    );
    ctx.fillStyle = THEME.accent;
    ctx.font = '600 11px InterBold, Inter, Arial';
    ctx.fillText(`Chances actuelles : ${data.modoTestChances ?? 1}/1`, col1 + 8, line4);

    ctx.font = '600 12px Inter, Arial';
    ctx.fillStyle = THEME.text;
    ctx.fillText(`Sanctions émises : ${data.sanctions ?? 0}`, col2, line1);
    ctx.fillStyle = (data.staffWarns || 0) > 0 ? THEME.warn : THEME.text;
    ctx.fillText(`Warns staff : ${data.staffWarns ?? 0}`, col2, line2 + 22);

    const currentModoTest = (data.modoTestPeriods || []).find(
        (p) => p.status === 'en_cours' || p.status === 'vote_en_cours'
    );
    if (currentModoTest) {
        const isVoting = currentModoTest.status === 'vote_en_cours';
        ctx.font = '600 11px InterBold, Inter, Arial';
        ctx.fillStyle = isVoting ? THEME.accent : THEME.roleLavender;
        ctx.fillText(
            isVoting ? 'Vote de promotion en cours' : 'Modo test en cours',
            col2,
            statsY + statsH - 14
        );
    }

    /* Deux panneaux bas */
    const bottomY = statsY + statsH + 10;
    const bottomH = innerH - (bottomY - y0) - 4;
    const halfW = (mainW - 10) / 2;

    function drawBottomPanel(px, title, emptyText, fillContent) {
        rr(ctx, px, bottomY, halfW, bottomH, 12);
        ctx.fillStyle = THEME.panel;
        ctx.fill();
        ctx.strokeStyle = THEME.outline;
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.font = '700 14px InterBold, Arial';
        ctx.fillStyle = THEME.accent;
        ctx.fillText(title, px + 10, bottomY + 20);
        ctx.font = '500 11px Inter, Arial';
        ctx.fillStyle = THEME.sub;
        if (fillContent) fillContent(px + 10, bottomY + 36, halfW - 20, bottomH - 44);
        else ctx.fillText(emptyText, px + 10, bottomY + 42);
    }

    drawBottomPanel(mainX, 'Historique des postes', 'Aucune promotion enregistrée', (ox, oy, cw, ch) => {
        const promos = (data.promotions || []).slice(0, 4);
        if (!promos.length) {
            ctx.fillText('Aucune promotion enregistrée', ox, oy);
            return;
        }
        let y = oy;
        for (const p of promos) {
            ctx.fillStyle = THEME.text;
            ctx.font = '600 11px Inter, Arial';
            ctx.fillText(truncateText(ctx, p.role_name || '—', cw), ox, y);
            y += 14;
            ctx.fillStyle = THEME.sub;
            ctx.font = '500 10px Inter, Arial';
            ctx.fillText(formatDate(p.date), ox, y);
            y += 18;
            if (y > oy + ch - 10) break;
        }
    });

    drawBottomPanel(mainX + halfW + 10, 'Appréciations', 'Aucune appréciation', (ox, oy, cw, ch) => {
        const appr = (data.appreciations || []).slice(0, 2);
        if (!appr.length) {
            ctx.fillText('Aucune appréciation', ox, oy);
            return;
        }
        let y = oy;
        for (const a of appr) {
            ctx.fillStyle = THEME.sub;
            ctx.font = '500 10px Inter, Arial';
            ctx.fillText(formatDate(a.date), ox, y);
            y += 12;
            ctx.fillStyle = THEME.text;
            ctx.font = '500 10px Inter, Arial';
            const lines = wrapLines(ctx, a.appreciation || '—', cw, 3);
            for (const ln of lines) {
                ctx.fillText(truncateText(ctx, ln, cw), ox, y);
                y += 12;
                if (y > oy + ch - 8) return;
            }
            y += 6;
        }
    });

    ctx.fillStyle = 'rgba(200, 215, 230, 0.45)';
    ctx.font = 'italic 10px Inter, Arial';
    ctx.textAlign = 'right';
    ctx.fillText(`Carte staff — /profil-staff-v2 · ${STAFF_CARD_BUILD}`, W - pad - 6, H - pad - 4);
    ctx.textAlign = 'left';

    return canvas.toBuffer('image/png');
}

module.exports = { renderStaffProfileCardV2, STAFF_CARD_BUILD };
