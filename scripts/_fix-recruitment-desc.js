const fs = require('fs');
const p = 'modération/src/modules/recruitment.js';
let t = fs.readFileSync(p, 'utf8');
const re = /\.setDescription\(`\*\*Nous recherchons[\s\S]*?dans vos réponses\.`\)/;
const repl = `.setDescription(
                'Postes ouverts ci-dessous.\\n\\n' +
                    '**Avant de postuler :**\\n' +
                    '• Sur le serveur depuis au moins **1 mois**.\\n' +
                    '• **2 candidatures** max (reset tous les 6 mois).\\n' +
                    '• Réponses sérieuses et honnêtes.'
            )`;
if (!re.test(t)) {
    console.error('pattern not found');
    process.exit(1);
}
t = t.replace(re, repl);
fs.writeFileSync(p, t);
console.log('ok');
