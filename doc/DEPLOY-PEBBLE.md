# Déploiement auto vers PebbleHost (Cursor → GitHub → SFTP)

Dès que tu **pousses** la branche `main` sur GitHub, le workflow **Deploy PebbleHost (SFTP)** peut recopier les fichiers du dépôt sur ton serveur Pebble **sans écraser** le `.env` (il n’est pas dans Git).

## 1. Récupère les infos SFTP sur Pebble

Dans le panel Pebble : **File Manager** → bouton du type **SFTP Details** (hôte, port, utilisateur, mot de passe).  
Le dossier distant est en général **`/home/container`** (vérifie dans le panel).

## 2. GitHub : activer le workflow

1. Ouvre le dépôt sur GitHub → **Settings** → **Secrets and variables** → **Actions**.

2. Onglet **Variables** → **New repository variable**  
   - Name : `PEBBLE_DEPLOY`  
   - Value : `1`  

   (Sans cette variable, le déploiement est **désactivé** pour éviter des erreurs si les secrets ne sont pas prêts.)

3. Onglet **Secrets** → crée au minimum :

   | Secret | Description |
   |--------|-------------|
   | `PEBBLE_SFTP_HOST` | Hôte SFTP (ex. `sftp.example.pebble.host`) |
   | `PEBBLE_SFTP_USERNAME` | Utilisateur SFTP |
   | `PEBBLE_REMOTE_PATH` | Chemin **vu par le SFTP** : souvent **`.`** ou **`/`** sur Pebble (chroot). Si `/home/container` échoue, mets **`.`**. Le workflow essaie aussi automatiquement `.` et `/` si ton chemin n’existe pas. |
   | `PEBBLE_SFTP_PASSWORD` | Mot de passe SFTP *(souvent le seul nécessaire)* |

   Optionnel :

   | Secret | Description |
   |--------|-------------|
   | `PEBBLE_SFTP_PORT` | Port si différent de **22** (ex. **2222** sur Pebble) |

Le workflow envoie les fichiers en **SFTP avec Python (paramiko)** : pas de shell SSH, adapté à PebbleHost (port 2222, etc.).

## 3. Flux quotidien dans Cursor

1. Tu modifies le code.  
2. Commit + push sur `main` :  
   ```bash
   git add -A && git commit -m "ton message" && git push origin main
   ```  
3. Onglet **Actions** sur GitHub : vérifie que **Deploy PebbleHost (SFTP)** est vert.  
4. Sur Pebble : bouton **Restart** (ou **Start**) du bot pour charger le nouveau code.  
   - Obligatoire après un déploiement si le process était déjà lancé.  
   - Si tu as changé des dépendances (`package.json`), assure-toi que la **commande de démarrage** inclut `npm install` une fois ou régulièrement (selon ce que tu as configuré sur Pebble).

## 4. Limites

- Ce workflow **envoie les fichiers** ; il ne redémarre pas toujours le bot tout seul (souvent pas d’accès SSH complet sur l’offre bot Discord).  
- **`node_modules`** n’est pas envoyé (trop lourd) : ils sont recréés sur le serveur via ta commande de démarrage / un install manuel.  
- Le **`.env`** sur Pebble reste celui que tu as mis dans le file manager ; il n’est pas remplacé par Git.

## 5. Déclencher à la main

GitHub → **Actions** → **Deploy PebbleHost (SFTP)** → **Run workflow**.

## 6. Le loader dit « Updating from Git » mais REBORN reste absent

Symptômes dans les logs : `reborn-slash-bodies.json absents`, `salon-hacker:NON`, parfois encore `profil-v2-factory` en avertissement — le **disque** n’est pas sur le même commit que GitHub `main` (dépôt git Pebble bloqué ou vieux `.gitignore` local).

### Vérifier dans le File Manager (sans console)

| Fichier | Rôle |
|---------|------|
| `niveau/src/generated/reborn-slash-bodies.json` | Déploiement des 32 slash REBORN |
| `reborn-test-bot/src/rebornRuntime.js` | Exécution des commandes (/salon-hacker, etc.) |
| `.gitignore` | ~**800 octets** (pas des dizaines de Ko) |

### Réparer (ordre recommandé)

1. **Panel Pebble → Git Management** : URL `https://github.com/okoyorin-cell/BLZbot`, branche **`main`**, puis **réinstaller / reset** le dépôt si l’option existe.
2. **Restart** le serveur.
3. Logs attendus : `[maintemp] REBORN OK — 32 slash · deploy guilde auto (~15s)` puis `salon-hacker:guilde`.

### Si le git Pebble ne se met toujours pas à jour

Active le workflow SFTP (sections 1–2 ci-dessus), lance **Deploy PebbleHost (SFTP)** une fois, puis **Restart**. Le `.env` sur le serveur n’est pas écrasé.

### Secours minimal (File Manager uniquement)

- **Slash visibles sur Discord** : tu peux copier **un seul** fichier depuis GitHub (Raw) vers  
  `niveau/src/generated/reborn-slash-bodies.json`  
  puis Restart (les commandes ne **répondront** pas tant que `reborn-test-bot/` est absent).

### Token Discord

Si les logs affichent **`BLZbot-Backup#0739`**, le `BOT_TOKEN` dans `.env` ne correspond pas à `CLIENT_ID=1487192923350237244` — remets le token de la bonne application dans `.env`.
