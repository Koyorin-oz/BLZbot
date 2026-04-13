const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const logger = require('./logger');
const db = require('../database/database');

const TUTORIAL_PROGRESS_DDL = `
    CREATE TABLE IF NOT EXISTS tutorial_progress (
        user_id TEXT PRIMARY KEY,
        thread_id TEXT NOT NULL,
        step TEXT NOT NULL DEFAULT 'welcome',
        rules_accepted INTEGER DEFAULT 0,
        completed INTEGER DEFAULT 0,
        created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000)
    )
`;

// Créer la table sur chaque fichier SQLite (principal + test en mode double serveur).
// Au chargement du module, db pointe sans contexte guild → sans ça seul mainDb serait initialisé.
function initializeTutorialDatabase() {
    try {
        if (typeof db.forEachEconomyDatabase === 'function') {
            db.forEachEconomyDatabase((instance) => instance.exec(TUTORIAL_PROGRESS_DDL));
        } else {
            db.exec(TUTORIAL_PROGRESS_DDL);
        }
        logger.info('[TUTORIAL] Table tutorial_progress initialisée avec succès (toutes les bases économie)');
    } catch (error) {
        logger.error('[TUTORIAL] Erreur lors de l\'initialisation de la base de données:', error);
        throw error;
    }
}

initializeTutorialDatabase();

/**
 * Contenu du tutoriel - Toutes les fonctionnalités du bot expliquées
 */
