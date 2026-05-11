/**
 * Pont optionnel vers les quêtes REBORN (`reborn-test-bot`) quand le monorepo
 * contient les deux bots. **Désactivé par défaut** : activer explicitement avec
 * `REBORN_QUEST_HOOK=1` dans l’environnement du process **niveau** (sandbox / test).
 */
const fs = require('fs');
const path = require('path');

function rebornQuestsPath() {
  return path.join(__dirname, '..', '..', '..', 'reborn-test-bot', 'src', 'services', 'quests.js');
}

function trackMinijeuWinForReborn(winnerUserId) {
  if (String(process.env.REBORN_QUEST_HOOK || '').trim() !== '1') return;
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
