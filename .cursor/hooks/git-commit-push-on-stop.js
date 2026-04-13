#!/usr/bin/env node
/**
 * Fin de tour agent : commit + push vers la branche courante.
 * Désactiver : CURSOR_AUTO_SYNC=0
 */
const { execFileSync, execSync } = require('child_process');
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

function main() {
    try {
        fs.readFileSync(0, 'utf8');
    } catch {
        /* stdin optionnel */
    }

    if (['0', 'false', 'no', 'off'].includes(String(process.env.CURSOR_AUTO_SYNC || '').toLowerCase())) {
        process.exit(0);
    }

    const root = gitRoot();
    if (!fs.existsSync(path.join(root, '.git'))) {
        process.exit(0);
    }

    try {
        const porcelain = execSync('git status --porcelain', { cwd: root, encoding: 'utf8' }).trim();
        if (!porcelain) {
            process.exit(0);
        }

        execFileSync('git', ['add', '-A'], { cwd: root, stdio: 'pipe' });

        const staged = execSync('git diff --cached --name-only', { cwd: root, encoding: 'utf8' }).trim();
        if (!staged) {
            process.exit(0);
        }

        const msg = `sync(cursor): ${new Date().toISOString().slice(0, 19).replace('T', ' ')}`;
        execFileSync('git', ['commit', '-m', msg], { cwd: root, stdio: 'inherit' });
        execFileSync('git', ['push'], { cwd: root, stdio: 'inherit' });
        console.error('[cursor-auto-sync] Poussé sur GitHub.');
    } catch (e) {
        console.error('[cursor-auto-sync]', e.message || e);
    }
    process.exit(0);
}

main();
