# Commandes slash — MAJ REBORN (`reborn-test-bot`)

Bot **sandbox** : économie / arbre / guildes joueur / ranked / temple / events, etc. Les définitions sont déployées via `src/slashDeploy.js` (guild si `REBORN_TEST_GUILD_ID`, sinon **global**).

---

## 1. Commandes natives (code dans `src/commands/`)

Chaque ligne = une commande racine ; les sous-commandes principales sont indiquées.

| Commande | Rôle (résumé) |
|----------|----------------|
| `/admin-creer-guilde` | Staff : créer une guilde joueur de test. |
| `/admin-economie` | Owner : audit + simulation inflation (`audit`, `simu`). |
| `/admin-focus` | Staff : désactiver / réactiver focus guilde, reset CD, historique. |
| `/admin-roles` | Admin : ranked, index 100 %, **Temple Roi/Légende** (`creer-ranked`, `definir-ranked`, `creer-index-full`, `creer-temple`, `definir-temple-roi`, `definir-temple-legende`, `definir-index-full`, `voir`, `resync`). |
| `/arbre` | Arbre de compétences : canvas, acheter palier, classe, branche séparatiste (`voir`, `acheter`, `classe`, `separatiste`). |
| `/boutique` | Boutique du jour, coffres, boosts (composants). |
| `/classement` | Classements Starss, niveau XP, RP ranked, GRP guildes (option `type`). |
| `/daily` | Daily / streak / items (canvas V2). |
| `/echange` | Trades starss + monnaie event (`proposer`, `accepter`). |
| `/event` | Events serveur (`lancer` : chasse, raid, marathon, siege, arene, conquete · `contribuer`, `classement`, `actifs`, `cloturer`). |
| `/grp` | Guilde : GRP perso (`voir`, `classement`). |
| `/guilde` | Guildes joueur : créer, rejoindre, trésor, grades, focus, salon, rôles internes, etc. (nombreux sous-commandes). |
| `/salon-hacker` | Publier le panneau salon hacker (bouton loot 12 h). |
| `/inventaire` | Inventaire + menu. |
| `/itemindex` | Catalogue d’items : progression auto + paliers crédités automatiquement. |
| `/money` | Owner : give/remove/set starss (`give`, `remove`, `set`). |
| `/mute` | Modération simple (timeout). |
| `/passeport` | Staff : fiche staff/sécu (`voir`, `maj_staff`, `audit`). |
| `/payer` | Payer un joueur en starss. |
| `/ping` | Latence bot. |
| `/profil-guilde` | Profil guilde canvas (nom de guilde). |
| `/purge` | Purge messages (staff). |
| `/quetes` | Panel quêtes REBORN (boutons + sélection). |
| `/ranked` | RP ranked : vue, paliers, réclamation milestones (`voir`, `paliers`, `reclamer`). |
| `/reborn-ref` | Aide : quelles commandes sont « vraies » sur ce bot vs miroir. |
| `/separation` | Séparations de guilde (`lancer`, `rejoindre`, `statut`). |
| `/server` | Debug infos serveur. |
| `/skill-points` | Owner : points d’arbre (`give`, `remove`, `set`, `voir`, `reset-arbre`). |
| `/solde` | Starss + boosts + aperçu progression. |
| `/temple` | Temple : points, sync, classement Rois/Légendes (`voir`, `sync`, `classement`). |
| `/trophees` | Trophées : liste, vérif, tirage 24 h (`voir`, `verifier`, `tirage`). |
| `/warn` | Avertissement staff (lié passeport). |

**Total : 32** commandes racine dans ce dossier.

---

## 2. Miroir **BLZbot niveau** (optionnel)

Si la variable `REBORN_MIRROR_NIVEAU_SLASH` n’est pas `0` (défaut : miroir **activé**), le déploiement **fusionne** les définitions slash du bot **niveau** (`niveau/src/commands/{core,guilde,admin,misc}/`) avec les commandes ci-dessus. En cas de **même nom**, la commande **native** `reborn-test-bot` l’emporte.

- **`REBORN_MIRROR_NIVEAU_EXECUTE`** : si `1` (défaut possible selon `config.js`), les handlers **niveau** sont chargés pour les noms absents du dossier local ; sinon un **stub** répond que l’action doit passer par BLZbot.

- **`profil-guilde`** : **exclu** du miroir (`MIRROR_EXCLUDE_COMMAND_NAMES`) pour éviter le conflit avec la version REBORN locale.

Exemples de commandes typiquement fournies par le miroir : `/profil`, `/xp`, `/daily` (niveau), `/boutique` si nom différent, `/guilde` (ancien), etc. — la liste exacte dépend des fichiers présents dans `niveau` (certaines sont filtrées comme obsolètes).

---

## 3. Après ajout / modification de commande

1. Redémarrer le bot **ou** laisser `REBORN_AUTO_DEPLOY_SLASH=1` pousser les slash au `ready`.  
2. En manuel : `npm run deploy-commands` depuis `reborn-test-bot/`.

---

*Généré à partir du dépôt ; ajuster si tu désactives le miroir ou si le dossier `niveau` change.*
