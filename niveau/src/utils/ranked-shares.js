const dbm = require('../database/database');
const logger = require('./logger');

function forEachDb(fn) {
    if (typeof dbm.forEachEconomyDatabase === 'function') {
        dbm.forEachEconomyDatabase(fn);
    } else {
        fn(dbm);
    }
}

forEachDb((db) => {
    db.exec(`
    CREATE TABLE IF NOT EXISTS server_config (
        key TEXT PRIMARY KEY,
        value REAL
    );
`);
});

function getServerConfig(key, defaultValue = 0) {
    const row = dbm.prepare('SELECT value FROM server_config WHERE key = ?').get(key);
    return row ? row.value : defaultValue;
}

function setServerConfig(key, value) {
    dbm.prepare('INSERT OR REPLACE INTO server_config (key, value) VALUES (?, ?)').run(key, value);
}

function initializeSharesSystem() {
    forEachDb((db) => {
        try {
            db.exec('ALTER TABLE users ADD COLUMN shares REAL DEFAULT 0');
        } catch (e) {
            // Ignorer si la colonne existe (déjà ajoutée)
        }

        const existingGlobal = db.prepare('SELECT value FROM server_config WHERE key = ?').get('total_shares_global');
        if (existingGlobal !== undefined) return;

        logger.info('Démarrage de la migration de la Ranked V2 (Parts) sur une base…');

        const users = db.prepare('SELECT id, points FROM users WHERE points > 0').all();
        let totalPoints = 0;

        const setCfg = (k, v) => db.prepare('INSERT OR REPLACE INTO server_config (key, value) VALUES (?, ?)').run(k, v);

        const migrate = db.transaction(() => {
            const updateSharesStmt = db.prepare('UPDATE users SET shares = ? WHERE id = ?');
            for (const user of users) {
                updateSharesStmt.run(user.points, user.id);
                totalPoints += user.points;
            }
            setCfg('total_shares_global', totalPoints);
            setCfg('pool_rp_total', totalPoints);
        });

        migrate();
        logger.info(`Migration terminée (${users.length} utilisateurs, total ${totalPoints}).`);
    });
}

function getUserShares(userId) {
    const row = dbm.prepare('SELECT shares FROM users WHERE id = ?').get(userId);
    return row ? (row.shares || 0) : 0;
}

function getUserRP(userId) {
    const sharesJoueur = getUserShares(userId);
    if (sharesJoueur <= 0) return 0;
    
    const pool_rp_total = getServerConfig('pool_rp_total', 0);
    const total_shares_global = getServerConfig('total_shares_global', 0);
    
    if (total_shares_global === 0) return 0;
    
    // RP = (sharesJoueur * pool_rp_total) / totalSharesGlobal
    return Math.floor((sharesJoueur * pool_rp_total) / total_shares_global);
}

function addPlayerRP(userId, gainRP) {
    if (gainRP <= 0) return;
    
    const sharesJoueur = getUserShares(userId);
    const pointsActuels = getUserRP(userId);
    
    let pool_rp_total = getServerConfig('pool_rp_total', 0);
    let total_shares_global = getServerConfig('total_shares_global', 0);
    
    // Si c'est le tout premier gain (système vide) ou système désactivé/à 0
    if (total_shares_global === 0 || pool_rp_total === 0) {
        // Init basique très légère pour bootstrap
        total_shares_global = 10; 
        pool_rp_total = 10;
    }
    
    // Formule: deltaShares = (gainRP * totalSharesGlobal) / (pool_rp_total - pointsActuels - gainRP)
    // On doit s'assurer que (pool_rp_total - pointsActuels - gainRP) ne tombe pas <= 0 
    // ce qui voudrait dire qu'un joueur va gagner + que la totalité du serveur (cas très extrême).
    let denominator = pool_rp_total - pointsActuels - gainRP;
    if (denominator <= 0) denominator = 1; // Fallback mathématique (éviter crash ou valeurs négatives)
    
    const deltaShares = (gainRP * total_shares_global) / denominator;
    
    const newShares = sharesJoueur + deltaShares;
    const newTotalShares = total_shares_global + deltaShares;
    const newPoolRP = pool_rp_total + gainRP;
    
    const updateTransaction = dbm.transaction(() => {
        dbm.prepare('UPDATE users SET shares = ? WHERE id = ?').run(newShares, userId);
        setServerConfig('total_shares_global', newTotalShares);
        setServerConfig('pool_rp_total', newPoolRP);
        
        // Maintien synchrone de la colonne points (Part 1 de ranked se basait là dessus et sur getPoints)
        // en mettant à jour la bdd, on préserve tout le code de la Part 1 Ranked qui check `user.points`
        const finalRP = Math.floor((newShares * newPoolRP) / newTotalShares);
        dbm.prepare('UPDATE users SET points = ? WHERE id = ?').run(finalRP, userId);
    });
    
    try {
        updateTransaction();
    } catch (error) {
        logger.error(`Erreur addPlayerRP(${userId}, ${gainRP}): ${error.message}`);
    }
}

function burnPlayerRP(userId, perteRP) {
    if (perteRP <= 0) return;
    
    const sharesJoueur = getUserShares(userId);
    const pointsActuels = getUserRP(userId);
    
    // Éviter de perdre plus que ce qu'on a
    if (pointsActuels === 0) return;
    if (perteRP > pointsActuels) perteRP = pointsActuels;
    
    let pool_rp_total = getServerConfig('pool_rp_total', 0);
    let total_shares_global = getServerConfig('total_shares_global', 0);
    
    if (total_shares_global === 0 || pool_rp_total === 0) return;
    
    // Formule: deltaShares = (perteRP * totalSharesGlobal) / (pool_rp_total - pointsActuels + perteRP)
    const denominator = pool_rp_total - pointsActuels + perteRP;
    if (denominator <= 0) return;
    
    const deltaShares = (perteRP * total_shares_global) / denominator;
    
    let newShares = sharesJoueur - deltaShares;
    if (newShares < 0) newShares = 0;
    
    let newTotalShares = total_shares_global - deltaShares;
    if (newTotalShares < 0) newTotalShares = 0;
    
    // Le pool_rp_total NE BOUGE PAS (c'est ce qui crée la revalorisation globale via burn)
    
    const updateTransaction = dbm.transaction(() => {
        dbm.prepare('UPDATE users SET shares = ? WHERE id = ?').run(newShares, userId);
        setServerConfig('total_shares_global', newTotalShares);
        
        const finalRP = Math.floor((newShares * pool_rp_total) / newTotalShares);
        dbm.prepare('UPDATE users SET points = ? WHERE id = ?').run(finalRP, userId);
    });
    
    try {
        updateTransaction();
    } catch (error) {
        logger.error(`Erreur burnPlayerRP(${userId}, ${perteRP}): ${error.message}`);
    }
}

module.exports = {
    initializeSharesSystem,
    getUserShares,
    getUserRP,
    addPlayerRP,
    burnPlayerRP,
    getServerConfig
};
