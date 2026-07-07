const db = require('../database/database');
const { ITEMS } = require('./items');
const logger = require('./logger');

/**
 * Crée les tables boutique sur une connexion SQLite concrète.
 * Important : avec `database.js` en mode double fichier (test + principal), le proxy `db`
 * pointe vers la bonne base seulement pendant une interaction ; au chargement du module
 * il pointait toujours vers la base principale — les tables manquaient sur blzbot.test.sqlite.
 */
function initializeShopTablesOnDatabase(d) {
    // Nouvelle table pour les boutiques individuelles
    d.exec(`
        CREATE TABLE IF NOT EXISTS user_daily_shop (
            user_id TEXT NOT NULL,
            date TEXT NOT NULL,
            slot INTEGER NOT NULL,
            item_id TEXT NOT NULL,
            PRIMARY KEY (user_id, date, slot)
        );
    `);

    d.exec(`
        CREATE TABLE IF NOT EXISTS user_shop_state (
            user_id TEXT NOT NULL PRIMARY KEY,
            last_generated TEXT,
            last_legendary_chest_check INTEGER DEFAULT 0,
            legendary_chest_available INTEGER DEFAULT 0,
            last_shop_reset INTEGER DEFAULT 0
        );
    `);

    d.exec(`
        CREATE TABLE IF NOT EXISTS shop_purchases (
            user_id TEXT NOT NULL,
            item_id TEXT NOT NULL,
            purchase_date TEXT NOT NULL,
            quantity INTEGER DEFAULT 1,
            PRIMARY KEY (user_id, item_id, purchase_date)
        );
    `);

    try {
        const tableInfo = d.prepare('PRAGMA table_info(user_shop_state)').all();
        const hasLastShopReset = tableInfo.some((col) => col.name === 'last_shop_reset');
        if (!hasLastShopReset) {
            d.exec('ALTER TABLE user_shop_state ADD COLUMN last_shop_reset INTEGER DEFAULT 0');
            logger.info('Colonne last_shop_reset ajoutée à user_shop_state');
        }
    } catch (migrationError) {
        logger.warn('Migration last_shop_reset non nécessaire ou déjà existante');
    }
}

function ensureShopTablesOnAllEconomyDatabases() {
    try {
        if (typeof db.forEachEconomyDatabase === 'function') {
            db.forEachEconomyDatabase((d) => initializeShopTablesOnDatabase(d));
        } else {
            initializeShopTablesOnDatabase(db.getMainDb ? db.getMainDb() : db);
        }
        logger.info('Tables de la boutique personnelle vérifiées/créées (toutes les bases économie).');
    } catch (error) {
        logger.error('Erreur lors de l\'initialisation des tables de la boutique:', error);
    }
}

ensureShopTablesOnAllEconomyDatabases();

const RARITY_PROBABILITIES = [
    { rarity: 'Commun', weight: 50 },
    { rarity: 'Rare', weight: 25 },
    { rarity: 'Épique', weight: 15 },
    { rarity: 'Légendaire', weight: 6 },
    { rarity: 'Mythique', weight: 3 },
    { rarity: 'Goatesque', weight: 1 },
];

const TOTAL_WEIGHT = RARITY_PROBABILITIES.reduce((sum, r) => sum + r.weight, 0);

/**
 * Filtre les items par rareté
 * @param {string} rarity 
 * @param {string} userId - Pour vérifier si l'utilisateur peut voir certains items
 * @returns {Array}
 */
function getItemsByRarity(rarity, userId = null) {
    const { getGuildOfUser } = require('./db-guilds');
    
    return Object.values(ITEMS).filter(item => {
        // Filtrer les boosts
        if (['xp_boost', 'points_boost', 'starss_boost', 'counting_boost'].includes(item.id)) {
            return false;
        }
        
        // Vérifier la rareté et le type
        if (item.rarity !== rarity || item.type !== 'item') {
            return false;
        }
        
        // joker_guilde uniquement pour les chefs de guilde
        if (item.id === 'joker_guilde' && userId) {
            const guild = getGuildOfUser(userId);
            if (!guild || guild.owner_id !== userId) {
                return false;
            }
        }
        
        return true;
    });
}

