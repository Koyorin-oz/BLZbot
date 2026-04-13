const logger = require('../utils/logger');
const Database = require('better-sqlite3');
const path = require('path');
const { isTestBotProfile } = require(path.join(__dirname, '..', '..', '..', 'blzbot-env.js'));

const mainDb = new Database(path.join(__dirname, 'blzbot.sqlite'));
const testG = String(process.env.GUILD_ID || '').trim();
const mainG = String(process.env.BLZ_MAIN_GUILD_ID || '').trim();
let testDb = null;
if (isTestBotProfile() && /^\d{17,22}$/.test(testG) && /^\d{17,22}$/.test(mainG) && testG !== mainG) {
    testDb = new Database(path.join(__dirname, 'blzbot.test.sqlite'));
    logger.info('[DB] Mode double serveur : économie test → blzbot.test.sqlite, principal → blzbot.sqlite');
}

function initializeDatabase(db) {
    logger.debug('Initialisation de la base de données…');

    // Table des utilisateurs
    db.exec(`
        CREATE TABLE IF NOT EXISTS users (
            id TEXT PRIMARY KEY, -- ID Discord de l'utilisateur
            username TEXT NOT NULL,
            xp INTEGER DEFAULT 0,
            level INTEGER DEFAULT 1, -- On commence niveau 1
            xp_needed INTEGER DEFAULT 100, -- XP pour passer au niveau 2
            points INTEGER DEFAULT 0,
            stars INTEGER DEFAULT 0,
            daily_last_claimed INTEGER DEFAULT 0 -- Timestamp de la dernière réclamation
        );
    `);

    // Table de l'inventaire des utilisateurs (pour les items uniques)
    db.exec(`
        CREATE TABLE IF NOT EXISTS user_inventory (
            user_id TEXT,
            item_id TEXT,
            quantity INTEGER DEFAULT 1,
            PRIMARY KEY (user_id, item_id),
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );
    `);

    // Table des guildes
    db.exec(`
        CREATE TABLE IF NOT EXISTS guilds (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE,
            owner_id TEXT NOT NULL,
            level INTEGER DEFAULT 0,
            member_slots INTEGER DEFAULT 3, -- Nombre de places initial (réduit à 3)
            upgrade_level INTEGER DEFAULT 1,
            treasury INTEGER DEFAULT 0,
            treasury_capacity INTEGER DEFAULT 0,
            sub_chiefs TEXT DEFAULT '[]',
            boost_level INTEGER DEFAULT 0,
            treasury_multiplier_level INTEGER DEFAULT 0,
            guild_boost_until INTEGER DEFAULT 0,
            channel_id TEXT DEFAULT NULL,
            wars_won INTEGER DEFAULT 0,
            wars_won_70 INTEGER DEFAULT 0,
            wars_won_80 INTEGER DEFAULT 0,
            wars_won_90 INTEGER DEFAULT 0,
            joker_guilde_uses INTEGER DEFAULT 0,
            total_treasury_generated INTEGER DEFAULT 0,
            xp_boost_purchased INTEGER DEFAULT 0,
            points_boost_purchased INTEGER DEFAULT 0,
            stars_boost_purchased INTEGER DEFAULT 0,
            treasury_multiplier_purchased INTEGER DEFAULT 0,
            emoji TEXT DEFAULT NULL,
            custom_roles TEXT DEFAULT '[]',
            overstaffed_since INTEGER DEFAULT NULL
        );
    `);

    db.exec(`
        CREATE TABLE IF NOT EXISTS guild_wars (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            guild1_id INTEGER NOT NULL,
            guild2_id INTEGER NOT NULL,
            start_time INTEGER NOT NULL,
            end_time INTEGER NOT NULL,
            duration_type TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'ongoing',
            winner_id INTEGER DEFAULT NULL,
            declared_by INTEGER DEFAULT NULL,
            forced BOOLEAN DEFAULT 0,
            guild1_initial_treasury INTEGER DEFAULT 0,
            guild2_initial_treasury INTEGER DEFAULT 0
        );
    `);

    db.exec(`
        CREATE TABLE IF NOT EXISTS guild_war_members (
            war_id INTEGER NOT NULL,
            user_id TEXT NOT NULL,
            guild_id INTEGER NOT NULL,
            war_messages INTEGER DEFAULT 0,
            war_counting_messages INTEGER DEFAULT 0,
            war_voice_minutes INTEGER DEFAULT 0,
            war_points INTEGER DEFAULT 0,
            PRIMARY KEY (war_id, user_id)
        );
    `);

    db.exec(`
        CREATE TABLE IF NOT EXISTS guild_war_declarations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            from_guild_id INTEGER NOT NULL,
            to_guild_id INTEGER NOT NULL,
            duration_type TEXT NOT NULL,
            forced BOOLEAN DEFAULT 0,
            timestamp INTEGER NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending'
        );
    `);

    db.exec(`
        CREATE TABLE IF NOT EXISTS guild_quests (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            type TEXT NOT NULL,
            target INTEGER NOT NULL,
            reward_type TEXT NOT NULL,
            reward_amount INTEGER NOT NULL,
            rarity TEXT NOT NULL,
            description TEXT NOT NULL
        );
    `);

    db.exec(`
        CREATE TABLE IF NOT EXISTS guild_quest_progress (
            guild_id INTEGER NOT NULL,
            quest_id INTEGER NOT NULL,
            completed BOOLEAN DEFAULT 0,
            completed_at INTEGER DEFAULT 0,
            PRIMARY KEY (guild_id, quest_id)
        );
    `);

    db.exec(`
        CREATE TABLE IF NOT EXISTS battle_pass (
            user_id TEXT NOT NULL,
            tier INTEGER NOT NULL,
            claimed_free BOOLEAN NOT NULL DEFAULT FALSE,
            claimed_vip BOOLEAN NOT NULL DEFAULT FALSE,
            PRIMARY KEY (user_id, tier)
        );
    `);

    db.exec(`
        CREATE TABLE IF NOT EXISTS shop_info (
            id INTEGER PRIMARY KEY DEFAULT 1,
            last_generated TEXT,
            last_legendary_chest_check INTEGER DEFAULT 0,
            legendary_chest_available INTEGER DEFAULT 0
        );
    `);

    try {
        db.exec('ALTER TABLE users ADD COLUMN seasonal_xp INTEGER DEFAULT 0');
        logger.debug('Colonne seasonal_xp ajoutée à la table users.');
    } catch (error) {
        if (!error.message.includes('duplicate column name')) {
            console.error('Erreur lors de l\'ajout de la colonne seasonal_xp:', error);
        }
    }

    try {
        db.exec('ALTER TABLE users ADD COLUMN streak INTEGER DEFAULT 0');
        logger.debug('Colonne streak ajoutée à la table users.');
    } catch (error) {
        if (!error.message.includes('duplicate column name')) {
            console.error('Erreur lors de l\'ajout de la colonne streak:', error);
        }
    }

    try {
        db.exec('ALTER TABLE users ADD COLUMN last_streak_timestamp INTEGER DEFAULT 0');
        logger.debug('Colonne last_streak_timestamp ajoutée à la table users.');
    } catch (error) {
        if (!error.message.includes('duplicate column name')) {
            console.error('Erreur lors de l\'ajout de la colonne last_streak_timestamp:', error);
        }
    }

    try {
        db.exec('ALTER TABLE users ADD COLUMN streak_lost_timestamp INTEGER DEFAULT 0');
        logger.debug('Colonne streak_lost_timestamp ajoutée à la table users.');
    } catch (error) {
        if (!error.message.includes('duplicate column name')) {
            console.error('Erreur lors de l\'ajout de la colonne streak_lost_timestamp:', error);
        }
    }

    try {
        db.exec('ALTER TABLE users ADD COLUMN previous_streak INTEGER DEFAULT 0');
        logger.debug('Colonne previous_streak ajoutée à la table users.');
    } catch (error) {
        if (!error.message.includes('duplicate column name')) {
            console.error('Erreur lors de l\'ajout de la colonne previous_streak:', error);
        }
    }

    db.exec(`
        CREATE TABLE IF NOT EXISTS server_quests (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            objective TEXT NOT NULL,
            target INTEGER NOT NULL,
            progress INTEGER NOT NULL DEFAULT 0,
            status TEXT NOT NULL DEFAULT 'inactive',
            start_time DATETIME,
            end_time DATETIME
        );
    `);

    db.exec(`
        CREATE TABLE IF NOT EXISTS server_quest_votes (
            quest_id INTEGER NOT NULL,
            user_id TEXT NOT NULL,
            reward TEXT NOT NULL,
            PRIMARY KEY (quest_id, user_id)
        );
    `);

    // Table des membres de guilde
    db.exec(`
        CREATE TABLE IF NOT EXISTS guild_members (
            user_id TEXT PRIMARY KEY,
            guild_id INTEGER,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
            FOREIGN KEY (guild_id) REFERENCES guilds(id) ON DELETE CASCADE
        );
    `);

    // Table des invitations de guilde (pour les cooldowns)
    db.exec(`
        CREATE TABLE IF NOT EXISTS guild_invitations (
            guild_id INTEGER,
            target_user_id TEXT,
            inviter_user_id TEXT,
            timestamp INTEGER NOT NULL,
            FOREIGN KEY (guild_id) REFERENCES guilds(id) ON DELETE CASCADE
        );
    `);

    // Table de progression des quêtes
    db.exec(`
        CREATE TABLE IF NOT EXISTS quest_progress (
            user_id TEXT,
            quest_id TEXT,
            progress INTEGER DEFAULT 0,
            completed INTEGER DEFAULT 0, -- 0 pour non, 1 pour oui (timestamp)
            PRIMARY KEY (user_id, quest_id),
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );
    `);

    // Table des refus de postulation de guilde
    db.exec(`
        CREATE TABLE IF NOT EXISTS guild_application_refusals (
            guild_id INTEGER,
            user_id TEXT,
            PRIMARY KEY (guild_id, user_id),
            FOREIGN KEY (guild_id) REFERENCES guilds(id) ON DELETE CASCADE,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );
    `);

    // Table des rôles personnalisés
    db.exec(`
        CREATE TABLE IF NOT EXISTS custom_roles (
            role_id TEXT PRIMARY KEY,
            guild_id INTEGER NOT NULL,
            owner_id TEXT NOT NULL,
            members TEXT DEFAULT '[]'
        );
    `);

    // Table des prêts
    db.exec(`
        CREATE TABLE IF NOT EXISTS loans (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            lenderId TEXT NOT NULL,
            borrowerId TEXT NOT NULL,
            amount INTEGER NOT NULL,
            interest INTEGER NOT NULL,
            createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
            expiresAt DATETIME NOT NULL,
            accepted BOOLEAN DEFAULT FALSE,
            repaid BOOLEAN DEFAULT FALSE,
            repaid_amount INTEGER DEFAULT 0
        );
    `);

    // Migration: ajouter colonne repaid_amount pour tracker les remboursements partiels
    try {
        db.exec('ALTER TABLE loans ADD COLUMN repaid_amount INTEGER DEFAULT 0');
        logger.debug('Colonne repaid_amount ajoutée à la table loans.');
    } catch (error) {
        if (!error.message.includes('duplicate column name')) {
            console.error('Erreur lors de l\'ajout de la colonne repaid_amount:', error);
        }
    }

    try {
        db.exec('ALTER TABLE users ADD COLUMN last_decay_timestamp INTEGER DEFAULT 0');
        logger.debug('Colonne last_decay_timestamp ajoutée à la table users.');
    } catch (error) {
        if (!error.message.includes('duplicate column name')) {
            console.error('Erreur lors de l\'ajout de la colonne last_decay_timestamp:', error);
        }
    }

    // On s'assure que la colonne xp_needed existe pour les bases de données existantes
    try {
        db.exec('ALTER TABLE users ADD COLUMN xp_needed INTEGER DEFAULT 100');
        logger.debug('Colonne xp_needed ajoutée à la table users.');
    } catch (error) {
        if (!error.message.includes('duplicate column name')) {
            logger.error('Erreur lors de l\'ajout de la colonne xp_needed:', error);
        }
        // Si la colonne existe déjà, on ignore l'erreur
    }

    // On s'assure que la colonne xp_boost_until existe pour les utilisateurs existants
    try {
        db.exec('ALTER TABLE users ADD COLUMN xp_boost_until INTEGER DEFAULT 0');
        logger.debug('Colonne xp_boost_until ajoutée à la table users.');
    } catch (error) {
        if (!error.message.includes('duplicate column name')) {
            logger.error('Erreur lors de l\'ajout de la colonne xp_boost_until:', error);
        }
    }

    // On s'assure que la colonne xp_boost_x4_until existe pour le boost x4
    try {
        db.exec('ALTER TABLE users ADD COLUMN xp_boost_x4_until INTEGER DEFAULT 0');
        logger.debug('Colonne xp_boost_x4_until ajoutée à la table users.');
    } catch (error) {
        if (!error.message.includes('duplicate column name')) {
            logger.error('Erreur lors de l\'ajout de la colonne xp_boost_x4_until:', error);
        }
    }

    // On s'assure que la colonne points_boost_until existe pour les utilisateurs existants
    try {
        db.exec('ALTER TABLE users ADD COLUMN points_boost_until INTEGER DEFAULT 0');
        logger.debug('Colonne points_boost_until ajoutée à la table users.');
    } catch (error) {
        if (!error.message.includes('duplicate column name')) {
            logger.error('Erreur lors de l\'ajout de la colonne points_boost_until:', error);
        }
    }

    // On s'assure que la colonne last_activity_timestamp existe pour les utilisateurs existants
    try {
        db.exec('ALTER TABLE users ADD COLUMN last_activity_timestamp INTEGER DEFAULT 0');
        logger.debug('Colonne last_activity_timestamp ajoutée à la table users.');
    } catch (error) {
        if (!error.message.includes('duplicate column name')) {
            logger.error('Erreur lors de l\'ajout de la colonne last_activity_timestamp:', error);
        }
    }

    // On s'assure que la colonne stars_boost_until existe
    try {
        db.exec('ALTER TABLE users ADD COLUMN stars_boost_until INTEGER DEFAULT 0');
        logger.debug('Colonne stars_boost_until ajoutée à la table users.');
    } catch (error) {
        if (!error.message.includes('duplicate column name')) {
            logger.error('Erreur lors de l\'ajout de la colonne stars_boost_until:', error);
        }
    }

    // On s'assure que la colonne counting_boost_until existe
    try {
        db.exec('ALTER TABLE users ADD COLUMN counting_boost_until INTEGER DEFAULT 0');
        logger.debug('Colonne counting_boost_until ajoutée à la table users.');
    } catch (error) {
        if (!error.message.includes('duplicate column name')) {
            logger.error('Erreur lors de l\'ajout de la colonne counting_boost_until:', error);
        }
    }

    // Timestamps de dernière utilisation des boosts (pour le cooldown 12h)
    const boostTimestampColumns = ['last_xp_boost', 'last_points_boost', 'last_stars_boost', 'last_counting_boost'];
    for (const col of boostTimestampColumns) {
        try {
            db.exec(`ALTER TABLE users ADD COLUMN ${col} INTEGER DEFAULT 0`);
            logger.debug(`Colonne ${col} ajoutée à la table users.`);
        } catch (error) {
            if (!error.message.includes('duplicate column name')) {
                logger.error(`Erreur lors de l'ajout de la colonne ${col}:`, error);
            }
        }
    }

    // On s'assure que la colonne emoji existe pour les guildes existantes
    try {
        db.exec("ALTER TABLE guilds ADD COLUMN emoji TEXT DEFAULT '🛡️'");
        logger.debug('Colonne emoji ajoutée à la table guilds.');
    } catch (error) {
        if (!error.message.includes('duplicate column name')) {
            logger.error("Erreur lors de l'ajout de la colonne emoji:", error);
        }
    }

    // On s'assure que la colonne emoji existe pour les guildes existantes
    try {
        db.exec("ALTER TABLE guilds ADD COLUMN emoji TEXT DEFAULT '🛡️'");
        logger.debug('Colonne emoji ajoutée à la table guilds.');
    } catch (error) {
        if (!error.message.includes('duplicate column name')) {
            logger.error("Erreur lors de l'ajout de la colonne emoji:", error);
        }
    }

    // On s'assure que la colonne sub_chiefs existe pour les guildes existantes
    try {
        db.exec("ALTER TABLE guilds ADD COLUMN sub_chiefs TEXT DEFAULT '[]'");
        logger.debug('Colonne sub_chiefs ajoutée à la table guilds.');
    } catch (error) {
        if (!error.message.includes('duplicate column name')) {
            logger.error("Erreur lors de l'ajout de la colonne sub_chiefs:", error);
        }
    }

    // On s'assure que la colonne quantity existe pour l'inventaire utilisateur
    try {
        db.exec('ALTER TABLE user_inventory ADD COLUMN quantity INTEGER DEFAULT 1');
        logger.debug('Colonne quantity ajoutée à la table user_inventory.');
    } catch (error) {
        if (!error.message.includes('duplicate column name')) {
            logger.error('Erreur lors de l\'ajout de la colonne quantity:', error);
        }
    }

    // On s'assure que la colonne points_comptage existe pour les utilisateurs
    try {
        db.exec('ALTER TABLE users ADD COLUMN points_comptage INTEGER DEFAULT 0');
        logger.debug('Colonne points_comptage ajoutée à la table users.');
    } catch (error) {
        if (!error.message.includes('duplicate column name')) {
            logger.error('Erreur lors de l\'ajout de la colonne points_comptage:', error);
        }
    }

    // On s'assure que la colonne hacker_item_timestamp existe pour les utilisateurs existants
    try {
        db.exec('ALTER TABLE users ADD COLUMN hacker_item_timestamp TEXT DEFAULT NULL');
        logger.debug('Colonne hacker_item_timestamp ajoutée à la table users.');
    } catch (error) {
        if (!error.message.includes('duplicate column name')) {
            logger.error('Erreur lors de l\'ajout de la colonne hacker_item_timestamp:', error);
        }
    }

    // On s'assure que la colonne peak_rank existe pour le verrouillage des rangs Mythique+
    try {
        db.exec('ALTER TABLE users ADD COLUMN peak_rank TEXT DEFAULT NULL');
        logger.debug('Colonne peak_rank ajoutée à la table users.');
    } catch (error) {
        if (!error.message.includes('duplicate column name')) {
            logger.error('Erreur lors de l\'ajout de la colonne peak_rank:', error);
        }
    }

    // On s'assure que les colonnes de shop_info existent
    try {
        db.exec('ALTER TABLE shop_info ADD COLUMN last_legendary_chest_check INTEGER DEFAULT 0');
        logger.debug('Colonne last_legendary_chest_check ajoutée à la table shop_info.');
    } catch (error) {
        if (!error.message.includes('duplicate column name')) {
            logger.error('Erreur lors de l\'ajout de la colonne last_legendary_chest_check:', error);
        }
    }

    try {
        db.exec('ALTER TABLE shop_info ADD COLUMN legendary_chest_available INTEGER DEFAULT 0');
        logger.debug('Colonne legendary_chest_available ajoutée à la table shop_info.');
    } catch (error) {
        if (!error.message.includes('duplicate column name')) {
            logger.error('Erreur lors de l\'ajout de la colonne legendary_chest_available:', error);
        }
    }

    // Colonnes pour le nerf vocal
    try {
        db.exec('ALTER TABLE users ADD COLUMN daily_voice_xp INTEGER DEFAULT 0');
        logger.debug('Colonne daily_voice_xp ajoutée à la table users.');
    } catch (error) {
        if (!error.message.includes('duplicate column name')) {
            logger.error('Erreur lors de l\'ajout de la colonne daily_voice_xp:', error);
        }
    }

    try {
        db.exec('ALTER TABLE users ADD COLUMN daily_voice_last_reset INTEGER DEFAULT 0');
        logger.debug('Colonne daily_voice_last_reset ajoutée à la table users.');
    } catch (error) {
        if (!error.message.includes('duplicate column name')) {
            logger.error('Erreur lors de l\'ajout de la colonne daily_voice_last_reset:', error);
        }
    }

    try {
        db.exec('ALTER TABLE users ADD COLUMN daily_voice_points INTEGER DEFAULT 0');
        logger.debug('Colonne daily_voice_points ajoutée à la table users.');
    } catch (error) {
        if (!error.message.includes('duplicate column name')) {
            logger.error('Erreur lors de l\'ajout de la colonne daily_voice_points:', error);
        }
    }

    try {
        db.exec('ALTER TABLE users ADD COLUMN minigames_won INTEGER DEFAULT 0');
        logger.debug('Colonne minigames_won ajoutée à la table users.');
    } catch (error) {
        if (!error.message.includes('duplicate column name')) {
            logger.error('Erreur lors de l\'ajout de la colonne minigames_won:', error);
        }
    }

    // --- Colonnes pour les stats All-Time ---
    try {
        db.exec('ALTER TABLE users ADD COLUMN max_points INTEGER DEFAULT 0');
        logger.debug('Colonne max_points ajoutée à la table users.');

        // Initialiser avec les valeurs actuelles pour commencer
        db.exec('UPDATE users SET max_points = points WHERE max_points = 0 AND points > 0');
        logger.debug('Valeurs max_points initialisées avec les points actuels.');
    } catch (error) {
        if (!error.message.includes('duplicate column name')) {
            logger.error('Erreur lors de l\'ajout de la colonne max_points:', error);
        }
    }

    try {
        db.exec('ALTER TABLE users ADD COLUMN max_stars INTEGER DEFAULT 0');
        logger.debug('Colonne max_stars ajoutée à la table users.');

        // Initialiser avec les valeurs actuelles pour commencer
        db.exec('UPDATE users SET max_stars = stars WHERE max_stars = 0 AND stars > 0');
        logger.debug('Valeurs max_stars initialisées avec les stars actuelles.');
    } catch (error) {
        if (!error.message.includes('duplicate column name')) {
            logger.error('Erreur lors de l\'ajout de la colonne max_stars:', error);
        }
    }

    // --- Colonnes pour les Paramètres Utilisateur (/paramètres) ---
    const userSettingsColumns = [
        'notify_rank_up INTEGER DEFAULT 1',
        'notify_level_up INTEGER DEFAULT 1',
        'notify_streak INTEGER DEFAULT 1',
        'notify_guild_invite INTEGER DEFAULT 1',
        'notify_quest_complete INTEGER DEFAULT 1',
        'notify_trade INTEGER DEFAULT 1',
        'notify_minigame_invite INTEGER DEFAULT 1',
        'notify_debt_reminder INTEGER DEFAULT 1'
    ];

    for (const columnDef of userSettingsColumns) {
        const columnName = columnDef.split(' ')[0];
        try {
            db.exec(`ALTER TABLE users ADD COLUMN ${columnDef}`);
            logger.debug(`Colonne ${columnName} ajoutée à la table users.`);
        } catch (error) {
            if (!error.message.includes('duplicate column name')) {
                logger.error(`Erreur lors de l'ajout de la colonne ${columnName}:`, error);
            }
        }
    }

    // --- Tables pour les nouvelles fonctionnalités V5 ---

    // Table des MVP de Guerre
    db.exec(`
        CREATE TABLE IF NOT EXISTS war_mvps (
            war_id INTEGER NOT NULL,
            user_id TEXT NOT NULL,
            guild_id INTEGER NOT NULL,
            points_contributed INTEGER NOT NULL,
            rewarded_at INTEGER NOT NULL,
            PRIMARY KEY (war_id, user_id)
        );
    `);

    // Table des Badges Utilisateur
    db.exec(`
        CREATE TABLE IF NOT EXISTS user_badges (
            user_id TEXT NOT NULL,
            badge_id TEXT NOT NULL,
            earned_at INTEGER NOT NULL,
            PRIMARY KEY (user_id, badge_id)
        );
    `);

    // Table des Alertes Boutique
    db.exec(`
        CREATE TABLE IF NOT EXISTS shop_alerts (
            user_id TEXT NOT NULL,
            item_id TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            PRIMARY KEY (user_id, item_id)
        );
    `);

    // Migration pour shop_alerts si créée sans created_at
    try {
        db.exec('ALTER TABLE shop_alerts ADD COLUMN created_at INTEGER DEFAULT 0');
        logger.debug('Colonne created_at ajoutée à la table shop_alerts.');
    } catch (error) {
        if (!error.message.includes('duplicate column name')) {
            logger.error('Erreur lors de l\'ajout de la colonne created_at à shop_alerts:', error);
        }
    }

    // Migrations pour le système de guildes V5
    const guildV5Columns = [
        'channel_id TEXT DEFAULT NULL',
        'wars_won INTEGER DEFAULT 0',
        'wars_won_70 INTEGER DEFAULT 0',
        'wars_won_80 INTEGER DEFAULT 0',
        'wars_won_90 INTEGER DEFAULT 0',
        'joker_guilde_uses INTEGER DEFAULT 0',
        'total_treasury_generated INTEGER DEFAULT 0',
        'xp_boost_purchased INTEGER DEFAULT 0',
        'points_boost_purchased INTEGER DEFAULT 0',
        'stars_boost_purchased INTEGER DEFAULT 0',
        'treasury_multiplier_purchased INTEGER DEFAULT 0',
        'treasury_capacity INTEGER DEFAULT 0'
    ];

    for (const column of guildV5Columns) {
        const columnName = column.split(' ')[0];
        try {
            db.exec(`ALTER TABLE guilds ADD COLUMN ${column}`);
            logger.debug(`Colonne ${columnName} ajoutée à la table guilds.`);
        } catch (error) {
            if (!error.message.includes('duplicate column name')) {
                logger.error(`Erreur lors de l'ajout de la colonne ${columnName}:`, error);
            }
        }
    }

    // Migration spécifique pour upgrade_level (souvent manquante dans les vieilles DBs)
    try {
        db.exec('ALTER TABLE guilds ADD COLUMN upgrade_level INTEGER DEFAULT 1');
        logger.debug('Colonne upgrade_level ajoutée à la table guilds.');
    } catch (error) {
        if (!error.message.includes('duplicate column name')) {
            logger.error('Erreur lors de l\'ajout de la colonne upgrade_level:', error);
        }
    }

    // Migration de secours pour treasury (manquante dans certaines anciennes DB)
    try {
        db.exec('ALTER TABLE guilds ADD COLUMN treasury INTEGER DEFAULT 0');
        logger.debug('Colonne treasury ajoutée à la table guilds (migration secours).');
    } catch (error) {
        if (!error.message.includes('duplicate column name')) {
            logger.error('Erreur lors de l\'ajout de la colonne treasury:', error);
        }
    }

    // Migration pour la colonne created_at des guildes (date de création)
    try {
        db.exec('ALTER TABLE guilds ADD COLUMN created_at INTEGER DEFAULT 0');
        logger.debug('Colonne created_at ajoutée à la table guilds.');
    } catch (error) {
        if (!error.message.includes('duplicate column name')) {
            logger.error('Erreur lors de l\'ajout de la colonne created_at:', error);
        }
    }

    // --- Colonnes pour le cooldown des boosts boutique (12h) ---
    const boostCooldownColumns = [
        'last_xp_boost INTEGER DEFAULT 0',
        'last_points_boost INTEGER DEFAULT 0',
        'last_stars_boost INTEGER DEFAULT 0',
        'last_counting_boost INTEGER DEFAULT 0'
    ];

    for (const columnDef of boostCooldownColumns) {
        const columnName = columnDef.split(' ')[0];
        try {
            db.exec(`ALTER TABLE users ADD COLUMN ${columnDef}`);
            logger.debug(`Colonne ${columnName} ajoutée à la table users.`);
        } catch (error) {
            if (!error.message.includes('duplicate column name')) {
                logger.error(`Erreur lors de l'ajout de la colonne ${columnName}:`, error);
            }
        }
    }

    // --- MIGRATION GUILDES OVERHAUL ---
    try {
        db.exec("ALTER TABLE guilds ADD COLUMN last_penalty_check INTEGER DEFAULT 0");
        logger.debug('Colonne last_penalty_check ajoutée à la table guilds.');
    } catch (e) { /* Ignore if exists */ }

    try {
        db.exec("ALTER TABLE guilds ADD COLUMN custom_roles_config TEXT DEFAULT '[]'");
        logger.debug('Colonne custom_roles_config ajoutée à la table guilds.');
    } catch (e) { /* Ignore if exists */ }

    try {
        db.exec("ALTER TABLE guild_members ADD COLUMN role_id TEXT DEFAULT NULL");
        logger.debug('Colonne role_id ajoutée à la table guild_members.');
    } catch (e) { /* Ignore if exists */ }

    // Initialiser les quêtes de guilde si elles n'existent pas
    const existingQuests = db.prepare('SELECT COUNT(*) as count FROM guild_quests').get();
    if (existingQuests.count === 0) {
        const questsToInsert = [
            // Quêtes de Trésorerie
            { type: 'treasury', target: 500000, reward_type: 'xp', reward_amount: 1000, rarity: 'Commun', description: 'Atteindre 500 000 starss en trésorerie' },
            { type: 'treasury', target: 2000000, reward_type: 'xp', reward_amount: 3000, rarity: 'Rare', description: 'Atteindre 2 000 000 starss en trésorerie' },
            { type: 'treasury', target: 5000000, reward_type: 'xp', reward_amount: 6000, rarity: 'Épique', description: 'Atteindre 5 000 000 starss en trésorerie' },
            { type: 'treasury', target: 10000000, reward_type: 'xp', reward_amount: 10000, rarity: 'Légendaire', description: 'Atteindre 10 000 000 starss en trésorerie' },
            { type: 'treasury', target: 30000000, reward_type: 'xp', reward_amount: 15000, rarity: 'Mythique', description: 'Atteindre 30 000 000 starss en trésorerie' },

            // Quêtes de Niveau
            { type: 'level', target: 100, reward_type: 'stars', reward_amount: 100000, rarity: 'Rare', description: 'Atteindre le niveau 100' },
            { type: 'level', target: 250, reward_type: 'stars', reward_amount: 250000, rarity: 'Épique', description: 'Atteindre le niveau 250' },
            { type: 'level', target: 500, reward_type: 'stars', reward_amount: 500000, rarity: 'Légendaire', description: 'Atteindre le niveau 500' },
            { type: 'level', target: 1000, reward_type: 'stars', reward_amount: 750000, rarity: 'Mythique', description: 'Atteindre le niveau 1000' },
            { type: 'level', target: 2000, reward_type: 'stars', reward_amount: 1000000, rarity: 'Goatesque', description: 'Atteindre le niveau 2000' },

            // Quêtes de GvG
            { type: 'war_win', target: 1, reward_type: 'stars', reward_amount: 100000, rarity: 'Épique', description: 'Gagner 1 guerre de guilde' },
            { type: 'war_win_70', target: 1, reward_type: 'stars', reward_amount: 200000, rarity: 'Légendaire', description: 'Gagner une guerre à 70%+' },
            { type: 'war_win_80', target: 1, reward_type: 'stars', reward_amount: 300000, rarity: 'Mythique', description: 'Gagner une guerre à 80%+' },
            { type: 'war_win_90', target: 1, reward_type: 'stars', reward_amount: 500000, rarity: 'Goatesque', description: 'Gagner une guerre à 90%+' },

            // Quêtes d'Amélioration
            { type: 'upgrade', target: 2, reward_type: 'unlock', reward_amount: 0, rarity: 'Rare', description: 'Atteindre l\'Upgrade 2 (+3 places, +trésorerie)' },
            { type: 'upgrade', target: 3, reward_type: 'unlock', reward_amount: 0, rarity: 'Rare', description: 'Atteindre l\'Upgrade 3 (+3 places)' },
            { type: 'upgrade', target: 4, reward_type: 'unlock', reward_amount: 0, rarity: 'Épique', description: 'Atteindre l\'Upgrade 4 (+3 places, +Guilds tools)' },
            { type: 'upgrade', target: 5, reward_type: 'unlock', reward_amount: 0, rarity: 'Épique', description: 'Atteindre l\'Upgrade 5 (+3 places, +Salons persos)' },
            { type: 'upgrade', target: 6, reward_type: 'unlock', reward_amount: 0, rarity: 'Légendaire', description: 'Atteindre l\'Upgrade 6 (+3 places, +Guerre de guildes)' },
            { type: 'upgrade', target: 7, reward_type: 'unlock', reward_amount: 0, rarity: 'Légendaire', description: 'Atteindre l\'Upgrade 7 (+3 places)' },
            { type: 'upgrade', target: 8, reward_type: 'unlock', reward_amount: 0, rarity: 'Mythique', description: 'Atteindre l\'Upgrade 8 (+3 places, +Nouveaux guilds tools)' },
            { type: 'upgrade', target: 9, reward_type: 'unlock', reward_amount: 0, rarity: 'Mythique', description: 'Atteindre l\'Upgrade 9 (+3 places)' },
            { type: 'upgrade', target: 10, reward_type: 'unlock', reward_amount: 0, rarity: 'Goatesque', description: 'Atteindre l\'Upgrade X (+3 places)' },

            // Quête de Prestige
            { type: 'prestige', target: 1, reward_type: 'role', reward_amount: 0, rarity: 'Goatesque', description: 'Guilde pleine + Upgrade X' }
        ];

        const insertQuestStmt = db.prepare('INSERT INTO guild_quests (type, target, reward_type, reward_amount, rarity, description) VALUES (?, ?, ?, ?, ?, ?)');
        for (const quest of questsToInsert) {
            insertQuestStmt.run(quest.type, quest.target, quest.reward_type, quest.reward_amount, quest.rarity, quest.description);
        }
        logger.debug('Quêtes de guilde initialisées avec succès.');
    }

    // Table d'historique des ressources pour le diagnostic
    db.exec(`
        CREATE TABLE IF NOT EXISTS resource_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id TEXT NOT NULL,
            resource_type TEXT NOT NULL,
            amount INTEGER NOT NULL,
            source TEXT NOT NULL,
            timestamp INTEGER NOT NULL
        );
    `);

    // Index pour améliorer les performances des requêtes
    try {
        db.exec('CREATE INDEX IF NOT EXISTS idx_resource_history_user ON resource_history(user_id)');
        db.exec('CREATE INDEX IF NOT EXISTS idx_resource_history_timestamp ON resource_history(timestamp)');
    } catch (error) {
        // Index déjà existants
    }

    // Nettoyage automatique des vieilles entrées (garder 7 jours)
    const sevenDaysAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
    db.prepare('DELETE FROM resource_history WHERE timestamp < ?').run(sevenDaysAgo);

    // --- Migration pour le système de points de guerre V2 ---
    // Colonne war_points pour tracker les points accumulés (ne descend jamais)
    try {
        db.exec('ALTER TABLE guild_war_members ADD COLUMN war_points INTEGER DEFAULT 0');
        logger.debug('Colonne war_points ajoutée à la table guild_war_members.');
    } catch (error) {
        if (!error.message.includes('duplicate column name')) {
            logger.error('Erreur lors de l\'ajout de la colonne war_points:', error);
        }
    }

    // Colonne initial_pc pour tracker les points de comptage initiaux
    try {
        db.exec('ALTER TABLE guild_war_members ADD COLUMN initial_pc INTEGER DEFAULT 0');
        logger.debug('Colonne initial_pc ajoutée à la table guild_war_members.');
    } catch (error) {
        if (!error.message.includes('duplicate column name')) {
            logger.error('Erreur lors de l\'ajout de la colonne initial_pc:', error);
        }
    }

    try {
        db.exec('ALTER TABLE guild_war_members ADD COLUMN war_messages INTEGER DEFAULT 0');
        logger.debug('Colonne war_messages ajoutée à la table guild_war_members.');
    } catch (error) {
        if (!error.message.includes('duplicate column name')) {
            logger.error('Erreur lors de l\'ajout de la colonne war_messages:', error);
        }
    }

    try {
        db.exec('ALTER TABLE guild_war_members ADD COLUMN war_counting_messages INTEGER DEFAULT 0');
        logger.debug('Colonne war_counting_messages ajoutée à la table guild_war_members.');
    } catch (error) {
        if (!error.message.includes('duplicate column name')) {
            logger.error('Erreur lors de l\'ajout de la colonne war_counting_messages:', error);
        }
    }

    try {
        db.exec('ALTER TABLE guild_war_members ADD COLUMN war_voice_minutes INTEGER DEFAULT 0');
        logger.debug('Colonne war_voice_minutes ajoutée à la table guild_war_members.');
    } catch (error) {
        if (!error.message.includes('duplicate column name')) {
            logger.error('Erreur lors de l\'ajout de la colonne war_voice_minutes:', error);
        }
    }

    // Table des paramètres du bot (pour les toggles admin)
    db.exec(`
        CREATE TABLE IF NOT EXISTS bot_settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );
    `);

    // --- RANKED V2 Part 2: Table d'activité pour le pool dynamique ---
    db.exec(`
        CREATE TABLE IF NOT EXISTS ranked_daily_activity (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id TEXT NOT NULL,
            date TEXT NOT NULL,
            messages INTEGER DEFAULT 0,
            voice_minutes INTEGER DEFAULT 0,
            UNIQUE(user_id, date)
        );
    `);

    // Index pour améliorer les performances
    try {
        db.exec('CREATE INDEX IF NOT EXISTS idx_ranked_activity_user ON ranked_daily_activity(user_id)');
        db.exec('CREATE INDEX IF NOT EXISTS idx_ranked_activity_date ON ranked_daily_activity(date)');
        logger.debug('Table ranked_daily_activity créée/vérifiée avec succès.');
    } catch (error) {
        // Index déjà existants
    }

    // --- Migration pour le Pass VIP (stocké en DB au lieu du rôle Discord) ---
    try {
        db.exec('ALTER TABLE users ADD COLUMN is_vip INTEGER DEFAULT 0');
        logger.debug('Colonne is_vip ajoutée à la table users.');
    } catch (error) {
        if (!error.message.includes('duplicate column name')) {
            logger.error('Erreur lors de l\'ajout de la colonne is_vip:', error);
        }
    }

    // --- Migration pour l'expiration du Pass VIP (1 mois) ---
    try {
        db.exec('ALTER TABLE users ADD COLUMN vip_expires_at INTEGER DEFAULT 0');
        logger.debug('Colonne vip_expires_at ajoutée à la table users.');
    } catch (error) {
        if (!error.message.includes('duplicate column name')) {
            logger.error('Erreur lors de l\'ajout de la colonne vip_expires_at:', error);
        }
    }

    // --- Migration pour les rôles personnalisés de guilde ---
    try {
        db.exec('ALTER TABLE guilds ADD COLUMN custom_roles TEXT DEFAULT \'[]\'');
        logger.debug('Colonne custom_roles ajoutée à la table guilds.');
    } catch (error) {
        if (!error.message.includes('duplicate column name')) {
            logger.error('Erreur lors de l\'ajout de la colonne custom_roles:', error);
        }
    }

    try {
        db.exec('ALTER TABLE guilds ADD COLUMN overstaffed_since INTEGER DEFAULT NULL');
        logger.debug('Colonne overstaffed_since ajoutée à la table guilds.');
    } catch (error) {
        if (!error.message.includes('duplicate column name')) {
            logger.error('Erreur lors de l\'ajout de la colonne overstaffed_since:', error);
        }
    }

    // --- Migration pour custom_role dans guild_members ---
    try {
        db.exec('ALTER TABLE guild_members ADD COLUMN custom_role TEXT DEFAULT NULL');
        logger.debug('Colonne custom_role ajoutée à la table guild_members.');
    } catch (error) {
        if (!error.message.includes('duplicate column name')) {
            logger.error('Erreur lors de l\'ajout de la colonne custom_role:', error);
        }
    }

    // --- Migration pour les colonnes d'activité de guerre (guild_war_members) ---
    const warMemberColumns = [
        'war_messages INTEGER DEFAULT 0',
        'war_counting_messages INTEGER DEFAULT 0',
        'war_voice_minutes INTEGER DEFAULT 0',
        'war_points INTEGER DEFAULT 0',
    ];
    for (const columnDef of warMemberColumns) {
        const columnName = columnDef.split(' ')[0];
        try {
            db.exec(`ALTER TABLE guild_war_members ADD COLUMN ${columnDef}`);
            logger.debug(`Colonne ${columnName} ajoutée à la table guild_war_members.`);
        } catch (error) {
            if (!error.message.includes('duplicate column name')) {
                logger.error(`Erreur lors de l'ajout de la colonne ${columnName} à guild_war_members:`, error);
            }
        }
    }

    // --- Repair : insérer les membres manquants dans guild_war_members pour les guerres en cours ---
    // (Cas où la guerre avait démarré avant que les colonnes war_messages etc. existaient)
    try {
        // Vérifier que toutes les colonnes existent
        const warMemberCols = db.prepare('PRAGMA table_info(guild_war_members)').all().map(c => c.name);
        logger.debug(`[GUILD-WAR] Colonnes guild_war_members: ${warMemberCols.join(', ')}`);

        const ongoingWars = db.prepare("SELECT * FROM guild_wars WHERE status = 'ongoing' OR status = 'overtime'").all();
        logger.debug(`[GUILD-WAR] Repair: ${ongoingWars.length} guerre(s) en cours trouvée(s).`);

        for (const war of ongoingWars) {
            const members1 = db.prepare('SELECT user_id FROM guild_members WHERE guild_id = ?').all(war.guild1_id);
            const members2 = db.prepare('SELECT user_id FROM guild_members WHERE guild_id = ?').all(war.guild2_id);
            const existingMembers = db.prepare('SELECT COUNT(*) as count FROM guild_war_members WHERE war_id = ?').get(war.id);

            logger.debug(`[GUILD-WAR] Repair guerre #${war.id}: ${existingMembers.count} membres existants, ${members1.length + members2.length} membres attendus.`);

            const insertMember = db.prepare('INSERT OR IGNORE INTO guild_war_members (war_id, user_id, guild_id, war_messages, war_counting_messages, war_voice_minutes, war_points) VALUES (?, ?, ?, 0, 0, 0, 0)');
            let inserted = 0;
            for (const m of members1) {
                const r = insertMember.run(war.id, m.user_id, war.guild1_id);
                if (r.changes > 0) inserted++;
            }
            for (const m of members2) {
                const r = insertMember.run(war.id, m.user_id, war.guild2_id);
                if (r.changes > 0) inserted++;
            }
            logger.debug(`[GUILD-WAR] Repair guerre #${war.id}: ${inserted} nouveau(x) membre(s) inséré(s).`);
        }
    } catch (err) {
        logger.error('[GUILD-WAR] Erreur repair guild_war_members:', err);
    }

    // ============================================================
    // === MAJ MARS 2026 : Puits de Combat, Marketplace, Trophées & Valeur ===
    // ============================================================

    // --- 1. Colonnes pour le système de Puits (Points de Tirage) ---
    // tirage_points (PT) : points accumulés pour débloquer des tirages
    // total_tirages : nombre total de tirages effectués ce mois
    try {
        db.exec('ALTER TABLE users ADD COLUMN tirage_points INTEGER DEFAULT 0');
        logger.debug('[MAJ-MARS] Colonne tirage_points ajoutée à la table users.');
    } catch (error) {
        if (!error.message.includes('duplicate column name')) {
            logger.error('[MAJ-MARS] Erreur ajout tirage_points:', error);
        }
    }

    try {
        db.exec('ALTER TABLE users ADD COLUMN total_tirages INTEGER DEFAULT 0');
        logger.debug('[MAJ-MARS] Colonne total_tirages ajoutée à la table users.');
    } catch (error) {
        if (!error.message.includes('duplicate column name')) {
            logger.error('[MAJ-MARS] Erreur ajout total_tirages:', error);
        }
    }

    // --- 2. Table de l'historique des tirages du puits ---
    db.exec(`
        CREATE TABLE IF NOT EXISTS puits_tirages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id TEXT NOT NULL,
            tirage_number INTEGER NOT NULL,
            reward_type TEXT NOT NULL,
            reward_id TEXT,
            reward_amount INTEGER DEFAULT 0,
            timestamp INTEGER NOT NULL,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );
    `);

    try {
        db.exec('CREATE INDEX IF NOT EXISTS idx_puits_tirages_user ON puits_tirages(user_id)');
        logger.debug('[MAJ-MARS] Table puits_tirages créée/vérifiée.');
    } catch (error) {
        // Index déjà existant
    }

    // --- 3. Table du Marketplace ---
    db.exec(`
        CREATE TABLE IF NOT EXISTS marketplace_listings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            seller_id TEXT NOT NULL,
            item_id TEXT NOT NULL,
            quantity INTEGER NOT NULL DEFAULT 1,
            price_type TEXT NOT NULL DEFAULT 'starss',
            price_item_id TEXT DEFAULT NULL,
            price_amount INTEGER NOT NULL,
            created_at INTEGER NOT NULL,
            expires_at INTEGER NOT NULL,
            status TEXT NOT NULL DEFAULT 'active',
            buyer_id TEXT DEFAULT NULL,
            bought_at INTEGER DEFAULT NULL,
            FOREIGN KEY (seller_id) REFERENCES users(id) ON DELETE CASCADE
        );
    `);

    try {
        db.exec('CREATE INDEX IF NOT EXISTS idx_marketplace_seller ON marketplace_listings(seller_id)');
        db.exec('CREATE INDEX IF NOT EXISTS idx_marketplace_status ON marketplace_listings(status)');
        db.exec('CREATE INDEX IF NOT EXISTS idx_marketplace_item ON marketplace_listings(item_id)');
        logger.debug('[MAJ-MARS] Table marketplace_listings créée/vérifiée.');
    } catch (error) {
        // Index déjà existants
    }

    // --- 4. Table des trophées (renommage des succès avec raretés) ---
    db.exec(`
        CREATE TABLE IF NOT EXISTS user_trophies (
            user_id TEXT NOT NULL,
            trophy_id TEXT NOT NULL,
            rarity TEXT NOT NULL,
            earned_at INTEGER NOT NULL,
            PRIMARY KEY (user_id, trophy_id),
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );
    `);

    try {
        db.exec('CREATE INDEX IF NOT EXISTS idx_user_trophies_user ON user_trophies(user_id)');
        logger.debug('[MAJ-MARS] Table user_trophies créée/vérifiée.');
    } catch (error) {
        // Index déjà existant
    }

    // --- 5. Colonne de valeur totale pour le cache (recalculé périodiquement) ---
    try {
        db.exec('ALTER TABLE users ADD COLUMN total_value INTEGER DEFAULT 0');
        logger.debug('[MAJ-MARS] Colonne total_value ajoutée à la table users.');
    } catch (error) {
        if (!error.message.includes('duplicate column name')) {
            logger.error('[MAJ-MARS] Erreur ajout total_value:', error);
        }
    }

    // Valeur totale de la guilde (cache, recalculée à partir des membres)
    try {
        db.exec('ALTER TABLE guilds ADD COLUMN total_value INTEGER DEFAULT 0');
        logger.debug('[MAJ-MARS] Colonne total_value ajoutée à la table guilds.');
    } catch (error) {
        if (!error.message.includes('duplicate column name')) {
            logger.error('[MAJ-MARS] Erreur ajout total_value guilds:', error);
        }
    }

    // --- 6. Migration des badges existants vers les trophées ---
    // Les badges/succès existants deviennent des trophées avec une rareté
    // On migre user_badges vers user_trophies si pas déjà fait
    try {
        const existingBadges = db.prepare('SELECT COUNT(*) as count FROM user_badges').get();
        const existingTrophies = db.prepare('SELECT COUNT(*) as count FROM user_trophies').get();
        if (existingBadges.count > 0 && existingTrophies.count === 0) {
            // Migration : copier les badges vers les trophées avec rareté par défaut
            const badges = db.prepare('SELECT * FROM user_badges').all();
            const insertTrophy = db.prepare('INSERT OR IGNORE INTO user_trophies (user_id, trophy_id, rarity, earned_at) VALUES (?, ?, ?, ?)');
            for (const badge of badges) {
                insertTrophy.run(badge.user_id, badge.badge_id, 'Commun', badge.earned_at);
            }
            logger.debug(`[MAJ-MARS] ${badges.length} badges migrés vers les trophées.`);
        }
    } catch (error) {
        logger.error('[MAJ-MARS] Erreur migration badges→trophées:', error);
    }

    logger.debug('[MAJ-MARS] Migration Mars 2026 terminée avec succès.');

    // --- Table des rôles VIP personnalisés ---
    db.exec(`
        CREATE TABLE IF NOT EXISTS vip_custom_roles (
            user_id TEXT PRIMARY KEY,
            role_id TEXT NOT NULL,
            role_name TEXT NOT NULL,
            role_color TEXT NOT NULL DEFAULT '#FFFFFF',
            role_icon TEXT DEFAULT NULL,
            created_at INTEGER NOT NULL DEFAULT 0,
            updated_at INTEGER NOT NULL DEFAULT 0
        );
    `);
    logger.debug('Table vip_custom_roles créée/vérifiée avec succès.');

    logger.debug('Base de données initialisée avec succès.');
}

// Initialiser la DB au premier chargement
initializeDatabase();

// Exporter l'objet db pour l'utiliser ailleurs
module.exports = db;