const TUTORIAL_CONTENT = {
    welcome: {
        /** Texte intégralement affiché dans le footer de l’embed (pas de titre / description). */
        footerText: `Avant de pouvoir accéder à l'entièreté du serveur, tu vas devoir passer par un petit tutoriel pour découvrir toutes les fonctionnalités incroyables que nous proposons.

📋 Première étape : Accepter le règlement

Pour continuer, tu dois d'abord accepter le règlement du serveur. Rends-toi dans le salon <#1454477663703011439> et clique sur le bouton "Accepter le règlement".

Une fois fait, clique sur le bouton "Fait !" ci-dessous pour continuer ! ✨`,
        color: 'Blue'
    },

    choice: {
        title: '✅ Règlement accepté !',
        description: `Parfait ! Tu as accepté le règlement. 

Maintenant, tu as le choix :

🎓 **Faire le tutoriel complet** - Je t'explique en détail tout le système d'argent, de rangs, de levels, les guildes, les quêtes, et bien plus !

⏭️ **Skip le tutoriel** - Si tu préfères découvrir par toi-même, pas de problème ! Tu auras directement accès au serveur.

**Que préfères-tu faire ?**`,
        color: 'Gold'
    },

    tutorial_part_1: {
        title: '💰 Système d\'Économie - Partie 1 : Les Starss',
        description: `Commençons par le système économique du serveur !

**💸 Les Starss**
Les **Starss** sont la monnaie principale du serveur. Tu peux les gagner de plusieurs façons :

• **Messages** : Envoie des messages pour gagner des Starss (avec des boosts de guilde !)
• **Vocal** : Reste en vocal pour être récompensé toutes les minutes
• **/daily** : Récupère ta récompense quotidienne aléatoire
• **Quêtes** : Complète des quêtes pour des récompenses importantes

Les Starss te permettent d'acheter des items dans la **/boutique**, de prêter de l'argent à d'autres membres, d'améliorer ta guilde, et bien plus encore !

Tu peux voir ton solde à tout moment avec **/profile** 📊`,
        color: 'Gold'
    },

    tutorial_part_2: {
        title: '📊 Système d\'Économie - Partie 2 : Les Points de Rang (RP)',
        description: `**⭐ Les Points de Rang (RP)**

Les **Points de Rang** sont essentiels pour progresser dans le classement du serveur !

**Comment gagner des RP ?**
• Envoyer des messages
• Rester en vocal
• Participer aux guerres de guildes
• Utiliser certains items (Micro = +15% RP)

**🏆 Le système de rangs**

Tu commences au rang **Plastique I** et tu peux monter jusqu'au rang **GOAT** !

Voici la progression complète :
\`\`\`
Plastique I-III → Carton I-III → Bronze I-III → Fer I-III
→ Or I-III → Diamant I-III → Émeraude I-III → Rubis I-III
→ Légendaire I-II → Mythique I-II → GOAT
\`\`\`

**⚠️ Attention au decay !**
À partir du rang **Émeraude I**, tu perds des points de rang toutes les 2 heures si tu n'es pas actif. Plus ton rang est élevé, plus le decay est important !

Utilise **/classement** pour voir ta position dans le classement ! 📈`,
        color: 'Purple'
    },

    tutorial_part_3: {
        title: '🎯 Système de Niveaux et XP',
        description: `**⬆️ Les Niveaux et l'Expérience (XP)**

En plus des rangs, tu as aussi un système de **niveaux** !

**Comment gagner de l'XP ?**
• Envoyer des messages (+XP aléatoire)
• Rester en vocal (XP par minute)
• Compléter des quêtes
• Utiliser certains items (Couronne = +20% XP)

**🎁 Récompenses de niveau**

À chaque niveau, ton XP nécessaire pour le prochain niveau augmente. Plus tu montes haut, plus c'est difficile ! Tu débloques aussi des **rôles de niveau** qui s'affichent sur ton profil.

**Items utiles pour progresser :**
• **⚡ Boost XP** : Double ton gain d'XP pendant 1 heure (100 000 Starss)
• **👑 Couronne** : +20% d'XP permanent (400 000 Starss)

Utilise **/profile** pour voir ta progression ! 📊`,
        color: 'Green'
    },

    tutorial_part_4: {
        title: '🏰 Système de Guildes - Partie 1 : Les Bases',
        description: `**🛡️ Les Guildes**

Les guildes sont des groupes de joueurs qui travaillent ensemble pour devenir les plus puissants du serveur !

**Créer une guilde**
• **/creerguilde [nom] [emoji]** : Crée ta propre guilde
• Coût : **500 000 Starss** + **Niveau 15 minimum**
• Tu deviens le **Chef de Guilde** automatiquement

**Rejoindre une guilde**
• **/demander-rejoindre-guilde [nom]** : Demande à rejoindre une guilde existante
• **/inviter-guilde [membre]** : Le chef peut t'inviter directement

**👑 Pouvoirs du Chef de Guilde**
• Inviter/exclure des membres
• Changer le nom et l'émoji de la guilde
• Améliorer la guilde (upgrades)
• Gérer la trésorerie
• Dissoudre la guilde

**📊 Infos importantes**
• Places de base : **5 membres**
• Places maximum : **35 membres** (avec les upgrades)
• Niveau de guilde : Augmente avec l'activité des membres
• Trésorerie : Se débloque à l'upgrade 2

Utilise **/profil-guilde** pour voir toutes les infos de ta guilde !`,
        color: 'Red'
    },

    tutorial_part_5: {
        title: '🏰 Système de Guildes - Partie 2 : Améliorations',
        description: `**⚡ Système d'Upgrades (10 niveaux)**

Ta guilde peut monter jusqu'à l'**Upgrade 10** avec des avantages à chaque niveau !

**Upgrades disponibles :**

**U1** (Gratuit) : Guilde de base - 5 places
**U2** (350k ⭐ + niv 50) : Trésorerie débloquée + 3 places
**U3** (1M ⭐ + niv 100 + tréso 1M) : +3 places
**U4** (2M ⭐ + niv 200 + tréso 2.5M) : Guilds Tools + 3 places
**U5** (5M ⭐ + niv 300 + tréso 5M) : Salon privé + 3 places
**U6** (10M ⭐ + niv 400 + tréso 10M) : Guerres débloquées + 3 places
**U7** (15M ⭐ + niv 500 + 1 guerre gagnée) : +3 places
**U8** (20M ⭐ + niv 600 + 70% victoires + 1 MEGA BOOST) : Nouveaux Tools + 3 places
**U9** (25M ⭐ + niv 800 + 80% victoires + 1 MEGA BOOST) : +3 places
**U10** (30M ⭐ + niv 1000 + 90% victoires + 1 Guild Upgrader + 2 MEGA BOOST) : +3 places

**💰 Trésorerie**
• Se remplit automatiquement chaque jour
• Capacité augmente avec les upgrades
• Utilisable pour les améliorations de guilde

**💎 Items utiles :**
• **Guild upgrader** (Mythique) : Requis pour U10 (1 500 000 Starss)
• **MEGA BOOST** (Goatesque) : Requis pour U8, U9 et U10 (3 000 000 Starss)

Utilise **/guilde-upgrade** pour voir les détails et améliorer !`,
        color: 'Red'
    },

    tutorial_part_6: {
        title: '⚔️ Système de Guildes - Partie 3 : Guerres',
        description: `**⚔️ Guerres de Guildes**

Débloqué à l'**Upgrade 6**, les guerres permettent aux guildes de s'affronter !

**Types de guerres :**
• **Courte** : 12 heures
• **Classique** : 48 heures
• **Longue** : 168 heures (7 jours)

**Comment ça marche ?**
1. Le chef déclare la guerre avec **/guerre declarer**
2. L'autre guilde accepte ou refuse
3. Pendant la guerre, les membres des deux guildes gagnent des points en étant actifs
4. La guilde avec le plus de points à la fin gagne !

**🏆 Récompenses de guerre**
• Starss pour tous les membres de la guilde gagnante
• Points de rang bonus
• Statistiques de guilde (+1 guerre gagnée)

**Items utiles :**
• **Coup d'état** (Goatesque) : Force une attaque sans consentement ! (3 000 000 Starss)

Utilise **/guerre-statut** pour voir l'état de la guerre en cours !`,
        color: 'DarkRed'
    },

    tutorial_part_7: {
        title: '📜 Système de Quêtes',
        description: `**🎯 Les Quêtes**

Les quêtes sont des défis que tu peux accomplir pour gagner des récompenses importantes !

**Il existe plusieurs types de quêtes :**

**🟢 Communes** - Récompenses : 10k-50k Starss
Exemples : Envoyer des messages, rester en vocal, réagir, atteindre un niveau

**🔵 Rares** - Récompenses : 50k-100k Starss
Exemples : Rejoindre une guilde, atteindre des rangs, faire des trades

**🟣 Épiques** - Récompenses : 150k-300k Starss
Exemples : Créer une guilde, ouvrir des coffres, rembourser des dettes

**🟠 Légendaires** - Récompenses : 500k-1M Starss
Exemples : Acheter des items mythiques, finir le Battle Pass, ouvrir des coffres légendaires

**🔴 Mythiques** - Récompenses : 1M-5M Starss + Rôles
Exemples : Passer GOAT, devenir chef d'une grosse guilde, accomplir des défis extrêmes

**✨ Goatesques** - Récompenses : 10M-15M Starss + Rôles exclusifs
Exemples : 100 000 messages, 100h en vocal, 50M Starss, niveau 100

**Comment progresser ?**
• Messages, vocal, réactions, images
• Monter en niveau et en rang
• Ouvrir des coffres, faire des trades
• Participer aux mini-jeux
• Utiliser la boutique et le Battle Pass

Utilise **/acces-quetes** pour voir toutes tes quêtes en cours ! 📋`,
        color: 'Yellow'
    },

    tutorial_part_8: {
        title: '🎖️ Battle Pass Saisonnier',
        description: `**🎖️ Le Battle Pass**

Le Battle Pass est un système de progression saisonnier avec **50 paliers** de récompenses !

**Comment ça marche ?**
• Tu gagnes de l'**XP saisonnier** grâce aux messages, au temps passé en vocal, et aux quêtes
• Chaque palier débloque des récompenses
• Le Battle Pass se réinitialise chaque saison

**🎁 Types de récompenses :**
• Starss (de 10k à 500k)
• Items exclusifs (coffres, boosts)
• XP de niveau bonus
• Points de rang
• Items rares et légendaires

**👑 VIP Battle Pass**
Les membres VIP ont accès à des récompenses BONUS sur chaque palier !

**Commandes utiles :**
• **/battlepass afficher** : Voir ta progression
• **/battlepass claim** : Récupérer les récompenses d'un palier

**Commandes utiles :**
• **/puits afficher** : Voir ta progression dans le puits
• **/puits tirer** : Effectuer des tirages avec tes Points de Tirage`,
        color: 'Blurple'
    },

    tutorial_part_9: {
        title: '🛒 Système de Boutique et Items',
        description: `**🛒 La Boutique**

La boutique propose des items qui changent **tous les jours à minuit** !

**Types d'items disponibles :**

**⚡ Boosts (Toujours disponibles)**
• Boost XP/RP/Starss/Comptage (x2 pendant 1h)

**📦 Coffres (Toujours disponibles)**
• Coffre normal (25k ⭐) : Récompenses aléatoires
• Méga coffre (150k ⭐) : Meilleures récompenses

**🎲 Items Quotidiens (Rotation aléatoire)**
Chaque jour, 6 items aléatoires apparaissent selon leur rareté :
• Commun (50%) : 50k ⭐
• Rare (25%) : 200k ⭐
• Épique (15%) : 400k ⭐
• Légendaire (6%) : 800k ⭐
• Mythique (3%) : 1.5M ⭐
• Goatesque (1%) : 3M ⭐

**⚠️ Limites d'achat**
Chaque item a une limite d'achat par jour selon sa rareté !

**Items spéciaux :**
• Double Daily, Reset boutique, Micro, Écran, Couronne
• Joker de guilde, Streak Keeper, Remboursement
• MEGA BOOST, Coup d'état, Guild upgrader

Utilise **/boutique** pour voir les items du jour ! 🛍️`,
        color: 'Gold'
    },

    tutorial_part_10: {
        title: '🎁 Système d\'Items et Inventaire',
        description: `**🎒 Ton Inventaire**

Tous les items que tu achètes sont stockés dans ton inventaire !

**Commandes importantes :**
• **/inventaire** : Voir tous tes items
• **/use [item]** : Utiliser un item

**💎 Items Permanents (Passifs)**
Certains items donnent des bonus permanents une fois utilisés :
• **🎤 Micro** : +15% RP permanent
• **🖥️ Écran** : +20% Starss permanent
• **👑 Couronne** : +20% XP permanent

**⚡ Items Consommables**
• **Boosts** : Activent un bonus temporaire (1h)
• **Coffres** : S'ouvrent pour donner des récompenses aléatoires
• **Remboursement** : Annule une dette
• **MEGA BOOST** : Choix entre 2M Starss, 25k XP, ou 1 coffre légendaire

**🔄 Système d'Échange**
Tu peux échanger des items et des Starss avec d'autres membres !
• **/echange [membre]** : Proposer un échange
• **/payer [membre] [montant]** : Donner des Starss

Utilise **/inventaire** pour gérer tes items ! 📦`,
        color: 'Blue'
    },

    tutorial_part_11: {
        title: '💳 Système de Prêts',
        description: `**💰 Prêts entre Membres**

Tu peux prêter des Starss à d'autres membres avec un système de remboursement !

**Comment prêter ?**
• **/starss-preter [membre] [montant] [durée] [intérêt]**
• Durée : Entre 24h et 7 jours (format : 24h, 3d, 7d)
• Intérêt : Entre 0% et 30%
• Montant max par prêt : **5 000 000 Starss**
• Limite : **10 dettes maximum** par membre
• Dette totale max : **5 000 000 Starss**

**Exemple :**
\`/starss-preter @Membre 100000 3d 10\`
→ Prête 100k Starss pour 3 jours avec 10% d'intérêt
→ L'emprunteur devra rembourser 110k Starss

**⚠️ PÉNALITÉS DE RETARD TRÈS SÉVÈRES !**
Si l'emprunteur ne rembourse pas à temps :
• Il perd **(montant + intérêts) X2** automatiquement
• Le prêteur reçoit **(montant + intérêts) X2** en dédommagement
• Exemple : Dette de 110k → Pénalité de 220k Starss !
• ⚠️ Le solde peut devenir **négatif** (ex: -500k Starss possible)

**Commandes utiles :**
• **/rembourser [dette] [montant]** : Rembourser une dette (en plusieurs fois possible)
• **Remboursement** (item Mythique) : Annule automatiquement une dette !

⚠️ L'emprunteur doit **accepter** le prêt via un bouton. Sois TRÈS prudent en empruntant ! 💸`,
        color: 'Green'
    },

    tutorial_part_12: {
        title: '🎮 Autres Fonctionnalités',
        description: `**🎲 Minijeux**

Utilise **/minijeu** pour jouer à des jeux avec d'autres membres :
• Pierre-Papier-Ciseaux
• Morpion
• Puissance 4

**🔢 Système de Comptage**

Un salon spécial où il faut compter dans l'ordre !
• Chaque membre peut envoyer le nombre suivant
• Gagne des **Points de Comptage (PC)** à chaque nombre
• Si tu te trompes, ton message est supprimé !

**💯 Boost de Comptage**
• Boost Points Comptage (x2 - 1h) : 150 000 Starss

**📊 Commandes Utiles**

• **/profile** : Ton profil complet
• **/classement** : Le classement du serveur
• **/liste-guildes** : Toutes les guildes
• **/acces-quetes** : Tes quêtes
• **/battlepass** : Ta progression Battle Pass
• **/inventaire** : Tes items
• **/boutique** : La boutique du jour
• **/daily** : Récompense quotidienne

Tu es maintenant prêt à conquérir le serveur ! 🚀`,
        color: 'Blurple'
    },

    completed: {
        title: '🎉 Tutoriel Terminé !',
        description: `Félicitations ! Tu as terminé le tutoriel et tu connais maintenant toutes les fonctionnalités du serveur ! 🎊

**📝 Récapitulatif :**
✅ Système d'économie (Starss, RP, Niveaux)
✅ Système de rangs (Plastique → GOAT)
✅ Guildes (création, améliorations, guerres)
✅ Quêtes (Commune → Goatesque)
✅ Battle Pass saisonnier
✅ Boutique et items
✅ Prêts et échanges
✅ Minijeux et système de comptage

**Tu as maintenant accès à tout le serveur !**

Clique sur le bouton ci-dessous pour terminer le tutoriel ! 👇

Amuse-toi bien ! 🎮✨`,
        color: 'Green'
    }
};

