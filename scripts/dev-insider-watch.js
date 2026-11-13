const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const repoRoot = path.join(__dirname, '..');
const startScript = path.join(__dirname, 'start-insider.js');
const insiderEnvPath = path.join(repoRoot, '.insider.env');
const sourceDirectories = [
    path.join(repoRoot, 'niveau', 'src'),
    path.join(repoRoot, 'reborn-test-bot', 'src'),
    path.join(repoRoot, 'utils'),
    __dirname,
];
const rootSourceFiles = [
    path.join(repoRoot, 'blzbot-env.js'),
    path.join(repoRoot, 'blz-log.js'),
];

let child = null;
let restartTimer = null;
let restartRequested = false;
let stopping = false;
const watchers = [];

function restart(reason) {
    if (stopping) return;
    if (restartTimer) clearTimeout(restartTimer);
    restartTimer = setTimeout(() => {
        restartTimer = null;
        console.log(`[insider] Changement détecté (${reason}), redémarrage…`);
        if (child) {
            restartRequested = true;
            child.kill();
        } else {
            startBot();
        }
    }, 250);
}

function startBot() {
    if (stopping || child) return;
    child = spawn(process.execPath, [startScript], {
        cwd: repoRoot,
        env: process.env,
        stdio: 'inherit',
    });

    child.once('error', (error) => {
        console.error(`[insider] Impossible de démarrer le bot : ${error.message}`);
    });

    child.once('exit', (code, signal) => {
        child = null;
        if (stopping) return;
        if (restartRequested) {
            restartRequested = false;
            startBot();
            return;
        }
        console.warn(
            `[insider] Le bot s’est arrêté (code ${code ?? 'inconnu'}${signal ? `, signal ${signal}` : ''}). Le watcher reste actif.`
        );
    });
}

function watchSourceDirectory(directory) {
    if (!fs.existsSync(directory)) return;
    try {
        watchers.push(
            fs.watch(directory, { recursive: true }, (_eventType, filename) => {
                if (!filename || path.extname(String(filename)).toLowerCase() !== '.js') return;
                restart(String(filename));
            })
        );
    } catch (error) {
        console.error(`[insider] Surveillance impossible pour ${directory} : ${error.message}`);
    }
}

function watchRootSourceFile(filePath) {
    try {
        watchers.push(
            fs.watch(filePath, () => {
                restart(path.basename(filePath));
            })
        );
    } catch (error) {
        console.error(`[insider] Surveillance impossible pour ${filePath} : ${error.message}`);
    }
}

function stop() {
    if (stopping) return;
    stopping = true;
    if (restartTimer) clearTimeout(restartTimer);
    for (const watcher of watchers) watcher.close();
    fs.unwatchFile(insiderEnvPath);
    if (child) child.kill();
}

for (const directory of sourceDirectories) watchSourceDirectory(directory);
for (const filePath of rootSourceFiles) watchRootSourceFile(filePath);
fs.watchFile(insiderEnvPath, { interval: 500 }, (current, previous) => {
    if (current.mtimeMs !== previous.mtimeMs || current.size !== previous.size) {
        restart('.insider.env');
    }
});

process.once('SIGINT', stop);
process.once('SIGTERM', stop);

console.log('[insider] Watch actif : fichiers .js et .insider.env uniquement.');
startBot();
