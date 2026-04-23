/**
 * Configuration centralisée du bot
 */
const path = require('path');
const { resolveDotenvPath, PEBBLE_HOST_ENV_PATH } = require(path.join(__dirname, '..', '..', 'blzbot-env.js'));
const { BLZ_EMBED_STRIP_HEX } = require(path.join(__dirname, '..', '..', 'blz-embed-theme'));
require('dotenv').config({
    path: resolveDotenvPath(
        path.join(__dirname, '..', '..', '.env'),
        PEBBLE_HOST_ENV_PATH,
        path.join(process.cwd(), '.env')
    ),
    quiet: true,
});
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true, override: true });

module.exports = {
    // ==================== TOKEN ET IDENTIFIANTS ====================
    BOT_TOKEN: process.env.BOT_TOKEN,
    CLIENT_ID: process.env.CLIENT_ID,
    GUILD_ID: process.env.GUILD_ID,

    // ==================== SERVEURS ====================
    MAIN_GUILD_ID: '1097110036192448656',
    DEBAN_GUILD_ID: '1097110036192448656',
    // Déploie /panel ici ; par défaut = même serveur que GUILD_ID (évite Unknown Guild si l’ancien serveur panel n’existe plus)
    PANEL_GUILD_ID: process.env.PANEL_GUILD_ID || process.env.GUILD_ID || '1351221530998345828',

    // ==================== SALONS ====================
    DEBAN_CHANNEL_ID: '1382368378613796997',
    RECRUITMENT_ANNOUNCEMENT_CHANNEL_ID: '1454478266416234648',
    RECRUITMENT_CHANNEL_ID: '1343195997869834290',
    STAFF_CHANNEL_ID: '1439327530267054121',
    STAFF_WARN_CHANNEL_ID: '1454490261714370758',
    LOGS_CHANNEL_ID: '1454490261714370758', // Alias pour logs modération
    ALL_LOG_CHANNEL_ID: '1454505747080548372', // Logs complets (voc, rôles, etc.)

    // ==================== MESSAGES ====================
    RECRUITMENT_MESSAGE_ID: '5',

    // ==================== RÔLES ====================
    REGLEMENT_ACCEPTED_ROLE_ID: '1323296825725292646',
    SUSPECT_ROLE_ID: '1400457540386422916', // Rôle suspect
    MEMBER_ROLE_ID: '1323236382881222797', // Rôle membre (nouveaux arrivants)

    // ==================== UTILISATEURS SPÉCIAUX ====================
    SPECIAL_USER_ID: '1232324259506815026',

    /**
     * Suppressions de messages : ne rien journaliser (salon ALL_LOG / embeds modération,
     * ni logs console type [SECURITY] ou Message : Supprimé) pour cet ID quand il est
     * l’exécuteur audit ou l’auteur en auto-suppression sans audit.
     */
    IGNORE_MESSAGE_DELETE_LOG_USER_IDS: ['965984018216665099'],

    // ==================== HIÉRARCHIE UNIFIÉE DES RÔLES STAFF ====================
    // Système complet : points, promotions et rétrogradations
    // 
    // Points: Poids du vote (plus élevé = plus d'influence)
    // Demotion: Rétrogradation après 3 warns staff
    //   - string: ID du rôle inférieur (rétrogradation simple)
    //   - array: IDs des rôles à retirer (derank complet)
    //   - null: Pas de rétrogradation configurée
    STAFF_ROLES: [
        {
            id: '1433460304041218150',
            name: 'Modérateur Test',
            points: 0,
            demotion: ['1433460304041218150', '1172237685763608579'] // Derank complet
        },
        {
            id: '1433462694148837528',
            name: 'Communiquant Test',
            points: 0,
            demotion: ['1433462694148837528', '1172237685763608579'] // Derank complet
        },
        {
            id: '1433462694740230235',
            name: 'Développeur Test',
            points: 0,
            demotion: ['1433462694740230235', '1172237685763608579'] // Derank complet
        },
        {
            id: '1452608041454407711',
            name: 'Modérateur',
            points: 1,
            demotion: ['1452608041454407711', '1172237685763608579'] // Derank complet
        },
        {
            id: '1452608118998433864',
            name: 'Superviseur',
            points: 3,
            demotion: '1452608041454407711' // Rétrograde vers Modérateur
        },
        {
            id: '1404222782891495424',
            name: 'Administrateur Test',
            points: 4,
            demotion: '1323241034855223348' // Rétrograde vers Superviseur
        },
        {
            id: '1452608223634001940',
            name: 'Administrateur',
            points: 5,
            demotion: '1452608118998433864' // Rétrograde vers Superviseur
        },
        {
            id: '1433460248789778524',
            name: 'Directeur',
            points: 6,
            demotion: '1452608223634001940' // Rétrograde vers Administrateur
        },
        {
            id: '1012686884369080330',
            name: 'avia',
            points: 6,
            demotion: '1323241037392642129' // Rétrograde vers Administrateur
        },
        {
            id: '1433460236470980608',
            name: 'Owner',
            points: 7,
            demotion: null // Pas de rétrogradation
        },
        {
            id: '1172237685763608579',
            name: 'Staff',
            points: 0,
            demotion: null // Pas de rétrogradation
        }
    ],

    // ==================== RACCOURCIS POUR ACCÈS RAPIDE ====================
    // Générés automatiquement depuis STAFF_ROLES
    get STAFF_ROLE_ID() { return '1172237685763608579'; },
    get MODO_TEST_ROLE_ID() { return '1323240945235529748'; },
    get MODO_ROLE_ID() { return '1323241032770654289'; },
    get SUPERVISEUR_ROLE_ID() { return '1323241034855223348'; },
    get ADMIN_TEST_ROLE_ID() { return '1404222782891495424'; },
    get ADMIN_ROLE_ID() { return '1323241037392642129'; },
    get CHEF_ROLE_ID() { return '1323241046154678313'; },
    get CHEF_ALT_ROLE_ID() { return '1012686884369080330'; },
    get OWNER_ROLE_ID() { return '1323241048029528105'; },

    // ==================== CONFIGURATION DU SNIPE ====================
    SNIPE_CONFIG: {
        excludedCategoryId: '1',
        maxHistorySize: 10
    },

    // ==================== RÔLE ADMINISTRATEUR PRINCIPAL ====================
    // ID du rôle administrateur à retirer lors des déranks conditionnels
    MAIN_ADMIN_ROLE_ID: '1439605304873713695', // Rôle Administrateur

    // ==================== DÉRANKS CONDITIONNELS APRÈS 3 WARN STAFF ====================
    // Pour les administrateurs ayant plusieurs rôles, détermine le dérank selon le rôle secondaire
    // Le rôle MAIN_ADMIN_ROLE_ID sera automatiquement retiré + le checkRoleId
    ADMIN_CONDITIONAL_DERANKS: [
        {
            checkRoleId: '1433460299167436811',  // Si l'admin a ce rôle secondaire
            demotionRoleId: '1433460250832535816' // Il est dérank vers ce rôle après 3 warn staff
        },
        {
            checkRoleId: '1433460252246020096',  // Si l'admin a ce rôle secondaire (Community Manager)
            demotionRoleId: 'PLACE_HOLDER_COM'   // Il est dérank vers ce rôle après 3 warn staff
        },
        {
            checkRoleId: '1433462694740230235',  // Si l'admin a ce rôle secondaire (Developer)
            demotionRoleId: 'PLACE_HOLDER_DEV'   // Il est dérank vers ce rôle après 3 warn staff
        }
    ],

    // ==================== PROMOTIONS POSSIBLES ====================
    // Tableau des promotions possibles pour /rankup
    PROMOTION_PATHS: [
        {
            name: 'Modérateur test > Modérateur',
            value: 'modo_test_to_modo',
            fromRoleId: '1323240945235529748', // Modo Test
            toRoleId: '1323241032770654289'    // Modo
        },
        {
            name: 'Modérateur > Superviseur',
            value: 'modo_to_superviseur',
            fromRoleId: '1323241032770654289', // Modo
            toRoleId: '1323241034855223348'    // Superviseur
        },
        {
            name: 'Superviseur > Administrateur Test',
            value: 'superviseur_to_admin_test',
            fromRoleId: '1323241034855223348', // Superviseur
            toRoleId: '1404222782891495424'    // Admin Test
        },
        {
            name: 'Administrateur Test > Administrateur',
            value: 'admin_test_to_admin',
            fromRoleId: '1404222782891495424', // Admin Test
            toRoleId: '1323241037392642129'    // Admin
        },
        {
            name: 'Administrateur > Chef',
            value: 'admin_to_chef',
            fromRoleId: '1323241037392642129', // Admin
            toRoleId: '1323241046154678313'    // Chef
        }
    ],

    // ==================== SYSTÈME DE BIENVENUE ====================
    WELCOME: {
        ENABLED: true,
        CHANNEL_ID: '1454476910225657978', // Salon où poster le message
        /** Salon ⁠📋・règles */
        LINK_REGLEMENT_CHANNEL_ID: '1454477663703011439',
        /** Salon ⁠🪢・tickets */
        /** Salon support où se trouve le panneau « Créer un ticket » (lien bienvenue). */
        LINK_TICKETS_CHANNEL_ID: '1496896791465955338',
        /** Couleur de la barre latérale du container Components V2 (hex) */
        ACCENT_COLOR: BLZ_EMBED_STRIP_HEX,
        /**
         * Emoji personnalisé dans le titre (à la place de 👋). L’ID doit exister sur un serveur où le bot est présent.
         * Surcharge : WELCOME_CUSTOM_EMOJI_ID dans .env
         */
        CUSTOM_WELCOME_EMOJI_ID: process.env.WELCOME_CUSTOM_EMOJI_ID || '1495554515427135568',
        /** Serveur où l’emoji est uploadé (fetch si pas encore en cache) — ex. serveur de test */
        CUSTOM_WELCOME_EMOJI_SOURCE_GUILD_ID: process.env.WELCOME_CUSTOM_EMOJI_SOURCE_GUILD_ID || '1493276404643532810',
        /**
         * Si l’emoji n’est pas récupérable : nom exact + animé. Sinon chaîne <:name:id> construite sans nom fiable.
         * Surcharge : WELCOME_CUSTOM_EMOJI_NAME, WELCOME_CUSTOM_EMOJI_ANIMATED=1
         */
        CUSTOM_WELCOME_EMOJI_NAME: process.env.WELCOME_CUSTOM_EMOJI_NAME || '',
        CUSTOM_WELCOME_EMOJI_ANIMATED: ['1', 'true', 'yes', 'on'].includes(
            String(process.env.WELCOME_CUSTOM_EMOJI_ANIMATED || '').toLowerCase()
        ),
    },

    // ==================== SYSTÈME DE TICKETS ====================
    TICKETS: {
        ENABLED: true,
        PANEL_CHANNEL_ID: '1454477715494404212',     // Salon où afficher le panneau
        CATEGORY_ID: '1454508411122221139',                            // Catégorie pour les tickets (null = pas de catégorie)
        PING_ROLE_ID: '1461142125801639988',         // Rôle à ping lors de la création
        STAFF_ACCESS_ROLE_ID: '1172237685763608579',  // Rôle staff qui peut voir tous les tickets
        LOG_CHANNEL_ID: null,                         // Salon de logs tickets (null = pas de logs)
        MAX_OPEN_TICKETS: 1,                          // Max tickets ouverts par utilisateur
        COOLDOWN_MS: 300000,                          // Cooldown entre tickets (5 minutes)
        EMBED_COLOR: BLZ_EMBED_STRIP_HEX,
        /**
         * Serveur support : ticket = salon avec uniquement le membre + le bot.
         * Les messages sont relayés vers un salon « vrai » ticket sur MAIN_GUILD_ID.
         */
        SUPPORT_GUILD_ID: '1351221530998345828',
        BRIDGE: {
            ENABLED: true,
            /** Catégorie sur le serveur PRINCIPAL pour les tickets staff (null = racine du serveur) */
            MAIN_CATEGORY_ID: process.env.TICKET_BRIDGE_MAIN_CATEGORY_ID || null,
        },
    },

    // ==================== SYSTÈME D'ABSENCES STAFF ====================
    ABSENCES: {
        ENABLED: true,
        LOG_CHANNEL_ID: '1454490284963663923',       // Salon pour notifier les absences
        MAX_DURATION_DAYS: 99                         // Durée max d'absence en jours
    },

    // ==================== SIGNALEMENTS ====================
    REPORTS: {
        ENABLED: true,                                  // Activer le système de signalements
        CHANNEL_ID: "1454490890297933944",                               // ID du salon où envoyer les signalements
        PING_ROLE_ID: null,                             // ID du rôle à ping (modérateurs)
        PING_COOLDOWN_MS: 30 * 60 * 1000,              // Cooldown entre les pings (30 minutes)
        EMBED_COLOR: BLZ_EMBED_STRIP_HEX                  // Bande latérale des signalements (identité BLZbot)
    },

    // ==================== ANTI-RAID ====================
    RAID_ROLE_ID: '1400457540386422916', // Rôle attribué aux membres suspects de raid
    RAID_LOG_CHANNEL_ID: '1454490890297933944', // Salon pour les alertes raid (null = utilise ALL_LOG_CHANNEL_ID)

    RAID_DETECTION: {
        // Seuils d'action
        ACTION_THRESHOLD: 50,           // Score pour appliquer RAID_ROLE
        CRITICAL_THRESHOLD: 100,        // Score pour lockdown + DM admins

        // Décroissance du score
        DECAY_RATE: 1,                  // Points perdus par minute
        DECAY_INTERVAL: 60000,          // Intervalle de vérification (1 minute)

        // Détection rafale de joins
        JOIN_WINDOW: 10000,             // Fenêtre de temps en ms (10 secondes)
        JOIN_THRESHOLD: 10,             // Nombre de joins pour déclencher
        JOIN_SCORE_MULTIPLIER: 25,      // Score = (joins/threshold) × multiplier

        // Détection comptes récents
        NEW_ACCOUNT_DAYS: 7,            // Jours - comptes créés récemment = suspect
        NEW_ACCOUNT_SCORE: 10,          // Points par compte récent

        // Détection noms similaires
        SIMILAR_NAME_THRESHOLD: 3,      // Nombre minimum de noms similaires
        SIMILAR_NAME_SCORE: 20,         // Score par nom similaire au-delà du seuil

        // Détection spam messages
        SPAM_CHANNEL_THRESHOLD: 3,      // Même message dans X salons
        SPAM_CHANNEL_WINDOW: 10000,     // Fenêtre de temps (10 secondes)
        SPAM_CHANNEL_SCORE: 50,         // Score pour spam multi-salon

        // Détection messages répétés
        REPEAT_MESSAGE_THRESHOLD: 10,    // X messages identiques consécutifs
        REPEAT_MESSAGE_SCORE: 30,       // Score pour messages répétés

        // Rôles protégés (ne jamais appliquer RAID_ROLE)
        PROTECTED_ROLES: ['1172237685763608579']             // IDs des rôles staff à ne pas affecter
    }
};