/**
 * Initialise le tutoriel pour un nouveau membre
 */
async function initializeTutorial(member, thread) {
    try {
        logger.debug(`[TUTORIAL] Début initializeTutorial pour ${member.user.username}`);

        // Enregistrer dans la base de données
        try {
            logger.debug(`[TUTORIAL] Insertion en base de données...`);
            const stmt = db.prepare(`
                INSERT OR REPLACE INTO tutorial_progress (user_id, thread_id, step, rules_accepted, completed)
                VALUES (?, ?, ?, ?, ?)
            `);
            stmt.run(member.id, thread.id, 'welcome', 0, 0);
            logger.debug(`[TUTORIAL] Base de données OK`);
        } catch (dbError) {
            logger.error('[TUTORIAL] Erreur base de données:', dbError);
            throw dbError;
        }

        // Ajouter le rôle "Tutoriel pas fait"
        try {
            logger.debug(`[TUTORIAL] Recherche/création du rôle...`);
            let notDoneRole = member.guild.roles.cache.find(r => r.name === 'Tutoriel pas fait');
            if (!notDoneRole) {
                logger.debug(`[TUTORIAL] Rôle introuvable, création...`);
                notDoneRole = await member.guild.roles.create({
                    name: 'Tutoriel pas fait',
                    color: 'Red',
                    reason: 'Rôle pour les membres n\'ayant pas terminé le tutoriel'
                });
                logger.info('[TUTORIAL] Rôle "Tutoriel pas fait" créé');
            }
            logger.debug(`[TUTORIAL] Ajout du rôle au membre...`);
            await member.roles.add(notDoneRole);
            logger.info(`[TUTORIAL] Rôle "Tutoriel pas fait" ajouté à ${member.user.username}`);
        } catch (roleError) {
            logger.error('[TUTORIAL] Erreur ajout rôle:', roleError);
            // Ne pas bloquer si le rôle échoue
        }

        // Envoyer le message de bienvenue avec bouton
        try {
            logger.debug(`[TUTORIAL] Construction de l'embed...`);
            const welcomeFooter = `👋 Bienvenue, <@${member.id}> !\n\n${TUTORIAL_CONTENT.welcome.footerText}`;
            const embed = new EmbedBuilder()
                .setColor(TUTORIAL_CONTENT.welcome.color)
                .setFooter({ text: welcomeFooter.slice(0, 2048) });

            logger.debug(`[TUTORIAL] Construction du bouton...`);
            const row = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId('tutorial_check_rules')
                        .setLabel('✅ Fait !')
                        .setStyle(ButtonStyle.Success)
                );

            logger.debug(`[TUTORIAL] Envoi du message dans le fil...`);
            await thread.send({ embeds: [embed], components: [row] });
            logger.debug(`[TUTORIAL] Message envoyé avec succès`);
        } catch (sendError) {
            logger.error('[TUTORIAL] Erreur envoi message:', sendError);
            throw sendError;
        }

        logger.info(`[TUTORIAL] Tutoriel initialisé avec succès pour ${member.user.username}`);
    } catch (error) {
        logger.error('[TUTORIAL] ERREUR CRITIQUE dans initializeTutorial:', error);
        logger.error('[TUTORIAL] Stack:', error.stack);
        throw error; // Re-throw pour que guildMemberAdd puisse aussi logger
    }
}

