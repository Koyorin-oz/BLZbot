# 📜 Référence des Commandes — BLZbot V5.3

> Liste exhaustive de toutes les commandes slash disponibles.  
> Dernière mise à jour : 28/02/2026

---

## Légende

- 🔒 = Admin uniquement (`PermissionFlagsBits.Administrator`)
- 👤 = Utilisateur
- 🏰 = Chef/Sous-chef de guilde requis
- 📊 = Sous-commandes disponibles
- 🆕 = MAJ Mars 2026

---

## Profil & Progression

| Commande | Type | Description |
|---|---|---|
| `/profil [membre]` | 👤 | Affiche le profil (canvas). Boutons : 🎯 Quêtes, 🏆 Trophées, 📦 Inventaire, 🛡️ Guilde |
| `/classement [type]` | 👤 | Classements : stars, XP, RP, comptage, **valeur** 💎, événements |
| `/parametres` | 👤 | Préférences de notifications (rank up, level up, streak, etc.) |

> `/valeur` retire — passe par `/classement` type Valeur.

---

## Économie & Items

| Commande | Type | Description |
|---|---|---|
| `/daily` | 👤 | Récompense quotidienne (10k-25k ⭐, 500 XP/RP, coffres) |
| `/boutique` | 👤 | Boutique quotidienne personnalisée |
| `/inventaire` | 👤 | Affiche l'inventaire avec boutons "Utiliser" |
| `/use [item]` | 👤 | Utiliser un item de l'inventaire |
| `/payer [membre] [montant]` | 👤 | Envoyer des Starss à un autre membre |
| `/echange [membre]` | 👤 | Proposer un échange d'items (niveau 25+) |

---

## Puits de Combat 🆕

| Commande | Type | Description |
|---|---|---|
| `/puits afficher` | 👤 | Voir ses PT, progression, coûts, boutons de tirage |
| `/puits tirer [nombre]` | 👤 | Effectuer des tirages (1 par défaut) |
| `/puits historique` | 👤 | Historique des tirages avec pagination |

---

## Marketplace 🆕

| Commande | Type | Description |
|---|---|---|
| `/marketplace parcourir` | 👤 | Voir toutes les annonces actives |
| `/marketplace vendre [item] [quantité] [prix]` | 👤 | Mettre un item en vente (niveau 25+) |
| `/marketplace acheter [id]` | 👤 | Acheter une annonce |
| `/marketplace annuler [id]` | 👤 | Annuler sa propre annonce |
| `/marketplace mes-annonces` | 👤 | Voir ses propres annonces |
| `/marketplace rechercher [item]` | 👤 | Rechercher par item (autocomplete) |

---

## Battle Pass

| Commande | Type | Description |
|---|---|---|
| `/battlepass afficher` | 👤 | Voir sa progression (canvas) |
| `/battlepass claim [tier]` | 👤 | Récupérer les récompenses d'un palier |
| `/battlepass-admin set-xp [membre] [xp]` | 🔒 | Définir l'XP saisonnière |
| `/battlepass-admin add-xp [membre] [xp]` | 🔒 | Ajouter de l'XP saisonnière |
| `/battlepass-admin reset-season` | 🔒 | Forcer un reset de saison |
| `/battlepass-admin view-tier [membre]` | 🔒 | Voir le palier d'un membre |

---

## Guildes

| Commande | Type | Description |
|---|---|---|
| `/creerguilde [nom] [emoji]` | 👤 | Créer une guilde (500k ⭐, niv. 15) |
| `/guilde-dissoudre` | 🏰 | Dissoudre sa guilde (irréversible) |
| `/guilde acheterplace` | 🏰 | Acheter un slot supplémentaire |
| `/guilde changer-de-nom [nom]` | 🏰 | Renommer la guilde |
| `/guilde-admin inviter [membre]` | 🏰 | Inviter un membre |
| `/guilde-admin exclure [membre]` | 🏰 | Exclure un membre |
| `/guilde-membre demander-rejoindre [guilde]` | 👤 | Demander à rejoindre |
| `/guilde-membre quitter` | 👤 | Quitter sa guilde |
| `/guilde-upgrade` | 🏰 | Upgrader la guilde au niveau suivant |
| `/guilde-tools` | 🏰 | Boutique boosts guilde (upgrade 4+) |
| `/guilde-roles liste/creer/modifier` | 🏰 | Gérer les rôles custom (upgrade 7+) |
| `/profil-guilde [guilde]` | 👤 | Voir le profil d'une guilde |
| `/liste-guildes` | 👤 | Lister toutes les guildes |
| `/quetes-guilde` | 👤 | Voir les quêtes de guilde |
| `/tresorerie deposer/donner/distribuer` | 🏰 | Gérer la trésorerie |

---

## Guerres

| Commande | Type | Description |
|---|---|---|
| `/guerre declarer [guilde] [durée]` | 🏰 | Déclarer une guerre (12h/48h/7j) |
| `/guerre repondre` | 🏰 | Accepter/refuser une déclaration |
| `/guerre statut` | 👤 | Voir le statut de la guerre en cours |

