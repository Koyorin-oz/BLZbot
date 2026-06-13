#!/usr/bin/env node
/**
 * Retire les emojis des chaînes passées à .setDescription() / .setName() (commandes slash).
 * Ne modifie pas l'indentation du fichier.
 */
const fs = require('fs');
const path = require('path');

const roots = [
    path.join(__dirname, '..', 'niveau', 'src', 'commands'),
    path.join(__dirname, '..', 'modération', 'src', 'commands'),
    path.join(__dirname, '..', 'verification', 'src'),
];

const emojiRe =
    /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}\u{1F1E6}-\u{1F1FF}]/gu;

function walk(d, out = []) {
    if (!fs.existsSync(d)) return out;
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) walk(p, out);
        else if (e.name.endsWith('.js')) out.push(p);
    }
    return out;
}

function cleanQuotedContent(content) {
    return content
        .replace(emojiRe, '')
        .replace(/[ \t]{2,}/g, ' ')
        .replace(/^[ \t]+|[ \t]+$/g, '');
}

function cleanLine(line) {
    if (!/\.set(Description|Name)\(/.test(line)) return line;
    return line.replace(/(['"`])((?:\\.|(?!\1).)*)\1/g, (full, quote, inner) => {
        const cleaned = cleanQuotedContent(inner);
        if (cleaned === inner) return full;
        return quote + cleaned + quote;
    });
}

let filesChanged = 0;
let linesChanged = 0;

for (const root of roots) {
    for (const file of walk(root)) {
        const raw = fs.readFileSync(file, 'utf8');
        if (!/SlashCommandBuilder/.test(raw)) continue;

        const lines = raw.split('\n');
        let changed = false;
        const next = lines.map((line) => {
            const cleaned = cleanLine(line);
            if (cleaned !== line) {
                changed = true;
                linesChanged++;
            }
            return cleaned;
        });

        if (changed) {
            fs.writeFileSync(file, next.join('\n'), 'utf8');
            filesChanged++;
            console.log('updated:', path.relative(path.join(__dirname, '..'), file));
        }
    }
}

console.log(`done: ${filesChanged} files, ${linesChanged} lines`);
