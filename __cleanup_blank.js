const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, 'reborn-test-bot', 'src');

function walk(dir, out = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(p, out);
    else if (ent.isFile() && p.endsWith('.js')) out.push(p);
  }
  return out;
}

const files = walk(ROOT);

// Collapse blank line(s) sitting between a trailing comma and a closing `}` or `)`.
const RE = /,(\r?\n)[ \t]*\r?\n(\s*[)}\]])/g;

let changed = 0;
for (const f of files) {
  const original = fs.readFileSync(f, 'utf8');
  let s = original;
  // Run repeatedly until idempotent (handles multiple blank lines in a row).
  let prev;
  do {
    prev = s;
    s = s.replace(RE, ',$1$2');
  } while (s !== prev);
  if (s !== original) {
    fs.writeFileSync(f, s);
    changed++;
  }
}
console.log(`${changed} files cleaned.`);
