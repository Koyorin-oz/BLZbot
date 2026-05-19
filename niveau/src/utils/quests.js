const dbQuests = require('./db-quests');
const logger = require('./logger');
const { grantEventCurrency } = require('./db-halloween'); // Ajout pour les récompenses en bonbons
const roleConfig = require('../config/role.config.json');

require('dotenv').config(); // Pour accéder à process.env.GUILD_ID et QUEST_CHANNEL

const getMainRank = (name) => roleConfig.rankRoles.mainRanks.find(rank => rank === name) || name;
const HALLOWEEN_BONBON_LEGENDAIRE = roleConfig.eventRoles.halloween.bonbonRewards.bonbonLegendaire.name;
const TOP_ROLES = roleConfig.topRoles;
const QUEST_REWARD_ROLES = roleConfig.questRewardRoles;

const QUESTS = {
    // --- Quêtes d'Halloween ---
    HALLOWEEN_OPEN_CANDIES: {
        id: 'HALLOWEEN_OPEN_CANDIES',
        name: 'Collectionneur de bonbons',
        description: 'Ouvrir 10 bonbons surprises.',
        rarity: 'Halloween',
        trigger: 'HALLOWEEN_CANDY_OPEN',
        goal: 10,
        reward: { bonbons: 30000 },
    },
    HALLOWEEN_HAVE_PUMPKINS: {
        id: 'HALLOWEEN_HAVE_PUMPKINS',
        name: 'Le Grand Citrouillard',
        description: 'Posséder 27,859 citrouilles.',
        rarity: 'Halloween',
        trigger: 'HALLOWEEN_PUMPKIN_CHECK',
        goal: 27859,
        reward: { bonbons: 100000 },
    },
    HALLOWEEN_REPLY_LEGEND: {
        id: 'HALLOWEEN_REPLY_LEGEND',
        name: 'Chasseur de Légende',
        description: `Répondre à un message de quelqu'un avec le rôle '${HALLOWEEN_BONBON_LEGENDAIRE}'.`,
        rarity: 'Halloween',
        trigger: 'REPLY_TO_ROLE_NAME',
        goal: HALLOWEEN_BONBON_LEGENDAIRE,
        reward: { bonbons: 111111 },
    },
    // --- Quêtes Communes ---
    MSG_50: {
        id: 'MSG_50',
        name: 'Piplette I',
        description: 'Envoyer 50 messages.',
        rarity: 'Commune',
        trigger: 'MESSAGE_SEND',
        goal: 50,
        reward: { stars: 20000 },
    },
    VOICE_20M: {
        id: 'VOICE_20M',
        name: 'Bon Auditeur',
        description: "Rester 20 minutes d'affilée en vocal.",
        rarity: 'Commune',
        trigger: 'VOICE_MINUTE',
        goal: 20,
        reward: { stars: 20000 },
    },
    REPLY_GOLD: {
        id: 'REPLY_GOLD',
        name: 'Social',
        description: "Répondre à un message d'un membre de rang Or ou plus.",
        rarity: 'Commune',
        trigger: 'REPLY_TO_RANK',
        goal: getMainRank('Or'),
        reward: { stars: 20000 },
    },
    RANK_BRONZE: {
        id: 'RANK_BRONZE',
        name: 'Passer Bronze',
        description: 'Passer le rang Bronze.',
        rarity: 'Commune',
        trigger: 'RANK_UP',
        goal: getMainRank('Bronze'),
        reward: { stars: 50000 },
    },
    DAILY_3: {
        id: 'DAILY_3',
        name: 'Routinier',
        description: 'Avoir récupéré 3 fois son /daily.',
        rarity: 'Commune',
        trigger: 'DAILY_CLAIM',
        goal: 3,
        reward: { stars: 10000 },
    },
    SAY_HI: {
        id: 'SAY_HI',
        name: 'Salutations',
        description: "Dire 'Salut' sur le serveur.",
        rarity: 'Commune',
        trigger: 'MESSAGE_CONTENT',
        goal: 'salut',
        reward: { stars: 10000 },
    },
    REACTION_5: {
        id: 'REACTION_5',
        name: 'Expressif',
        description: 'Envoyer 5 réactions.',
        rarity: 'Commune',
        trigger: 'REACTION_ADD',
        goal: 5,
        reward: { stars: 10000 },
    },
    LEVEL_5: {
        id: 'LEVEL_5',
        name: 'Débutant',
        description: 'Atteindre le niveau 5.',
        rarity: 'Commune',
        trigger: 'LEVEL_REACH',
        goal: 5,
        reward: { stars: 20000 },
    },
    IMAGE_1: {
        id: 'IMAGE_1',
        name: 'Photographe Amateur',
        description: 'Envoyer une image.',
        rarity: 'Commune',
        trigger: 'MESSAGE_ATTACHMENT',
        goal: 1,
        reward: { stars: 10000 },
    },
    PRIVATE_CHAT_BLZBOT: {
        id: 'PRIVATE_CHAT_BLZBOT',
        name: 'Confidences à BLZbot',
        description: 'Envoyer un message dans le fil de discussion privé avec BLZbot.',
        rarity: 'Commune',
        trigger: 'PRIVATE_THREAD_MESSAGE',
        goal: '1414668466413375629',
        reward: { stars: 10000 },
    },

    // --- Quêtes Rares ---
    MSG_200: {
        id: 'MSG_200',
        name: 'Piplette II',
        description: 'Envoyer 200 messages.',
        rarity: 'Rare',
        trigger: 'MESSAGE_SEND',
        goal: 200,
        reward: { stars: 50000 },
    },
    VOICE_60M: {
        id: 'VOICE_60M',
        name: 'Accro au Micro',
        description: "Rester 1 heure d'affilée en vocal.",
        rarity: 'Rare',
        trigger: 'VOICE_MINUTE',
        goal: 60,
        reward: { stars: 60000 },
    },
    REPLY_MASTER: {
        id: 'REPLY_MASTER',
        name: 'Élève de Fer',
        description: "Répondre à un message d'un membre de rang Fer ou plus.",
        rarity: 'Rare',
        trigger: 'REPLY_TO_RANK',
        goal: getMainRank('Fer'),
        reward: { stars: 25000 },
    },
    RANK_GOLD: {
        id: 'RANK_GOLD',
        name: 'Passer Fer',
        description: 'Passer le rang Fer.',
        rarity: 'Rare',
        trigger: 'RANK_UP',
        goal: getMainRank('Fer'),
        reward: { stars: 100000 },
    },
    RANK_GOLD2: {
        id: 'RANK_GOLD2',
        name: 'Passer Or',
        description: 'Passer le rang Or.',
        rarity: 'Rare',
        trigger: 'RANK_UP',
        goal: getMainRank('Or'),
        reward: { stars: 250000 },
    },
    GUILD_JOIN: {
        id: 'GUILD_JOIN',
        name: 'En Groupe',
        description: 'Rejoindre une Guilde.',
        rarity: 'Rare',
        trigger: 'GUILD_ACTION',
        goal: 'join',
        reward: { stars: 30000 },
    },
    GUILD_SLOT: {
        id: 'GUILD_SLOT',
        name: 'Recruteur',
        description: 'Ajouter une place dans sa guilde.',
        rarity: 'Rare',
        trigger: 'GUILD_ACTION',
        goal: 'buy_slot',
        reward: { stars: 100000 },
    },
    DAILY_7: {
        id: 'DAILY_7',
        name: 'Habitué',
        description: 'Avoir récupéré 7 fois son /daily.',
        rarity: 'Rare',
        trigger: 'DAILY_CLAIM',
        goal: 7,
        reward: { stars: 30000 },
    },
    REACTION_30: {
        id: 'REACTION_30',
        name: 'Super Expressif',
        description: 'Envoyer 30 réactions.',
        rarity: 'Rare',
        trigger: 'REACTION_ADD',
        goal: 30,
        reward: { stars: 60000 },
    },
    LEVEL_15: {
        id: 'LEVEL_15',
        name: 'Apprenti',
        description: 'Atteindre le niveau 15.',
        rarity: 'Rare',
        trigger: 'LEVEL_REACH',
        goal: 15,
        reward: { stars: 100000 },
    },
    IMAGE_10: {
        id: 'IMAGE_10',
        name: 'Bon Photographe',
        description: 'Envoyer 10 images.',
        rarity: 'Rare',
        trigger: 'MESSAGE_ATTACHMENT',
        goal: 10,
        reward: { stars: 70000 },
    },

    // --- Quêtes Épiques ---
    MSG_1000: {
        id: 'MSG_1000',
        name: 'Piplette III',
        description: 'Envoyer 1000 messages.',
        rarity: 'Épique',
        trigger: 'MESSAGE_SEND',
        goal: 1000,
        reward: { stars: 300000 },
    },
    VOICE_180M: {
        id: 'VOICE_180M',
        name: 'Pilier de Vocal',
        description: "Rester 3 heures d'affilée en vocal.",
        rarity: 'Épique',
        trigger: 'VOICE_MINUTE',
        goal: 180,
        reward: { stars: 200000 },
    },
    REPLY_GOAT: {
        id: 'REPLY_GOAT',
        name: 'Disciple du GOAT',
        description: "Répondre à un message d'un membre de rang GOAT.",
        rarity: 'Épique',
        trigger: 'REPLY_TO_RANK',
        goal: getMainRank('GOAT'),
        reward: { stars: 75000 },
    },
    GUILD_CREATE: {
        id: 'GUILD_CREATE',
        name: 'Fondateur',
        description: 'Créer une Guilde.',
        rarity: 'Épique',
        trigger: 'GUILD_ACTION',
        goal: 'create',
        reward: { role: QUEST_REWARD_ROLES.guildCreator },
    },
    RANK_DIAMOND: {
        id: 'RANK_DIAMOND',
        name: 'Passer Diamant',
        description: 'Passer le rang Diamant.',
        rarity: 'Épique',
        trigger: 'RANK_UP',
        goal: getMainRank('Diamant'),
        reward: { stars: 500000 },
    },
    RANK_EMERAUDE: {
        id: 'RANK_EMERAUDE',
        name: 'Passer Émeraude',
        description: 'Passer le rang Émeraude.',
        rarity: 'Épique',
        trigger: 'RANK_UP',
        goal: getMainRank('Émeraude'),
        reward: { stars: 800000 },
    },
    DAILY_30: {
        id: 'DAILY_30',
        name: 'Pilier du Serveur',
        description: 'Avoir récupéré 30 fois son /daily.',
        rarity: 'Épique',
        trigger: 'DAILY_CLAIM',
        goal: 30,
        reward: { stars: 150000 },
    },
    REACTION_100: {
        id: 'REACTION_100',
        name: 'Célébrité Locale',
        description: 'Envoyer 100 réactions.',
        rarity: 'Épique',
        trigger: 'REACTION_ADD',
        goal: 100,
        reward: { stars: 150000 },
    },
    LEVEL_30: {
        id: 'LEVEL_30',
        name: 'Confirmé',
        description: 'Atteindre le niveau 30.',
        rarity: 'Épique',
        trigger: 'LEVEL_REACH',
        goal: 30,
        reward: { stars: 250000 },
    },
    IMAGE_50: {
        id: 'IMAGE_50',
        name: 'Paparazzi',
        description: 'Envoyer 50 images.',
        rarity: 'Épique',
        trigger: 'MESSAGE_ATTACHMENT',
        goal: 50,
        reward: { stars: 150000 },
    },

    // --- Quêtes Légendaires ---
    MSG_5000: {
        id: 'MSG_5000',
        name: 'Moulin à Paroles',
        description: 'Envoyer 5000 messages.',
        rarity: 'Légendaire',
        trigger: 'MESSAGE_SEND',
        goal: 5000,
        reward: { stars: 1000000 },
    },
    VOICE_480M: {
        id: 'VOICE_480M',
        name: 'Voix de la Communauté',
        description: "Rester 8 heures d'affilée en vocal.",
        rarity: 'Légendaire',
        trigger: 'VOICE_MINUTE',
        goal: 480,
        reward: { stars: 800000 },
    },
    RANK_MASTER: {
        id: 'RANK_MASTER',
        name: 'Passer Rubis',
        description: 'Passer le rang Rubis.',
        rarity: 'Légendaire',
        trigger: 'RANK_UP',
        goal: getMainRank('Rubis'),
        reward: { stars: 1500000 },
    },
    RANK_LEGENDAIRE: {
        id: 'RANK_LEGENDAIRE',
        name: 'Passer Légendaire',
        description: 'Passer le rang Légendaire.',
        rarity: 'Légendaire',
        trigger: 'RANK_UP',
        goal: getMainRank('Légendaire'),
        reward: { stars: 2500000 },
    },
    DAILY_100: {
        id: 'DAILY_100',
        name: 'Infatigable',
        description: 'Avoir récupéré 100 fois son /daily.',
        rarity: 'Légendaire',
        trigger: 'DAILY_CLAIM',
        goal: 100,
        reward: { stars: 500000 },
    },
    REACTION_500: {
        id: 'REACTION_500',
        name: 'Idole des Foules',
        description: 'Envoyer 500 réactions.',
        rarity: 'Légendaire',
        trigger: 'REACTION_ADD',
        goal: 500,
        reward: { stars: 400000 },
    },
    LEVEL_50: {
        id: 'LEVEL_50',
        name: 'Vétéran',
        description: 'Atteindre le niveau 50.',
        rarity: 'Légendaire',
        trigger: 'LEVEL_REACH',
        goal: 50,
        reward: { stars: 600000 },
    },
    IMAGE_200: {
        id: 'IMAGE_200',
        name: 'Archiviste Visuel',
        description: 'Envoyer 200 images.',
        rarity: 'Légendaire',
        trigger: 'MESSAGE_ATTACHMENT',
        goal: 200,
        reward: { stars: 500000 },
    },

    // --- Quêtes Mythiques ---
    MSG_20000: {
        id: 'MSG_20000',
        name: 'Légende Bavarde',
        description: 'Envoyer 20000 messages.',
        rarity: 'Mythique',
        trigger: 'MESSAGE_SEND',
        goal: 20000,
        reward: { stars: 2000000 },
    },
    VOICE_840M: {
        id: 'VOICE_840M',
        name: 'Le Noctambule',
        description: "Rester 16 heures d'affilée en vocal.",
        rarity: 'Mythique',
        trigger: 'VOICE_MINUTE',
        goal: 960,
        reward: { stars: 1500000 },
    },
    RANK_MYTHIQUE: {
        id: 'RANK_MYTHIQUE',
        name: 'Passer Mythique',
        description: 'Passer le rang Mythique.',
        rarity: 'Mythique',
        trigger: 'RANK_UP',
        goal: getMainRank('Mythique'),
        reward: { stars: 5000000 },
    },
    RANK_GOAT: {
        id: 'RANK_GOAT',
        name: 'Passer GOAT',
        description: 'Passer le rang GOAT.',
        rarity: 'Goatesque',
        trigger: 'RANK_UP',
        goal: getMainRank('GOAT'),
        reward: { stars: 10000000 },
        badge: 'badge_goat_rank'
    },
    REACTION_2000: {
        id: 'REACTION_2000',
        name: 'Panthéon des Émojis',
        description: 'Envoyer 2000 réactions.',
        rarity: 'Mythique',
        trigger: 'REACTION_ADD',
        goal: 2000,
        reward: { stars: 1000000 },
    },
    LEVEL_75: {
        id: 'LEVEL_75',
        name: 'Légende Vivante',
        description: 'Atteindre le niveau 75.',
        rarity: 'Mythique',
        trigger: 'LEVEL_REACH',
        goal: 75,
        reward: { stars: 1000000 },
    },
    IMAGE_500: {
        id: 'IMAGE_500',
        name: 'Bibliothèque d\'Alexandrie',
        description: 'Envoyer 500 images.',
        rarity: 'Mythique',
        trigger: 'MESSAGE_ATTACHMENT',
        goal: 500,
        reward: { stars: 1000000 },
    },
    VOICE_1440M: { // Anciennement 24h, maintenant 16h
        id: 'VOICE_1440M',
        name: 'Oiseau de Nuit',
        description: 'Rester 16 heures en vocal.',
        rarity: 'Goatesque',
        trigger: 'VOICE_MINUTE',
        goal: 960,
        reward: { stars: 3000000 },
        badge: 'badge_night_owl'
    },

    // --- Quêtes Goatesques ---
    VOICE_6000M: { // Anciennement 100h, maintenant 24h
        id: 'VOICE_6000M',
        name: 'Marathonien du Vocal',
        description: 'Rester 24 heures en vocal.',
        rarity: 'Goatesque',
        trigger: 'VOICE_MINUTE',
        goal: 1440,
        reward: { stars: 10000000 },
        badge: 'badge_marathon_24h'
    },
    BALANCE_50M: {
        id: 'BALANCE_50M',
        name: 'Magnat de la Finance',
        description: 'Posséder 50,000,000 de Starss.',
        rarity: 'Goatesque',
        trigger: 'BALANCE_REACH',
        goal: 50000000,
        reward: { role: QUEST_REWARD_ROLES.rich },
        badge: 'badge_finance_magnate'
    },
    MSG_100K: {
        id: 'MSG_100K',
        name: 'Divinité de la Parole',
        description: 'Envoyer 100,000 messages.',
        rarity: 'Goatesque',
        trigger: 'MESSAGE_SEND',
        goal: 100000,
        reward: { stars: 15000000, role: QUEST_REWARD_ROLES.ultimateChatter },
        badge: 'badge_speech_divinity'
    },
    LEVEL_100: {
        id: 'LEVEL_100',
        name: 'Centurion',
        description: 'Atteindre le niveau 100.',
        rarity: 'Goatesque',
        trigger: 'LEVEL_REACH',
        goal: 100,
        reward: { stars: 10000000 },
        badge: 'badge_centurion'
    },

    // --- Quêtes Coffres & Trades (Communes) ---
    OPEN_CHEST: {
        id: 'OPEN_CHEST',
        name: 'Ouvrir un coffre au trésor',
        description: 'Ouvrir 1 coffre au trésor.',
        rarity: 'Commune',
        trigger: 'CHEST_OPEN',
        goal: 1,
        reward: { stars: 10000 },
    },
    TRADE_1: {
        id: 'TRADE_1',
        name: 'Faire un trade',
        description: 'Faire 1 trade.',
        rarity: 'Commune',
        trigger: 'TRADE_COMPLETE',
        goal: 1,
        reward: { stars: 20000 },
    },

    // --- Quêtes Coffres & Trades (Rares) ---
    OPEN_MEGA_CHEST_1: {
        id: 'OPEN_MEGA_CHEST_1',
        name: 'Ouvrir 1 Méga Coffre au trésor',
        description: 'Ouvrir 1 Méga Coffre au trésor.',
        rarity: 'Rare',
        trigger: 'MEGA_CHEST_OPEN',
        goal: 1,
        reward: { stars: 30000 },
    },
    MINIGAME_WIN_1: {
        id: 'MINIGAME_WIN_1',
        name: 'Gagner 1 game de mini jeux',
        description: 'Gagner 1 game de mini jeux.',
        rarity: 'Rare',
        trigger: 'MINIGAME_WIN',
        goal: 1,
        reward: { stars: 50000 },
    },
    OPEN_CHEST_5: {
        id: 'OPEN_CHEST_5',
        name: 'Ouvrir 5 coffres au trésor',
        description: 'Ouvrir 5 coffres au trésor.',
        rarity: 'Rare',
        trigger: 'CHEST_OPEN',
        goal: 5,
        reward: { stars: 50000 },
    },
    TRADE_5: {
        id: 'TRADE_5',
        name: 'Faire 5 trades',
        description: 'Faire 5 trades.',
        rarity: 'Rare',
        trigger: 'TRADE_COMPLETE',
        goal: 5,
        reward: { stars: 70000 },
    },
    BATTLE_PASS_10: {
        id: 'BATTLE_PASS_10',
        name: 'Atteindre le Pallier 10 du Pass',
        description: 'Atteindre le pallier 10 du Battle Pass.',
        rarity: 'Rare',
        trigger: 'BATTLE_PASS_LEVEL',
        goal: 10,
        reward: { stars: 100000 },
    },

    // --- Quêtes Coffres & Trades (Épiques) ---
    OPEN_MEGA_CHEST_5: {
        id: 'OPEN_MEGA_CHEST_5',
        name: 'Ouvrir 5 Méga Coffres au trésor',
        description: 'Ouvrir 5 Méga Coffres au trésor.',
        rarity: 'Épique',
        trigger: 'MEGA_CHEST_OPEN',
        goal: 5,
        reward: { stars: 150000 },
    },
    MINIGAME_WIN_10: {
        id: 'MINIGAME_WIN_10',
        name: 'Gagner 10 games de mini jeux',
        description: 'Gagner 10 games de mini jeux.',
        rarity: 'Épique',
        trigger: 'MINIGAME_WIN',
        goal: 10,
        reward: { stars: 200000 },
    },
    LOAN_REPAY: {
        id: 'LOAN_REPAY',
        name: 'Rembourser une dette',
        description: 'Rembourser une dette.',
        rarity: 'Épique',
        trigger: 'LOAN_REPAID',
        goal: 1,
        reward: { stars: 200000 },
    },
    OPEN_CHEST_20: {
        id: 'OPEN_CHEST_20',
        name: 'Ouvrir 20 coffres au trésor',
        description: 'Ouvrir 20 coffres au trésor.',
        rarity: 'Épique',
        trigger: 'CHEST_OPEN',
        goal: 20,
        reward: { stars: 200000 },
    },
    BATTLE_PASS_25: {
        id: 'BATTLE_PASS_25',
        name: 'Atteindre le Pallier 25 du Pass',
        description: 'Atteindre le pallier 25 du Battle Pass.',
        rarity: 'Épique',
        trigger: 'BATTLE_PASS_LEVEL',
        goal: 25,
        reward: { stars: 200000 },
    },
    TRADE_15: {
        id: 'TRADE_15',
        name: 'Faire 15 trades',
        description: 'Faire 15 trades.',
        rarity: 'Épique',
        trigger: 'TRADE_COMPLETE',
        goal: 15,
        reward: { stars: 250000 },
    },
    OPEN_LEGENDARY_CHEST_1: {
        id: 'OPEN_LEGENDARY_CHEST_1',
        name: 'Ouvrir 1 Coffre au trésor Légendaire',
        description: 'Ouvrir 1 Coffre au trésor Légendaire.',
        rarity: 'Épique',
        trigger: 'LEGENDARY_CHEST_OPEN',
        goal: 1,
        reward: { stars: 300000 },
    },
    DAILY_CHEST_REWARD: {
        id: 'DAILY_CHEST_REWARD',
        name: 'Avoir un Coffre au trésor dans un daily',
        description: 'Obtenir un Coffre au trésor en récompense daily.',
        rarity: 'Épique',
        trigger: 'DAILY_CHEST_REWARD',
        goal: 1,
        reward: { item: 'Coffre au trésor' },
    },

    // --- Quêtes Coffres & Trades (Légendaires) ---
    MINIGAME_WIN_50: {
        id: 'MINIGAME_WIN_50',
        name: 'Gagner 50 games de mini jeux',
        description: 'Gagner 50 games de mini jeux.',
        rarity: 'Légendaire',
        trigger: 'MINIGAME_WIN',
        goal: 50,
        reward: { stars: 500000 },
    },
    OPEN_CHEST_50: {
        id: 'OPEN_CHEST_50',
        name: 'Ouvrir 50 coffres au trésor',
        description: 'Ouvrir 50 coffres au trésor.',
        rarity: 'Légendaire',
        trigger: 'CHEST_OPEN',
        goal: 50,
        reward: { stars: 500000 },
    },
    BATTLE_PASS_MAX: {
        id: 'BATTLE_PASS_MAX',
        name: 'Atteindre le Pallier MAX du pass',
        description: 'Atteindre le pallier maximum du Battle Pass.',
        rarity: 'Légendaire',
        trigger: 'BATTLE_PASS_LEVEL',
        goal: 50,
        reward: { stars: 500000 },
    },
    OPEN_MEGA_CHEST_15: {
        id: 'OPEN_MEGA_CHEST_15',
        name: 'Ouvrir 15 Méga Coffres au trésor',
        description: 'Ouvrir 15 Méga Coffres au trésor.',
        rarity: 'Légendaire',
        trigger: 'MEGA_CHEST_OPEN',
        goal: 15,
        reward: { stars: 500000 },
    },
    TRADE_40: {
        id: 'TRADE_40',
        name: 'Faire 40 trades',
        description: 'Faire 40 trades.',
        rarity: 'Légendaire',
        trigger: 'TRADE_COMPLETE',
        goal: 40,
        reward: { stars: 500000 },
    },
    OPEN_LEGENDARY_CHEST_5: {
        id: 'OPEN_LEGENDARY_CHEST_5',
        name: 'Ouvrir 5 Coffres au trésor Légendaire',
        description: 'Ouvrir 5 Coffres au trésor Légendaire.',
        rarity: 'Légendaire',
        trigger: 'LEGENDARY_CHEST_OPEN',
        goal: 5,
        reward: { stars: 1000000 },
    },
    BUY_MYTHIC_ITEM: {
        id: 'BUY_MYTHIC_ITEM',
        name: 'Acheter un item Mythique dans la boutique',
        description: 'Acheter un item de rareté Mythique dans la boutique.',
        rarity: 'Légendaire',
        trigger: 'SHOP_BUY',
        goal: 'Mythique',
        reward: { item: 'Reset boutique' },
    },
    DAILY_MEGA_CHEST_REWARD: {
        id: 'DAILY_MEGA_CHEST_REWARD',
        name: 'Avoir un Méga Coffre au trésor dans un daily',
        description: 'Obtenir un Méga Coffre au trésor en récompense daily.',
        rarity: 'Légendaire',
        trigger: 'DAILY_MEGA_CHEST_REWARD',
        goal: 1,
        reward: { item: 'Méga Coffre au trésor' },
    },

    // --- Quêtes Coffres & Trades (Mythiques) ---
    LOAN_REPAY_MILLION: {
        id: 'LOAN_REPAY_MILLION',
        name: 'Rembourser une dette à plus d\'un million de starss',
        description: 'Rembourser une dette supérieure à 1,000,000 Starss.',
        rarity: 'Mythique',
        trigger: 'LOAN_REPAID_BIG',
        goal: 1000000,
        reward: { item: 'Remboursement' },
    },
    BUY_GOAT_ITEM: {
        id: 'BUY_GOAT_ITEM',
        name: 'Acheter un item Goatesque dans la boutique',
        description: 'Acheter un item de rareté Goatesque dans la boutique.',
        rarity: 'Mythique',
        trigger: 'SHOP_BUY',
        goal: 'Goatesque',
        reward: { item: 'Reset boutique', stars: 500000 },
    },
    MINIGAME_WIN_200: {
        id: 'MINIGAME_WIN_200',
        name: 'Gagner 200 games de mini jeux',
        description: 'Gagner 200 games de mini jeux.',
        rarity: 'Mythique',
        trigger: 'MINIGAME_WIN',
        goal: 200,
        reward: { stars: 1000000 },
    },
    OPEN_CHEST_100: {
        id: 'OPEN_CHEST_100',
        name: 'Ouvrir 100 coffres au trésor',
        description: 'Ouvrir 100 coffres au trésor.',
        rarity: 'Mythique',
        trigger: 'CHEST_OPEN',
        goal: 100,
        reward: { stars: 1000000 },
    },
    BATTLE_PASS_3X: {
        id: 'BATTLE_PASS_3X',
        name: 'Terminer le pass 3X d\'affilée',
        description: 'Terminer le Battle Pass 3 fois d\'affilée.',
        rarity: 'Mythique',
        trigger: 'BATTLE_PASS_COMPLETE',
        goal: 3,
        reward: { stars: 1000000 },
    },
    TRADE_100: {
        id: 'TRADE_100',
        name: 'Faire 100 trades',
        description: 'Faire 100 trades.',
        rarity: 'Mythique',
        trigger: 'TRADE_COMPLETE',
        goal: 100,
        reward: { stars: 1000000 },
    },
    OPEN_MEGA_CHEST_30: {
        id: 'OPEN_MEGA_CHEST_30',
        name: 'Ouvrir 30 Méga Coffres au trésor',
        description: 'Ouvrir 30 Méga Coffres au trésor.',
        rarity: 'Mythique',
        trigger: 'MEGA_CHEST_OPEN',
        goal: 30,
        reward: { stars: 1500000 },
    },
    OPEN_LEGENDARY_CHEST_15: {
        id: 'OPEN_LEGENDARY_CHEST_15',
        name: 'Ouvrir 15 Coffres au trésor Légendaire',
        description: 'Ouvrir 15 Coffres au trésor Légendaire.',
        rarity: 'Mythique',
        trigger: 'LEGENDARY_CHEST_OPEN',
        goal: 15,
        reward: { stars: 5000000 },
    },

    // --- Quêtes Coffres & Trades (Goatesques) ---
    OPEN_MEGA_CHEST_70: {
        id: 'OPEN_MEGA_CHEST_70',
        name: 'Ouvrir 70 Méga Coffres au trésor',
        description: 'Ouvrir 70 Méga Coffres au trésor.',
        rarity: 'Goatesque',
        trigger: 'MEGA_CHEST_OPEN',
        goal: 70,
        reward: { stars: 4000000 },
        badge: 'badge_70_mega_chests'
    },
    OPEN_LEGENDARY_CHEST_30: {
        id: 'OPEN_LEGENDARY_CHEST_30',
        name: 'Ouvrir 30 Coffres au trésor Légendaire',
        description: 'Ouvrir 30 Coffres au trésor Légendaire.',
        rarity: 'Goatesque',
        trigger: 'LEGENDARY_CHEST_OPEN',
        goal: 30,
        reward: { stars: 15000000 },
        badge: 'badge_30_legendary_chests'
    },

    // --- Quêtes TOP (activables via /toggle-top-quest) ---
    TOP_10_EXP: {
        id: 'TOP_10_EXP',
        name: 'Entrer dans le TOP 10 EXP',
        description: 'Être dans le TOP 10 XP du serveur.',
        rarity: 'Légendaire',
        trigger: 'TOP_RANK_CHECK',
        goal: 10,
        reward: { item: 'CAT', role: TOP_ROLES.level['10'] },
        category: 'TopQuest'
    },
    TOP_5_EXP: {
        id: 'TOP_5_EXP',
        name: 'Entrer dans le TOP 5 EXP',
        description: 'Être dans le TOP 5 XP du serveur.',
        rarity: 'Mythique',
        trigger: 'TOP_RANK_CHECK',
        goal: 5,
        reward: { item: 'CAT', role: TOP_ROLES.level['5'] },
        category: 'TopQuest'
    },
    TOP_1_EXP: {
        id: 'TOP_1_EXP',
        name: 'Entrer dans le TOP 1 EXP',
        description: 'Être le TOP 1 XP du serveur.',
        rarity: 'Goatesque',
        trigger: 'TOP_RANK_CHECK',
        goal: 1,
        reward: { item: 'CAT', role: TOP_ROLES.level['1'] },
        category: 'TopQuest'
    },
    TOP_10_PC: {
        id: 'TOP_10_PC',
        name: 'Entrer dans le TOP 10 PC',
        description: 'Être dans le TOP 10 Points Comptage du serveur.',
        rarity: 'Légendaire',
        trigger: 'TOP_PC_CHECK',
        goal: 10,
        reward: { item: 'CAT', role: TOP_ROLES.counting['10'] },
        category: 'TopQuest'
    },
    TOP_5_PC: {
        id: 'TOP_5_PC',
        name: 'Entrer dans le TOP 5 PC',
        description: 'Être dans le TOP 5 Points Comptage du serveur.',
        rarity: 'Mythique',
        trigger: 'TOP_PC_CHECK',
        goal: 5,
        reward: { item: 'CAT', role: TOP_ROLES.counting['5'] },
        category: 'TopQuest'
    },
    TOP_1_PC: {
        id: 'TOP_1_PC',
        name: 'Entrer dans le TOP 1 PC',
        description: 'Être le TOP 1 Points Comptage du serveur.',
        rarity: 'Goatesque',
        trigger: 'TOP_PC_CHECK',
        goal: 1,
        reward: { item: 'CAT', role: TOP_ROLES.counting['1'] },
        category: 'TopQuest'
    },
    STREAK_100: {
        id: 'STREAK_100',
        name: 'Avoir 100 Streaks',
        description: 'Atteindre 100 jours de streak.',
        rarity: 'Mythique',
        trigger: 'STREAK_REACH',
        goal: 100,
        reward: { role: QUEST_REWARD_ROLES.consistent },
        category: 'TopQuest'
    },
};

