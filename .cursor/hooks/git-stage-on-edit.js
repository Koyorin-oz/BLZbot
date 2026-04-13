#!/usr/bin/env node
/**
 * Après une édition agent (Write / Tab), stage le fichier.
 * Commit + push au hook `stop`.
 * Désactiver : CURSOR_AUTO_SYNC=0
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

function gitRoot() {
    let d = process.cwd();
    for (;;) {
        if (fs.existsSync(path.join(d, '.git'))) return d;
        const p = path.dirname(d);
        if (p === d) return process.cwd();
        d = p;
    }
}

function pickPath(obj) {
    if (!obj || typeof obj !== 'object') return null;
    const keys = ['file_path', 'filePath', 'path', 'file', 'uri'];
    for (const k of keys) {
        const v = obj[k];
        if (typeof v === 'string' && v.length) {
            return v.replace(/^file:\/\//, '').replace(/\\/g, path.sep);
        }
    }
    return null;
}

function main() {
    if (['0', 'false', 'no', 'off'].includes(String(process.env.CURSOR_AUTO_SYNC || '').toLowerCase())) {
        process.exit(0);
    }

    let raw = '';
    try {
        raw = fs.readFileSync(0, 'utf8');
    } catch {
        process.exit(0);
    }

    let rel = null;
    try {
        rel = pickPath(JSON.parse(raw || '{}'));
    } catch {
        process.exit(0);
    }
    if (!rel) process.exit(0);

    const root = gitRoot();
    const abs = path.isAbsolute(rel) ? path.normalize(rel) : path.normalize(path.join(root, rel));
    if (!fs.existsSync(abs)) process.exit(0);

    const relToRoot = path.relative(root, abs);
    if (!relToRoot || relToRoot.startsWith('..') || path.isAbsolute(relToRoot)) {
        process.exit(0);
    }

    try {
        execFileSync('git', ['add', '--', relToRoot], { cwd: root, stdio: 'pipe' });
    } catch {
        /* ignore */
    }
    process.exit(0);
}

main();
