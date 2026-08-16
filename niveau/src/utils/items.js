const roleConfig = require('../config/role.config.json');

const { valentin } = roleConfig.specialRoles;

const ITEMS = {
    // --- BOOSTS PERMANENTS (non inclus dans la rotation) ---
    'xp_boost': { id: 'xp_boost', name: '⚡ Boost XP (x2 - 1h)', description: 'Double votre gain d\'XP pendant 1 heure.', price: 100000, type: 'boost' },
    'points_boost': { id: 'points_boost', name: '✨ Boost RP (x2 - 1h)', description: 'Double votre gain de points de rang pendant 1 heure.', price: 150000, type: 'boost' },
    'starss_boost': { id: 'starss_boost', name: '💸 Boost Starss (x2 - 1h)', description: 'Double votre gain de Starss pendant 1 heure.', price: 100000, type: 'boost' },
    'counting_boost': { id: 'counting_boost', name: '💯 Boost Points Comptage (x2 - 1h)', description: 'Double vos points gagnés au jeu de comptage pendant 1 heure.', price: 150000, type: 'boost' },

    // --- ITEMS DE ROTATION ---

    // Communs (50,000 Starss)
    'double_daily': { id: 'double_daily', name: 'Double Daily', description: 'Permet de reprendre son daily une deuxième fois.', rarity: 'Commun', price: 50000, type: 'item' },
    'reset_boutique': { id: 'reset_boutique', name: 'Reset boutique', description: 'Permet d\'avoir un reset de la boutique avant l\'heure.', rarity: 'Commun', price: 50000, type: 'item' },

    // Rares (200,000 Starss)
    'micro': { id: 'micro', name: '🎤 Micro', description: 'Donne +15% de points de rang en plus.', rarity: 'Rare', price: 200000, type: 'item' },
    'ecran': { id: 'ecran', name: '🖥️ Écran', description: 'Donne +20% de Starss en plus.', rarity: 'Rare', price: 200000, type: 'item' },
    'coffre_normal': { id: 'coffre_normal', name: 'Coffre au trésor', description: 'Contient des récompenses aléatoires.', rarity: 'Rare', price: 25000, type: 'item' },

    // Épiques (400,000 Starss)
    'couronne': { id: 'couronne', name: '👑 Couronne', description: 'Donne +20% d\'XP de niveau en plus.', rarity: 'Épique', price: 400000, type: 'item' },
    'joker_guilde': { id: 'joker_guilde', name: 'Joker de guilde', description: 'Ajoute une place dans sa guilde sans payer (max 3 utilisations).', rarity: 'Épique', price: 400000, type: 'item' },

    // Légendaires (800,000 Starss)
    'coffre_mega': { id: 'coffre_mega', name: 'Méga coffre aux trésors', description: 'Contient de meilleures récompenses.', rarity: 'Légendaire', price: 150000, type: 'item' },
    'streak_keeper': { id: 'streak_keeper', name: 'Streak Keeper', description: 'Récupère une streak perdue (valable 48h).', rarity: 'Légendaire', price: 800000, type: 'item' },

    // Mythiques (1,500,000 Starss)
    'coffre_legendaire': { id: 'coffre_legendaire', name: 'Coffre aux trésors légendaire', description: 'Contient des récompenses exceptionnelles.', rarity: 'Mythique', price: 750000, type: 'item' },
    'remboursement': { id: 'remboursement', name: 'Remboursement', description: 'Rembourse entièrement une dette.', rarity: 'Mythique', price: 1500000, type: 'item' },
    'guild_upgrader': { id: 'guild_upgrader', name: 'Guild upgrader', description: 'Monte une amélioration de guilde sans payer les starss.', rarity: 'Mythique', price: 1500000, type: 'item' },

    // Goatesques (3,000,000 Starss)
    'mega_boost': { id: 'mega_boost', name: 'MEGA BOOST', description: 'Convertible en 2M starss, 25k XP, ou 1 coffre légendaire.', rarity: 'Goatesque', price: 3000000, type: 'item' },
    'coup_detat': { id: 'coup_detat', name: 'Coup d\'état', description: 'Force une attaque sur une guilde sans consentement.', rarity: 'Goatesque', price: 3000000, type: 'item' },

    // --- SAINT-VALENTIN ---
    'bague_mariage': { id: 'bague_mariage', name: '💍 Bague de Mariage', description: 'Boost 10% RP/XP/Starss. Passe à 30% si votre partenaire en a une aussi.', rarity: 'Mythique', price: 15000, type: 'valentin' },
    'ami_chiant': { id: 'ami_chiant', name: '😠 Petit(e) ami(e) chiant(e)', description: 'Boost 20% XP/Starss si 100 msg/jour. Sinon, -20% de pénalité.', rarity: 'Légendaire', price: 10000, type: 'valentin' },
    'coeur_rouge': { id: 'coeur_rouge', name: '❤️ Cœur rouge', description: `Item aléatoire : Rôle ${valentin.celib.name} (99%) ou Rôle ${valentin.couple.name} (1%).`, rarity: 'Commun', price: 777, type: 'valentin' },

    // --- EASTER EGG ---
    'couscous': { id: 'couscous', name: '🥘 Couscous', description: 'Un délicieux couscous... mais il ne fait rien.', rarity: 'Commun', price: 0, type: 'easter_egg', hidden: true },
};

const SHOP_CONFIG = {
    rarityProbabilities: {
        'Commun': 0.50,
        'Rare': 0.25,
        'Épique': 0.15,
        'Légendaire': 0.06,
        'Mythique': 0.03,
        'Goatesque': 0.01,
    },
    prices: {
        'Commun': 50000,
        'Rare': 200000,
        'Épique': 400000,
        'Légendaire': 800000,
        'Mythique': 1500000,
        'Goatesque': 3000000,
    }
};

function getItem(itemId) {
    if (ITEMS[itemId]) return ITEMS[itemId];
    try {
        const { getRebornCatalogItem } = require('./reborn-integration');
        return getRebornCatalogItem(itemId) || undefined;
    } catch {
        return undefined;
    }
}

function getAllItems() {
    const out = { ...ITEMS };
    try {
        const { getRebornCatalogItems } = require('./reborn-integration');
        for (const it of getRebornCatalogItems()) {
            if (!out[it.id]) out[it.id] = it;
        }
    } catch {
        /* reborn off */
    }
    return out;
}

function getRarityValue(rarity) {
    return SHOP_CONFIG.prices[rarity] || 0;
}

const PASSIVE_ITEMS = ['micro', 'ecran', 'couronne'];

module.exports = {
    getItem,
    getAllItems,
    getRarityValue,
    SHOP_CONFIG,
    ITEMS,
    PASSIVE_ITEMS
};