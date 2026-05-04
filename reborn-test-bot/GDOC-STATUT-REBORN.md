# Tableau gdoc → bot de test REBORN

Légende :

| Statut | Signification |
|--------|-----------------|
| **OK** | Implémenté et utilisable en jeu (peut rester du polish UX / équilibrage). |
| **Partiel** | Une partie des règles / du flux gdoc est là ; le reste est simplifié, manuel ou à brancher. |
| **Absent** | Pas dans le bot de test (ou seulement mentionné en doc interne). |

*Dernière passe basée sur le code dans `reborn-test-bot/src` (pas une relecture ligne à ligne du Google Doc hors repo).*

---

## Économie & progression

| Sujet gdoc | Statut | Détail (bot test) |
|------------|--------|-------------------|
| Starss 15/msg, 40/min voc | **OK** | `constants.js` + `earn.js` |
| Boosts ×2 XP / GXP / starss (1 h) | **OK** | Boutique + `users.setBoostField` |
| Courbe XP doc (1 + 99 + paliers) | **OK** | `xpCurve.js` + `xp_total` |
| RP paliers msg/voc | **OK** | `rankedRp.js` |
| Décroissance RP 24 h | **OK** | `decayForUserIfIdle` sur activité |
| Pool zéro-sum 50k–100k (300k) | **OK** | `rankedRp.js` |
| Tiers RP + rôles Discord par tier | **Partiel** | Tiers + sync auto si rôles enregistrés (`rankedRoles.js`, `/admin-roles`) ; noms/seuils peuvent différer du wording gdoc |
| « Roi du serveur » / « Légende » sur **11 points temple** (gdoc classique) | **Partiel** | Le Temple a **11 sources** + `/temple classement` (Roi / Légende **temple** sur clés, pas la même sémantique exacte que « 11 pts + top1 global » du slide) |
| Classement starss / niveau / RP / GRP guildes | **OK** | `/classement` |

---

## Daily & consommables

| Sujet gdoc | Statut | Détail |
|------------|--------|--------|
| Daily loot + reset jour | **OK** | `/daily` (V2) |
| Double Daily (limite / 24 h) | **OK** | `daily.js` + item |
| Streak Keeper (règles fines 72 h / 1× mois) | **Partiel** | Item + effet dans `itemEffects.js` (doc « cosmétique / simplifié » côté streak) |
| Skip daily / skip weekly | **Partiel** | `itemEffects.js` — à valider vs toutes les contraintes gdoc |
| Reset boutique (item + limite) | **OK** | `shopExtras.js` + item ; reset **gratuit** hebdo si arbre shop ≥ 1 |
| Event Spawner (CD 24 h + plancher global 1 h) | **Partiel** | `itemEffects.js` + meta ; branche event palier 5 = spawner hebdo côté panneau (`panelComponents` / quêtes) — recouper avec le gdoc |

---

## Boutique avancée (arbre Shop)

| Sujet gdoc | Statut | Détail |
|------------|--------|--------|
| Reset minuit (fuseau) | **OK** | Clé **Europe/Paris** (`shop.js`) |
| 2ᵉ rotation midi (branche ≥ 3) | **OK** | `effectiveShopDateKey` |
| −30 % tout le shop (branche 5) | **OK** | `purchase.js` + `skillTree` |
| ×2 contenu coffres (branche 2) | **OK** | `chestLootMult` dans `purchase.js` |
| CATL gratuit / 3 h (branche 5) | **OK** | `shopExtras.claimGuaranteedCatl` (pas le même slot que « 100 % sur ligne boutique » mais équivalent « gratuit régulier ») |
| CATL / CATS en surprise sur slot | **OK** | `tryRollChestSlot` |
| Skip boutique gratuit / semaine (branche 1) | **OK** | `shopExtras.freeResetAvailable` |

---

## Guildes joueur

| Sujet gdoc | Statut | Détail |
|------------|--------|--------|
| Création nv 15, 5 places, grades, tréso, perms | **OK** | `/guilde` + `playerGuilds.js` |
| Slots bonus chef (arbre guilde) | **OK** | `guildMemberCapBonus` |
| +10 % GXP / +10 % GRP (arbre) | **OK** | `earn.js` + `skillTree` |
| Focus 500k + CD + modes GRP | **OK** | dont malus ÷2 GRP (`meta grp_half_*`) |
| Séparation 12 h / 48 h / 25 % | **OK** | `separation.js` + `/separation` |
| Branche **séparatiste** (points, paliers) | **OK** | `skillTree` separatist* + hooks séparation |
| Salon perso guilde | **Partiel** | `/guilde salon` — besoin perms bot **Manage Channels** ; pas tout le « pack social » gdoc |
| 3 rôles perso nommables | **Absent** | Non implémenté comme sur le slide guilde |

