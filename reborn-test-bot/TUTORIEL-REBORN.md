# Tutoriel complet — bot de test REBORN (`reborn-test-bot`)

Ce document explique **à quoi sert** ce bot, **comment le lancer**, et **ce que tu peux faire** dessus (commandes, règles, ordre des choses à tester).  
C’est un **sandbox** : base **SQLite locale** `data/reborn.sqlite`, **séparée** de BLZbot prod. Les slash peuvent avoir le **même nom** que le bot principal mais un **comportement REBORN** (voir miroir plus bas).

---

## 1. Objectif du bot

- Tester la **MAJ REBORN** (économie, guildes « joueur », GRP, séparation, quêtes, index, arbre, temple, etc.) **sans toucher** à la prod.
- Les chiffres et règles suivent la **doc REBORN** autant que possible dans ce dépôt (certaines parties sont encore simplifiées ou à brancher sur de vrais événements Discord).

---

## 2. Installation & démarrage

### 2.1 Prérequis

- **Node.js** (idéalement la même version que celle avec laquelle `better-sqlite3` a été compilé — souvent **20+**).  
  Si au `npm start` tu vois une erreur `NODE_MODULE_VERSION` / `better_sqlite3.node` :

```bash
cd reborn-test-bot
npm rebuild better-sqlite3
```

ou le script du `package.json` : `npm run reinstall:sqlite`.

### 2.2 Variables d’environnement

Fichier **`reborn-test-bot/.env`** (ou variables `REBORN_*` à la racine du repo — voir `src/config.js`) :

| Variable | Rôle |
|----------|------|
| `REBORN_TEST_BOT_TOKEN` | Token du bot Discord (**obligatoire**) |
| `REBORN_TEST_BOT_CLIENT_ID` | ID application — **obligatoire** pour `npm run deploy` |
| `REBORN_TEST_GUILD_ID` | *(recommandé)* déploiement slash **sur cette guilde** (plus rapide que global) |
| `REBORN_AUTO_DEPLOY_SLASH` | `1` par défaut : déploie les slash au démarrage si `CLIENT_ID` est défini |
| `REBORN_MIRROR_NIVEAU_SLASH` | `1` par défaut : enregistre aussi les slash du dossier **niveau** (voir § 12) |
| `REBORN_HACKER_ROLE_ID` | Rôle Discord requis pour `/hacker` (vide = pas de check rôle, owners bypass) |

### 2.3 Lancer le bot

```bash
cd reborn-test-bot
npm install
npm start
```

Après **ajout ou modification** de commandes slash : redémarrage, ou manuellement :

```bash
npm run deploy
```

---

## 3. Par où commencer (ordre conseillé)

1. Invite le bot sur un **serveur de test** avec les intents habituels (membres, messages, vocal si tu testes le gain vocal).
2. Vérifie **`/ping`**.
3. Envoie quelques **messages** (et éventuellement reste un peu en **vocal**) pour alimenter starss / XP / RP / GXP / GRP.
4. **`/solde`** : voir tout d’un coup.
5. **`/daily`** une fois par jour calendaire (minuit **heure locale du serveur Node** pour le reset « jour ») ; bonus **Double Daily** le même jour si tu as l’item (voir § 5).
6. **`/boutique`** : acheter avec les **boutons** sous le message.
7. Quand tu es **niveau 15+** : **`/guilde creer`** ou **`/guilde rejoindre`** (après **`/guilde liste`** pour l’ID).
8. Plus tard : **`/arbre`**, **`/temple`**, **`/itemindex`**, **`/quete`**, **`/echange`**, **`/separation`**, etc.

---

## 4. Gains automatiques (sans commande)

Sur un **serveur** (pas en MP bot économie complète), en **message** et en **vocal** :