async function checkQuestProgress(client, trigger, user, data = {}) {
    // Ne pas vérifier les quêtes d'halloween si l'event est inactif
    const { getEventState } = require('./db-halloween');
    const isHalloweenActive = getEventState('halloween');

    // Vérifier si les quêtes TOP sont activées
    const db = require('../database/database');
    let isTopQuestsActive = false;
    try {
        const topQuestState = db.prepare('SELECT value FROM bot_settings WHERE key = ?').get('top_quests_enabled');
        isTopQuestsActive = topQuestState && topQuestState.value === '1';
    } catch (err) {
        // Table ou clé inexistante, quêtes TOP désactivées par défaut
    }

    const questsForTrigger = Object.values(QUESTS).filter(q => {
        if (q.rarity === 'Halloween' && !isHalloweenActive) {
            return false; // Exclure les quêtes Halloween si l'événement est inactif
        }
        if (q.category === 'TopQuest' && !isTopQuestsActive) {
            return false; // Exclure les quêtes TOP si non activées
        }
        return q.trigger === trigger;
    });

    // --- Anti-spam TRADE_COMPLETE : vérifier UNE FOIS avant la boucle ---
    if (trigger === 'TRADE_COMPLETE' && data.otherUserId) {
        const lastTradeKey = `${user.id}_trade_${data.otherUserId}`;
        const lastTradeTime = global.lastTrades?.[lastTradeKey];
        const now = Date.now();

        if (lastTradeTime && (now - lastTradeTime) < 24 * 60 * 60 * 1000) {
            return; // Même paire dans les 24h, ne pas compter
        }
        // Enregistrer ce trade
        if (!global.lastTrades) global.lastTrades = {};
        global.lastTrades[lastTradeKey] = now;
    }

    for (const quest of questsForTrigger) {
        const progress = dbQuests.getQuestProgress(user.id, quest.id);

        if (progress && progress.completed) {
            continue; // Quête déjà terminée
        }

        let currentProgress = progress ? progress.progress : 0;
        let newProgress = currentProgress;
        let shouldUpdate = false;

        // --- Logique pour forcer la complétion (Bonbon Surprise) ---
        if (data.forceComplete && quest.id === data.questId) {
            newProgress = typeof quest.goal === 'number' ? quest.goal : 1;
            shouldUpdate = true;
        } else {
            // --- Logique de Progression Normale ---
            switch (trigger) {
                case 'MESSAGE_SEND':
                case 'VOICE_MINUTE':
                case 'DAILY_CLAIM':
                case 'REACTION_ADD':
                case 'MESSAGE_ATTACHMENT':
                case 'HALLOWEEN_CANDY_OPEN': // Ajout du trigger pour les bonbons
                case 'CHEST_OPEN': // Ouverture de coffres
                case 'MEGA_CHEST_OPEN': // Ouverture de méga coffres
                case 'LEGENDARY_CHEST_OPEN': // Ouverture de coffres légendaires
                case 'MINIGAME_WIN': // Victoire au mini-jeu
                    newProgress++;
                    shouldUpdate = true;
                    break;

                case 'MESSAGE_CONTENT':
                    if (data.content.toLowerCase().includes(quest.goal.toLowerCase())) {
                        newProgress = 1; // Goal reached
                        shouldUpdate = true;
                    }
                    break;

                case 'GUILD_ACTION':
                    if (quest.goal === data.action) {
                        newProgress = 1; // Goal reached
                        shouldUpdate = true;
                    }
                    break;

                case 'RANK_UP': {
                    const MAIN_RANKS = ['Plastique', 'Carton', 'Bronze', 'Fer', 'Or', 'Diamant', 'Émeraude', 'Rubis', 'Légendaire', 'Mythique', 'GOAT'];

                    const normalize = (str) => str ? str.normalize("NFD").replace(/[\u0300-\u036f]/g, "") : "";

                    // Trouver l'index en comparant les versions normalisées (plus robuste)
                    const goalRankIndex = MAIN_RANKS.findIndex(r => normalize(r) === normalize(quest.goal));
                    const currentRankIndex = MAIN_RANKS.findIndex(r => normalize(r) === normalize(data.newRankName));

                    if (goalRankIndex !== -1 && currentRankIndex !== -1) {
                        if (currentRankIndex >= goalRankIndex) {
                            newProgress = 1; // Goal reached or surpassed
                            shouldUpdate = true;
                        }
                    } else if (normalize(quest.goal) === normalize(data.newRankName)) {
                        // Fallback simple string comparison normalisée
                        newProgress = 1;
                        shouldUpdate = true;
                    }
                    break;
                }

                case 'REPLY_TO_RANK': {
                    const RANK_HIERARCHY = ['Plastique', 'Carton', 'Bronze', 'Fer', 'Or', 'Diamant', 'Émeraude', 'Rubis', 'Légendaire', 'Mythique', 'GOAT'];
                    const normalize = (str) => str ? str.normalize("NFD").replace(/[\u0300-\u036f]/g, "") : "";

                    const normalizedGoal = normalize(quest.goal);
                    const normalizedRepliedRank = normalize(data.repliedToRank);

                    const targetRankIndex = RANK_HIERARCHY.findIndex(r => normalize(r) === normalizedGoal);
                    const repliedRankIndex = RANK_HIERARCHY.findIndex(r => normalize(r) === normalizedRepliedRank);

                    if (targetRankIndex !== -1 && repliedRankIndex !== -1) {
                        if (repliedRankIndex >= targetRankIndex) {
                            newProgress = 1; // Goal reached or surpassed
                            shouldUpdate = true;
                        }
                    } else if (normalizedRepliedRank === normalizedGoal) {
                        newProgress = 1;
                        shouldUpdate = true;
                    }
                    break;
                }

                case 'REPLY_TO_ROLE_NAME': // Ajout du trigger pour le nom de rôle
                    if (data.repliedToRoleName === quest.goal) {
                        newProgress = 1; // Goal reached
                        shouldUpdate = true;
                    }
                    break;

                case 'GUILD_MEMBER_COUNT':
                    if (data.memberCount >= quest.goal) {
                        newProgress = data.memberCount;
                        shouldUpdate = true;
                    }
                    break;

                case 'LEVEL_REACH':
                    // Toujours mettre à jour la progression avec le niveau actuel
                    if (data.newLevel !== undefined) {
                        newProgress = data.newLevel;
                        shouldUpdate = true;
                    }
                    break;

                case 'BALANCE_REACH':
                    // Toujours mettre à jour la progression avec le solde actuel
                    if (data.newBalance !== undefined) {
                        newProgress = data.newBalance;
                        shouldUpdate = true;
                    }
                    break;

                case 'PRIVATE_THREAD_MESSAGE':
                    if (data.parentChannelId === quest.goal) {
                        newProgress = 1; // Goal reached
                        shouldUpdate = true;
                    }
                    break;

                case 'HALLOWEEN_PUMPKIN_CHECK': // Ajout du trigger pour le check de citrouilles
                    if (data.pumpkinCount >= quest.goal) {
                        newProgress = data.pumpkinCount;
                        shouldUpdate = true;
                    }
                    break;

                case 'TRADE_COMPLETE':
                    // L'anti-spam 24h est vérifié avant la boucle des quêtes
                    newProgress++;
                    shouldUpdate = true;
                    break;

                case 'BATTLE_PASS_LEVEL':
                    if (data.battlePassLevel !== undefined) {
                        newProgress = data.battlePassLevel;
                        shouldUpdate = true;
                    }
                    break;

                case 'BATTLE_PASS_COMPLETE':
                    newProgress++;
                    shouldUpdate = true;
                    break;

                case 'LOAN_REPAID':
                    newProgress = 1; // Goal reached
                    shouldUpdate = true;
                    break;

                case 'LOAN_REPAID_BIG':
                    if (data.repayAmount >= quest.goal) {
                        newProgress = quest.goal; // Atteindre le goal pour valider la complétion
                        shouldUpdate = true;
                    }
                    break;

                case 'SHOP_BUY':
                    if (data.itemRarity === quest.goal) {
                        newProgress = 1;
                        shouldUpdate = true;
                    }
                    break;

                case 'TOP_RANK_CHECK':
                    // data = rank position (ex: 1, 5, 10)
                    // quest.goal = position requise (ex: 10 = TOP 10)
                    if (typeof data === 'number' && data <= quest.goal) {
                        newProgress = 1;
                        shouldUpdate = true;
                    }
                    break;

                case 'TOP_PC_CHECK':
                    // data = rank position comptage (ex: 1, 5, 10)
                    // quest.goal = position requise (ex: 10 = TOP 10)
                    if (typeof data === 'number' && data <= quest.goal) {
                        newProgress = 1;
                        shouldUpdate = true;
                    }
                    break;

                case 'STREAK_REACH':
                    // data = current streak count
                    if (typeof data === 'number' && data >= quest.goal) {
                        newProgress = data;
                        shouldUpdate = true;
                    }
                    break;

                case 'DAILY_CHEST_REWARD':
                    newProgress = 1;
                    shouldUpdate = true;
                    break;

                case 'DAILY_MEGA_CHEST_REWARD':
                    newProgress = 1;
                    shouldUpdate = true;
                    break;
            }
        }

        if (shouldUpdate) {
            const goal = typeof quest.goal === 'number' ? quest.goal : 1;
            dbQuests.updateQuestProgress(user.id, quest.id, newProgress);

            // --- Vérification de Complétion ---
            if (newProgress >= goal) {
                dbQuests.completeQuest(user.id, quest.id);
                logger.info(`Quête terminée pour ${user.id}: ${quest.name}`);

                // --- Récompenses et notification dans un try/catch ---
                // pour ne PAS casser la boucle si une erreur survient
                // (sinon les quêtes suivantes ne progressent jamais)
                try {
                    // Accorder les récompenses
                    let rewardText = '';
                    if (quest.reward.stars) {
                        const { grantResources } = require('./db-users');
                        grantResources(client, user.id, { stars: quest.reward.stars, source: 'quest' });
                        rewardText = `${quest.reward.stars.toLocaleString('fr-FR')} Starss`;
                    }
                    if (quest.reward.bonbons) {
                        grantEventCurrency(user.id, { bonbons: quest.reward.bonbons });
                        rewardText = `${quest.reward.bonbons.toLocaleString('fr-FR')} Bonbons`;
                    }
                    if (quest.reward.item) {
                        const { addItemToInventory } = require('./db-users');

                        const itemMapping = {
                            'Coffre au trésor': 'coffre_normal',
                            'Reset boutique': 'reset_boutique',
                            'Méga Coffre au trésor': 'coffre_mega',
                            'Remboursement': 'remboursement'
                        };

                        const itemId = itemMapping[quest.reward.item] || Object.keys(require('./items').ITEMS).find(k => require('./items').ITEMS[k].name === quest.reward.item);

                        if (itemId) {
                            addItemToInventory(user.id, itemId, 1);
                            rewardText = `Item: ${quest.reward.item}`;
                        } else {
                            logger.error(`Impossible de trouver l'ID pour l'item de récompense : ${quest.reward.item}`);
                            rewardText = `Item: ${quest.reward.item} (Erreur distribution)`;
                        }
                    }
                    if (quest.reward.role) {
                        try {
                            const guild = await client.guilds.fetch(process.env.GUILD_ID);
                            const normalize = (str) => str.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
                            const targetRoleName = quest.reward.role;

                            let role = guild.roles.cache.find(r => r.name === targetRoleName);
                            if (!role) {
                                role = guild.roles.cache.find(r => normalize(r.name) === normalize(targetRoleName));
                            }
                            if (!role) {
                                role = await guild.roles.create({ name: quest.reward.role, reason: 'Récompense de quête' });
                            }
                            const member = await guild.members.fetch(user.id).catch(() => null);
                            if (member && !member.roles.cache.has(role.id)) {
                                await member.roles.add(role);
                                rewardText += rewardText ? ` & Rôle "${quest.reward.role}"` : `Rôle "${quest.reward.role}"`;
                            } else if (member && member.roles.cache.has(role.id)) {
                                rewardText += rewardText ? ` & Rôle "${quest.reward.role}" (déjà possédé)` : `Rôle "${quest.reward.role}" (déjà possédé)`;
                            }
                        } catch (roleError) {
                            logger.error(`Erreur attribution rôle pour quête ${quest.id}:`, roleError);
                            rewardText += rewardText ? ` & Rôle "${quest.reward.role}" (Erreur)` : `Rôle "${quest.reward.role}" (Erreur)`;
                        }
                    }

                    // Accorder le badge si présent
                    if (quest.badge) {
                        const { grantBadge: grantBadgeDB } = require('../database/db-badges');
                        grantBadgeDB(user.id, quest.badge);
                        rewardText += rewardText ? ` & Badge "${quest.badge}"` : `Badge "${quest.badge}"`;
                    }

                    // MAJ Mars 2026: Accorder un trophée pour chaque quête complétée
                    try {
                        const { grantTrophy } = require('./trophy-value-system');
                        const trophyRarity = quest.rarity || 'Commune';
                        const isNew = grantTrophy(user.id, quest.id, trophyRarity);
                        if (isNew) {
                            rewardText += rewardText ? ` & 🏆 Trophée "${quest.name}" (${trophyRarity})` : `🏆 Trophée "${quest.name}" (${trophyRarity})`;
                        }
                    } catch (trophyError) {
                        logger.error(`Erreur attribution trophée pour quête ${quest.id}:`, trophyError);
                    }

                    // Notification salon quêtes (embed « Succès Déverrouillé »)
                    const { sendQuestUnlockNotification, resolveQuestLogChannelId } = require('./quest-unlock-notify');
                    if (resolveQuestLogChannelId()) {
                        let fullUser = null;
                        try {
                            fullUser = await client.users.fetch(user.id);
                        } catch {
                            fullUser = null;
                        }
                        const displayName = fullUser?.username || user.username || `Utilisateur ${user.id}`;
                        const { getOrCreateUser } = require('./db-users');
                        const dbUser = getOrCreateUser(user.id, displayName);
                        const shouldPing = dbUser.notify_quest_complete !== 0;
                        await sendQuestUnlockNotification(
                            client,
                            fullUser || user,
                            quest,
                            rewardText,
                            { shouldPing },
                        ).catch((err) =>
                            logger.error(`Erreur envoi notification quête ${quest.id}:`, err),
                        );
                    }
                } catch (rewardError) {
                    logger.error(`Erreur récompense/notification pour quête ${quest.id} (user ${user.id}):`, rewardError);
                    // On continue la boucle pour les autres quêtes
                }
            }
        }
    }
}