/**
 * Vérifie si un utilisateur a accepté le règlement
 */
function hasAcceptedRules(userId) {
    const stmt = db.prepare('SELECT rules_accepted FROM tutorial_progress WHERE user_id = ?');
    const result = stmt.get(userId);
    return result && result.rules_accepted === 1;
}

/**
 * Vérifie si un utilisateur a le rôle de règlement et passe à l'étape suivante
 */
async function checkAndProgressTutorial(userId, client) {
    try {
        logger.debug(`[TUTORIAL] Vérification du rôle pour ${userId}...`);

        const stmt = db.prepare('SELECT thread_id, step FROM tutorial_progress WHERE user_id = ?');
        const progress = stmt.get(userId);

        if (!progress) {
            logger.debug(`[TUTORIAL] Aucune progression trouvée pour ${userId}`);
            return;
        }

        logger.debug(`[TUTORIAL] Étape actuelle pour ${userId}: ${progress.step}`);

        if (progress.step !== 'welcome') {
            logger.debug(`[TUTORIAL] ${userId} n'est pas à l'étape 'welcome', skip`);
            return; // Pas dans le tutoriel ou déjà passé cette étape
        }

        // Vérifier si l'utilisateur a le rôle de règlement
        const guild = await client.guilds.fetch(process.env.GUILD_ID);
        const member = await guild.members.fetch(userId);
        const rulesRoleId = process.env.REGLEMENT_ROLE;

        logger.debug(`[TUTORIAL] Vérification du rôle ${rulesRoleId} pour ${userId}...`);
        logger.debug(`[TUTORIAL] Rôles du membre: ${[...member.roles.cache.keys()].join(', ')}`);

        if (!member.roles.cache.has(rulesRoleId)) {
            logger.debug(`[TUTORIAL] ${userId} n'a pas encore le rôle de règlement`);
            return; // N'a pas encore le rôle
        }

        logger.info(`[TUTORIAL] ✅ Rôle de règlement détecté pour ${userId} !`);

        // Mettre à jour la base de données
        const updateStmt = db.prepare('UPDATE tutorial_progress SET rules_accepted = 1, step = ? WHERE user_id = ?');
        updateStmt.run('choice', userId);

        // Récupérer le fil
        const thread = await client.channels.fetch(progress.thread_id).catch(() => null);
        if (!thread) {
            logger.error(`[TUTORIAL] Thread introuvable: ${progress.thread_id}`);
            return;
        }

        // Envoyer le message de choix
        const embed = new EmbedBuilder()
            .setTitle(TUTORIAL_CONTENT.choice.title)
            .setDescription(TUTORIAL_CONTENT.choice.description)
            .setColor(TUTORIAL_CONTENT.choice.color)
            .setTimestamp();

        const row = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('tutorial_continue')
                    .setLabel('🎓 Faire le tutoriel complet')
                    .setStyle(ButtonStyle.Primary),
                new ButtonBuilder()
                    .setCustomId('tutorial_skip')
                    .setLabel('⏭️ Skip le tutoriel')
                    .setStyle(ButtonStyle.Secondary)
            );

        await thread.send({ content: `<@${userId}>`, embeds: [embed], components: [row] });

        logger.info(`[TUTORIAL] Message de choix envoyé à ${userId}`);
    } catch (error) {
        logger.error('[TUTORIAL] Erreur lors de la vérification du règlement:', error);
    }
}