| Système | Règle (doc / code test-bot) |
|---------|-----------------------------|
| **Starss** | **15** / message, **40** / minute en vocal (×2 si boost starss actif) |
| **XP joueur** | **10** / message, **25** × nombre de **minutes** complètes en vocal ; courbe de niveau type doc (stockée en `xp_total`) |
| **RP (ranked)** | Gains **selon ton palier** de RP (moins tu es haut, plus tu gagnes par msg/voc) ; **décroissance** si **24 h** sans message **ni** 1 min vocale ; entre **50k et 100k** RP, **pool zéro-sum** (300k « excès » partagé — le bot peut retirer du RP à d’autres dans la bande si le pool dépasse) |
| **GXP** (membre → guilde joueur sur ce hub) | Selon **ton niveau** ; plafonné comme le doc (**6 GXP / msg**, **12 / min voc** au-delà du niveau 60) ; ×2 si boost GXP |
| **GRP** (membre sur ce serveur) | **1** / message, **3** / minute vocale ; **×1,1** si branche **Guilde** arbre ≥ étape 4 ; **÷2** si ta guilde joueur est sous **focus mode 3** (malus 2 h) |

Les **quêtes** comptent aussi des messages (`/quete`). Les **trophées** peuvent se débloquer en fond (`/trophees verifier`).

---

## 5. Daily & Double Daily

- **`/daily`** : une fois par **jour calendaire** (minuit local machine). Réponse **Components V2** (carte + bouton Fermer), loot aligné sur l’idée du daily principal (starss, XP, RP, coffres catalogue).
- **Double Daily** (item **`double_daily`** dans l’inventaire) : si tu as **déjà** pris ton daily **aujourd’hui**, tu peux **rejouer** en consommant **1** item, **jusqu’à 3 fois / 24 h glissantes** (sauf si `TEST_NO_LIMITS` désactive la limite dans la config).
- Le daily ne met **pas** à jour la date « dernier daily » quand c’est un **bonus** Double Daily (tu restes sur le même jour pour le reset naturel).

---

## 6. Boutique & inventaire

### `/boutique`

- Ligne 1 : **5 items** du jour (boutons `Slot 1` …).
- Ligne 2 : **coffres** (boutons achat).
- Ligne 3 : **boosts** ×2 (XP, GXP, starss) 1 h.

**Clé du shop** : date **Europe/Paris** ; si tu as l’**arbre boutique étape ≥ 3**, une **2ᵉ rotation** à **midi** Paris (suffixe `am` / `pm` sur la clé — nouveaux slots).

**Remise** : branche **boutique étape 5** de l’arbre → **−30 %** sur les prix boutique (slots + boosts + coffres).

### `/inventaire`

Liste les **items** et quantités (pas d’usage automatique de tous les consommables ici — certains se consomment via d’autres flux, ex. Double Daily au `/daily`).

### Coffres (rappel)

Loot dans **`reborn/chestLoot.js`** (starss, XP, items, CATS avec règles type doc, diamant unique via meta, etc.).

---

## 7. Économie explicite (commandes)

| Commande | Usage |
|----------|--------|
| **`/solde`** | Starss, **RP (ranked)**, **monnaie d’évent**, niveau / XP (total + palier), GXP & GRP sur **ce serveur**, guilde joueur, boosts, rappel des taux passifs |
| **`/payer`** | Transférer des **starss** à un autre joueur |
| **`/money`** | **Admin serveur** ou **owner app** : `give`, `remove`, `set` (starss ou points RP) |

---

## 8. Guildes « joueur » (`/guilde`)

Système **indépendant** des guildes BLZbot classiques. Tout est rattaché au **serveur Discord** courant (hub).

