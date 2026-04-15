/**
 * Aperçus /testprofilguilde — thème BLZ saturé (noir, bordeaux, or, jaune, rouge).
 * citadelle | brasier | etendard
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
const H = 800;

const GUILD_PREVIEW_VARIANTS = [
    { id: 'citadelle', label: 'Citadelle', hint: '3 blocs + membres + stats (comme Bastion, couleurs BLZ)' },
    { id: 'brasier', label: 'Brasier', hint: 'Stats à gauche, membres à droite — contrasté' },
    { id: 'etendard', label: 'Étendard', hint: 'Bandeau cramoisi + cartes or + liste' },
];

const C = {
    overlay: 'rgba(22, 6, 10, 0.62)',
    panel: 'rgba(5, 1, 3, 0.94)',
    panelHi: 'rgba(48, 12, 18, 0.95)',
    text: '#fff8f0',
    sub: '#f0b0a8',
    gold: '#ffc928',
    yellow: '#ffd166',
    red: '#ff2d2d',
    crimson: '#7f1020',
    strokeGold: 'rgba(255, 200, 70, 0.75)',
    strokeHot: 'rgba(255, 80, 60, 0.35)',
    peace: '#86efac',
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

function formatValue(n) {
    const v = n || 0;
    if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
    if (v >= 1000) return `${(v / 1000).toFixed(1)}K`;
    return v.toLocaleString('fr-FR');
}

async function drawBlzBackdrop(ctx) {
    const p = path.join(__dirname, '..', 'assets', 'blz_bg.png');
    if (fs.existsSync(p)) {
        try {
            const bg = await loadImage(fs.readFileSync(p));
            ctx.drawImage(bg, 0, 0, W, H);
            ctx.fillStyle = C.overlay;
            ctx.fillRect(0, 0, W, H);
            return;
        } catch {
            /* fallthrough */
        }
    }
    const g = ctx.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, '#120408');
    g.addColorStop(0.4, '#2a0c12');
    g.addColorStop(1, '#080204');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(18, 4, 8, 0.45)';
    ctx.fillRect(0, 0, W, H);
}

function panelBlz(ctx, x, y, w, h, r, fill = C.panel) {
    rr(ctx, x, y, w, h, r);
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.strokeStyle = C.strokeGold;
    ctx.lineWidth = 2.5;
    ctx.stroke();
    ctx.save();
    rr(ctx, x + 2, y + 2, w - 4, h - 4, Math.max(0, r - 2));
    ctx.strokeStyle = C.strokeHot;
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();
}

function drawFooter(ctx, label) {
    ctx.font = 'italic 13px Inter, Arial';
    ctx.fillStyle = 'rgba(255, 200, 100, 0.85)';
    ctx.textAlign = 'right';
    ctx.fillText(label, W - 28, H - 22);
    ctx.textAlign = 'left';
}

function drawMemberLine(ctx, member, guild, x, y, nameMax, titleFace, textFace, valueRightX) {
    let icon = '👤';
    let nameColor = C.text;
    if (member.user_id === guild.owner_id) {
        icon = '👑';
        nameColor = C.gold;
    } else if (guild.sub_chiefs && guild.sub_chiefs.includes(member.user_id)) {
        icon = '⚔️';
        nameColor = '#e8e0ff';
    }
    ctx.font = `20px Arial`;
    ctx.fillText(icon, x, y);
    ctx.font = `700 16px ${titleFace}, Arial`;
    ctx.fillStyle = nameColor;
    ctx.fillText(truncateText(ctx, member.username, nameMax), x + 36, y);
    ctx.font = `700 14px ${textFace}, Arial`;
    ctx.fillStyle = C.yellow;
    const mv = member.total_value || 0;
    ctx.textAlign = 'right';
    ctx.fillText(`💎 ${formatValue(mv)}`, valueRightX, y);
    ctx.textAlign = 'left';
}

/**
 * @param {object} opts
 * @param {'citadelle'|'brasier'|'etendard'} variant
 */