/**
 * Gère le choix de l'utilisateur (continuer ou skip)
 */
async function handleTutorialChoice(interaction, choice) {
    try {
        await interaction.deferReply({ ephemeral: true });
        logger.debug(`[TUTORIAL] handleTutorialChoice appelé: ${choice}`);
        const userId = interaction.user.id;
        const stmt = db.prepare('SELECT step FROM tutorial_progress WHERE user_id = ?');
        const progress = stmt.get(userId);

        if (!progress || progress.step !== 'choice') {
            logger.debug(`[TUTORIAL] Étape incorrecte: ${progress ? progress.step : 'null'}`);
            return interaction.editReply({ content: 'Tu n\'es pas à cette étape du tutoriel.' });
        }

        if (choice === 'skip') {
            logger.info(`[TUTORIAL] ${userId} a choisi de skip le tutoriel`);
            // Skip le tutoriel - donner le rôle et fermer le fil
            await completeTutorial(userId, interaction.guild, interaction.channel, true);
            await interaction.editReply({ content: '✅ Tutoriel skippé ! Tu as maintenant accès à tout le serveur. Ce fil va se fermer dans quelques secondes.' });
        } else {
            logger.info(`[TUTORIAL] ${userId} a choisi de faire le tutoriel complet`);
            // Commencer le tutoriel complet
            const updateStmt = db.prepare('UPDATE tutorial_progress SET step = ? WHERE user_id = ?');
            updateStmt.run('part_1', userId);

            await interaction.editReply({ content: '🎓 Parfait ! Je vais t\'expliquer tout en détail. C\'est parti !' });

            // Envoyer la première partie du tutoriel
            await sendTutorialPart(interaction.channel, userId, 1);
        }
    } catch (error) {
        if (error.code !== 10062) {
            logger.error('[TUTORIAL] ERREUR dans handleTutorialChoice:', error);
        }
    }
}

