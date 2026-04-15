/**
 * Aperçus visuels alternatifs pour profil guilde (ne remplace pas renderGuildProfileV2).
 * bastion | orbit | ledger
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
    { id: 'bastion', label: 'Bastion', hint: 'Pierre, or, blason' },
    { id: 'orbit', label: 'Orbit', hint: 'Espace, halo, lisibilité néon' },
    { id: 'ledger', label: 'Registre', hint: 'Style tableau / terminal vert' },
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

function formatValue(n) {
    const v = n || 0;
    if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
    if (v >= 1000) return `${(v / 1000).toFixed(1)}K`;
    return v.toLocaleString('fr-FR');
}

function drawMemberRows(ctx, members, guild, startX, startY, colW, titleFace, textFace, iconFn) {
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    const lineH = 52;
    ctx.font = `700 18px ${titleFace}, Arial`;
    ctx.fillStyle = iconFn.accent;
    ctx.fillText('Membres', startX, startY);
    ctx.font = `600 15px ${textFace}, Arial`;
    for (let i = 0; i < Math.min(10, members.length); i++) {
        const m = members[i];
        const y = startY + 28 + i * lineH;
        let icon = '·';
        let nameColor = iconFn.text;
        if (m.user_id === guild.owner_id) {
            icon = '♦';
            nameColor = iconFn.gold;
        } else if (guild.sub_chiefs && guild.sub_chiefs.includes(m.user_id)) {
            icon = '◇';
            nameColor = iconFn.silver;
        }
        ctx.fillStyle = nameColor;
        ctx.fillText(`${icon} ${truncateText(ctx, m.username, colW - 120)}`, startX, y);
        ctx.fillStyle = iconFn.sub;
        ctx.font = `500 13px ${textFace}, Arial`;
        const mv = m.total_value || 0;
        ctx.fillText(formatValue(mv), startX + colW - 100, y);
        ctx.font = `600 15px ${textFace}, Arial`;
    }
}

/**
 * @param {object} opts — { guild, members, owner, warInfo, totalMembers }
 * @param {'bastion'|'orbit'|'ledger'} variant
 */
