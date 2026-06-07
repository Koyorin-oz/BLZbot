/**
 * Module de gestion des tickets
 */
const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(__dirname, '../../ticketsData.json');

let ticketsData = { lastTicketId: 0, mapping: {}, cooldowns: {} };

// Charger les données existantes
function loadData() {
    try {
        if (fs.existsSync(DATA_FILE)) {
            ticketsData = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
            // S'assurer que cooldowns existe
            if (!ticketsData.cooldowns) ticketsData.cooldowns = {};
        }
    } catch (error) {
        console.error('[Tickets] Erreur chargement données:', error);
        ticketsData = { lastTicketId: 0, mapping: {}, cooldowns: {} };
    }
}

// Sauvegarder les données
function saveData() {
    try {
        fs.writeFileSync(DATA_FILE, JSON.stringify(ticketsData, null, 2));
    } catch (error) {
        console.error('[Tickets] Erreur sauvegarde données:', error);
    }
}

// Charger au démarrage
loadData();

/**
 * Vérifie si un utilisateur peut créer un ticket (cooldown + limite)
 * @param {string} userId - ID de l'utilisateur
 * @param {object} config - Configuration des tickets
 * @returns {{ canCreate: boolean, reason?: string }}
 */
function canCreateTicket(userId, config) {
    // Vérifier le cooldown
    const lastCreation = ticketsData.cooldowns[userId];
    if (lastCreation) {
        const timeSince = Date.now() - lastCreation;
        if (timeSince < config.COOLDOWN_MS) {
            const remaining = Math.ceil((config.COOLDOWN_MS - timeSince) / 60000);
            return {
                canCreate: false,
                reason: `Tu dois attendre encore ${remaining} minute(s) avant de créer un nouveau ticket.`
            };
        }
    }

    // Vérifier le nombre de tickets ouverts
    const openTickets = Object.values(ticketsData.mapping).filter(
        t => t.owner === userId && t.status === 'open'
    );

    if (openTickets.length >= config.MAX_OPEN_TICKETS) {
        return {
            canCreate: false,
            reason: `Tu as déjà ${openTickets.length} ticket(s) ouvert(s). Ferme-les avant d'en créer un nouveau.`
        };
    }

    return { canCreate: true };
}

/**
 * Crée un nouveau ticket
 * @param {string} userId - ID de l'utilisateur
 * @param {string} channelId - ID du salon créé
 * @returns {string} - ID du ticket
 */
/**
 * @param {string} userId
 * @param {string} channelId - Salon « principal » du ticket (en mode pont : serveur main / staff)
 * @param {{ supportChannelId?: string|null }} [opts] - Si défini : ticket pont support ↔ main
 */
function createTicket(userId, channelId, opts = {}) {
    ticketsData.lastTicketId++;
    const ticketId = ticketsData.lastTicketId.toString().padStart(4, '0');

    const entry = {
        channelId,
        owner: userId,
        status: 'open',
        createdAt: new Date().toISOString(),
        addedUsers: [],
    };
    if (opts.supportChannelId) {
        entry.supportChannelId = opts.supportChannelId;
        entry.bridge = true;
    }
    if (opts.ticketType) {
        entry.ticketType = opts.ticketType;
    }

    ticketsData.mapping[ticketId] = entry;

    ticketsData.cooldowns[userId] = Date.now();
    saveData();

    return ticketId;
}

/**
 * Met à jour le statut d'un ticket
 * @param {string} ticketId - ID du ticket
 * @param {string} status - Nouveau statut
 */
function updateTicketStatus(ticketId, status) {
    if (ticketsData.mapping[ticketId]) {
        ticketsData.mapping[ticketId].status = status;
        if (status === 'closed') {
            ticketsData.mapping[ticketId].closedAt = new Date().toISOString();
        }
        saveData();
    }
}

/**
 * Récupère un ticket par son ID
 * @param {string} ticketId - ID du ticket
 * @returns {object|null}
 */
function getTicket(ticketId) {
    return ticketsData.mapping[ticketId] || null;
}

/**
 * Récupère l'ID d'un ticket depuis le topic du salon
 * @param {object} channel - Le salon Discord
 * @returns {string|null}
 */
function getTicketIdFromChannel(channel) {
    const match = channel.topic?.match(/TICKET_ID:(\d+)/);
    return match ? match[1] : null;
}

/**
 * Vérifie si un salon est un ticket
 * @param {object} channel - Le salon Discord
 * @returns {boolean}
 */
function isTicketChannel(channel) {
    return channel.topic && channel.topic.includes('TICKET_ID:');
}

/**
 * Trouve un ticket ouvert dont le salon principal OU le salon miroir support correspond à channelId.
 * @param {string} channelId
 * @returns {{ ticketId: string } & object|null}
 */
function findOpenBridgedTicketByChannelId(channelId) {
    if (!channelId) return null;
    for (const [ticketId, t] of Object.entries(ticketsData.mapping)) {
        if (!t || t.status !== 'open' || !t.bridge) continue;
        if (String(t.channelId) === String(channelId) || String(t.supportChannelId) === String(channelId)) {
            return { ticketId, ...t };
        }
    }
    return null;
}

/**
 * Ajoute un utilisateur à un ticket
 * @param {string} ticketId - ID du ticket
 * @param {string} userId - ID de l'utilisateur
 */
function addUserToTicket(ticketId, userId) {
    if (ticketsData.mapping[ticketId]) {
        if (!ticketsData.mapping[ticketId].addedUsers.includes(userId)) {
            ticketsData.mapping[ticketId].addedUsers.push(userId);
            saveData();
        }
    }
}

/**
 * Retire un utilisateur d'un ticket
 * @param {string} ticketId - ID du ticket
 * @param {string} userId - ID de l'utilisateur
 */
function removeUserFromTicket(ticketId, userId) {
    if (ticketsData.mapping[ticketId]) {
        ticketsData.mapping[ticketId].addedUsers =
            ticketsData.mapping[ticketId].addedUsers.filter(id => id !== userId);
        saveData();
    }
}

/**
 * Marque un ticket comme supprimé
 * @param {string} ticketId - ID du ticket
 */
function deleteTicket(ticketId) {
    if (ticketsData.mapping[ticketId]) {
        ticketsData.mapping[ticketId].status = 'deleted';
        ticketsData.mapping[ticketId].deletedAt = new Date().toISOString();
        saveData();
    }
}

/**
 * Récupère les statistiques des tickets
 * @returns {object}
 */
function getStats() {
    const tickets = Object.values(ticketsData.mapping);
    return {
        total: tickets.length,
        open: tickets.filter(t => t.status === 'open').length,
        closed: tickets.filter(t => t.status === 'closed').length,
        deleted: tickets.filter(t => t.status === 'deleted').length
    };
}

module.exports = {
    canCreateTicket,
    createTicket,
    updateTicketStatus,
    getTicket,
    getTicketIdFromChannel,
    isTicketChannel,
    findOpenBridgedTicketByChannelId,
    addUserToTicket,
    removeUserFromTicket,
    deleteTicket,
    getStats,
    loadData,
    saveData
};