async function renderGuildProfilePreviewVariant(opts, variant) {
    const { guild, members, owner, warInfo, totalMembers } = opts;
    const titleFace = 'InterBold';
    const textFace = 'Inter';
    const ownerName = owner?.username ?? 'Inconnu';
    const up = guild.upgrade_level === 10 ? 'X' : String(guild.upgrade_level);

    if (variant === 'citadelle') {
        const canvas = createCanvas(W, H);
        const ctx = canvas.getContext('2d');
        await drawBlzBackdrop(ctx);

        const pad = 22;
        const gap = 14;
        const topH = 112;
        const cw = (W - pad * 2 - gap * 2) / 3;
        let y0 = 18;

        panelBlz(ctx, pad, y0, cw, topH, 20, C.panelHi);
        ctx.font = `52px Arial`;
        ctx.fillText(guild.emoji, pad + 18, y0 + 72);
        ctx.font = `800 32px ${titleFace}, Arial`;
        ctx.fillStyle = C.text;
        ctx.fillText(truncateText(ctx, guild.name, cw - 90), pad + 82, y0 + 68);

        const x2 = pad + cw + gap;
        panelBlz(ctx, x2, y0, cw, topH, 20, C.panelHi);
        ctx.font = `800 38px ${titleFace}, Arial`;
        ctx.fillStyle = C.yellow;
        ctx.fillText(`💎 ${formatValue(guild.total_value || 0)}`, x2 + 16, y0 + 58);
        ctx.font = `600 15px ${textFace}, Arial`;
        ctx.fillStyle = C.sub;
        ctx.fillText('Valeur totale', x2 + 16, y0 + 92);

        const x3 = pad + (cw + gap) * 2;
        panelBlz(ctx, x3, y0, cw, topH, 20, C.panelHi);
        ctx.font = `800 26px ${titleFace}, Arial`;
        ctx.fillStyle = C.gold;
        ctx.fillText(`Upgrade ${up}`, x3 + 16, y0 + 50);
        ctx.font = `600 16px ${textFace}, Arial`;
        ctx.fillStyle = C.text;
        ctx.fillText(`👥 ${totalMembers} / ${guild.member_slots}`, x3 + 16, y0 + 82);
        ctx.font = `600 14px ${textFace}, Arial`;
        ctx.fillStyle = C.gold;
        ctx.fillText(truncateText(ctx, `👑 ${ownerName}`, cw - 24), x3 + 16, y0 + 106);

        const yMain = y0 + topH + gap;
        const mainH = H - yMain - 32;
        const leftW = 440;

        panelBlz(ctx, pad, yMain, leftW, mainH, 22);
        ctx.font = `800 22px ${titleFace}, Arial`;
        ctx.fillStyle = C.yellow;
        ctx.fillText(`Membres (${totalMembers})`, pad + 20, yMain + 36);
        const startY = yMain + 58;
        const lh = 50;
        for (let i = 0; i < Math.min(10, members.length); i++) {
            const rowY = startY + i * lh;
            if (i % 2 === 0) {
                rr(ctx, pad + 10, rowY - 18, leftW - 20, lh - 6, 10);
                ctx.fillStyle = 'rgba(255, 200, 80, 0.07)';
                ctx.fill();
            }
            drawMemberLine(ctx, members[i], guild, pad + 18, rowY, 220, titleFace, textFace, pad + leftW - 16);
        }
        if (totalMembers > 10) {
            ctx.font = `italic 14px ${textFace}, Arial`;
            ctx.fillStyle = C.sub;
            ctx.fillText(`… +${totalMembers - 10}`, pad + 20, startY + 10 * lh + 4);
        }

        const rx = pad + leftW + gap;
        const rw = W - rx - pad;
        const h1 = Math.round(mainH * 0.38);
        const h2 = Math.round(mainH * 0.34);
        const h3 = mainH - h1 - h2 - gap;
        let yy = yMain;

        panelBlz(ctx, rx, yy, rw, h1, 18);
        ctx.font = `800 22px ${titleFace}, Arial`;
        ctx.fillStyle = C.yellow;
        ctx.fillText('Trésorerie', rx + 18, yy + 32);
        if (guild.upgrade_level < 2) {
            ctx.font = `700 18px ${textFace}, Arial`;
            ctx.fillStyle = '#9ca3af';
            ctx.fillText('🔒 Upgrade 2', rx + 18, yy + 72);
        } else {
            ctx.font = `700 28px ${titleFace}, Arial`;
            ctx.fillStyle = C.text;
            ctx.fillText(
                `${(guild.treasury ?? 0).toLocaleString('fr-FR')} / ${(guild.treasury_capacity ?? 0).toLocaleString('fr-FR')}`,
                rx + 18,
                yy + 68
            );
            ctx.font = `600 14px ${textFace}, Arial`;
            ctx.fillStyle = C.sub;
            const inc = guild.level * 100 * (guild.treasury_multiplier_purchased || 1);
            ctx.fillText(`📈 ${inc.toLocaleString('fr-FR')} ⭐ / jour`, rx + 18, yy + 100);
        }

        yy += h1 + gap;
        panelBlz(ctx, rx, yy, rw, h2, 18);
        ctx.font = `800 22px ${titleFace}, Arial`;
        ctx.fillStyle = C.red;
        ctx.fillText('Guerres', rx + 18, yy + 30);
        if (guild.upgrade_level < 6) {
            ctx.fillStyle = '#9ca3af';
            ctx.font = `700 17px ${textFace}, Arial`;
            ctx.fillText('🔒 Upgrade 6', rx + 18, yy + 68);
        } else {
            ctx.font = `600 16px ${textFace}, Arial`;
            ctx.fillStyle = C.text;
            ctx.fillText(`🏆 ${guild.wars_won ?? 0} · 🔥${guild.wars_won_70 ?? 0} · ⚡${guild.wars_won_80 ?? 0} · 💎${guild.wars_won_90 ?? 0}`, rx + 18, yy + 62);
            if (warInfo && warInfo.status === 'ongoing') {
                ctx.fillStyle = C.red;
                ctx.font = `700 15px ${titleFace}, Arial`;
                ctx.fillText(`⚔️ ${warInfo.opponent}`, rx + 18, yy + 92);
            } else {
                ctx.fillStyle = C.peace;
                ctx.font = `600 15px ${textFace}, Arial`;
                ctx.fillText('🕊️ Paix', rx + 18, yy + 92);
            }
        }

        yy += h2 + gap;
        panelBlz(ctx, rx, yy, rw, h3, 18);
        ctx.font = `800 18px ${titleFace}, Arial`;
        ctx.fillStyle = C.gold;
        ctx.fillText('Infos', rx + 18, yy + 28);
        ctx.font = `600 14px ${textFace}, Arial`;
        ctx.fillStyle = C.text;
        const pct = Math.min(100, Math.round((totalMembers / Math.max(1, guild.member_slots)) * 100));
        ctx.fillText(`Places ${pct} % · 🃏 ${guild.joker_guilde_uses || 0}/3`, rx + 18, yy + 56);
        ctx.fillText(guild.channel_id ? '💬 Salon privé actif' : '💬 Salon : U5', rx + 18, yy + 78);

        drawFooter(ctx, 'Aperçu Citadelle — /testprofilguilde');
        return canvas.toBuffer('image/png');
    }

    if (variant === 'brasier') {
        const canvas = createCanvas(W, H);
        const ctx = canvas.getContext('2d');
        await drawBlzBackdrop(ctx);

        const pad = 22;
        const gap = 16;
        const colL = 400;
        const yTop = 18;
        const hTop = 110;

        panelBlz(ctx, pad, yTop, colL, H - yTop - pad, 22, C.panelHi);
        ctx.font = `800 24px ${titleFace}, Arial`;
        ctx.fillStyle = C.yellow;
        ctx.fillText('Synthèse', pad + 18, yTop + 36);
        ctx.font = `700 42px ${titleFace}, Arial`;
        ctx.fillStyle = C.yellow;
        ctx.fillText(`💎`, pad + 18, yTop + 92);
        ctx.fillText(formatValue(guild.total_value || 0), pad + 64, yTop + 92);
        ctx.font = `700 22px ${textFace}, Arial`;
        ctx.fillStyle = C.gold;
        ctx.fillText(`U${up}`, pad + 18, yTop + 140);
        ctx.font = `600 16px ${textFace}, Arial`;
        ctx.fillStyle = C.text;
        ctx.fillText(`${guild.emoji} ${truncateText(ctx, guild.name, colL - 36)}`, pad + 18, yTop + 180);
        ctx.fillText(`👥 ${totalMembers} / ${guild.member_slots}`, pad + 18, yTop + 212);
        ctx.fillStyle = C.gold;
        ctx.fillText(`👑 ${truncateText(ctx, ownerName, colL - 36)}`, pad + 18, yTop + 244);

        let yy = yTop + 280;
        panelBlz(ctx, pad, yy, colL, 200, 18);
        ctx.font = `800 20px ${titleFace}, Arial`;
        ctx.fillStyle = C.yellow;
        ctx.fillText('Trésorerie', pad + 18, yy + 32);
        if (guild.upgrade_level < 2) {
            ctx.fillStyle = '#9ca3af';
            ctx.font = `700 17px ${textFace}, Arial`;
            ctx.fillText('🔒 U2', pad + 18, yy + 72);
        } else {
            ctx.fillStyle = C.text;
            ctx.font = `700 24px ${titleFace}, Arial`;
            ctx.fillText(`${(guild.treasury ?? 0).toLocaleString('fr-FR')}`, pad + 18, yy + 70);
            ctx.font = `600 13px ${textFace}, Arial`;
            ctx.fillStyle = C.sub;
            ctx.fillText(`cap ${(guild.treasury_capacity ?? 0).toLocaleString('fr-FR')}`, pad + 18, yy + 98);
        }

        yy += 200 + gap;
        panelBlz(ctx, pad, yy, colL, H - yy - pad, 18);
        ctx.font = `800 20px ${titleFace}, Arial`;
        ctx.fillStyle = C.red;
        ctx.fillText('Guerre', pad + 18, yy + 32);
        if (guild.upgrade_level < 6) {
            ctx.fillStyle = '#9ca3af';
            ctx.font = `700 17px ${textFace}, Arial`;
            ctx.fillText('🔒 U6', pad + 18, yy + 72);
        } else if (warInfo && warInfo.status === 'ongoing') {
            ctx.fillStyle = C.red;
            ctx.font = `700 18px ${titleFace}, Arial`;
            ctx.fillText(`VS ${warInfo.opponent}`, pad + 18, yy + 72);
        } else {
            ctx.fillStyle = C.peace;
            ctx.font = `600 17px ${textFace}, Arial`;
            ctx.fillText('Paix', pad + 18, yy + 72);
        }

        const rx = pad + colL + gap;
        const rw = W - rx - pad;
        panelBlz(ctx, rx, yTop, rw, H - yTop - pad, 22, C.panel);
        ctx.font = `800 26px ${titleFace}, Arial`;
        ctx.fillStyle = C.gold;
        ctx.fillText(`Membres`, rx + 22, yTop + 40);
        const startY = yTop + 72;
        const lh = 52;
        for (let i = 0; i < Math.min(10, members.length); i++) {
            const y = startY + i * lh;
            rr(ctx, rx + 12, y - 20, rw - 24, lh - 8, 12);
            ctx.fillStyle = i % 2 === 0 ? 'rgba(255,60,40,0.12)' : 'rgba(255,200,80,0.08)';
            ctx.fill();
            drawMemberLine(ctx, members[i], guild, rx + 22, y, 320, titleFace, textFace, rx + rw - 18);
        }

        drawFooter(ctx, 'Aperçu Brasier — /testprofilguilde');
        return canvas.toBuffer('image/png');
    }

    /* etendard */
    const canvas = createCanvas(W, H);
    const ctx = canvas.getContext('2d');
    await drawBlzBackdrop(ctx);

    const pad = 22;
    const bandH = 100;
    rr(ctx, pad, 16, W - pad * 2, bandH, 16);
    const bg = ctx.createLinearGradient(pad, 0, W - pad, 0);
    bg.addColorStop(0, '#5c0a14');
    bg.addColorStop(0.5, '#8b1424');
    bg.addColorStop(1, '#4a0810');
    ctx.fillStyle = bg;
    ctx.fill();
    ctx.strokeStyle = C.gold;
    ctx.lineWidth = 3;
    ctx.stroke();

    ctx.font = `56px Arial`;
    ctx.fillText(guild.emoji, pad + 28, 88);
    ctx.font = `800 40px ${titleFace}, Arial`;
    ctx.fillStyle = '#fff';
    ctx.fillText(truncateText(ctx, guild.name, 700), pad + 100, 82);
    ctx.font = `600 16px ${textFace}, Arial`;
    ctx.fillStyle = 'rgba(255,230,200,0.95)');
    ctx.fillText(`Chef : ${ownerName} · ${totalMembers}/${guild.member_slots} membres`, pad + 100, 108);

    const yCards = 16 + bandH + 14;
    const cardW = (W - pad * 2 - 28) / 3;
    const ch = 100;
    const drawCard = (i, title, big, small) => {
        const x = pad + i * (cardW + 14);
        panelBlz(ctx, x, yCards, cardW, ch, 16);
        ctx.font = `700 14px ${titleFace}, Arial`;
        ctx.fillStyle = C.gold;
        ctx.fillText(title, x + 16, yCards + 26);
        ctx.font = `800 30px ${titleFace}, Arial`;
        ctx.fillStyle = C.yellow;
        ctx.fillText(big, x + 16, yCards + 64);
        if (small) {
            ctx.font = `600 12px ${textFace}, Arial`;
            ctx.fillStyle = C.sub;
            ctx.fillText(small, x + 16, yCards + 88);
        }
    };
    drawCard(0, 'VALEUR', `💎 ${formatValue(guild.total_value || 0)}`, 'Puissance');
    drawCard(1, 'UPGRADE', `U${up}`, 'Niveau guilde');
    const tr =
        guild.upgrade_level < 2
            ? '🔒 U2'
            : `${(guild.treasury ?? 0).toLocaleString('fr-FR')} ⭐`;
    drawCard(2, 'TRÉSOR', tr, 'Réserve');

    const yList = yCards + ch + 18;
    const listH = H - yList - pad;
    const lw = (W - pad * 2 - 14) * 0.55;
    const rw = W - pad * 2 - 14 - lw;

    panelBlz(ctx, pad, yList, lw, listH, 20);
    ctx.font = `800 22px ${titleFace}, Arial`;
    ctx.fillStyle = C.yellow;
    ctx.fillText('Roster', pad + 18, yList + 34);
    const sy = yList + 56;
    const lh = 48;
    for (let i = 0; i < Math.min(10, members.length); i++) {
        drawMemberLine(ctx, members[i], guild, pad + 14, sy + i * lh, 260, titleFace, textFace);
    }

    const rx = pad + lw + 14;
    panelBlz(ctx, rx, yList, rw, listH, 20);
    ctx.font = `800 20px ${titleFace}, Arial`;
    ctx.fillStyle = C.red;
    ctx.fillText('Guerre & état', rx + 18, yList + 34);
    ctx.font = `600 15px ${textFace}, Arial`;
    ctx.fillStyle = C.text;
    let ly = yList + 70;
    if (guild.upgrade_level < 6) {
        ctx.fillStyle = '#9ca3af';
        ctx.fillText('Guerres verrouillées (U6).', rx + 18, ly);
    } else {
        ctx.fillText(`Victoires totales : ${guild.wars_won ?? 0}`, rx + 18, ly);
        ly += 26;
        if (warInfo && warInfo.status === 'ongoing') {
            ctx.fillStyle = C.red;
            ctx.fillText(`En guerre : ${warInfo.opponent}`, rx + 18, ly);
        } else {
            ctx.fillStyle = C.peace;
            ctx.fillText('Aucune guerre en cours.', rx + 18, ly);
        }
    }
    ly += 36;
    ctx.fillStyle = C.sub;
    ctx.font = `600 14px ${textFace}, Arial`;
    ctx.fillText(`🃏 Jokers ${guild.joker_guilde_uses || 0}/3`, rx + 18, ly);

    drawFooter(ctx, 'Aperçu Étendard — /testprofilguilde');
    return canvas.toBuffer('image/png');
}

function normalizeGuildVariant(v) {
    const allowed = GUILD_PREVIEW_VARIANTS.map((x) => x.id);
    if (allowed.includes(v)) return v;
    return 'citadelle';
}

module.exports = {
    GUILD_PREVIEW_VARIANTS,
    renderGuildProfilePreviewVariant,
    normalizeGuildVariant,
};
