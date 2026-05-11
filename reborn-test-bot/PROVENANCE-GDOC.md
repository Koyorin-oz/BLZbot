# REBORN — d’où viennent les « manques » listés ?

Ce dépôt ne contient **pas** le Google Doc source : on travaille à partir de **fichiers de suivi dans le repo**, rédigés pour refléter le doc design / la spec équipe :

| Fichier | Rôle |
|---------|------|
| `GDOC-STATUT-REBORN.md` | Grille **sujet gdoc → statut code** (revue code `reborn-test-bot`). |
| `REBORN-ETAT-MAJ.md` | Synthèse **état maj** (vision prod + sandbox). |
| `REBORN-CHECKLIST-DISCORD.md` | **Renvoi** vers `REBORN-ETAT-MAJ.md` (ancienne checklist). |

Les extensions techniques dans le code (types d’events supplémentaires, plafond focus, pont minijeu) sont **commentées en référence** à cette spec interne / checklist — pas des obligations inventées hors de ce cadre.

**Hors périmètre code** : merge prod unique, BDD finale, com / reset — décisions d’équipe et d’infra.