---

## Quêtes & arbre Quête

| Sujet gdoc | Statut | Détail |
|------------|--------|--------|
| Daily / hebdo / sélection sandbox | **OK** | `/quete` + `quests.js` |
| ×2 récompenses si arbre quête palier 2 | **OK** | `questRewardMult` |
| Skips gratuits / semaine (paliers 1 + 4) | **OK** | `questSkipsPerWeek` |
| Slots sélection 4–5 (paliers 3 + 5) | **OK** | `questSelectionSlots` exposé dans le résumé |

---

## Index items

| Sujet gdoc | Statut | Détail |
|------------|--------|--------|
| Paliers 10–100 % + starss + coffres | **OK** | `indexProgress.js` + `/itemindex` |
| Rôle Discord « pipelette ultime » à 100 % | **Partiel** | Mention / hors bot (attribution rôle manuelle) |

---

## Monnaie d’évent & events

| Sujet gdoc | Statut | Détail |
|------------|--------|--------|
| Monnaie d’évent persistée | **OK** | `users.event_currency` |
| Gain lié aux events (score → currency) | **OK** | `events.js` + bonus arbre event |
| Échanges avec valeur ×5 pour l’évent | **OK** | `/echange` + `trade.js` |
| Tous les types d’events / récompenses du gdoc | **Partiel** | Quelques **types** (`chasse`, `raid`, `marathon`) + participation ; à étendre si le gdoc en liste d’autres |

---

## Temple (11 « clés »)

| Sujet gdoc | Statut | Détail |
|------------|--------|--------|
| 11 sources listées + sync | **OK** | `temple.js` (`SOURCE_DEFS`) : classes, RP, diamant, index, grade Star, GRP star, nv 99, vocal, séparation gagnée, hacker, champion event |
| Dévoilement tant que temple non débloqué | **Partiel** | `publicLines` masque partiellement les noms |
| Classement Roi / Légende **temple** | **OK** | `/temple classement` (seuils **6** / **3** clés côté code — à aligner si le gdoc impose strictement **11** pour « Légende ») |
| Attribution auto rôles Discord « Roi » / « Légende » gdoc | **Absent** | Affichage / classement interne ; pas la même mécanique que rôles Discord auto sans commande dédiée |

---

## Arbre — branches Ranked / Guilde / Event

| Sujet gdoc | Statut | Détail |
|------------|--------|--------|
| Ranked : % + flat RP | **OK** | `rankedRp` + `skillTree.rankedRpBonuses` |
| Guilde : GXP, GRP, cap, loyal séparation | **OK** | Voir ci-dessus |
| Event : mult monnaie, défense, réduc coffres event, spawner hebdo | **Partiel** | Mult + défense + discount + flag spawner ; recouper chiffres exacts avec le gdoc |

---

## Divers

| Sujet gdoc | Statut | Détail |
|------------|--------|--------|
| Coffres loot CATL/CATS/diamant | **OK** | `chestLoot.js` + meta diamant |
| Trophées sandbox | **Partiel** | `/trophees` — pas tout le système « points serveur » du slide si différent |
| Hacker salon | **OK** | `/hacker` + config rôle |
| Miroir slash `niveau` | **OK** | `slashDeploy.js` |
| Canvas / UI identique prod partout | **Partiel** | Ex. profil guilde embed test ; daily en V2 |

---

## Comment l’utiliser en équipe

1. **Réunion** : parcourir ce tableau + le **Google Doc** ; cocher ligne par ligne ce qui est « validé prod » vs « encore du ressenti ».
2. **Issues** : tout ce qui est **Absent** ou **Partiel** important → ticket avec lien vers la ligne du gdoc.
3. **Polish** : tout ce qui est **OK** peut quand même avoir des tickets « UX / équilibre / textes ».

Pour le détail joueur, voir aussi **`TUTORIEL-REBORN.md`**.
