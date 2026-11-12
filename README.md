# BLZbot

Bot Discord du serveur communautaire du YouTubeur **[BLZstarss](https://www.youtube.com/@BLZstarss)**.

Il assure la **modération**, le **niveau / économie / guildes**, des **événements** (saisonniers, giveaways, etc.) et d’autres modules autour de la communauté.

---

## Liens

- **Chaîne YouTube :** [BLZstarss](https://www.youtube.com/@BLZstarss)

---

*Code publié à titre informatif pour la communauté. Ce dépôt n’est pas fourni comme guide pour héberger ou recopier le bot ailleurs ; l’exploitation officielle concerne le serveur associé à BLZstarss.*

## Bot BLZ Insider (développement)

Le bot Insider se lance indépendamment du bot principal avec `npm run dev`. Il utilise
`.env.insider` (à créer depuis `.env.insider.example`) pour son token, son serveur, ses
salons et ses autres variables. Le fichier `.env` principal n’est pas chargé dans ce mode.
Le mode watch redémarre le bot quand un fichier JavaScript chargé est modifié.
Les bases SQLite sont elles aussi isolées et persistées dans
`niveau/src/database/insider` ; elles ne sont pas recréées à chaque redémarrage. L’emplacement
peut être changé avec `BLZ_INSIDER_DATABASE_DIR` dans `.env.insider`.

Les commandes, autocomplétions, boutons, menus, modals (y compris ceux gérés par des
collectors) et messages sont réservés aux IDs présents dans
`niveau/data/insider-users.json`. Si le fichier n’existe pas, le démarrage le crée avec une
liste vide ; ajoute ensuite les IDs autorisés à `acceptedUserIds`, par exemple
`{"acceptedUserIds":["ID_DISCORD"]}`. La liste est relue à chaque action ; une liste invalide
bloque l’accès.
