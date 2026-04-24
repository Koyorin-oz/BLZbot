const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '..', '..', 'data', 'wallet.json');

function readAll() {
  try {
    const raw = fs.readFileSync(file, 'utf8');
    const o = JSON.parse(raw);
    return typeof o === 'object' && o ? o : {};
  } catch {
    return {};
  }
}

function writeAll(data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
}

function getBalance(userId) {
  const all = readAll();
  const n = Number(all[userId]);
  return Number.isFinite(n) ? n : 0;
}

/** Pas de plafond : montant arbitraire accepté. */
function setBalance(userId, amount) {
  const all = readAll();
  all[userId] = String(Math.trunc(Number(amount)));
  writeAll(all);
  return getBalance(userId);
}

function addBalance(userId, delta) {
  return setBalance(userId, getBalance(userId) + Number(delta));
}

module.exports = { getBalance, setBalance, addBalance };
