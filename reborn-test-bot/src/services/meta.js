const db = require('../db');

function get(k) {
  const r = db.prepare('SELECT v FROM meta WHERE k = ?').get(k);
  return r ? r.v : null;
}

function set(k, v) {
  db.prepare('INSERT INTO meta (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v').run(k, String(v));
}

function diamondHolder() {
  return get('diamond_holder');
}

function setDiamondHolder(userIdOrNull) {
  if (userIdOrNull) set('diamond_holder', userIdOrNull);
  else db.prepare('DELETE FROM meta WHERE k = ?').run('diamond_holder');
}

module.exports = { get, set, diamondHolder, setDiamondHolder };