/**
 * Envoie une partie spécifique du tutoriel
 */
async function sendTutorialPart(channel, userId, partNumber) {
    try {
        const contentKey = `tutorial_part_${partNumber}`;
        const content = TUTORIAL_CONTENT[contentKey];

        if (!content) {
            // Fin du tutoriel
            await sendTutorialCompletion(channel, userId);
            return;
        }

        const embed = new EmbedBuilder()
            .setTitle(content.title)
            .setDescription(content.description)
            .setColor(content.color)
            .setFooter({ text: `Partie ${partNumber}/14` })
            .setTimestamp();

        const row = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId(`tutorial_next_${partNumber}`)
                    .setLabel('➡️ Continuer')
                    .setStyle(ButtonStyle.Primary)
            );

        await channel.send({ embeds: [embed], components: [row] });
    } catch (error) {
        logger.error(`[TUTORIAL] Erreur lors de l'envoi de la partie ${partNumber}:`, error);
    }
}

/**
 * Gère le clic sur le bouton "Continuer"
 */
async function handleTutorialNext(interaction) {
    try {
        await interaction.deferReply({ ephemeral: true });
        const userId = interaction.user.id;
        const partNumber = parseInt(interaction.customId.split('_')[2]);
        const nextPart = partNumber + 1;

        // Mettre à jour l'étape
        const updateStmt = db.prepare('UPDATE tutorial_progress SET step = ? WHERE user_id = ?');
        updateStmt.run(`part_${nextPart}`, userId);

        await interaction.editReply({ content: '👍 Compris ! Passons à la suite...' });

        // Envoyer la partie suivante
        await sendTutorialPart(interaction.channel, userId, nextPart);
    } catch (error) {
        if (error.code !== 10062) {
            logger.error('[TUTORIAL] Erreur lors du passage à la partie suivante:', error);
        }
    }
}