| Sous-commande | Rôle |
|---------------|------|
| `creer` | Créer une guilde (**niveau ≥ 15**, gratuit, **5** places de base) |
| `rejoindre` | Rejoindre avec l’**ID** affiché dans `liste` |
| `quitter` | Quitter (pas le chef) |
| `info` | Infos guilde |
| `liste` | Guildes sur ce serveur |
| `inviter` | Chef ou permission **invitations** |
| `tresor_depot` / `tresor_retrait` / `tresor_voir` | Trésorerie (permissions dépôt / retrait) |
| `grade_up` | Chef : achat du **grade** suivant (conditions type doc simplifiées) |
| `perm_voir` / `perm_set` | **depot**, **retrait**, **kick**, **roles**, **focus** |
| `expulser` | Chef ou permission **kick** |
| `transferer_chef` / `dissoudre` | Gestion du lead / suppression |
| `focus` | **500 000** starss depuis la trésorerie, **CD 7 j** ; modes **GRP** sur la guilde cible (dont **÷2 GRP 2 h** côté cible, voir § 4) |

### `/profil-guilde`

Fiche **embed** (pas le canvas prod) : ta guilde ou recherche par **nom / ID**.

---

## 9. GRP & saison

| Commande | Rôle |
|----------|------|
| **`/grp voir`** | Ton GRP (ou un membre), rang, pics de saison |
| **`/grp classement`** | Top 15 GRP du serveur |

- Reset **mensuel** (clé mois UTC) + tick **1er du mois UTC** pour remettre les GRP à zéro sur tous les hubs enregistrés.

---

## 10. Séparation (`/separation`)

Flux test : **phase 1** (adhésion au camp), **phase 2** (comparaison des **gains GRP** depuis les snapshots), annulation si **&lt; 25 %** des membres en phase 1.  
Détail dans `src/services/separation.js` + commande.

---

## 11. Échanges (`/echange`)

- **`proposer`** : starss donnés / reçus, optionnel **`objets_donnes`** et **`objets_recus`** au format `item_id:quantité` (ex. `corail:2,xp_boost:1`).
- **Monnaie d’évent** : **`tu_donnes_event`** / **`tu_recois_event`** (entiers). En **valeur** d’échange : **1 monnaie d’évent = 5** « valeur » (comme les starss 1:1 côté valeur doc).
- Règle **40 %** max d’écart de **valeur** totale entre les deux côtés.
- **`accepter`** avec l’**ID** du trade affiché au proposeur.

---

## 12. Index items (`/itemindex`)

| Sous-commande | Rôle |
|---------------|------|
| `voir` | % complétion + liste des **paliers** (starss + **coffres** + note rôle à 100 %) |
| `definir` | Fixer le % (**admin** ou **owner**) — pour tests |
| `reclamer` | Prochain palier disponible → **starss** + **coffres** dans l’inventaire |

---

## 13. Quêtes (`/quete`)

| Sous-commande | Rôle |
|---------------|------|
| `voir` | Compteurs jour / semaine / sélection |
| `quotidienne` | Récompense si assez de **messages** aujourd’hui |
| `hebdo` | Récompense si assez de **points** semaine (1 pt ≈ 1 message) |
| `choisir` | Quête à choix hebdo |
| `reclamer_selection` | Valider la récompense (ex. retrait corail si besoin) |

*(La branche **Quête** de l’arbre n’est pas encore entièrement reliée à tous les effets doc — skips, slots supplémentaires, etc.)*

---

## 14. Arbre de compétences (`/arbre`)

- **`/arbre voir`** : étapes **0–5** par branche (**Quête**, **Guilde**, **Boutique**, **Ranked**, **Événement**) + **points de compétence** disponibles.
- **`/arbre acheter`** + branche : achète la **prochaine** étape ; **coût = numéro d’étape** (1 pt pour passer 0→1, 2 pts pour 1→2, …).
- Tu gagnes **+1 point d’arbre** à **chaque niveau joueur** gagné (montée de niveau par XP).

**Effets déjà branchés (exemples)** :