function chooseRarity() {
    let random = Math.random() * TOTAL_WEIGHT;
    for (const rarityInfo of RARITY_PROBABILITIES) {
        if (random < rarityInfo.weight) {
            return rarityInfo.rarity;
        }
        random -= rarityInfo.weight;
    }
    return 'Commun'; // Fallback
}

/**
 * Génère une boutique pour un utilisateur spécifique
 * @param {string} userId
 * @returns {Array} Liste des items générés
 */
function generateUserDailyShop(userId) {
    const today = new Date().toISOString().slice(0, 10);
    const items = [];
    const usedItemIds = new Set();

    for (let i = 0; i < 4; i++) {
        let attempts = 0;
        let randomItem = null;

        while (attempts < 20) {
            const rarity = chooseRarity();
            const itemsOfRarity = getItemsByRarity(rarity, userId);

            if (itemsOfRarity.length > 0) {
                randomItem = itemsOfRarity[Math.floor(Math.random() * itemsOfRarity.length)];

                if (!usedItemIds.has(randomItem.id)) {
                    usedItemIds.add(randomItem.id);
                    items.push({ slot: i + 1, item_id: randomItem.id });
                    break;
                }
            }
            attempts++;
        }
    }

    db.transaction(() => {
        // Supprimer l'ancienne boutique du jour si existe (cas du reroll)
        db.prepare('DELETE FROM user_daily_shop WHERE user_id = ? AND date = ?').run(userId, today);

        const insertStmt = db.prepare('INSERT INTO user_daily_shop (user_id, date, slot, item_id) VALUES (?, ?, ?, ?)');
        for (const item of items) {
            insertStmt.run(userId, today, item.slot, item.item_id);
        }

        // Mettre à jour l'état de la boutique utilisateur
        db.prepare(`
            INSERT INTO user_shop_state (user_id, last_generated, last_legendary_chest_check, legendary_chest_available)
            VALUES (?, ?, 0, 0)
            ON CONFLICT(user_id) DO UPDATE SET last_generated = ?, legendary_chest_available = 0
        `).run(userId, today, today);
    })();

    // Nettoyer les vieilles boutiques (garder 2 jours pour s'assurer)
    // On peut faire ça de manière asynchrone ou moins fréquente pour perf
    // db.prepare('DELETE FROM user_daily_shop WHERE date < ?').run(today);

    return items;
}

/**
 * Récupère les items de la boutique du jour pour un utilisateur
 * Génère la boutique si elle n'existe pas encore.
 * @param {string} userId
 */
function getDailyShopItems(userId) {
    const today = new Date().toISOString().slice(0, 10);

    const shopItems = db.prepare('SELECT slot, item_id FROM user_daily_shop WHERE user_id = ? AND date = ? ORDER BY slot ASC').all(userId, today);

    if (shopItems.length === 0) {
        return generateUserDailyShop(userId);
    }

    return shopItems;
}

/**
 * Reroll la boutique d'un utilisateur (pour l'item reset_boutique)
 * @param {string} userId
 */
function rerollUserShop(userId) {
    const now = Date.now();
    const COOLDOWN_24H = 24 * 60 * 60 * 1000; // 24 heures en millisecondes

    // Vérifier le cooldown
    const shopState = db.prepare('SELECT last_shop_reset FROM user_shop_state WHERE user_id = ?').get(userId);
    const lastReset = shopState ? shopState.last_shop_reset : 0;

    if (lastReset && now - lastReset < COOLDOWN_24H) {
        const timeLeft = COOLDOWN_24H - (now - lastReset);
        const hoursLeft = Math.ceil(timeLeft / (60 * 60 * 1000));
        return {
            success: false,
            message: `⏳ Vous devez attendre **${hoursLeft}h** avant de pouvoir réinitialiser la boutique à nouveau.`
        };
    }

    const today = new Date().toISOString().slice(0, 10);

    // Reset achats du jour pour permettre de racheter
    db.prepare('DELETE FROM shop_purchases WHERE user_id = ? AND purchase_date = ?').run(userId, today);

    // Mettre à jour le timestamp du dernier reset
    if (shopState) {
        db.prepare('UPDATE user_shop_state SET last_shop_reset = ? WHERE user_id = ?').run(now, userId);
    } else {
        db.prepare('INSERT INTO user_shop_state (user_id, last_shop_reset) VALUES (?, ?)').run(userId, now);
    }

    // Régénérer
    generateUserDailyShop(userId);

    return {
        success: true,
        message: `✅ Votre boutique personnelle a été réinitialisée avec de nouveaux items ! Vos limites d'achats ont également été remises à zéro.`
    };
}