async function renderGuildProfilePreviewVariant(opts, variant) {
    const { guild, members, owner, warInfo, totalMembers } = opts;
    const titleFace = 'InterBold';
    const textFace = 'Inter';
    const ownerName = owner?.username ?? 'Inconnu';

    if (variant === 'bastion') {
        const canvas = createCanvas(W, H);
        const ctx = canvas.getContext('2d');
        const g = ctx.createLinearGradient(0, 0, W, H);
        g.addColorStop(0, '#2a2a32');
        g.addColorStop(0.5, '#3d3a42');
        g.addColorStop(1, '#1e1c22');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, W, H);
        const bg = await tryLoadBlzBg();
        if (bg) {
            ctx.save();
            ctx.globalAlpha = 0.18;
            ctx.drawImage(bg, 0, 0, W, H);
            ctx.restore();
        }

        rr(ctx, 36, 36, W - 72, 120, 20);
        ctx.fillStyle = 'rgba(0,0,0,0.35)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(212,175,55,0.85)';
        ctx.lineWidth = 3;
        ctx.stroke();

        ctx.font = `700 44px ${titleFace}, Arial`;
        ctx.fillStyle = '#f5e6b8';
        ctx.fillText(`${guild.emoji}`, 64, 108);
        ctx.fillStyle = '#fffef5';
        ctx.font = `700 36px ${titleFace}, Arial`;
        ctx.fillText(truncateText(ctx, guild.name, 700), 130, 105);

        const chipY = 190;
        const chipW = (W - 80) / 3;
        const drawChip = (i, title, val, sub) => {
            const x = 40 + i * (chipW + 10);
            rr(ctx, x, chipY, chipW, 100, 16);
            ctx.fillStyle = 'rgba(0,0,0,0.4)';
            ctx.fill();
            ctx.strokeStyle = 'rgba(212,175,55,0.5)';
            ctx.lineWidth = 2;
            ctx.stroke();
            ctx.fillStyle = '#d4af37';
            ctx.font = `700 16px ${titleFace}, Arial`;
            ctx.fillText(title, x + 18, chipY + 28);
            ctx.fillStyle = '#fff';
            ctx.font = `700 26px ${textFace}, Arial`;
            ctx.fillText(val, x + 18, chipY + 62);
            if (sub) {
                ctx.fillStyle = 'rgba(245,230,184,0.75)';
                ctx.font = `500 12px ${textFace}, Arial`;
                ctx.fillText(sub, x + 18, chipY + 86);
            }
        };
        const up = guild.upgrade_level === 10 ? 'X' : String(guild.upgrade_level);
        drawChip(0, 'VALEUR', `💎 ${formatValue(guild.total_value || 0)}`, 'Puissance guilde');
        drawChip(1, 'UPGRADE', `U${up}`, `${totalMembers}/${guild.member_slots} membres`);
        drawChip(2, 'CHEF', truncateText(ctx, ownerName, chipW - 36), 'Salle des chefs');

        const leftW = 520;
        rr(ctx, 40, 320, leftW, H - 360, 18);
        ctx.fillStyle = 'rgba(0,0,0,0.42)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(212,175,55,0.4)';
        ctx.stroke();
        drawMemberRows(ctx, members, guild, 64, 350, leftW - 48, titleFace, textFace, {
            accent: '#d4af37',
            text: '#f8f4e8',
            sub: 'rgba(245,230,184,0.75)',
            gold: '#ffd700',
            silver: '#c8c8d8',
        });

        const rx = 40 + leftW + 24;
        const rw = W - rx - 40;
        rr(ctx, rx, 320, rw, H - 360, 18);
        ctx.fillStyle = 'rgba(0,0,0,0.42)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(212,175,55,0.4)';
        ctx.stroke();

        ctx.fillStyle = '#d4af37';
        ctx.font = `700 20px ${titleFace}, Arial`;
        ctx.fillText('Trésorerie', rx + 24, 352);
        ctx.fillStyle = '#eee';
        ctx.font = `600 16px ${textFace}, Arial`;
        if (guild.upgrade_level < 2) {
            ctx.fillText('🔒 Débloquée à l’upgrade 2', rx + 24, 392);
        } else {
            ctx.fillText(
                `${(guild.treasury ?? 0).toLocaleString('fr-FR')} / ${(guild.treasury_capacity ?? 0).toLocaleString('fr-FR')} ⭐`,
                rx + 24,
                388
            );
        }

        ctx.fillStyle = '#d4af37';
        ctx.font = `700 20px ${titleFace}, Arial`;
        ctx.fillText('Guerre', rx + 24, 448);
        ctx.fillStyle = '#e8e0d4';
        ctx.font = `600 15px ${textFace}, Arial`;
        if (guild.upgrade_level < 6) {
            ctx.fillText('🔒 Guerres à l’upgrade 6', rx + 24, 482);
        } else if (warInfo && warInfo.status === 'ongoing') {
            ctx.fillStyle = '#f87171';
            ctx.fillText(`En cours vs ${warInfo.opponent}`, rx + 24, 478);
            const h = Math.max(1, Math.ceil((warInfo.timeRemaining || 0) / (3600000)));
            ctx.fillStyle = '#ccc';
            ctx.fillText(`~${h}h restantes`, rx + 24, 502);
        } else {
            ctx.fillStyle = '#a7f3d0';
            ctx.fillText('Aucune guerre en cours', rx + 24, 482);
        }

        ctx.fillStyle = 'rgba(200,190,170,0.8)';
        ctx.font = `italic 13px ${textFace}, Arial`;
        ctx.textAlign = 'right';
        ctx.fillText('Aperçu Bastion — /testprofilguilde', W - 36, H - 28);
        ctx.textAlign = 'left';
        return canvas.toBuffer('image/png');
    }

    if (variant === 'orbit') {
        const canvas = createCanvas(W, H);
        const ctx = canvas.getContext('2d');
        const rg = ctx.createRadialGradient(W / 2, H / 2, 40, W / 2, H / 2, W * 0.75);
        rg.addColorStop(0, '#1a0f2e');
        rg.addColorStop(0.4, '#0f172a');
        rg.addColorStop(1, '#020617');
        ctx.fillStyle = rg;
        ctx.fillRect(0, 0, W, H);

        ctx.strokeStyle = 'rgba(56,189,248,0.15)';
        ctx.lineWidth = 2;
        for (let r = 120; r < 700; r += 90) {
            ctx.beginPath();
            ctx.arc(W / 2, 120, r, 0, Math.PI * 2);
            ctx.stroke();
        }

        ctx.fillStyle = '#38bdf8';
        ctx.font = `800 42px ${titleFace}, Arial`;
        ctx.textAlign = 'center';
        ctx.fillText(`${guild.emoji}`, W / 2, 100);
        ctx.fillStyle = '#f0f9ff';
        ctx.font = `700 34px ${titleFace}, Arial`;
        ctx.fillText(truncateText(ctx, guild.name, 900), W / 2, 150);

        const barY = 200;
        const barH = 56;
        const segW = (W - 100) / 4;
        for (let i = 0; i < 4; i++) {
            const x = 50 + i * segW;
            rr(ctx, x, barY, segW - 12, barH, 14);
            ctx.fillStyle = 'rgba(15,23,42,0.85)';
            ctx.fill();
            ctx.strokeStyle = 'rgba(56,189,248,0.45)';
            ctx.stroke();
        }
        ctx.textAlign = 'center';
        ctx.fillStyle = '#7dd3fc';
        ctx.font = `600 13px ${textFace}, Arial`;
        ctx.fillText('VALEUR', 50 + (segW - 12) / 2, barY + 22);
        ctx.fillText('MEMBRES', 50 + segW + (segW - 12) / 2, barY + 22);
        ctx.fillText('UPGRADE', 50 + 2 * segW + (segW - 12) / 2, barY + 22);
        ctx.fillText('CHEF', 50 + 3 * segW + (segW - 12) / 2, barY + 22);
        ctx.fillStyle = '#fff';
        ctx.font = `700 18px ${titleFace}, Arial`;
        ctx.fillText(formatValue(guild.total_value || 0), 50 + (segW - 12) / 2, barY + 48);
        ctx.fillText(`${totalMembers}/${guild.member_slots}`, 50 + segW + (segW - 12) / 2, barY + 48);
        const up = guild.upgrade_level === 10 ? 'X' : String(guild.upgrade_level);
        ctx.fillText(`U${up}`, 50 + 2 * segW + (segW - 12) / 2, barY + 48);
        ctx.fillText(truncateText(ctx, ownerName, 120), 50 + 3 * segW + (segW - 12) / 2, barY + 48);

        const midY = 300;
        const lw = 540;
        rr(ctx, 40, midY, lw, H - midY - 50, 18);
        ctx.fillStyle = 'rgba(2,6,23,0.65)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(99,102,241,0.5)';
        ctx.stroke();
        ctx.textAlign = 'left';
        ctx.textBaseline = 'alphabetic';
        drawMemberRows(ctx, members, guild, 64, midY + 28, lw - 48, titleFace, textFace, {
            accent: '#818cf8',
            text: '#e0e7ff',
            sub: '#94a3b8',
            gold: '#fcd34d',
            silver: '#cbd5e1',
        });

        const rx = 40 + lw + 20;
        const rw = W - rx - 40;
        rr(ctx, rx, midY, rw, H - midY - 50, 18);
        ctx.fillStyle = 'rgba(2,6,23,0.65)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(99,102,241,0.5)';
        ctx.stroke();
        ctx.fillStyle = '#a5b4fc';
        ctx.font = `700 18px ${titleFace}, Arial`;
        ctx.fillText('Synthèse', rx + 20, midY + 32);
        ctx.fillStyle = '#e2e8f0';
        ctx.font = `600 14px ${textFace}, Arial`;
        let ly = midY + 64;
        if (guild.upgrade_level >= 2) {
            ctx.fillText(`Trésor : ${(guild.treasury ?? 0).toLocaleString('fr-FR')} / ${(guild.treasury_capacity ?? 0).toLocaleString('fr-FR')}`, rx + 20, ly);
            ly += 28;
        }
        if (guild.upgrade_level >= 6) {
            ctx.fillText(`Victoires : ${guild.wars_won ?? 0}`, rx + 20, ly);
            ly += 28;
            if (warInfo && warInfo.status === 'ongoing') {
                ctx.fillStyle = '#fca5a5';
                ctx.fillText(`Guerre : ${warInfo.opponent}`, rx + 20, ly);
                ly += 28;
            }
        }
        ctx.fillStyle = 'rgba(148,163,184,0.9)';
        ctx.font = `italic 12px ${textFace}, Arial`;
        ctx.textAlign = 'right';
        ctx.fillText('Aperçu Orbit — /testprofilguilde', W - 36, H - 26);
        ctx.textAlign = 'left';
        return canvas.toBuffer('image/png');
    }

    /* ledger */
    const canvas = createCanvas(W, H);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#041208';
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = 'rgba(34,197,94,0.25)';
    for (let y = 0; y < H; y += 28) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(W, y);
        ctx.stroke();
    }

    ctx.fillStyle = '#22c55e';
    ctx.font = `700 12px ${textFace}, Arial`;
    ctx.fillText('GUILDE_REG / v0-preview', 32, 28);
    ctx.fillStyle = '#4ade80';
    ctx.font = `700 32px ${titleFace}, Arial`;
    ctx.fillText(`${guild.emoji} ${truncateText(ctx, guild.name, 800)}`, 32, 68);

    ctx.strokeStyle = '#166534';
    ctx.strokeRect(28, 96, W - 56, 64);
    ctx.fillStyle = 'rgba(22,101,52,0.25)';
    ctx.fillRect(28, 96, W - 56, 64);
    ctx.fillStyle = '#bbf7d0';
    ctx.font = `600 15px ${textFace}, Arial`;
    ctx.fillText(`valeur_total=${(guild.total_value || 0).toLocaleString('fr-FR')} | membres=${totalMembers}/${guild.member_slots} | upgrade=${guild.upgrade_level === 10 ? 'X' : guild.upgrade_level} | chef=${ownerName}`, 40, 128);

    const tableTop = 190;
    const rowH = 46;
    ctx.fillStyle = '#22c55e';
    ctx.font = `700 13px ${textFace}, Arial`;
    ctx.fillText('user_id', 40, tableTop);
    ctx.fillText('username', 280, tableTop);
    ctx.fillText('total_value', 780, tableTop);
    ctx.strokeStyle = '#14532d';
    ctx.beginPath();
    ctx.moveTo(32, tableTop + 8);
    ctx.lineTo(W - 32, tableTop + 8);
    ctx.stroke();

    ctx.font = `500 14px ${textFace}, Arial`;
    for (let i = 0; i < Math.min(10, members.length); i++) {
        const m = members[i];
        const y = tableTop + 22 + i * rowH;
        ctx.fillStyle = m.user_id === guild.owner_id ? '#fde047' : '#86efac';
        const idShort = `${m.user_id}`.slice(0, 12) + '…';
        ctx.fillText(idShort, 40, y);
        ctx.fillStyle = '#dcfce7';
        ctx.fillText(truncateText(ctx, m.username, 420), 280, y);
        ctx.fillStyle = '#a7f3d0';
        ctx.fillText(String(m.total_value ?? 0), 780, y);
    }

    const boxY = tableTop + 22 + 10 * rowH + 20;
    ctx.strokeStyle = '#166534';
    ctx.strokeRect(28, boxY, W - 56, 120);
    ctx.fillStyle = 'rgba(6,78,59,0.35)';
    ctx.fillRect(28, boxY, W - 56, 120);
    ctx.fillStyle = '#86efac';
    ctx.font = `600 14px ${textFace}, Arial`;
    let ty = boxY + 28;
    if (guild.upgrade_level >= 2) {
        ctx.fillText(`treasury: ${(guild.treasury ?? 0)} / ${(guild.treasury_capacity ?? 0)}`, 40, ty);
        ty += 26;
    } else {
        ctx.fillText('treasury: LOCKED (upgrade<2)', 40, ty);
        ty += 26;
    }
    if (guild.upgrade_level >= 6) {
        ctx.fillText(`wars_won: ${guild.wars_won ?? 0}`, 40, ty);
        ty += 26;
        if (warInfo && warInfo.status === 'ongoing') {
            ctx.fillText(`war_opponent: ${warInfo.opponent}`, 40, ty);
        }
    } else {
        ctx.fillText('wars: LOCKED (upgrade<6)', 40, ty);
    }

    ctx.fillStyle = 'rgba(74,222,128,0.65)';
    ctx.font = `italic 12px ${textFace}, Arial`;
    ctx.textAlign = 'right';
    ctx.fillText('Aperçu Registre — /testprofilguilde', W - 36, H - 24);
    ctx.textAlign = 'left';
    return canvas.toBuffer('image/png');
}

function normalizeGuildVariant(v) {
    const allowed = GUILD_PREVIEW_VARIANTS.map((x) => x.id);
    if (allowed.includes(v)) return v;
    return 'bastion';
}

module.exports = {
    GUILD_PREVIEW_VARIANTS,
    renderGuildProfilePreviewVariant,
    normalizeGuildVariant,
};
