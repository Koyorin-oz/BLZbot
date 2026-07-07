const db = require('../database/database');
const { grantResources } = require('./db-users');
const logger = require('./logger');

/**
 * Solde de starss "réel" d'un joueur : celui de l'économie REBORN (boutique,
 * daily, /profil). Fallback sur la valeur niveau si REBORN est inactif.
 * @param {string} userId
 * @param {string} [username]
 * @returns {number}
 */
function getEffectiveStars(userId, username) {
    try {
        const { getRebornStars } = require('./reborn-integration');
        const rb = getRebornStars(userId);
        if (rb !== null && rb !== undefined) return rb;
    } catch { /* fallback niveau */ }
    try {
        const { getOrCreateUser } = require('./db-users');
        return getOrCreateUser(userId, username || 'unknown').stars || 0;
    } catch {
        return 0;
    }
}

/**
 * Déplace des starss dans le bon portefeuille (REBORN si actif, sinon niveau).
 * Retourne true si l'opération a touché le portefeuille REBORN (dans ce cas les
 * valeurs de guerre niveau ne doivent PAS être ajustées, car le solde niveau
 * n'a pas bougé).
 * @param {string} userId
 * @param {number} delta
 * @param {string} [username]
 * @returns {boolean} reborn utilisé ?
 */
function moveLoanStars(userId, delta, username) {
    try {
        const { addRebornStars } = require('./reborn-integration');
        const res = addRebornStars(userId, delta, username);
        if (res !== null && res !== undefined) return true;
    } catch { /* fallback niveau */ }
    try {
        const { updateUserBalance } = require('./db-users');
        updateUserBalance(userId, { stars: delta });
    } catch (e) {
        logger.error('moveLoanStars fallback niveau échec:', e?.message || e);
    }
    return false;
}

/**
 * Calcule la dette totale d'un utilisateur (incluant les intérêts).
 * @param {string} userId - L'ID de l'utilisateur emprunteur.
 * @returns {number} La dette totale accumulée.
 */
function getTotalDebt(userId) {
    const query = db.prepare('SELECT amount, interest, repaid_amount FROM loans WHERE borrowerId = ? AND accepted = 1 AND repaid = 0');
    const loans = query.all(userId);

    return loans.reduce((total, loan) => {
        const amountWithInterest = Math.round(loan.amount * (1.0 + (loan.interest || 0) / 100.0));
        return total + (amountWithInterest - (loan.repaid_amount || 0));
    }, 0);
}

/**
 * Récupère l'échéance la plus proche pour les dettes d'un utilisateur.
 * @param {string} userId - L'ID de l'utilisateur.
 * @returns {string|null} Un texte formaté du temps restant ou null si pas de dette.
 */
function getClosestDebtDeadline(userId) {
    const query = db.prepare('SELECT MIN(expiresAt) as closest FROM loans WHERE borrowerId = ? AND accepted = 1 AND repaid = 0');
    const result = query.get(userId);

    if (!result || !result.closest) return null;

    const expiresAt = new Date(result.closest);
    const now = new Date();
    const diff = expiresAt - now;

    if (diff <= 0) return '⚠️ Échéance dépassée !';

    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

    if (days > 0) return `Temps restant: ${days}j ${hours}h`;
    return `Temps restant: ${hours}h ${minutes}m`;
}

/**
 * Vérifie et traite les prêts arrivés à échéance.
 */
async function checkOverdueLoans(client) {
    const getOverdueLoansStmt = db.prepare('SELECT * FROM loans WHERE accepted = 1 AND repaid = 0 AND expiresAt < ?');
    const overdueLoans = getOverdueLoansStmt.all(new Date().toISOString());

    for (const loan of overdueLoans) {
        logger.info(`Processing overdue loan: ${loan.id}`);

        // Calcul de la pénalité : (montant + intérêts) X2
        const totalWithInterest = Math.round(loan.amount * (1.0 + (loan.interest || 0) / 100.0));
        const penaltyAmount = totalWithInterest * 2; // X2 en cas de retard

        // Appliquer la pénalité (l'emprunteur paie, le prêteur reçoit)
        grantResources(client, loan.borrowerId, { stars: -penaltyAmount, source: 'loan' });
        grantResources(client, loan.lenderId, { stars: penaltyAmount, source: 'loan' });

        const updateLoanStmt = db.prepare('UPDATE loans SET repaid = 1, repaid_amount = ? WHERE id = ?');
        updateLoanStmt.run(penaltyAmount, loan.id);

        const { getOrCreateUser } = require('./db-users');

        try {
            const borrower = await client.users.fetch(loan.borrowerId);
            const borrowerData = getOrCreateUser(loan.borrowerId, borrower.username);

            if (borrowerData.notify_debt_reminder !== 0) {
                await borrower.send(`⚠️ Vous n'avez pas remboursé votre prêt à temps ! Vous avez été pénalisé de **${penaltyAmount.toLocaleString('fr-FR')}** starss (X2). Dette initiale : ${totalWithInterest.toLocaleString('fr-FR')} starss.`);
            }
        } catch (err) {
            logger.error(`Failed to send overdue message to borrower ${loan.borrowerId}`, err);
        }

        try {
            const lender = await client.users.fetch(loan.lenderId);
            await lender.send(`✅ L'emprunteur n'a pas remboursé votre prêt à temps. Vous avez reçu **${penaltyAmount.toLocaleString('fr-FR')}** starss en dédommagement (X2) !`);
        } catch (err) {
            logger.error(`Failed to send overdue message to lender ${loan.lenderId}`, err);
        }
    }
}

module.exports = { 
    checkOverdueLoans,
    getTotalDebt,
    getClosestDebtDeadline
};