---

## Prêts & Dettes

| Commande | Type | Description |
|---|---|---|
| `/starss-preter [membre] [montant] [intérêt] [durée]` | 👤 | Proposer un prêt |
| `/rembourser [prêt]` | 👤 | Rembourser une dette |

---

## Mini-jeux

| Commande | Type | Description |
|---|---|---|
| `/minijeu morpion [membre] [mise]` | 👤 | Partie de morpion (avec mise optionnelle) |
| `/minijeu puissance4 [membre] [mise]` | 👤 | Partie de puissance 4 (avec mise optionnelle) |

---

## Administration

| Commande | Type | Description |
|---|---|---|
| `/admin` | 🔒 | Panel admin guildes (rename, transfer, add/remove members, set upgrade, merge users) |
| `/money give/remove/set [membre] [ressource] [montant]` | 🔒 | Gérer les Starss/Points |
| `/xp give/remove/set [membre] [montant]` | 🔒 | Gérer l'XP/Niveau |
| `/set-rank [membre] [rang]` | 🔒 | Définir le rang d'un membre |
| `/set-vip [membre] [durée]` | 🔒 | Donner/retirer le VIP |
| `/diagnostic [membre]` | 🔒 | Diagnostic complet d'un profil |
| `/maintenance` | 🔒 | Activer/désactiver le mode maintenance |
| `/event-toggle [événement]` | 🔒 | Activer/désactiver un événement saisonnier |
| `/force-tutoriel [membre]` | 🔒 | Forcer le tutoriel pour un membre |
| `/forcequestcomplete [membre] [quête]` | 🔒 | Forcer la complétion d'une quête |
| `/toggle-top-quest [quête]` | 🔒 | Activer/désactiver les quêtes TOP |
| `/hacker-item` | 🔒 | Item aléatoire dans le canal hacker |
| `/reset-db` | 🔒 | Reset DB ou refresh usernames |
| `/giveaway` | 🔒 | Créer un giveaway |

---

## Événement Halloween 🎃

> Disponible uniquement quand Halloween est actif

| Commande | Type | Description |
|---|---|---|
| `/daily-bonbons` | 👤 | 1 000 bonbons gratuits/jour |
| `/ouvrir-bonbons-surprise` | 👤 | Ouvrir tous ses bonbons surprise |
| `/boutique-halloween` | 👤 | Boutique d'Halloween |
| `/donner-bonbons [membre] [montant]` | 👤 | Donner des bonbons |
| `/halloween-profile` | 👤 | Profil Halloween (canvas) |
| `/halloween-quetes` | 👤 | Quêtes Halloween |
| `/give-bonbons [membre] [montant]` | 🔒 | Admin : donner bonbons |
| `/give-citrouilles [membre] [montant]` | 🔒 | Admin : donner citrouilles |
| `/set-bonbons [membre] [montant]` | 🔒 | Admin : définir bonbons |
| `/set-citrouilles [membre] [montant]` | 🔒 | Admin : définir citrouilles |

---

## Événement Noël 🎄

> Disponible uniquement quand Noël est actif

| Commande | Type | Description |
|---|---|---|
| `/boutique-noël` | 👤 | Boutique de Noël |
| `/cadeau-ouvrir` | 👤 | Ouvrir ses cadeaux surprise |
| `/calendrier` | 👤 | Calendrier de l'Avent (12-25 déc.) |
| `/noel-profil` | 👤 | Profil Noël (canvas) |
| `/ajouter-cadeaux [membre] [montant]` | 🔒 | Admin : ajouter cadeaux |
| `/ajouter-rubans [membre] [montant]` | 🔒 | Admin : ajouter rubans |
| `/retirer-cadeaux [membre] [montant]` | 🔒 | Admin : retirer cadeaux |
| `/retirer-rubans [membre] [montant]` | 🔒 | Admin : retirer rubans |
| `/rubans [membre] ajouter/retirer [montant]` | 🔒 | Admin : gérer rubans |
| `/set-cadeaux [membre] [montant]` | 🔒 | Admin : définir cadeaux |
| `/set-rubans [membre] [montant]` | 🔒 | Admin : définir rubans |

---

## Événement Saint-Valentin 💕

> Disponible uniquement quand la Saint-Valentin est active

| Commande | Type | Description |
|---|---|---|
| `/boutique-valentin` | 👤 | Boutique Valentine (Bague, Ami chiant, Cœur rouge) |
| `/daily-amour` | 👤 | 100 cœurs gratuits/jour |
| `/date` | 👤 | Mini-jeu : simulation de restaurant |
| `/marier [membre]` | 👤 | Se marier (requiert Bague de Mariage) |
| `/donner-coeurs [membre] [montant]` | 👤 | Donner des cœurs |
| `/preter-coeurs [membre] [montant] [durée]` | 👤 | Prêter des cœurs |
| `/rembourser-coeurs` | 👤 | Rembourser un prêt de cœurs |
| `/valentin-profil` | 👤 | Profil Valentine (canvas) |
| `/give-coeurs [membre] [montant]` | 🔒 | Admin : donner cœurs |