// Limites d'achats par rareté - Tous limités à 1 par item
const PURCHASE_LIMITS = {
    'Commun': 1,
    'Rare': 1,
    'Épique': 1,
    'Légendaire': 1,
    'Mythique': 1,
    'Goatesque': 1
};

function canPurchaseItem(userId, itemId, rarity) {
    const today = new Date().toISOString().slice(0, 10);
    const limit = PURCHASE_LIMITS[rarity] || 1;

    const stmt = db.prepare(`
        SELECT COALESCE(SUM(quantity), 0) as total 
        FROM shop_purchases 
        WHERE user_id = ? AND item_id = ? AND purchase_date = ?
    `);

    const result = stmt.get(userId, itemId, today);
    const currentPurchases = result.total || 0;

    return {
        canPurchase: currentPurchases < limit,
        currentPurchases: currentPurchases,
        limit: limit,
        remaining: limit - currentPurchases
    };
}

function recordPurchase(userId, itemId, quantity = 1) {
    const today = new Date().toISOString().slice(0, 10);

    const stmt = db.prepare(`
        INSERT INTO shop_purchases (user_id, item_id, purchase_date, quantity)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(user_id, item_id, purchase_date) 
        DO UPDATE SET quantity = quantity + ?
    `);

    stmt.run(userId, itemId, today, quantity, quantity);
}

function cleanOldPurchases() {
    const today = new Date().toISOString().slice(0, 10);
    db.prepare('DELETE FROM shop_purchases WHERE purchase_date < ?').run(today);
    // Nettoyer aussi les vieilles boutiques
    db.prepare('DELETE FROM user_daily_shop WHERE date < ?').run(today);
}

/**
 * Vérifie si le coffre légendaire doit spawn pour un utilisateur (30% de chance par heure d'activité shop)
 * Maintenant c'est individuel !
 */
function checkLegendaryChestSpawn(userId) {
    const now = Date.now();
    const oneHour = 60 * 60 * 1000;

    let info = db.prepare('SELECT last_legendary_chest_check, legendary_chest_available FROM user_shop_state WHERE user_id = ?').get(userId);

    // Initialiser si pas présent (peu probable si getDailyShopItems est appelé avant)
    if (!info) {
        const today = new Date().toISOString().slice(0, 10);
        db.prepare('INSERT INTO user_shop_state (user_id, last_generated, last_legendary_chest_check, legendary_chest_available) VALUES (?, ?, 0, 0)').run(userId, today);
        info = { last_legendary_chest_check: 0, legendary_chest_available: 0 };
    }

    if (info.legendary_chest_available === 1) {
        return true;
    }

    const lastCheck = info.last_legendary_chest_check || 0;
    if (now - lastCheck >= oneHour) {
        const shouldSpawn = Math.random() < 0.30;

        db.prepare('UPDATE user_shop_state SET last_legendary_chest_check = ?, legendary_chest_available = ? WHERE user_id = ?')
            .run(now, shouldSpawn ? 1 : 0, userId);

        if (shouldSpawn) {
            logger.info(`🎁 Coffre légendaire spawn pour ${userId}`);
        }

        return shouldSpawn;
    }

    return false;
}

function removeLegendaryChest(userId) {
    db.prepare('UPDATE user_shop_state SET legendary_chest_available = 0 WHERE user_id = ?').run(userId);
}

module.exports = {
    getDailyShopItems,
    generateUserDailyShop, // Exported mainly for testing or explicit calls
    canPurchaseItem,
    recordPurchase,
    cleanOldPurchases,
    checkLegendaryChestSpawn,
    removeLegendaryChest,
    rerollUserShop,
    PURCHASE_LIMITS
};
