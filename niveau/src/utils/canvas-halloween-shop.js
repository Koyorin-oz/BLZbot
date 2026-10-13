const { createCanvas, loadImage } = require('canvas');
const fs = require('node:fs');
const path = require('node:path');

const W = 1100;
const H = 280;

function cover(ctx, img) {
    const scale = Math.max(W / img.width, H / img.height);
    const nw = img.width * scale;
    const nh = img.height * scale;
    ctx.drawImage(img, (W - nw) / 2, (H - nh) / 2, nw, nh);
}

async function renderHalloweenShopBanner() {
    const canvas = createCanvas(W, H);
    const ctx = canvas.getContext('2d');
    const bgPath = path.join(__dirname, '..', 'assets', 'blz_bg.png');
    try {
        if (fs.existsSync(bgPath)) cover(ctx, await loadImage(fs.readFileSync(bgPath)));
    } catch {
        ctx.fillStyle = '#1a0c08';
        ctx.fillRect(0, 0, W, H);
    }
    ctx.fillStyle = 'rgba(18, 6, 2, 0.55)';
    ctx.fillRect(0, 0, W, H);
    const wash = ctx.createLinearGradient(0, 0, W, 0);
    wash.addColorStop(0, 'rgba(230, 126, 34, 0.35)');
    wash.addColorStop(1, 'rgba(88, 24, 69, 0.28)');
    ctx.fillStyle = wash;
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#ffb020';
    ctx.fillRect(0, 0, W, 8);
    ctx.fillRect(0, H - 8, W, 8);
    ctx.fillStyle = '#fff6e8';
    ctx.font = '64px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('BOUTIQUE HALLOWEEN', W / 2, H / 2 - 8);
    return canvas.toBuffer('image/png');
}

module.exports = { renderHalloweenShopBanner };
