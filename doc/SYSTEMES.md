# ⚙️ Systèmes — BLZbot V5.3

> Documentation détaillée de chaque système majeur du bot.  
> Dernière mise à jour : 28/02/2026

---

## Table des matières

1. [Progression (XP, Niveaux, Rangs)](#1-progression-xp-niveaux-rangs)
2. [Économie (Starss, Boutique, Items)](#2-économie-starss-boutique-items)
3. [Puits de Combat (MAJ Mars 2026)](#3-puits-de-combat)
4. [Marketplace P2P (MAJ Mars 2026)](#4-marketplace-p2p)
5. [Trophées & Valeur (MAJ Mars 2026)](#5-trophées--valeur)
6. [Guildes](#6-guildes)
7. [Guerres de Guildes](#7-guerres-de-guildes)
8. [Battle Pass](#8-battle-pass)
9. [Quêtes](#9-quêtes)
10. [Streaks](#10-streaks)
11. [Comptage](#11-comptage)
12. [Decay (Dégradation)](#12-decay)
13. [Mini-jeux](#13-mini-jeux)
14. [Prêts et Dettes](#14-prêts-et-dettes)
15. [Échanges (Trades)](#15-échanges)
16. [TOP Rôles](#16-top-rôles)
17. [Tutoriel](#17-tutoriel)
18. [Giveaways](#18-giveaways)
19. [Événements Saisonniers](#19-événements-saisonniers)
20. [VIP](#20-vip)
21. [Système Ranked (AFK)](#21-système-ranked-afk)
22. [Modération & Sécurité](#22-modération--sécurité)

---

## 1. Progression (XP, Niveaux, Rangs)

### Ressources principales

| Ressource | Symbole | Rôle |
|---|---|---|
| **XP** | 📈 | Détermine le niveau (1 → ∞) |
| **Rank Points (RP)** | ✨ | Détermine le rang (Plastique I → GOAT+) |
| **Starss** | ⭐ | Monnaie principale |

### Gains par message

Chaque message (avec cooldown anti-spam de 2s) accorde :
- XP de base + multiplicateurs (Couronne +20%, Boost XP ×2)
- RP de base + multiplicateurs (Micro +15%, Boost RP ×2)
- Starss de base + multiplicateurs (Écran +20%, Boost Starss ×2)
- +10 Points de Tirage (PT)

### Gains vocaux (par minute)

| Ressource | Base | Soft Cap | Réduction | Hard Cap |
|---|---|---|---|---|
| XP | 30/min | 10 000/jour | ÷5 | 15 000/jour |
| RP | 10/min | 5 000/jour | ÷5 | 7 000/jour |
| PT | 20/min | — | — | — |

**Conditions pour recevoir des récompenses vocales :**
- Ne pas être seul dans le salon
- Ne pas être mute ET sourd simultanément

### Niveaux

- Formule XP nécessaire : progressive (stockée dans `xp_needed`)
- À chaque level up : rôle de niveau mis à jour

| Seuil | Rôle |
|---|---|
| Niv. 1 | Pleb \| Niveau 1-5 |
| Niv. 5 | Paysans \| Niveau 5-10 |
| Niv. 10 | Paysan Riche \| Niveau 10-20 |
| Niv. 20 | Noble \| Niveau 20-30 |
| Niv. 30 | Prince \| Niveau 30-50 |
| Niv. 50 | Dirigeant \| Niveau 50-75 |
| Niv. 75 | Roi \| Niveau 75-100 |
| Niv. 100 | Empereur \| Niveau 100+ |

### Rangs (30 rangs)

**Plastique I → GOAT** (voir `config/role.config.json` pour les seuils exacts)

Catégories : Plastique (3) → Carton (3) → Bronze (3) → Fer (3) → Or (3) → Diamant (3) → Émeraude (3) → Rubis (3) → Légendaire (2) → Mythique (2) → GOAT (1)

**Rangs verrouillés** (jamais rétrogradés) : Mythique I, Mythique II, GOAT

**Post-GOAT** (coefficient-based) :
- SUPER GOAT (+10% au-dessus du seuil GOAT)
- THE GOAT (+20%)
- MAGNIFIQUE (+30%)

---

## 2. Économie (Starss, Boutique, Items)

### Boutique quotidienne (`/boutique`)

- **Reset** : Tous les jours à minuit (par utilisateur)
- **Items permanents** : Boosts (XP, RP, Starss, Comptage), Coffres (Normal, Méga)
- **Items rotatifs** : 6 items aléatoires pondérés par rareté
- **Coffre légendaire** : Spawn aléatoire (vérification toutes les heures)

### Raretés et prix

| Rareté | Probabilité | Prix (Starss) |
|---|---|---|
| Commun | 50% | 50 000 |
| Rare | 25% | 200 000 |
| Épique | 15% | 400 000 |
| Légendaire | 6% | 800 000 |
| Mythique | 3% | 1 500 000 |
| Goatesque | 1% | 3 000 000 |

### Catalogue d'items

**Boosts (toujours disponibles) :**
- ⚡ Boost XP (×2, 1h) — 100 000 ⭐
- ✨ Boost RP (×2, 1h) — 150 000 ⭐
- 💸 Boost Starss (×2, 1h) — 100 000 ⭐
- 💯 Boost Comptage (×2, 1h) — 150 000 ⭐

**Items passifs (permanent une fois utilisé) :**
- 🎤 Micro — +15% RP permanent
- 🖥️ Écran — +20% Starss permanent
- 👑 Couronne — +20% XP permanent

**Coffres :**
- 📦 Coffre au trésor (25 000 ⭐) — récompenses aléatoires
- 📦 Méga coffre (150 000 ⭐) — meilleures récompenses
- 📦 Coffre légendaire (750 000 ⭐) — récompenses exceptionnelles

**Items spéciaux :**
- Double Daily — réclame le daily une 2ème fois
- Reset Boutique — force le reset de la boutique
- Joker de Guilde — place gratuite dans la guilde (max 3 uses)
- Streak Keeper — récupère un streak perdu (48h)
- Remboursement — rembourse une dette intégralement
- Guild Upgrader — upgrade gratuit de guilde
- MEGA BOOST — choix : 2M Starss, 25k XP, ou 1 coffre légendaire
- Coup d'État — déclare une guerre sans consentement

### Sources de revenus « fixes »

Les sources suivantes ne bénéficient **pas** des multiplicateurs passifs/boosts :
`coffre`, `quest`, `giveaway`, `daily`, `streak`, `guild_treasury`, `guild_quest`, `mega_boost`, `battlepass`, `boutique`, `marketplace`, `puits`

---

## 3. Puits de Combat

> 🆕 MAJ Mars 2026 — Remplace le système de progression linéaire du pass

### Concept

Le Puits de Combat est un système de **tirage aléatoire** où les joueurs accumulent des **Points de Tirage (PT)** puis effectuent des tirages pour obtenir des récompenses.

### Gain de PT

| Activité | PT gagnés |
|---|---|
| Message envoyé | +10 |
| Minute en vocal | +20 |

### Coûts des tirages

**Joueurs Free :**

| Tirages | Coût unitaire (PT) |
|---|---|
| 1 à 5 | 500 |
| 6 à 10 | 1 000 |
| 11 à 25 | 2 000 |
| 26 à 50 | 4 000 |

**Maximum : 50 tirages / saison**

**Joueurs VIP :**

| Tirages | Coût unitaire (PT) |
|---|---|
| 1 à 5 | 300 |
| 6 à 10 | 600 |
| 11 à 25 | 1 200 |
| 26 à 50 | 2 400 |
| 51 à 70 | 3 500 |

**Maximum : 70 tirages / saison**

### Pool de récompenses (Free)

| Récompense | Poids | Quantité |
|---|---|---|
| 30 000 Starss | 20 | — |
| 50 000 Starss | 10 | — |
| Coffre Normal | 15 | ×1 |
| Coffre Méga | 8 | ×1 |
| Coffre Légendaire | 3 | ×1 |
| Double Daily | 12 | ×1 |
| Reset Boutique | 10 | ×1 |
| Joker Guilde | 5 | ×1 |
| Streak Keeper | 5 | ×1 |
| MEGA BOOST | 2 | ×1 |
| Remboursement | 4 | ×1 |
| Boost XP | 8 | ×1 |
| Boost RP | 8 | ×1 |
| Rôle Exclusif | 1 | ×1 |

### Pool de récompenses VIP (en plus du pool Free)

| Récompense | Poids | Quantité |
|---|---|---|
| 100 000 Starss | 15 | — |
| Méga Coffre | 10 | ×1 |
| Coffre Légendaire | 5 | ×1 |
| MEGA BOOST | 3 | ×1 |
| Reset Boutique | 8 | ×1 |
| Double Daily | 10 | ×1 |

### Reset

Le puits est reset en même temps que le battle pass : **1er samedi du mois à 13h00**.  
Le reset remet `tirage_points` et `total_tirages` à 0.

### Fichiers

- `utils/puits-system.js` — Logique principale
- `commands/puits.js` — Commande slash

---

## 4. Marketplace P2P

> 🆕 MAJ Mars 2026

### Concept

Les joueurs peuvent vendre et acheter des items entre eux. Le système utilise un **escrow** : l'item est retiré de l'inventaire du vendeur au moment de la mise en vente, et rendu si l'annonce est annulée/expirée.

### Conditions

- **Niveau minimum** : 25
- **Annonces actives max** : 5 par joueur
- **Durée d'une annonce** : 7 jours
- **Prix** : entre 1 000 et 50 000 000 Starss

### Items non-vendables

`couscous`, `bague_mariage`, `ami_chiant`, `coeur_rouge`, tous les boosts (`xp_boost`, `points_boost`, `starss_boost`, `counting_boost`), et les items d'événement Saint-Valentin.

### Flux d'une transaction

```
Vendeur met en vente (item retiré de l'inventaire)
        │
   Annonce active pendant 7 jours
        │
    ┌───┴───────────────┬────────────────────┐
    │                   │                    │
Acheteur achète    Vendeur annule      Annonce expire
    │                   │                    │
Starss transférés   Item retourné       Item retourné
Item donné         au vendeur           au vendeur
```

### Nettoyage automatique

`cleanupExpiredListings()` s'exécute toutes les heures et :
1. Identifie les annonces dont `expires_at < maintenant` et `status = 'active'`
2. Retourne les items aux vendeurs
3. Passe le statut à `'expired'`

### Fichiers

- `utils/marketplace-system.js` — Logique principale
- `commands/marketplace.js` — Commande slash

---

## 5. Trophées & Valeur

> 🆕 MAJ Mars 2026

### Trophées

Les **trophées** remplacent l'ancien système de "succès". Ils sont attribués automatiquement à la complétion de quêtes.

| Rareté | Valeur | Couleur |
|---|---|---|
| Commune | 300 | — |
| Rare | 1 000 | — |
| Épique | 2 500 | — |
| Légendaire | 5 000 | — |
| Mythique | 10 000 | — |
| Goatesque | 25 000 | — |
| Halloween | 15 000 | — |

### Formule de Valeur (utilisateur)

```
Valeur = Valeur_RP + XP_total + Points_Comptage + Somme(Trophées)
```

Où **Valeur_RP** :
- Si RP ≤ 100 000 → `RP × 3`
- Si RP > 100 000 → `300 000 + (RP - 100 000) × 10`

### Valeur d'une guilde

```
Valeur_Guilde = Somme des Valeur de chaque membre
```

### Condition d'upgrade basée sur la valeur

Pour upgrader une guilde au niveau N, la guilde doit avoir une valeur ≥ `N × 300`.

### Recalcul automatique

- Exécuté toutes les 2 heures
- Exécuté 10 secondes après le démarrage du bot
- Met à jour `users.total_value` et `guilds.total_value`

### Fichiers

- `utils/trophy-value-system.js` — Logique principale
- Affichage : `/classement` type valeur + profil guilde (`/valeur` retire)

---

## 6. Guildes

### Création

- Commande : `/creerguilde [nom] [emoji]`
- Coût : 500 000 Starss
- Niveau minimum : 15
- Nom unique

### Rôles internes

| Rôle | Permissions |
|---|---|
| **CHEF** (propriétaire) | Tout |
| **SOUS_CHEF** (sous-chefs, max 2) | Inviter/exclure, trésorerie |
| **MEMBRE** | Trésorerie (dépôt), quêtes |

### Système d'upgrade (1-10)

Chaque niveau d'upgrade débloque des fonctionnalités :

| Niveau | Fonctionnalité débloquée |
|---|---|
| 1 | Base (3 slots) |
| 2 | +1 slot |
| 3 | +1 slot |
| 4 | Guild Tools (booster shop) |
| 5 | Canal privé de guilde |
| 6 | +1 slot |
| 7 | Rôles customisés |
| 8 | +1 slot |
| 9 | +1 slot |
| 10 | Max (12 slots) |

**Conditions d'upgrade :** Starss (depuis la trésorerie) + niveau du chef + valeur de guilde

### Sureffectif

- Maximum : 12 membres par guilde
- Si > 12 (via Joker de Guilde) : pénalité à partir de `overstaffed_since`
- Pénalités journalières croissantes sur la trésorerie

### Trésorerie

- **Revenu journalier** : calculé à minuit (Paris), basé sur l'activité des membres
- **Capacité** : limitée par le niveau d'upgrade
- **Opérations** : dépôt, retrait (chef/sous-chef), distribution

---

## 7. Guerres de Guildes

### Déclaration

- Via `/guerre declarer [guilde] [durée]`
- Durées : 12h, 48h, 7 jours
- L'autre guilde doit accepter (sauf avec Coup d'État)
- Cooldown entre guerres

### Scoring

Points de guerre basés sur l'activité des membres pendant la guerre :
- Messages envoyés
- Messages de comptage
- Minutes vocales
- RP gagnés

### Fin de guerre

- À la fin du timer, le score est comparé
- **Victoire** : pillage de trésorerie (25% pour 12h, 50% pour 48h, 100% pour 7j)
- **MVP** : le meilleur contributeur de chaque guilde est récompensé
- Stats de victoires enregistrées (wars_won, wars_won_70, wars_won_80, wars_won_90)

---

## 8. Battle Pass

### Structure

- 50 paliers (tiers)
- XP saisonnière (`seasonal_xp`) : l'XP gagnée par activité (messages, vocal) accumule aussi de la seasonal_xp
- Chaque palier a des récompenses Free et VIP

### Récompenses

Chaque tier a :
- `free_reward` — accessible à tous
- `vip_reward` — accessible aux VIP uniquement

Types : Starss, items, coffres, boosts

### Reset saisonnier

- **Quand** : 1er samedi du mois à 13h00 (Paris)
- **Ce qui est reset** : `seasonal_xp` → 0, table `battle_pass` vidée, `total_tirages` → 0, `tirage_points` → 0

### Fichiers

- `utils/battle-pass.js` — Logique et scheduling
- `commands/battlepass.js` — Commande slash
- `utils/canvas-battle-pass.js` — Rendu canvas

---

## 9. Quêtes

### Types

Les quêtes sont définies dans `utils/quests.js` (objet `QUESTS`).

Chaque quête a :
- `name`, `description`
- `type` (LEVEL_REACH, BALANCE_REACH, MESSAGES_SENT, etc.)
- `goal` (objectif numérique)
- `rarity` (Commune → Goatesque, Halloween)
- `reward` (badge + trophée à la complétion)

### Progression

- Vérifiée automatiquement dans `messageCreate.js` et autres événements
- Stockée dans `quest_progress` (user_id, quest_id, progress, completed)
- À la complétion : badge attribué + trophée attribué (MAJ Mars 2026)

### Quêtes de guilde

- Définies dans `guild_quests` (type, target, reward)
- Progression dans `guild_quest_progress`
- Récompenses : items ou Starss dans la trésorerie

---

## 10. Streaks

### Fonctionnement

- Le joueur doit se connecter chaque jour (envoyer un message)
- Chaque jour consécutif augmente le streak de +1
- Un streak perdu déclenche une période de grâce de 48h (avec `streak_keeper`)

### Récompenses

Récompenses croissantes basées sur la longueur du streak.

### Reset

Planifié mensuellement avec le battle pass.

---

## 11. Comptage

### Fonctionnement

- Canal dédié (défini par `COUNTING_CHANNEL`)
- Les joueurs doivent compter séquentiellement (1, 2, 3, ...)
- Un mauvais nombre = penalty (reset ou point perdu)
- Points de comptage (`points_comptage`) gagnés par nombre correct

### Boosts

- Boost Comptage (×2, 1h) — double les points de comptage

---

## 12. Decay

### Fonctionnement

- Vérifié toutes les heures
- S'applique uniquement aux joueurs avec ≥ 3 000 RP
- Le montant et l'intervalle dépendent du rang (définis dans `role.config.json`)
- Les rangs Émeraude I et au-dessus ont du decay

| Rang | Decay | Intervalle |
|---|---|---|
| Émeraude I | -100 | 2h |
| Émeraude II | -200 | 2h |
| Émeraude III | -300 | 2h |
| Rubis I | -500 | 2h |
| Rubis II | -750 | 2h |
| Rubis III | -1 000 | 2h |
| Légendaire I | -1 500 | 2h |
| Légendaire II | -2 000 | 2h |
| Mythique I | -3 000 | 2h |
| Mythique II | -4 000 | 2h |
| GOAT | -5 000 | 2h |

### Protection

- Les rangs **verrouillés** (Mythique I, Mythique II, GOAT) ne sont jamais rétrogradés en dessous de leur seuil, même avec le decay.

---

## 13. Mini-jeux

### Jeux disponibles

| Jeu | Commande | Joueurs |
|---|---|---|
| Morpion (Tic-Tac-Toe) | `/minijeu morpion` | 2 |
| Puissance 4 (Connect 4) | `/minijeu puissance4` | 2 |

### Paris

Les joueurs peuvent parier des Starss. Le gagnant remporte la mise.

### Tracking

`minigames_won` comptabilise les victoires (utilisé pour certaines quêtes).

---

## 14. Prêts et Dettes

### Fonctionnement

- `/starss-preter [membre] [montant] [intérêt] [durée]` — proposer un prêt
- L'emprunteur doit accepter
- Intérêt appliqué sur le montant
- `/rembourser` — rembourser (partiellement ou totalement)
- Vérification des prêts en retard toutes les heures

### Item Remboursement

L'item `remboursement` permet de rembourser intégralement une dette instantanément.

---

## 15. Échanges

### Fonctionnement

- `/echange [membre]` — proposer un échange
- Niveau 25 minimum
- Échange d'items et/ou de Starss
- Interface par boutons (confirmer/annuler)
- Validation des deux parties requise

---

## 16. TOP Rôles

### Catégories

| Catégorie | Rôles |
|---|---|
| Stars | Top 1, Top 5, Top 10 |
| Level | Top 1, Top 5, Top 10 |
| Counting | Top 1, Top 5, Top 10 |
| Guild | Top 1, Top 5, Top 10 |

### Mise à jour

- Toutes les heures + au démarrage
- Retire les anciens rôles, attribue les nouveaux
- Basé sur les classements en temps réel

---

## 17. Tutoriel

### Fonctionnement

- Déclenché à l'arrivée d'un nouveau membre (`guildMemberAdd`)
- Thread privé créé dans `TUTORIAL_CHANNEL`
- Progression en 10+ étapes avec boutons
- Couvre : XP, rangs, guildes, boutique, battle pass, items, etc.
- Vérification du rôle "règlement" en cours de tutoriel

---

## 18. Giveaways

### Fonctionnement

- Créés via `/giveaway` (admin)
- Wizard multi-étapes (type, récompense, durée, conditions)
- Les utilisateurs participent via boutons
- Tirage automatique à expiration (vérifié toutes les 30s)
- Base de données séparée (`giveaway.sqlite`)

---

## 19. Événements Saisonniers

### Halloween

- **Monnaies** : Bonbons 🍬, Citrouilles 🎃
- **Gains** : bonbons par message, citrouilles (chance aléatoire)
- **Boutique** : items spéciaux (boosts, cosmétiques)
- **Rôles** : Bonbon doré, Bonbon Légendaire, Master Bonbon, Citrouille légendaire
- **Activation** : `/event-toggle halloween`

### Noël

- **Monnaies** : Rubans 🎀, Cadeaux 🎁
- **Gains** : rubans par message/vocal/image/réaction
- **Calendrier de l'Avent** : récompenses quotidiennes (12-25 décembre)
- **Boutique** : items de Noël
- **Rôles** : Père de Noël, Maître de Noël, Riche de l'Hiver
- **Activation** : `/event-toggle noël`

### Saint-Valentin

- **Monnaie** : Cœurs ❤️
- **Gains** : cœurs par message et vocal
- **Mariage** : `/marier` — synergies de boost avec Bague
- **Boutique** : Bague de Mariage, Ami(e) Chiant(e), Cœur Rouge
- **Daily** : `/daily-amour` — 100 cœurs/jour
- **Mini-jeu** : `/date` — simulation de restaurant
- **Activation** : `/event-toggle valentin`

---

## 20. VIP

### Avantages

- 70 tirages max dans le Puits (vs 50)
- Coûts de tirages réduits (-40%)
- Récompenses bonus dans le pool VIP
- Récompenses VIP dans le Battle Pass

### Gestion

- Attributé via `/set-vip [membre] [durée]`
- Colonnes : `is_vip` (0/1), `vip_expires_at` (timestamp)
- Vérifié dynamiquement dans les systèmes concernés

---

## 21. Système Ranked (AFK)

### Concept

Système anti-AFK pour le vocal :
- Après 15 minutes d'inactivité en vocal, un captcha TTS est envoyé
- Le joueur doit répondre correctement
- Échec = pénalité (kick du vocal ou réduction de gains)

### Fichiers

- `utils/voice-afk-checker.js` — Vérification périodique
- `utils/ranked-state.js` — State management
- `utils/ranked-shares.js` — Distribution dynamique des RP

---

## 22. Modération & Sécurité

### Token Checker (`workers/CheckToken.js`)

Système automatique de vérification de token qui s'assure que le token n'a pas été compromis ou invalidé. En cas d'invalidation, il envoie une alerte via un webhook configuré (`WEBHOOK_URL` dans `.env`).

### Link Scanner (`workers/linkScanner.js`)

Scan en continu les messages pour détecter :
- Liens malveillants/encryptés
- Raccourcisseurs de liens (`bit.ly`, `tinyurl.com`, etc.)
- Liens/domaines bannis via `!banlink` et `!bandom`
- Sanctionne (time out) et supprime les messages si infraction détectée.
