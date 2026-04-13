# BLZbot

Bot Discord du serveur communautaire du YouTubeur **[BLZstarss](https://www.youtube.com/@BLZstarss)**. Il regroupe la **modération**, le **système de niveaux / économie / guildes** et des modules optionnels (IA, scan de liens, etc.) derrière un **orchestrateur** qui lance plusieurs processus Node.

> Ce dépôt ne contient **ni tokens ni `.env`** : copie `.env.example` vers `.env` et remplis les variables en local ou sur ton hébergeur (ex. PebbleHost).

---

## Fonctionnalités (aperçu)

| Zone | Rôle |
|------|------|
| **modération** | Sanctions, tickets, logs, votes staff, anti-raid, snipe, recrutement… |
| **niveau** | XP, monnaie, boutique, guildes, giveaways, événements (Halloween, Noël, Saint-Valentin), vocaux perso, etc. |
| **orchestrator** | `npm start` — démarre modération + niveau (et d’autres services si configurés). |
| **ia** | Module IA (Gemini / clés dans `.env`) — optionnel. |
| **workers** | Outils annexes (ex. `linkScanner`, `CheckToken`, `Bug`). |

Plus de détail dans le dossier [`doc/`](doc/) (architecture, commandes, BDD, déploiement).

---

## Prérequis

- **Node.js** 20.x ou plus récent (voir `engines` dans `package.json`).
- Un **bot Discord** (token) invité sur ton serveur avec les intents nécessaires (membres, messages, contenu des messages, vocaux si tu utilises ces fonctions).
- Fichier **`.env`** à la racine du projet (voir `.env.example`).

---

## Installation

```bash
git clone https://github.com/okoyorin-cell/BLZbot.git
cd BLZbot
npm install
```

Le dossier **`modération`** a aussi un `package-lock.json` : si la doc ou ton flux d’install le demande, exécute `npm install` dans `modération/` également.

---

## Configuration

1. Copie le modèle :  
   `cp .env.example .env` (ou équivalent sous Windows).
2. Renseigne au minimum **`BOT_TOKEN`**, **`GUILD_ID`**, et les salons / rôles attendus par ton serveur.
3. Pour la modération, un fichier **`modération/.env`** peut être utilisé selon ta config (même principe : pas de commit sur Git).

Les bases **SQLite** (`.db`, `.sqlite`) et fichiers comme `credentials.json` sont **ignorés par Git** : elles se créent ou se remplissent au fil de l’usage en local / en prod.

---

## Lancement

```bash
npm start
```

Lance l’orchestrateur (`orchestrator/maintemp.js`), qui fork en général **modération** et **niveau**. Pour tout activer d’un coup (plusieurs gateways avec le même token = à manier avec prudence) :

```bash
npm run start:full
```

Autres scripts utiles :

| Commande | Usage |
|----------|--------|
| `npm run start:niveau` | Seulement le bot niveau / économie. |
| `npm run deploy:commands` | Enregistrer les **slash commands** après une modification des commandes. |

Variables optionnelles (voir `.env.example`) : `BLZ_FORK_SERVICES`, `SKIP_SLASH_DEPLOY_ON_START`, `BLZ_FAST_START`, `LOG_LEVEL`, etc.

### Mise à jour auto vers PebbleHost

Après chaque **`git push`** sur `main`, un workflow GitHub Actions peut synchroniser les fichiers vers ton serveur en **SFTP** (sans toucher au `.env` sur Pebble). Configuration : **[`doc/DEPLOY-PEBBLE.md`](doc/DEPLOY-PEBBLE.md)**. Dans Cursor : tâche **« Push main → déclenche déploiement Pebble »** (`.vscode/tasks.json`) après tes commits — puis **Restart** du bot sur le panel Pebble.

---

## Structure du dépôt (simplifié)

```
├── orchestrator/     # Point d’entrée npm start
├── modération/       # Bot modération
├── niveau/           # Bot niveau / jeu / guildes
├── ia/               # Module IA
├── workers/          # Processus auxiliaires
├── scripts/          # CLI (déploiement commandes, dev)
├── doc/              # Documentation interne
└── archive/          # Anciens scripts / backups de référence
```

---

## Liens

- Chaîne YouTube : [BLZstarss](https://www.youtube.com/@BLZstarss)
- Dépôt : [github.com/okoyorin-cell/BLZbot](https://github.com/okoyorin-cell/BLZbot)

---

*Projet lié à la communauté BLZstarss — usage privé / serveur associé.*
