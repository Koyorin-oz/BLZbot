const db = require('../../database/database');
const logger = require('../logger');

/**
 * Ancienne fonction pour compatibilité
 */
function generateGuildTreasuries() {
    applyDailyIncome(null);
}

/**
 * Ajoute des starss à la trésorerie
 */
function addToTreasury(guildId, amount, bypassWarCheck = false) {
    // Bloquer les ajouts pendant les guerres de guilde (sauf revenus passifs)
    if (!bypassWarCheck) {
        const { isGuildInWar } = require('../db-guilds');
        if (isGuildInWar(guildId)) {
            throw new Error('⚔️ Impossible de modifier la trésorerie pendant une guerre de guilde !');
        }
    }

    const guild = db.prepare('SELECT treasury, treasury_capacity FROM guilds WHERE id = ?').get(guildId);

    if (!guild.treasury_capacity || guild.treasury_capacity === 0) {
        throw new Error('Trésorerie non débloquée (nécessite Upgrade 2+)');
    }

    const newAmount = guild.treasury + amount;
    if (newAmount > guild.treasury_capacity) {
        throw new Error(`Capacité de trésorerie dépassée (max: ${guild.treasury_capacity.toLocaleString('fr-FR')} starss)`);
    }

    db.prepare('UPDATE guilds SET treasury = ?, total_treasury_generated = total_treasury_generated + ? WHERE id = ?')
        .run(newAmount, amount, guildId);

    logger.info(`${amount} starss ajoutés à la trésorerie de la guilde ${guildId}`);
    return newAmount;
}

/**
 * Retire des starss de la trésorerie
 */
function removeFromTreasury(guildId, amount) {
    // Bloquer les retraits pendant les guerres de guilde
    const { isGuildInWar } = require('../db-guilds');
    if (isGuildInWar(guildId)) {
        throw new Error('⚔️ Impossible de modifier la trésorerie pendant une guerre de guilde !');
    }

    const guild = db.prepare('SELECT treasury FROM guilds WHERE id = ?').get(guildId);

    if (guild.treasury < amount) {
        throw new Error('Fonds insuffisants dans la trésorerie');
    }

    const newAmount = guild.treasury - amount;
    db.prepare('UPDATE guilds SET treasury = ? WHERE id = ?').run(newAmount, guildId);

    logger.info(`${amount} starss retirés de la trésorerie de la guilde ${guildId}`);
    return newAmount;
}

/**
 * Distribue équitablement la trésorerie aux membres
 */
function distributeTreasuryEqually(client, guildId) {
    // Bloquer la distribution pendant les guerres de guilde
    const { isGuildInWar } = require('../db-guilds');
    if (isGuildInWar(guildId)) {
        throw new Error('⚔️ Impossible de distribuer la trésorerie pendant une guerre de guilde !');
    }

    const { grantResources } = require('../db-users');

    const guild = db.prepare('SELECT treasury FROM guilds WHERE id = ?').get(guildId);
    const members = db.prepare('SELECT user_id FROM guild_members WHERE guild_id = ?').all(guildId);

    if (members.length === 0) {
        throw new Error('Aucun membre dans la guilde');
    }

    const amountPerMember = Math.floor(guild.treasury / members.length);

    if (amountPerMember === 0) {
        throw new Error('Trésorerie vide ou montant insuffisant');
    }

    // Distribuer aux membres
    for (const member of members) {
        grantResources(client, member.user_id, { stars: amountPerMember, source: 'guild_treasury' });
    }

    // Vider la trésorerie
    db.prepare('UPDATE guilds SET treasury = 0 WHERE id = ?').run(guildId);

    logger.info(`Trésorerie distribuée: ${amountPerMember} starss à ${members.length} membres de la guilde ${guildId}`);
    return { amountPerMember, memberCount: members.length, totalDistributed: amountPerMember * members.length };
}

/**
 * Calcule le revenu passif quotidien
 */
function calculateDailyIncome(guild) {
    const baseIncome = guild.level * 100;

    // Multiplicateurs basés sur les achats
    let multiplier = 1;
    if (guild.treasury_multiplier_purchased >= 2) multiplier = 100;
    if (guild.treasury_multiplier_purchased >= 3) multiplier = 200;
    if (guild.treasury_multiplier_purchased >= 4) multiplier = 400;
    if (guild.treasury_multiplier_purchased >= 5) multiplier = 800;

    return baseIncome * multiplier;
}

function getParisDateString(date = new Date()) {
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Europe/Paris',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).format(date);
}

function parseDateString(dateString) {
    const [year, month, day] = String(dateString).split('-').map((part) => parseInt(part, 10));
    return new Date(Date.UTC(year, month - 1, day));
}

