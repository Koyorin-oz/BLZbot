# État de la MAJ REBORN (revue code — `reborn-test-bot`)

*Dernière passe : revue du dépôt local, pas du Google Doc ligne à ligne.*

Légende : **OK** = présent et jouable sur le bot de test · **Partiel** = là mais à valider wording/doc/équilibre · **Absent** = pas dans ce sandbox · **Prod** = dépend merge BLZbot / infra · **Manuel** = rôle ou process hors bot.

---

## Vision & déploiement

| Sujet | Statut | Notes |
|-------|--------|--------|
| Bot sandbox `reborn-test-bot` | **OK** | Package autonome + `slashDeploy` |
| Miroir slash + exécution handlers `niveau` | **OK** | Défaut : `REBORN_MIRROR_NIVEAU_SLASH` actif et `REBORN_MIRROR_NIVEAU_EXECUTE=1` → commandes BLZbot sans stub si le module charge |
| Fusion prod unique + BDD finale | **Prod** | Hors périmètre du seul dossier `reborn-test-bot` |

---

## Économie & progression

| Sujet | Statut | Notes |
|-------|--------|--------|
| Starss / voc, boosts, courbe XP, RP, décrépitude, pool RP | **OK** | `earn`, `rankedRp`, `xpCurve`, etc. |
| Tiers RP + **rôles Discord** | **Partiel** | Auto-sync si `/admin-roles` + IDs stockés (`rankedRoles.js`) — pas « gratuit » sans setup admin |
| Classements | **OK** | `/classement` |

---

## Boutique, daily, items

| Sujet | Statut | Notes |
|-------|--------|--------|
| Daily, double daily, reset shop, boutique midi Paris, CATL/CATS/coffres | **OK** | Voir `shop.js`, `purchase`, `daily` |
| Items (streak keeper, skips, spawner…) | **Partiel** | Implémentés / simplifiés — recouper chaque contrainte gdoc |

---

## Guildes joueur

| Sujet | Statut | Notes |
|-------|--------|--------|
| Création, trésor, grades, perms, focus, GXP/GRP arbre, séparation | **OK** | `playerGuilds`, `separation` |
| Salon privé guilde | **OK** | `/guilde salon` (perms bot **Manage Channels**) |
| **Rôles internes** nommables | **Partiel → OK** | `/guilde role_set` — étiquette libre par membre (`guild_internal_roles`). Si le gdoc exigeait exactement **3 types** de rôles globaux, le modèle est plutôt *label par membre* (souvent plus flexible). |

---

## Quêtes, index, temple, events

| Sujet | Statut | Notes |
|-------|--------|--------|
| Quêtes + arbre quête | **OK** | `/quetes`, `quests` |
| Défi minijeu → progression REBORN | **OK** (monorepo) | `niveau` → `rebornQuestBridge` → `quests.trackMinijeuWin` après victoire morpion / rps / p4 |
| Index + matrice | **OK** | `/itemindex` |
| Rôle Discord « index 100 % » | **Manuel** | `/admin-roles definir-index-full` pour lier un rôle ; pas d’auto si non configuré |
| Temple 11 clés | **OK** | `SOURCE_DEFS` ×11 |
| `/temple classement` Rois & Légendes | **OK** | Seuils **≥6** clés (Roi) et **3–5** clés (Légende) sur **11** max — constantes exportées (`TEMPLE_KEY_TOTAL`, `CLASSEMENT_*`) |
| Rôles Discord auto « Roi / Légende » temple | **OK** (si config) | `/admin-roles creer-temple` ou `definir-temple-*` + sync sur activité (`earn`), `/temple`, fin event, séparation ; file d’attente 30 s |
| Events + monnaie event + trade ×5 | **OK** | `/event`, `trade.js` |
| Types d’events | **OK** (base étendue) | `chasse`, `raid`, `marathon`, `siege`, `arene`, `conquete` dans `events.TYPES` + `/event lancer` |

---

## Ranked, GRP saison, focus

| Sujet | Statut | Notes |
|-------|--------|--------|
| GRP, ladder guildes, saison (tick) | **OK** | `grpSeason`, `/grp`, `/guilde classement` |
| Palier rewards RP | **OK** | `/ranked reclamer` + `rankedMilestones` |
| Focus + mode ÷2 GRP | **OK** | `useFocus`, métas |
| Modération abuse focus | **Absent / Prod** | Pas de module dédié dans ce bot |

---

## Séparation & séparatiste

| Sujet | Statut | Notes |
|-------|--------|--------|
| Flow séparation + récompenses | **OK** | `/separation` |
| Branche séparatiste 5 paliers | **OK** | `skillTree.separatist*` |

---

## Divers

| Sujet | Statut | Notes |
|-------|--------|--------|
| Trophées, hacker, passeport | **OK** | Commandes dédiées |
| Canvas profil / daily | **Partiel** | Objectif alignement prod — daily V2, profils hybrides |

---

## Fichiers utiles

| Fichier | Contenu |
|---------|---------|
| `REBORN-COMMANDES.md` | Liste des slash natives + note miroir |
| `GDOC-STATUT-REBORN.md` | Ancienne grille gdoc ↔ code (détail par ligne métier) |
| `TUTORIEL-REBORN.md` | Aide joueur |
