const fs = require('node:fs');
const path = require('node:path');
const { AttachmentBuilder } = require('discord.js');

const REPO = path.join(__dirname, '..', '..', '..');
const BLZ = path.join(REPO, 'niveau', 'src', 'assets', 'blz_bg.png');
const AT_NAME = 'reborn_blz_bg.png';

/**
 * Bannière identique au profil (`niveau/src/assets/blz_bg.png`).
 * @returns {{ file: import('discord.js').AttachmentBuilder, name: string, mediaUrl: string } | null}
 */
function getBlzAttachment() {
  if (!fs.existsSync(BLZ)) return null;
  const file = new AttachmentBuilder(fs.readFileSync(BLZ), { name: AT_NAME });
  return { file, name: AT_NAME, mediaUrl: `attachment://${AT_NAME}` };
}

module.exports = { getBlzAttachment, BLZ };