function getBotSetting(key) {
    const row = db.prepare('SELECT value FROM bot_settings WHERE key = ?').get(key);
    return row ? row.value : null;
}

function setBotSetting(key, value) {
    db.prepare('INSERT OR REPLACE INTO bot_settings (key, value) VALUES (?, ?)').run(key, String(value));
}

function getLastTreasuryDailyIncomeDate() {
    return getBotSetting('treasury_daily_income_last_applied_date');
}

function setLastTreasuryDailyIncomeDate(dateString) {
    setBotSetting('treasury_daily_income_last_applied_date', dateString);
}

function getDaysBetweenParisDates(fromDateString, toDateString) {
    const from = parseDateString(fromDateString);
    const to = parseDateString(toDateString);
    const diffMs = to.getTime() - from.getTime();
    return Math.max(0, Math.floor(diffMs / 86400000));
}

/**
 * Applique le revenu passif quotidien à toutes les guildes
 */
function applyDailyIncome({ log = true } = {}) {
    const guilds = db.prepare('SELECT * FROM guilds WHERE upgrade_level >= 2').all();

    let totalApplied = 0;
    let totalStarss = 0;

    for (const guild of guilds) {
        const income = calculateDailyIncome(guild);

        try {
            // Calculer combien on peut ajouter sans dépasser la capacité
            const remainingCapacity = guild.treasury_capacity - guild.treasury;

            if (remainingCapacity <= 0) {
                if (log) {
                    logger.info(`Trésorerie de ${guild.name} pleine (${guild.treasury}/${guild.treasury_capacity}), revenu passif non appliqué`);
                }
            } else {
                // Ajouter le minimum entre le revenu et la place restante
                const amountToAdd = Math.min(income, remainingCapacity);
                addToTreasury(guild.id, amountToAdd, true); // bypassWarCheck = true pour le revenu passif
                totalApplied += 1;
                totalStarss += amountToAdd;

                if (log) {
                    if (amountToAdd < income) {
                        logger.info(`Revenu passif partiel appliqué: ${amountToAdd}/${income} starss pour ${guild.name} (capacité maximale atteinte)`);
                    } else {
                        logger.info(`Revenu passif appliqué: ${income} starss pour ${guild.name}`);
                    }
                }
            }
        } catch (error) {
            logger.error(`Erreur lors de l'application du revenu passif pour ${guild.name}:`, error);
        }
    }

    if (log) {
        logger.info(`Revenu passif appliqué à ${totalApplied} guildes (${totalStarss.toLocaleString('fr-FR')} starss au total)`);
    }

    return { totalApplied, totalStarss };
}

function catchUpDailyIncome() {
    const todayParis = getParisDateString();
    const lastAppliedDate = getLastTreasuryDailyIncomeDate();

    if (!lastAppliedDate) {
        setLastTreasuryDailyIncomeDate(todayParis);
        logger.info(`✅ Suivi du revenu de trésorerie initialisé à ${todayParis} (premier démarrage).`);
        return;
    }

    const missingDays = getDaysBetweenParisDates(lastAppliedDate, todayParis);
    if (missingDays <= 0) {
        logger.info(`✅ Revenu de trésorerie déjà appliqué pour aujourd'hui (${todayParis}).`);
        return;
    }

    logger.info(`⏳ Revenu de trésorerie manquant détecté : ${missingDays} jour(s) à rattraper (de ${lastAppliedDate} à ${todayParis}).`);

    for (let daysToCatchUp = 1; daysToCatchUp <= missingDays; daysToCatchUp += 1) {
        const targetDate = new Date(parseDateString(lastAppliedDate).getTime() + 86400000 * daysToCatchUp);
        const targetDateString = getParisDateString(targetDate);
        logger.info(`🏰 Application du revenu de trésorerie manqué pour le ${targetDateString}...`);
        applyDailyIncome({ log: true });
        setLastTreasuryDailyIncomeDate(targetDateString);
    }
}

function markDailyIncomeAppliedToday() {
    setLastTreasuryDailyIncomeDate(getParisDateString());
}

/**
 * Vérifie si une guilde peut se permettre un certain montant
 */
function canAffordFromTreasury(guildId, amount) {
    const guild = db.prepare('SELECT treasury FROM guilds WHERE id = ?').get(guildId);
    return guild && guild.treasury >= amount;
}

module.exports = {
    generateGuildTreasuries, // Pour compatibilité
    addToTreasury,
    removeFromTreasury,
    distributeTreasuryEqually,
    calculateDailyIncome,
    applyDailyIncome,
    catchUpDailyIncome,
    markDailyIncomeAppliedToday,
    canAffordFromTreasury
};
