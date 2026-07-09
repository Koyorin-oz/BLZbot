const { createCanvas, loadImage } = require('canvas');

const W = 1100;
const H = 500;
const IMAGE_ZONE_W = Math.floor(W * 0.48);
const TEXT_PAD_X = 48;
const TEXT_LEFT = IMAGE_ZONE_W + 24;
const TEXT_MAX_W = W - TEXT_LEFT - TEXT_PAD_X;

/**
 * @param {string} raw
 * @param {string} [fallbackChannelId]
 * @returns {{ guildId?: string, channelId: string, messageId: string } | null}
 */
function parseMessageReference(raw, fallbackChannelId) {
    const s = String(raw || '').trim();
    const link = s.match(/discord(?:app)?\.com\/channels\/(\d+)\/(\d+)\/(\d+)/i);
    if (link) {
        return { guildId: link[1], channelId: link[2], messageId: link[3] };
    }
    if (/^\d{15,25}$/.test(s) && fallbackChannelId) {
        return { channelId: String(fallbackChannelId), messageId: s };
    }
    return null;
}

function wrapText(ctx, text, maxWidth) {
    const words = String(text || '').split(/\s+/).filter(Boolean);
    if (!words.length) return [''];
    const lines = [];
    let line = '';
    for (const word of words) {
        const test = line ? `${line} ${word}` : word;
        if (ctx.measureText(test).width > maxWidth && line) {
            lines.push(line);
            line = word;
        } else {
            line = test;
        }
    }
    if (line) lines.push(line);
    return lines;
}

function fitQuoteLayout(ctx, text, maxWidth, maxHeight) {
    const clean = String(text || '').trim() || '…';
    for (let size = 58; size >= 20; size -= 2) {
        ctx.font = `bold ${size}px Arial, Helvetica, sans-serif`;
        const lines = wrapText(ctx, clean, maxWidth);
        const lineHeight = Math.round(size * 1.12);
        const blockH = lines.length * lineHeight;
        const tooWide = lines.some((l) => ctx.measureText(l).width > maxWidth);
        if (!tooWide && blockH <= maxHeight) {
            return { size, lines, lineHeight, blockH };
        }
    }
    ctx.font = 'bold 20px Arial, Helvetica, sans-serif';
    const lines = wrapText(ctx, clean, maxWidth);
    const lineHeight = 24;
    return { size: 20, lines, lineHeight, blockH: lines.length * lineHeight };
}

function drawCover(ctx, img, dx, dy, dw, dh) {
    const ir = img.width / img.height;
    const dr = dw / dh;
    let sx;
    let sy;
    let sw;
    let sh;
    if (ir > dr) {
        sh = img.height;
        sw = img.height * dr;
        sx = (img.width - sw) / 2;
        sy = 0;
    } else {
        sw = img.width;
        sh = img.width / dr;
        sx = 0;
        sy = (img.height - sh) / 2;
    }
    ctx.drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh);
}

async function loadRemoteImage(url) {
    if (!url) return null;
    try {
        return await loadImage(url);
    } catch {
        return null;
    }
}

/**
 * @param {object} opts
 * @param {string} opts.quoteText
 * @param {string} opts.displayName
 * @param {string} opts.username
 * @param {string} opts.imageUrl
 * @param {string} [opts.watermark]
 * @returns {Promise<Buffer>}
 */
async function renderQuoteCard({
    quoteText,
    displayName,
    username,
    imageUrl,
    watermark = 'BLZbot',
}) {
    const canvas = createCanvas(W, H);
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, W, H);

    const sideImg = await loadRemoteImage(imageUrl);
    if (sideImg) {
        ctx.save();
        ctx.filter = 'grayscale(100%) contrast(1.05)';
        drawCover(ctx, sideImg, 0, 0, IMAGE_ZONE_W + 80, H);
        ctx.restore();

        const fade = ctx.createLinearGradient(IMAGE_ZONE_W * 0.35, 0, W * 0.72, 0);
        fade.addColorStop(0, 'rgba(0,0,0,0)');
        fade.addColorStop(0.35, 'rgba(0,0,0,0.55)');
        fade.addColorStop(0.72, 'rgba(0,0,0,1)');
        fade.addColorStop(1, 'rgba(0,0,0,1)');
        ctx.fillStyle = fade;
        ctx.fillRect(0, 0, W, H);
    }

    const quote = String(quoteText || '').trim().slice(0, 420);
    const quoteLayout = fitQuoteLayout(ctx, quote, TEXT_MAX_W, H * 0.42);

    const authorLine = `- ${String(displayName || username || 'inconnu').slice(0, 48)} / ${String(username || 'user').slice(0, 32)}`;
    const handleLine = `@${String(username || 'user').replace(/^@+/, '').slice(0, 40)}`;

    ctx.font = `italic 22px Arial, Helvetica, sans-serif`;
    const authorH = 28;
    ctx.font = `22px Arial, Helvetica, sans-serif`;
    const handleH = 26;
    const gapAfterQuote = 22;
    const totalTextH =
        quoteLayout.blockH + gapAfterQuote + authorH + 8 + handleH;
    let y = Math.round((H - totalTextH) / 2);

    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.font = `bold ${quoteLayout.size}px Arial, Helvetica, sans-serif`;
    for (const line of quoteLayout.lines) {
        ctx.fillText(line, TEXT_LEFT, y);
        y += quoteLayout.lineHeight;
    }

    y += gapAfterQuote;
    ctx.font = `italic 22px Arial, Helvetica, sans-serif`;
    ctx.fillStyle = '#f2f2f2';
    ctx.fillText(authorLine, TEXT_LEFT, y);
    y += authorH + 8;

    ctx.font = `20px Arial, Helvetica, sans-serif`;
    ctx.fillStyle = '#d8d8d8';
    ctx.fillText(handleLine, TEXT_LEFT, y);

    ctx.textAlign = 'right';
    ctx.font = '15px Arial, Helvetica, sans-serif';
    ctx.fillStyle = 'rgba(160,160,160,0.85)';
    ctx.fillText(String(watermark).slice(0, 48), W - 18, H - 22);

    return canvas.toBuffer('image/png');
}

/**
 * @param {import('discord.js').Message} message
 * @returns {string|null}
 */
function extractQuoteText(message) {
    const content = String(message.content || '').trim();
    if (content) return content;
    const embed = message.embeds?.[0];
    if (embed?.description?.trim()) return embed.description.trim();
    if (embed?.title?.trim()) return embed.title.trim();
    return null;
}

/**
 * @param {import('discord.js').Message} message
 * @returns {string|null}
 */
function pickQuoteImageUrl(message) {
    const att = [...(message.attachments?.values?.() || [])].find((a) =>
        String(a.contentType || '').startsWith('image/'),
    );
    if (att?.url) return att.url;
    const embedImg =
        message.embeds?.[0]?.image?.url ||
        message.embeds?.[0]?.thumbnail?.url ||
        null;
    if (embedImg) return embedImg;
    return message.author?.displayAvatarURL?.({ extension: 'png', size: 512 }) || null;
}

module.exports = {
    parseMessageReference,
    extractQuoteText,
    pickQuoteImageUrl,
    renderQuoteCard,
};
