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
   | `PEBBLE_REMOTE_PATH` | Chemin distant, souvent `/home/container` |
   | `PEBBLE_SFTP_PASSWORD` | Mot de passe SFTP *(souvent le seul nécessaire)* |

   Optionnels :

   | Secret | Description |
   |--------|-------------|
   | `PEBBLE_SFTP_PORT` | Port si différent de **22** |
   | `PEBBLE_SFTP_PRIVATE_KEY` | Clé privée SSH si tu n’utilises pas le mot de passe |

4. Si Pebble n’accepte **que** SFTP (pas de shell SSH), ajoute une **variable** (pas un secret) :  
   - Name : `PEBBLE_SFTP_ONLY`  
   - Value : `1`  

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
