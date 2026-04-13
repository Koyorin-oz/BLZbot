/**
 * Obsolète : la commande /bug est gérée par le bot **niveau** (`niveau/src/commands/misc/bug.js`)
 * — modal + création de post sur le forum staff. Ne lance plus ce fichier avec le même token
 * pour éviter un double enregistrement de slash.
 */
console.warn(
    '[Bug] workers/Bug.js est obsolète — utilise uniquement le bot niveau pour /bug. Ce processus se termine.'
);
process.exit(0);