/**
 * Réinitialise la progression de toutes les quêtes vocales pour un utilisateur.
 * @param {string} userId 
 */
function resetVoiceQuestsProgress(userId) {
    logger.info(`Réinitialisation de la progression des quêtes vocales pour l'utilisateur ${userId}.`);
    const voiceQuests = Object.values(QUESTS).filter(q => q.trigger === 'VOICE_MINUTE');

    for (const quest of voiceQuests) {
        const progress = dbQuests.getQuestProgress(userId, quest.id);
        // On ne réinitialise que s'il y a une progression et que la quête n'est pas déjà terminée
        if (progress && !progress.completed) {
            dbQuests.updateQuestProgress(userId, quest.id, 0);
        }
    }
}

/**
 * Synchronise les badges pour un utilisateur (rétroactif).
 * @param {string} userId 
 * @param {GuildMember} [member] - Optionnel, pour vérifier les badges basés sur les rôles
 */
function syncUserBadges(userId, member) {
    const { grantBadge } = require('../database/db-badges');

    // 1. Sync badges de quêtes
    const userQuests = dbQuests.getAllUserQuests(userId);
    for (const questData of userQuests) {
        if (questData.completed) {
            const questConfig = QUESTS[questData.quest_id];
            if (questConfig && questConfig.badge) {
                grantBadge(userId, questConfig.badge);
            }
        }
    }

    // 2. Sync badges basés sur les rôles Discord
    if (member && member.roles && member.roles.cache) {
        const { BADGE_ROLE_MAP } = require('./badge-config');
        for (const badge of BADGE_ROLE_MAP) {
            const hasRole = badge.roleIds.some(roleId => member.roles.cache.has(roleId));
            if (hasRole) {
                grantBadge(userId, badge.badgeId);
            }
        }
    }
}

module.exports = { QUESTS, checkQuestProgress, resetVoiceQuestsProgress, syncUserBadges };