/**
 * Envoie le message de fin de tutoriel avec bouton
 */
async function sendTutorialCompletion(channel, userId) {
    try {
        const embed = new EmbedBuilder()
            .setTitle(TUTORIAL_CONTENT.completed.title)
            .setDescription(TUTORIAL_CONTENT.completed.description)
            .setColor(TUTORIAL_CONTENT.completed.color)
            .setTimestamp();

        const row = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('tutorial_finish')
                    .setLabel('✅ Terminer le tutoriel')
                    .setStyle(ButtonStyle.Success)
            );

        // Mettre à jour l'étape
        const updateStmt = db.prepare('UPDATE tutorial_progress SET step = ? WHERE user_id = ?');
        updateStmt.run('awaiting_confirmation', userId);

        await channel.send({ content: `<@${userId}>`, embeds: [embed], components: [row] });
    } catch (error) {
        logger.error('[TUTORIAL] Erreur lors de l\'envoi du message de fin:', error);
    }
}

/**
 * Gère le clic sur le bouton de fin de tutoriel
 */
async function handleFinalConfirmation(interaction) {
    try {
        await interaction.deferReply({ ephemeral: true });
        const userId = interaction.user.id;
        const stmt = db.prepare('SELECT step, thread_id FROM tutorial_progress WHERE user_id = ?');
        const progress = stmt.get(userId);

        if (!progress || progress.step !== 'awaiting_confirmation') {
            return interaction.editReply({ content: 'Tu n\'es pas à cette étape du tutoriel.' });
        }

        // Vérifier si c'est bien le bon fil
        if (interaction.channel.id !== progress.thread_id) {
            return interaction.editReply({ content: 'Cette action ne peut être effectuée que dans ton fil de tutoriel.' });
        }

        // Compléter le tutoriel
        await completeTutorial(userId, interaction.guild, interaction.channel, false);
        await interaction.editReply('🎉 Parfait ! Tutoriel terminé ! Tu as maintenant accès à tout le serveur. Ce fil va se fermer dans quelques secondes.');

        return true;
    } catch (error) {
        if (error.code !== 10062) {
            logger.error('[TUTORIAL] Erreur lors de la confirmation finale:', error);
        }
        return false;
    }
}

/**
 * Complète le tutoriel : attribue le rôle et ferme le fil
 */
async function completeTutorial(userId, guild, thread, skipped) {
    try {
        // Marquer comme complété dans la base de données
        const updateStmt = db.prepare('UPDATE tutorial_progress SET completed = 1, step = ? WHERE user_id = ?');
        updateStmt.run('completed', userId);

        const member = await guild.members.fetch(userId).catch(() => null);
        if (member) {
            // Retirer le rôle "Tutoriel pas fait"
            const notDoneRole = guild.roles.cache.find(r => r.name === 'Tutoriel pas fait');
            if (notDoneRole && member.roles.cache.has(notDoneRole.id)) {
                await member.roles.remove(notDoneRole);
                logger.info(`[TUTORIAL] Rôle "Tutoriel pas fait" retiré de ${userId}`);
            }

            // Ajouter le rôle "Tutoriel Fait"
            let doneRole = guild.roles.cache.find(r => r.name === 'Tutoriel Fait');
            if (!doneRole) {
                doneRole = await guild.roles.create({
                    name: 'Tutoriel Fait',
                    color: 'Green',
                    reason: 'Rôle pour les membres ayant terminé le tutoriel'
                });
                logger.info('[TUTORIAL] Rôle "Tutoriel Fait" créé');
            }

            await member.roles.add(doneRole);
            logger.info(`[TUTORIAL] Rôle "Tutoriel Fait" ajouté à ${userId} (skipped: ${skipped})`);
        }

        // Fermer et supprimer le fil après 5 secondes
        setTimeout(async () => {
            try {
                await thread.delete();
                logger.info(`[TUTORIAL] Fil supprimé pour ${userId}`);
            } catch (error) {
                logger.error('[TUTORIAL] Erreur lors de la suppression du fil:', error);
            }
        }, 5000);

    } catch (error) {
        logger.error('[TUTORIAL] Erreur lors de la complétion du tutoriel:', error);
    }
}

