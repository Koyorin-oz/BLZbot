/**
 * Remet à zéro l’économie globale (starss, RP/points, XP, parts ranked, inventaires liés, etc.)
 * sans supprimer les guildes ni les comptes utilisateurs.
 */
const db = require('../database/database');
const logger = require('./logger');
const { getAllGuilds, updateGuildLevel } = require('./db-guilds');

require('./ranked-shares'); // assure la table server_config

const USER_NUMERIC_RESET = {
    xp: 0,
    level: 1,
    xp_needed: 100,
    points: 0,
    stars: 0,
    daily_last_claimed: 0,
    last_decay_timestamp: 0,
    seasonal_xp: 0,
    streak: 0,
    last_streak_timestamp: 0,
    streak_lost_timestamp: 0,
    previous_streak: 0,
    xp_boost_until: 0,
    xp_boost_x4_until: 0,
    points_boost_until: 0,
    stars_boost_until: 0,
    counting_boost_until: 0,
    last_xp_boost: 0,
    last_points_boost: 0,
    last_stars_boost: 0,
    last_counting_boost: 0,
    points_comptage: 0,
    daily_voice_xp: 0,
    daily_voice_last_reset: 0,
    daily_voice_points: 0,
    minigames_won: 0,
    max_points: 0,
    max_stars: 0,
    tirage_points: 0,
    total_tirages: 0,
    total_value: 0,
    last_activity_timestamp: 0,
    shares: 0,
};

const USER_NULL_RESET = ['peak_rank', 'hacker_item_timestamp'];

const GUILD_NUMERIC_RESET = {
    treasury: 0,
    total_treasury_generated: 0,
    treasury_multiplier_level: 0,
    xp_boost_purchased: 0,
    points_boost_purchased: 0,
    stars_boost_purchased: 0,
    treasury_multiplier_purchased: 0,
    joker_guilde_uses: 0,
    guild_boost_until: 0,
};

function tableExists(name) {
    return !!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(name);
}

function buildUserUpdateSql() {
    const cols = db.prepare('PRAGMA table_info(users)').all().map((r) => r.name);
    const parts = [];
    for (const [col, val] of Object.entries(USER_NUMERIC_RESET)) {
        if (cols.includes(col)) {
            parts.push(`${col} = ${val}`);
        }
    }
    for (const col of USER_NULL_RESET) {
        if (cols.includes(col)) {
            parts.push(`${col} = NULL`);
        }
    }
    if (parts.length === 0) return null;
    return `UPDATE users SET ${parts.join(', ')}`;
}

function buildGuildUpdateSql() {
    const cols = db.prepare('PRAGMA table_info(guilds)').all().map((r) => r.name);
    const parts = [];
    for (const [col, val] of Object.entries(GUILD_NUMERIC_RESET)) {
        if (cols.includes(col)) {
            parts.push(`${col} = ${val}`);
        }
    }
    if (parts.length === 0) return null;
    return `UPDATE guilds SET ${parts.join(', ')}`;
}

function deleteFromTable(table) {
    if (!tableExists(table)) return 0;
    return db.prepare(`DELETE FROM ${table}`).run().changes;
}

/**
 * @returns {{ usersReset: number, guildsReset: number, deleted: Record<string, number> }}
 */
function resetServerEconomy() {
    const userSql = buildUserUpdateSql();
    const guildSql = buildGuildUpdateSql();

    const { usersReset, guildsReset, deleted } = db.transaction(() => {
        const del = {};
        let u = 0;
        if (userSql) {
            u = db.prepare(userSql).run().changes;
        }
        let g = 0;
        if (guildSql) {
            g = db.prepare(guildSql).run().changes;
        }

        db.prepare(
            'INSERT OR REPLACE INTO server_config (key, value) VALUES (?, ?)'
        ).run('total_shares_global', 0);
        db.prepare(
            'INSERT OR REPLACE INTO server_config (key, value) VALUES (?, ?)'
        ).run('pool_rp_total', 0);

        const tablesToWipe = [
            'user_inventory',
            'quest_progress',
            'battle_pass',
            'resource_history',
            'shop_alerts',
            'shop_purchases',
            'daily_shop',
            'loans',
            'guild_quest_progress',
            'server_quest_votes',
            'puits_tirages',
            'marketplace_listings',
            'ranked_daily_activity',
        ];
        for (const t of tablesToWipe) {
            const n = deleteFromTable(t);
            if (n > 0) del[t] = n;
        }

        if (tableExists('user_trophies')) {
            const n = deleteFromTable('user_trophies');
            if (n > 0) del.user_trophies = n;
        }

        if (tableExists('war_mvps')) {
            const n = deleteFromTable('war_mvps');
            if (n > 0) del.war_mvps = n;
        }

        if (tableExists('shop_info')) {
            try {
                db.prepare(
                    `UPDATE shop_info SET last_legendary_chest_check = 0, legendary_chest_available = 0`
                ).run();
            } catch {
                /* colonnes optionnelles */
            }
        }

        return { usersReset: u, guildsReset: g, deleted: del };
    })();

    try {
        const guilds = getAllGuilds();
        for (const g of guilds) {
            updateGuildLevel(g.id);
        }
    } catch (e) {
        logger.error('[reset-economy] Recalcul niveaux guildes:', e?.message || e);
    }

    logger.warn(
        `[reset-economy] Économie réinitialisée — ${usersReset} profil(s), ${guildsReset} guilde(s) (trésorerie/boosts guilde).`
    );

    return {
        usersReset,
        guildsReset,
        deleted,
    };
}

module.exports = { resetServerEconomy };