- **Guilde** : +10 % GXP (étape ≥ 2), +10 % GRP (étape ≥ 4).
- **Ranked** : bonus **%** et **+RP** msg / voc selon étapes (voir `skillTree.js` + `rankedRp.js`).
- **Boutique** : double rotation Paris (étape ≥ 3), **−30 %** (étape 5).

---

## 15. Temple (`/temple`)

- **`/temple voir`** ou **`/temple sync`** : recalcule les **conditions** (sur le **serveur actuel** pour guilde / GRP) et affiche les **points** cumulés + liste des **clés** détectées (classes complètes, RP max type doc, diamant, index 100 %, grade Star guilde, rang GRP Star, …).
- Les points liés à **séparation gagnée/perdue**, **rôle Hacker Discord**, **index d’évent**, etc. sont **indiqués comme à brancher** dans le message — la logique métier complète peut être branchée plus tard sur les événements réels.

**Temple débloqué** (affichage) : quand les **5** branches de l’arbre sont à **5/5** (`temple_unlocked`).

---

## 16. Trophées & Hacker

| Commande | Rôle |
|----------|------|
| **`/trophees`** | `voir` : succès ; `verifier` : revérifie |
| **`/hacker`** | Tirage pondéré par rareté ; **cooldown 12 h** (sauf limits test) ; rôle optionnel env |

---

## 17. Staff / utilitaires

| Commande | Rôle |
|----------|------|
| **`/passeport`** | Voir / maj staff (points sécu, warns, tests mod, candidature) |
| **`/warn`** | Avertir (points sécu) |
| **`/purge`** | Purge messages (mod) |
| **`/ping`** | Latence |
| **`/server`** | Infos serveur |
| **`/reborn-ref`** | Récap modules + rappel **miroir slash** niveau |

---

## 18. Miroir des commandes BLZbot (`niveau`)

Si **`REBORN_MIRROR_NIVEAU_SLASH=1`** : les définitions slash du dossier **`niveau`** sont aussi enregistrées sur **la même application Discord**.

- Si une commande a le **même nom** qu’une commande **locale** du sandbox → **la version REBORN gagne**.
- Sinon → le menu peut ressembler à BLZbot, mais l’exécution renvoie souvent un message du type **« utiliser le bot principal »**.
- Plafond **100** commandes / application : en cas de dépassement, priorité aux commandes **locales**.

Désactive le miroir avec **`REBORN_MIRROR_NIVEAU_SLASH=0`** si tu veux **uniquement** le sandbox.

---

## 19. Mode test sans limites

Dans **`src/config.js`**, `TEST_NO_LIMITS` peut désactiver certaines limites (ex. **Double Daily** 3/24h, cooldown hacker selon implémentation). À utiliser **seulement** en sandbox.

---

## 20. Dépannage rapide

| Problème | Piste |
|----------|--------|
| Bot ne démarre pas, erreur **better-sqlite3** | `npm rebuild better-sqlite3` ou `npm run reinstall:sqlite` avec la bonne version de Node |
| Slash introuvable / anciennes defs | `npm run deploy` + redémarrage ; vérifier `CLIENT_ID` et scope **guild** si `REBORN_TEST_GUILD_ID` est set |
| Pas de gains en vocal | Vérifier **intent** vocal + bot **connecté** au salon ; minutes comptées **entières** |
| RP bizarre entre 50k–100k | Normal : mécanique **pool** ; voir `rankedRp.js` |

---

## 21. Où lire le code

- Constantes doc : `src/reborn/constants.js`
- XP : `src/reborn/xpCurve.js` + `src/services/users.js`
- RP : `src/services/rankedRp.js`
- Earn : `src/services/earn.js`
- Arbre : `src/services/skillTree.js` + `src/commands/arbre.js`
- Temple : `src/services/temple.js` + `src/commands/temple.js`
- Schéma SQLite : `src/db/migrate.js`

Ce tutoriel décrit **ce dépôt** ; la doc produit « officielle » REBORN peut aller plus loin que ce qui est codé ici.
