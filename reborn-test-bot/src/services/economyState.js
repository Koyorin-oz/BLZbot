const meta = require('./meta');

const KEY = 'economy_paused';

/** Vrai si l'économie est gelée (plus de gains passifs, daily, boutique, rôles auto). */
function isPaused() {
  return meta.get(KEY) === '1';
}

/** Active ou désactive la pause globale de l'économie. */
function setPaused(value) {
  meta.set(KEY, value ? '1' : '0');
  return isPaused();
}

module.exports = { isPaused, setPaused };
