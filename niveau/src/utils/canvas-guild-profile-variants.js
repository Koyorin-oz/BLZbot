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

/** Panneaux semi-transparents (comme canvas-guild-profile-v2 /profil-guilde). */
const C = {
    overlay: 'rgba(18, 4, 8, 0.58)',
    panel: 'rgba(6, 2, 4, 0.66)',
    panelHi: 'rgba(32, 10, 16, 0.76)',
    panelRed: 'rgba(40, 8, 14, 0.62)',
    text: '#fff8f0',
    sub: '#f0b8b0',
    gold: '#ffc928',
    yellow: '#ffd166',
    red: '#ff2d2d',
    crimson: '#7f1020',
    strokeGold: 'rgba(255, 200, 70, 0.65)',
    strokeHot: 'rgba(255, 80, 60, 0.32)',
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
        /** Brasier : bandeau pleine largeur + tableau membres + 3 blocs bas (≠ Citadelle). */
        const canvas = createCanvas(W, H);
        const ctx = canvas.getContext('2d');
        await drawBlzBackdrop(ctx);

        const pad = 22;
        const gap = 14;
        const y0 = 18;
        const headH = 102;
        const innerW = W - pad * 2;

        panelBlz(ctx, pad, y0, innerW, headH, 20, C.panelHi);
        ctx.font = `48px Arial`;
        ctx.fillText(guild.emoji, pad + 20, y0 + 72);
        ctx.font = `800 30px ${titleFace}, Arial`;
        ctx.fillStyle = C.text;
        ctx.fillText(truncateText(ctx, guild.name, 420), pad + 86, y0 + 52);
        ctx.font = `600 14px ${textFace}, Arial`;
        ctx.fillStyle = C.sub;
        ctx.fillText(`👑 ${truncateText(ctx, ownerName, 400)} · 👥 ${totalMembers}/${guild.member_slots}`, pad + 86, y0 + 78);

        ctx.textAlign = 'right';
        ctx.font = `800 36px ${titleFace}, Arial`;
        ctx.fillStyle = C.yellow;
        ctx.fillText(`💎 ${formatValue(guild.total_value || 0)}`, pad + innerW - 20, y0 + 58);
        ctx.font = `600 14px ${textFace}, Arial`;
        ctx.fillStyle = C.gold;
        ctx.fillText(`Upgrade ${up}`, pad + innerW - 20, y0 + 86);
        ctx.textAlign = 'left';

        const yTable = y0 + headH + gap;
        const bottomH = 168;
        const tableH = H - yTable - bottomH - pad - 10;

        panelBlz(ctx, pad, yTable, innerW, tableH, 18, C.panel);
        ctx.font = `800 22px ${titleFace}, Arial`;
        ctx.fillStyle = C.gold;
        ctx.fillText('Membres', pad + 20, yTable + 34);
        ctx.strokeStyle = 'rgba(255, 200, 80, 0.35)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(pad + 16, yTable + 44);
        ctx.lineTo(pad + innerW - 16, yTable + 44);
        ctx.stroke();
        ctx.font = `700 12px ${titleFace}, Arial`;
        ctx.fillStyle = C.sub;
        ctx.fillText('#', pad + 28, yTable + 64);
        ctx.fillText('Membre', pad + 72, yTable + 64);
        ctx.textAlign = 'right';
        ctx.fillText('Valeur', pad + innerW - 28, yTable + 64);
        ctx.textAlign = 'left';

        const startY = yTable + 78;
        const lh = 46;
        for (let i = 0; i < Math.min(10, members.length); i++) {
            const y = startY + i * lh;
            rr(ctx, pad + 12, y - 20, innerW - 24, lh - 6, 10);
            ctx.fillStyle = i % 2 === 0 ? 'rgba(255, 200, 80, 0.07)' : 'rgba(255, 60, 40, 0.06)';
            ctx.fill();
            ctx.font = `600 13px ${textFace}, Arial`;
            ctx.fillStyle = C.sub;
            ctx.fillText(String(i + 1), pad + 28, y);
            drawMemberLine(ctx, members[i], guild, pad + 64, y, innerW - 200, titleFace, textFace, pad + innerW - 28);
        }
        if (totalMembers > 10) {
            ctx.font = `italic 13px ${textFace}, Arial`;
            ctx.fillStyle = C.sub;
            ctx.fillText(`… +${totalMembers - 10}`, pad + 20, startY + 10 * lh + 4);
        }

        const yBot = yTable + tableH + gap;
        const cw = (innerW - gap * 2) / 3;
        let bx = pad;

        panelBlz(ctx, bx, yBot, cw, bottomH, 16, C.panelRed);
        ctx.font = `800 18px ${titleFace}, Arial`;
        ctx.fillStyle = C.yellow;
        ctx.fillText('Trésorerie', bx + 16, yBot + 30);
        if (guild.upgrade_level < 2) {
            ctx.font = `700 16px ${textFace}, Arial`;
            ctx.fillStyle = '#9ca3af';
            ctx.fillText('🔒 Upgrade 2', bx + 16, yBot + 68);
            ctx.font = `500 13px ${textFace}, Arial`;
            ctx.fillStyle = C.sub;
            ctx.fillText('Déblocage requis', bx + 16, yBot + 92);
        } else {
            ctx.font = `700 22px ${titleFace}, Arial`;
            ctx.fillStyle = C.text;
            ctx.fillText(`${(guild.treasury ?? 0).toLocaleString('fr-FR')}`, bx + 16, yBot + 64);
            ctx.font = `600 12px ${textFace}, Arial`;
            ctx.fillStyle = C.sub;
            ctx.fillText(`/ ${(guild.treasury_capacity ?? 0).toLocaleString('fr-FR')} ⭐`, bx + 16, yBot + 90);
            const inc = guild.level * 100 * (guild.treasury_multiplier_purchased || 1);
            ctx.fillText(`📈 ${inc.toLocaleString('fr-FR')} / jour`, bx + 16, yBot + 118);
        }

        bx += cw + gap;
        panelBlz(ctx, bx, yBot, cw, bottomH, 16, C.panelRed);
        ctx.font = `800 18px ${titleFace}, Arial`;
        ctx.fillStyle = C.red;
        ctx.fillText('Guerres', bx + 16, yBot + 30);
        if (guild.upgrade_level < 6) {
            ctx.fillStyle = '#9ca3af';
            ctx.font = `700 16px ${textFace}, Arial`;
            ctx.fillText('🔒 Upgrade 6', bx + 16, yBot + 68);
        } else {
            ctx.font = `600 14px ${textFace}, Arial`;
            ctx.fillStyle = C.text;
            ctx.fillText(`🏆 ${guild.wars_won ?? 0} victoires`, bx + 16, yBot + 62);
            if (warInfo && warInfo.status === 'ongoing') {
                ctx.fillStyle = C.red;
                ctx.font = `700 14px ${titleFace}, Arial`;
                ctx.fillText(`⚔️ ${truncateText(ctx, warInfo.opponent, cw - 32)}`, bx + 16, yBot + 92);
            } else {
                ctx.fillStyle = C.peace;
                ctx.font = `600 14px ${textFace}, Arial`;
                ctx.fillText('🕊️ Paix', bx + 16, yBot + 92);
            }
        }

        bx += cw + gap;
        panelBlz(ctx, bx, yBot, cw, bottomH, 16, C.panel);
        ctx.font = `800 18px ${titleFace}, Arial`;
        ctx.fillStyle = C.gold;
        ctx.fillText('Infos', bx + 16, yBot + 30);
        ctx.font = `600 14px ${textFace}, Arial`;
        ctx.fillStyle = C.text;
        const pct = Math.min(100, Math.round((totalMembers / Math.max(1, guild.member_slots)) * 100));
        ctx.fillText(`Places ${pct} %`, bx + 16, yBot + 68);
        ctx.fillText(`🃏 ${guild.joker_guilde_uses || 0}/3`, bx + 16, yBot + 94);
        ctx.font = `500 12px ${textFace}, Arial`;
        ctx.fillStyle = C.sub;
        ctx.fillText(guild.channel_id ? '💬 Salon actif' : '💬 Salon : U5', bx + 16, yBot + 122);

        drawFooter(ctx, 'Aperçu Brasier — /testprofilguilde');
        return canvas.toBuffer('image/png');
    }

    /* Étendard : colonne stats à gauche + zone droite (guerre haut, roster bas). */
    const canvas = createCanvas(W, H);
    const ctx = canvas.getContext('2d');
    await drawBlzBackdrop(ctx);

    const pad = 22;
    const gap = 14;
    const spineW = 248;
    const xMain = pad + spineW + gap;
    const mainW = W - xMain - pad;

    rr(ctx, pad, 18, spineW, H - 36, 18);
    const spineG = ctx.createLinearGradient(pad, 0, pad + spineW, 0);
    spineG.addColorStop(0, 'rgba(92, 10, 20, 0.55)');
    spineG.addColorStop(0.5, 'rgba(120, 18, 32, 0.5)');
    spineG.addColorStop(1, 'rgba(50, 8, 14, 0.58)');
    ctx.fillStyle = spineG;
    ctx.fill();
    ctx.strokeStyle = C.strokeGold;
    ctx.lineWidth = 2.5;
    ctx.stroke();

    ctx.font = `44px Arial`;
    ctx.fillText(guild.emoji, pad + 20, 78);
    ctx.font = `800 22px ${titleFace}, Arial`;
    ctx.fillStyle = C.text;
    ctx.fillText(truncateText(ctx, guild.name, spineW - 28), pad + 16, 108);
    ctx.font = `600 12px ${textFace}, Arial`;
    ctx.fillStyle = 'rgba(255, 230, 200, 0.9)';
    ctx.fillText(truncateText(ctx, `Chef : ${ownerName}`, spineW - 20), pad + 16, 132);

    const chip = (y, label, value, color) => {
        rr(ctx, pad + 12, y, spineW - 24, 56, 12);
        ctx.fillStyle = 'rgba(6, 2, 4, 0.45)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(255, 200, 80, 0.35)';
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.font = `600 11px ${titleFace}, Arial`;
        ctx.fillStyle = C.sub;
        ctx.fillText(label, pad + 22, y + 20);
        ctx.font = `800 20px ${titleFace}, Arial`;
        ctx.fillStyle = color;
        ctx.fillText(value, pad + 22, y + 46);
    };
    chip(156, 'VALEUR', `💎 ${formatValue(guild.total_value || 0)}`, C.yellow);
    chip(220, 'UPGRADE', `U${up}`, C.gold);
    chip(284, 'MEMBRES', `${totalMembers}/${guild.member_slots}`, C.text);

    const warH = Math.round((H - 36 - gap) * 0.36);
    const rosterY = 18 + warH + gap;
    const rosterH = H - rosterY - pad;

    panelBlz(ctx, xMain, 18, mainW, warH, 18, C.panelRed);
    ctx.font = `800 24px ${titleFace}, Arial`;
    ctx.fillStyle = C.red;
    ctx.fillText('Guerre & défense', xMain + 20, 18 + 36);
    ctx.font = `600 15px ${textFace}, Arial`;
    ctx.fillStyle = C.text;
    let wy = 18 + 72;
    if (guild.upgrade_level < 6) {
        ctx.fillStyle = '#9ca3af';
        ctx.fillText('🔒 Guerres à l’Upgrade 6', xMain + 20, wy);
    } else {
        ctx.fillText(`Victoires : ${guild.wars_won ?? 0} · 🔥${guild.wars_won_70 ?? 0} · ⚡${guild.wars_won_80 ?? 0} · 💎${guild.wars_won_90 ?? 0}`, xMain + 20, wy);
        wy += 28;
        if (warInfo && warInfo.status === 'ongoing') {
            ctx.fillStyle = C.red;
            ctx.font = `700 16px ${titleFace}, Arial`;
            ctx.fillText(`⚔️ En cours vs ${warInfo.opponent}`, xMain + 20, wy);
        } else {
            ctx.fillStyle = C.peace;
            ctx.font = `600 16px ${textFace}, Arial`;
            ctx.fillText('🕊️ Aucune guerre en cours', xMain + 20, wy);
        }
    }
    wy += 36;
    ctx.font = `600 14px ${textFace}, Arial`;
    ctx.fillStyle = C.sub;
    ctx.fillText(`Trésorerie : ${guild.upgrade_level < 2 ? '🔒 U2' : `${(guild.treasury ?? 0).toLocaleString('fr-FR')} ⭐`}`, xMain + 20, wy);

    panelBlz(ctx, xMain, rosterY, mainW, rosterH, 18, C.panel);
    ctx.font = `800 22px ${titleFace}, Arial`;
    ctx.fillStyle = C.yellow;
    ctx.fillText('Roster', xMain + 18, rosterY + 34);
    const sy = rosterY + 58;
    const lh = 48;
    for (let i = 0; i < Math.min(10, members.length); i++) {
        const rowY = sy + i * lh;
        rr(ctx, xMain + 12, rowY - 18, mainW - 24, lh - 6, 10);
        ctx.fillStyle = i % 2 === 0 ? 'rgba(255, 200, 80, 0.06)' : 'rgba(255, 255, 255, 0.04)';
        ctx.fill();
        drawMemberLine(ctx, members[i], guild, xMain + 18, rowY, mainW - 140, titleFace, textFace, xMain + mainW - 22);
    }
    if (totalMembers > 10) {
        ctx.font = `italic 13px ${textFace}, Arial`;
        ctx.fillStyle = C.sub;
        ctx.fillText(`… +${totalMembers - 10}`, xMain + 18, sy + 10 * lh + 2);
    }

    drawFooter(ctx, 'Aperçu Étendard — /testprofilguilde');
    return canvas.toBuffer('image/png');
}

/** Anciens IDs (Bastion / Orbit / Registre) → nouveaux aperçus BLZ (même si Discord envoie encore l’ancienne valeur). */
const LEGACY_GUILD_VARIANT = Object.freeze({
    bastion: 'citadelle',
    orbit: 'brasier',
    ledger: 'etendard',
});

function normalizeGuildVariant(v) {
    const resolved = LEGACY_GUILD_VARIANT[v] || v;
    const allowed = GUILD_PREVIEW_VARIANTS.map((x) => x.id);
    if (allowed.includes(resolved)) return resolved;
    return 'citadelle';
}

module.exports = {
    GUILD_PREVIEW_VARIANTS,
    renderGuildProfilePreviewVariant,
    normalizeGuildVariant,
};