/**
 * Vérifie si l'utilisateur a le rôle de règlement quand il clique sur "Fait !"
 */
async function handleCheckRules(interaction) {
    try {
        await interaction.deferReply({ ephemeral: true });
        logger.debug(`[TUTORIAL] handleCheckRules appelé par ${interaction.user.username}`);
        const userId = interaction.user.id;

        // Vérifier la progression
        try {
            logger.debug(`[TUTORIAL] Vérification de la progression en DB...`);
            const stmt = db.prepare('SELECT step FROM tutorial_progress WHERE user_id = ?');
            const progress = stmt.get(userId);

            if (!progress || progress.step !== 'welcome') {
                logger.debug(`[TUTORIAL] Utilisateur pas à l'étape welcome: ${progress ? progress.step : 'null'}`);
                return interaction.editReply({ content: 'Tu n\'es pas à cette étape du tutoriel.' });
            }
        } catch (dbError) {
            logger.error('[TUTORIAL] Erreur DB dans handleCheckRules:', dbError);
            throw dbError;
        }

        // Vérifier si le membre a le rôle de règlement
        const rulesRoleId = process.env.REGLEMENT_ROLE;
        logger.debug(`[TUTORIAL] Vérification du rôle ${rulesRoleId}...`);

        if (!interaction.member.roles.cache.has(rulesRoleId)) {
            logger.debug(`[TUTORIAL] ${userId} n'a pas le rôle de règlement`);
            return interaction.editReply({
                content: '❌ Tu n\'as pas encore accepté le règlement ! Va dans <#1454477663703011439> et clique sur le bouton "Accepter le règlement", puis reviens cliquer ici.'
            });
        }

        // Le membre a bien le rôle !
        logger.info(`[TUTORIAL] ✅ Règlement vérifié pour ${userId}`);

        // Mettre à jour la base de données
        try {
            logger.debug(`[TUTORIAL] Mise à jour DB...`);
            const updateStmt = db.prepare('UPDATE tutorial_progress SET rules_accepted = 1, step = ? WHERE user_id = ?');
            updateStmt.run('choice', userId);
            logger.debug(`[TUTORIAL] DB mise à jour`);
        } catch (updateError) {
            logger.error('[TUTORIAL] Erreur update DB:', updateError);
            throw updateError;
        }

        // Envoyer le message de choix
        try {
            logger.debug(`[TUTORIAL] Construction de l'embed de choix...`);
            const embed = new EmbedBuilder()
                .setTitle(TUTORIAL_CONTENT.choice.title)
                .setDescription(TUTORIAL_CONTENT.choice.description)
                .setColor(TUTORIAL_CONTENT.choice.color)
                .setTimestamp();

            logger.debug(`[TUTORIAL] Construction des boutons...`);
            const row = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId('tutorial_continue')
                        .setLabel('🎓 Faire le tutoriel complet')
                        .setStyle(ButtonStyle.Primary),
                    new ButtonBuilder()
                        .setCustomId('tutorial_skip')
                        .setLabel('⏭️ Skip le tutoriel')
                        .setStyle(ButtonStyle.Secondary)
                );

            logger.debug(`[TUTORIAL] Envoi de la réponse...`);
            await interaction.editReply({ content: '✅ Parfait ! Règlement accepté.' });

            logger.debug(`[TUTORIAL] Envoi du message de choix...`);
            await interaction.channel.send({ content: `<@${userId}>`, embeds: [embed], components: [row] });

            logger.info(`[TUTORIAL] Message de choix envoyé à ${userId}`);
        } catch (sendError) {
            logger.error('[TUTORIAL] Erreur envoi messages:', sendError);
            throw sendError;
        }
    } catch (error) {
        if (error.code !== 10062) {
            logger.error('[TUTORIAL] ERREUR CRITIQUE dans handleCheckRules:', error);
            if (!interaction.replied && !interaction.deferred) {
                await interaction.reply({ content: 'Une erreur est survenue.', flags: 64 }).catch(() => { });
            }
        }
    }
}

/**
 * Récupère la progression d'un utilisateur
 */
function getTutorialProgress(userId) {
    try {
        const stmt = db.prepare('SELECT * FROM tutorial_progress WHERE user_id = ?');
        return stmt.get(userId);
    } catch (error) {
        logger.error('[TUTORIAL] Erreur lors de la récupération de la progression:', error);
        return null;
    }
}

module.exports = {
    initializeTutorial,
    hasAcceptedRules,
    checkAndProgressTutorial,
    handleTutorialChoice,
    handleTutorialNext,
    handleFinalConfirmation,
    handleCheckRules,
    getTutorialProgress,
    completeTutorial
};

