/**
 * Pont optionnel vers les quêtes REBORN (`reborn-test-bot`) quand le monorepo
 * contient les deux bots. Ne fait rien si le module est absent (prod BLZbot seul).
 *
 * Appelé depuis `minigame-handler.js` après une victoire minijeu.
 */
const fs = require('fs');
const path = require('path');

function rebornQuestsPath() {
  return path.join(__dirname, '..', '..', '..', 'reborn-test-bot', 'src', 'services', 'quests.js');
}

function trackMinijeuWinForReborn(winnerUserId) {
  if (!winnerUserId) return;
  const p = rebornQuestsPath();
  try {
    if (!fs.existsSync(p)) return;
    const { trackMinijeuWin } = require(p);
    if (typeof trackMinijeuWin === 'function') trackMinijeuWin(winnerUserId);
  } catch {
    /* reborn absent ou DB différente : ignorer */
  }
}

module.exports = { trackMinijeuWinForReborn };
