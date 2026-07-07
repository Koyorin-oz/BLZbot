require('dotenv').config();
const db = require('../database/database');
const { grantResources, removeUserItem, addItemToInventory, getOrCreateUser, setLevel, updateUserBalance } = require('./db-users');
const { getGuildOfUser } = require('./db-guilds');
const { generateDailyShop } = require('./shop-system');
const { forceCompleteQuest, getAllUserQuests, checkQuestProgress } = require('./db-quests');
const { checkQuestProgress: checkQuestProgressMain } = require('./quests');
const { EmbedBuilder, StringSelectMenuBuilder, ActionRowBuilder, ComponentType } = require('discord.js');
const roleConfig = require('../config/role.config.json');

const SPECIAL_ROLES = roleConfig.specialRoles;
const VIP_ROLE_ID = SPECIAL_ROLES?.vip?.id || roleConfig.roleIds?.vip;

const COFFRE_NORMAL_LOOT = [
    { item: 'xp', amount: 500, weight: 30 },
    { item: 'starss', amount: 15000, weight: 30 },
    { item: 'xp_boost', amount: 1, weight: 25 },
    { item: 'joker_guilde', amount: 1, weight: 10 },
    { item: 'role_pirate', amount: 1, weight: 2 },
    { item: 'mega_boost', amount: 1, weight: 3 },
];

const COFFRE_MEGA_LOOT = [
    { item: 'starss', amount: 30000, weight: 30 },
    { item: 'xp', amount: 500, weight: 30 },
    { item: 'joker_guilde', amount: 1, weight: 15 },
    { item: 'reset_boutique', amount: 1, weight: 10 },
    { item: 'streak_keeper', amount: 1, weight: 10 },
    { item: 'xp_boost', amount: 1, weight: 4 },
    { item: 'role_mega_pirate', amount: 1, weight: 1 },
];

const COFFRE_LEGENDAIRE_LOOT = [
    { item: 'xp', amount: 3000, weight: 30 },
    { item: 'remboursement', amount: 1, weight: 30 },
    { item: 'points_comptas_x2', amount: 1, weight: 15 },
    { item: 'coffre_normal', amount: 5, weight: 10 },
    { item: 'mega_boost', amount: 1, weight: 10 },
    { item: 'guild_upgrader', amount: 1, weight: 3 },
    { item: 'pass_vip', amount: 1, weight: 0.5 },
    { item: 'role_hackeur', amount: 1, weight: 0.5 },
];

function openChest(lootTable) {
    const totalWeight = lootTable.reduce((acc, { weight }) => acc + weight, 0);
    let random = Math.random() * totalWeight;

    for (const drop of lootTable) {
        if (random < drop.weight) {
            return drop;
        }
        random -= drop.weight;
    }
}

function getRarityEmoji(rarity) {
    const emojis = {
        'Commune': '⚪',
        'Rare': '🔵',
        'Épique': '🟣',
        'Légendaire': '🟡',
        'Mythique': '🔴',
        'Goatesque': '🌟',
        'Halloween': '🎃'
    };
    return emojis[rarity] || '❓';
}

async function useItem(interaction, itemId) {
    const userId = interaction.user.id;
    let message = `Vous avez utilisé ${itemId}!`;

    // Liste des items qui gèrent leur propre retrait (ont des collectors avec logique conditionnelle)
    const selfManagedItems = ['remboursement', 'guild_upgrader', 'mega_boost', 'coup_detat', 'joker_guilde', 'reset_boutique'];
    const isSelfManaged = selfManagedItems.includes(itemId);

    // Vérifier que l'utilisateur possède l'item
    const { checkUserInventory } = require('./db-users');
    const quantity = checkUserInventory(userId, itemId);
    if (quantity <= 0) {
        await interaction.editReply({ content: '❌ Vous ne possédez pas cet item.', embeds: [], components: [] });
        return;
    }

    // Objets passifs : Ne pas consommer
    const passiveItems = ['micro', 'ecran', 'couronne', 'role_pirate', 'role_mega_pirate', 'role_hackeur', 'bague_mariage', 'ami_chiant'];
    if (passiveItems.includes(itemId)) {
        await interaction.editReply({ content: `❌ **${itemId}** est un objet passif. Il fonctionne automatiquement tant qu'il est dans votre inventaire.`, embeds: [], components: [] });
        return;
    }

    // Pour les items non auto-gérés, retirer l'item IMMÉDIATEMENT pour éviter la duplication
    // MAIS on le rendra dans le default case si aucun effet n'est trouvé
    if (!isSelfManaged) {
        removeUserItem(userId, itemId);
    }

    try {
        switch (itemId) {
            case 'coffre_normal':
                const { checkQuestProgress: checkQ } = require('./quests');
                checkQ(interaction.client, 'CHEST_OPEN', interaction.user);
                const normalDrop = openChest(COFFRE_NORMAL_LOOT);
                message = await applyDrop(interaction, userId, normalDrop);
                break;
            case 'coffre_mega':
                const { checkQuestProgress: checkQM } = require('./quests');
                checkQM(interaction.client, 'MEGA_CHEST_OPEN', interaction.user);
                const megaDrop = openChest(COFFRE_MEGA_LOOT);
                message = await applyDrop(interaction, userId, megaDrop);
                break;
            case 'coffre_legendaire':
                const { checkQuestProgress: checkQL } = require('./quests');
                checkQL(interaction.client, 'LEGENDARY_CHEST_OPEN', interaction.user);
                const legendaireDrop = openChest(COFFRE_LEGENDAIRE_LOOT);
                message = await applyDrop(interaction, userId, legendaireDrop);
                break;
            case 'streak_keeper':
                const getUserStmt = db.prepare('SELECT streak_lost_timestamp, previous_streak FROM users WHERE id = ?');
                const user = getUserStmt.get(userId);

                if (user && user.streak_lost_timestamp > 0) {
                    const fortyEightHoursAgo = new Date();
                    fortyEightHoursAgo.setHours(fortyEightHoursAgo.getHours() - 48);

                    if (new Date(user.streak_lost_timestamp) > fortyEightHoursAgo) {
                        const updateUserStmt = db.prepare('UPDATE users SET streak = ?, streak_lost_timestamp = 0, previous_streak = 0 WHERE id = ?');
                        updateUserStmt.run(user.previous_streak, userId);
                        message = `✅ Votre streak a été restauré à ${user.previous_streak}!`;
                    } else {
                        const errorMsg = "❌ Il est trop tard pour utiliser le Streak Keeper (plus de 48h).";
                        await interaction.editReply({ content: errorMsg, embeds: [], components: [] });
                        return;
                    }
                } else {
                    const errorMsg = "❌ Vous n'avez pas de streak perdu à restaurer.";
                    await interaction.editReply({ content: errorMsg, embeds: [], components: [] });
                    return;
                }
                break;

            case 'double_daily':
                // Réinitialise le daily pour permettre une seconde réclamation
                // On met la date à 0 pour que la db oublie la réclamation (équivalent à jamais réclamé)
                db.prepare('UPDATE users SET daily_last_claimed = 0 WHERE id = ?').run(userId);
                message = `✅ Vous pouvez à nouveau utiliser la commande /daily !`;
                break;

            case 'reset_boutique':
                // Force la régénération de la boutique personnelle
                const { rerollUserShop } = require('./shop-system');
                const resetResult = rerollUserShop(userId);
                if (!resetResult.success) {
                    await interaction.editReply({ content: resetResult.message, embeds: [], components: [] });
                    return;
                }
                // Consommer l'item uniquement en cas de succès (pas de perte pendant le cooldown)
                removeUserItem(userId, 'reset_boutique');
                message = resetResult.message;
                break;


            case 'remboursement':
                // Récupérer toutes les dettes non remboursées de l'utilisateur
                const getLoansStmt = db.prepare(`
                SELECT id, lenderId, amount, interest, repaid_amount FROM loans 
                WHERE borrowerId = ? AND repaid = 0 AND accepted = 1
                ORDER BY expiresAt ASC
            `);
                const loans = getLoansStmt.all(userId);

                if (loans.length === 0) {
                    const errorMsg = '❌ Vous n\'avez aucune dette à rembourser.';
                    await interaction.editReply({ content: errorMsg, embeds: [], components: [] });
                    return;
                }

                // Créer un menu pour choisir la dette à rembourser
                const loanEmbed = new EmbedBuilder()
                    .setTitle('💳 Remboursement de Dette')
                    .setDescription('Choisissez quelle dette vous voulez rembourser entièrement :')
                    .setColor('Green');

                // Récupérer les usernames des prêteurs
                const loanOptions = [];
                for (const loan of loans) {
                    try {
                        const lender = await interaction.client.users.fetch(loan.lenderId);
                        const totalWithInterest = Math.ceil(loan.amount * (1 + loan.interest / 100));
                        const remainingDebt = totalWithInterest - (loan.repaid_amount || 0);

                        loanEmbed.addFields({
                            name: `Dette envers ${lender.username}`,
                            value: `Montant restant: ${remainingDebt.toLocaleString('fr-FR')} Starss`,
                            inline: false
                        });

                        loanOptions.push({
                            label: `${lender.username} - ${remainingDebt.toLocaleString('fr-FR')} Starss`,
                            value: loan.id.toString(),
                            description: `Dette avec ${loan.interest}% d'intérêt`
                        });
                    } catch (error) {
                        const totalWithInterest = Math.ceil(loan.amount * (1 + loan.interest / 100));
                        const remainingDebt = totalWithInterest - (loan.repaid_amount || 0);

                        loanEmbed.addFields({
                            name: `Dette envers ID ${loan.lenderId}`,
                            value: `Montant restant: ${remainingDebt.toLocaleString('fr-FR')} Starss`,
                            inline: false
                        });

                        loanOptions.push({
                            label: `ID ${loan.lenderId} - ${remainingDebt.toLocaleString('fr-FR')} Starss`,
                            value: loan.id.toString(),
                            description: `Dette avec ${loan.interest}% d'intérêt`
                        });
                    }
                }

                const loanRow = new ActionRowBuilder()
                    .addComponents(
                        new StringSelectMenuBuilder()
                            .setCustomId('select_loan')
                            .setPlaceholder('Sélectionnez une dette à rembourser')
                            .addOptions(loanOptions.slice(0, 25)) // Discord limite à 25 options
                    );

                await interaction.editReply({
                    embeds: [loanEmbed],
                    components: [loanRow]
                });

                const loanCollector = interaction.channel.createMessageComponentCollector({
                    componentType: ComponentType.StringSelect,
                    time: 60000
                });

                loanCollector.on('collect', async (i) => {
                    if (i.user.id !== userId) {
                        return i.reply({ content: '❌ Vous ne pouvez pas utiliser ce menu.', ephemeral: true }).catch(() => null);
                    }

                    try {
                        await i.deferUpdate();

                        const loanId = parseInt(i.values[0]);
                        const selectedLoan = loans.find(l => l.id === loanId);

                        if (!selectedLoan) {
                            await i.editReply({ content: '❌ Dette invalide.', embeds: [], components: [] });
                            loanCollector.stop();
                            return;
                        }

                        // Calculer le montant total à rembourser (Math.round cohérent avec getTotalDebt)
                        const totalWithInterest = Math.round(selectedLoan.amount * (1 + selectedLoan.interest / 100));
                        const remainingDebt = totalWithInterest - (selectedLoan.repaid_amount || 0);

                        // Rembourser la dette (l'emprunteur n'a rien à payer, le prêteur reçoit l'argent)
                        const lender = await interaction.client.users.fetch(selectedLoan.lenderId);

                        // Donner l'argent au prêteur sur le portefeuille réel (REBORN si actif)
                        getOrCreateUser(selectedLoan.lenderId, lender.username);
                        const { moveLoanStars } = require('./loan-system');
                        const usedReborn = moveLoanStars(selectedLoan.lenderId, remainingDebt, lender.username);

                        // Ajuster les valeurs de guerre uniquement si le solde niveau a bougé
                        if (!usedReborn) {
                            const { adjustWarInitialValues } = require('./guild/guild-wars');
                            adjustWarInitialValues(selectedLoan.lenderId, { stars: remainingDebt });
                        }

                        // Marquer la dette comme remboursée
                        db.prepare('UPDATE loans SET repaid = 1, repaid_amount = ? WHERE id = ?')
                            .run(totalWithInterest, loanId);

                        // Vérifier les quêtes de remboursement
                        checkQuestProgressMain(interaction.client, 'LOAN_REPAID', interaction.user);
                        checkQuestProgressMain(interaction.client, 'LOAN_REPAID_BIG', interaction.user, { repayAmount: remainingDebt });

                        // Notifier le prêteur
                        try {
                            await lender.send(`✅ ${interaction.user.username} a utilisé un item "Remboursement" pour vous rembourser **${remainingDebt.toLocaleString('fr-FR')}** Starss !`);
                        } catch (dmError) {
                            // Silencieux : l'utilisateur a les DMs désactivés
                        }

                        removeUserItem(userId, itemId);
                        await i.editReply({
                            content: `✅ Dette remboursée ! ${lender.username} a reçu ${remainingDebt.toLocaleString('fr-FR')} Starss.`,
                            embeds: [],
                            components: []
                        });
                    } catch (error) {
                        console.error('Erreur lors du remboursement:', error);
                        // Ignorer les erreurs d'interaction expirée
                    }

                    loanCollector.stop();
                });

                loanCollector.on('end', (collected) => {
                    if (collected.size === 0) {
                        interaction.editReply({
                            content: '⏱️ Temps écoulé. Utilisation annulée.',
                            embeds: [],
                            components: []
                        }).catch(() => { });
                    }
                });

                return; // Ne pas retirer l'item ici car il sera retiré dans le collector

            case 'guild_upgrader':
                const guild = getGuildOfUser(userId);
                if (!guild) {
                    const errorMsg = '❌ Vous n\'êtes pas dans une guilde.';
                    await interaction.editReply({ content: errorMsg, embeds: [], components: [] });
                    return;
                }

                // Liste des upgrades disponibles
                const upgrades = [
                    { id: 'max_members', name: 'Augmenter les membres', current: guild.max_members },
                    { id: 'bonus_xp', name: 'Bonus XP', current: guild.bonus_xp },
                    { id: 'bonus_stars', name: 'Bonus Starss', current: guild.bonus_stars }
                ];

                const upgradeEmbed = new EmbedBuilder()
                    .setTitle('🔧 Guild Upgrader')
                    .setDescription('Choisissez quelle amélioration de guilde vous voulez augmenter gratuitement :')
                    .setColor('Purple');

                upgrades.forEach(up => {
                    upgradeEmbed.addFields({
                        name: up.name,
                        value: `Niveau actuel: ${up.current}`,
                        inline: true
                    });
                });

                const upgradeOptions = upgrades.map(up => ({
                    label: up.name,
                    value: up.id,
                    description: `Niveau actuel: ${up.current}`
                }));

                const upgradeRow = new ActionRowBuilder()
                    .addComponents(
                        new StringSelectMenuBuilder()
                            .setCustomId('select_upgrade')
                            .setPlaceholder('Sélectionnez une amélioration')
                            .addOptions(upgradeOptions)
                    );

                await interaction.editReply({
                    embeds: [upgradeEmbed],
                    components: [upgradeRow]
                });

                const upgradeCollector = interaction.channel.createMessageComponentCollector({
                    componentType: ComponentType.StringSelect,
                    time: 60000
                });

                upgradeCollector.on('collect', async (i) => {
                    if (i.user.id !== userId) {
                        return i.reply({ content: '❌ Vous ne pouvez pas utiliser ce menu.', ephemeral: true }).catch(() => null);
                    }

                    try {
                        await i.deferUpdate();

                        const upgradeType = i.values[0];
                        const currentValue = guild[upgradeType] || 0;
                        const newValue = currentValue + 1;

                        db.prepare(`UPDATE guilds SET ${upgradeType} = ? WHERE guild_id = ?`).run(newValue, guild.guild_id);

                        removeUserItem(userId, itemId);
                        await i.editReply({
                            content: `✅ Amélioration "${upgrades.find(u => u.id === upgradeType).name}" augmentée au niveau ${newValue} !`,
                            embeds: [],
                            components: []
                        });
                    } catch (error) {
                        console.error('Erreur lors de l\'upgrade de guilde:', error);
                    }
                    upgradeCollector.stop();
                });

                upgradeCollector.on('end', (collected) => {
                    if (collected.size === 0) {
                        interaction.editReply({
                            content: '⏱️ Temps écoulé. Utilisation annulée.',
                            embeds: [],
                            components: []
                        }).catch(() => { });
                    }
                });

                return; // Ne pas retirer l'item ici car il sera retiré dans le collector

            case 'mega_boost':
                // Menu de choix pour le mega boost
                const boostEmbed = new EmbedBuilder()
                    .setTitle('⚡ MEGA BOOST')
                    .setDescription('Choisissez votre récompense :')
                    .setColor('Gold')
                    .addFields(
                        { name: '💰 2M Starss', value: '2 000 000 Starss', inline: true },
                        { name: '🚀 25k XP', value: '25 000 points d\'expérience', inline: true },
                        { name: '🎁 1 Coffre Légendaire', value: 'Un coffre aux trésors légendaire', inline: true }
                    );

                const boostOptions = [
                    { label: '2M Starss', value: 'starss', description: '2 000 000 Starss', emoji: '💰' },
                    { label: '25k XP', value: 'xp', description: '25 000 points d\'expérience', emoji: '🚀' },
                    { label: '1 Coffre Légendaire', value: 'coffre', description: 'Un coffre aux trésors légendaire', emoji: '🎁' }
                ];

                const boostRow = new ActionRowBuilder()
                    .addComponents(
                        new StringSelectMenuBuilder()
                            .setCustomId('select_boost')
                            .setPlaceholder('Choisissez votre récompense')
                            .addOptions(boostOptions)
                    );

                await interaction.editReply({
                    embeds: [boostEmbed],
                    components: [boostRow]
                });

                const boostCollector = interaction.channel.createMessageComponentCollector({
                    componentType: ComponentType.StringSelect,
                    time: 60000
                });

                boostCollector.on('collect', async (i) => {
                    if (i.user.id !== userId) {
                        return i.reply({ content: '❌ Vous ne pouvez pas utiliser ce menu.', ephemeral: true }).catch(() => null);
                    }

                    try {
                        await i.deferUpdate();

                        const choice = i.values[0];
                        let rewardMsg = '';

                        switch (choice) {
                            case 'starss':
                                await grantResources(interaction.client, userId, { stars: 2000000, source: 'mega_boost' });
                                rewardMsg = '✅ Vous avez reçu 2 000 000 Starss !';
                                break;
                            case 'xp':
                                await grantResources(interaction.client, userId, { xp: 25000, source: 'mega_boost' });
                                rewardMsg = '✅ Vous avez reçu 25 000 XP !';
                                break;
                            case 'coffre':
                                addItemToInventory(userId, 'coffre_legendaire', 1);
                                rewardMsg = '✅ Vous avez reçu un Coffre aux Trésors Légendaire !';
                                break;
                        }

                        removeUserItem(userId, itemId);
                        await i.editReply({ content: rewardMsg, embeds: [], components: [] });
                    } catch (error) {
                        console.error('Erreur lors de l\'utilisation du mega boost:', error);
                    }
                    boostCollector.stop();
                });

                boostCollector.on('end', (collected) => {
                    if (collected.size === 0) {
                        interaction.editReply({
                            content: '⏱️ Temps écoulé. Utilisation annulée.',
                            embeds: [],
                            components: []
                        }).catch(() => { });
                    }
                });

                return; // Ne pas retirer l'item ici car il sera retiré dans le collector

            case 'coup_detat':
                const warMsg = '⚠️ Le Coup d\'État doit être utilisé avec la commande /guerre en mentionnant la guilde à attaquer.';
                await interaction.editReply({ content: warMsg, embeds: [], components: [] });
                return;

            case 'joker_guilde':
                const userGuild = getGuildOfUser(userId);
                if (!userGuild) {
                    const errorMsg = '❌ Vous n\'êtes pas dans une guilde.';
                    await interaction.editReply({ content: errorMsg, embeds: [], components: [] });
                    return;
                }

                const { addGuildSlotWithJoker } = require('./guild/guild-upgrades');
                const jokerResult = addGuildSlotWithJoker(userGuild.id, userId);

                if (!jokerResult.success) {
                    await interaction.editReply({ content: jokerResult.message, embeds: [], components: [] });
                    return;
                }

                // Le joker est déjà consommé dans addGuildSlotWithJoker, ne pas appeler removeUserItem
                await interaction.editReply({ content: `✅ ${jokerResult.message}`, embeds: [], components: [] });
                return;

                return;

            case 'xp_boost':
                db.prepare('UPDATE users SET xp_boost_until = ? WHERE id = ?').run(Date.now() + 3600000, userId);
                message = `✅ **Boost XP (x2)** activé pour 1 heure !`;
                break;
            case 'points_boost':
                db.prepare('UPDATE users SET points_boost_until = ? WHERE id = ?').run(Date.now() + 3600000, userId);
                message = `✅ **Boost Points (x2)** activé pour 1 heure !`;
                break;
            case 'starss_boost':
                db.prepare('UPDATE users SET stars_boost_until = ? WHERE id = ?').run(Date.now() + 3600000, userId);
                message = `✅ **Boost Starss (x2)** activé pour 1 heure !`;
                break;
            case 'counting_boost':
                db.prepare('UPDATE users SET counting_boost_until = ? WHERE id = ?').run(Date.now() + 3600000, userId);
                message = `✅ **Boost Comptage (x2)** activé pour 1 heure !`;
                break;

            case 'coeur_rouge':
                message = await useCoeurRouge(interaction, userId);
                if (!message) { // Cas d'erreur (membre non trouvé)
                    // L'item a déjà été rendu dans useCoeurRouge si nécessaire, ou on le gère ici ?
                    // useCoeurRouge ne rend pas l'item, c'est l'appelant qui gère.
                    // Mais ici dans useItem, l'item a été consommé AVANT le switch.
                    // Si useCoeurRouge échoue, on doit le rendre.
                    // Modifions useCoeurRouge pour qu'il retourne null en cas d'erreur fatale.
                    addItemToInventory(userId, itemId, 1);
                    return interaction.editReply({ content: '❌ Erreur: Impossible de récupérer vos informations de membre.' });
                }
                break;

            case 'couscous':
                // Easter egg item - ne fait rien de spécial
                message = `🥘 Tu as mangé le couscous... mais il ne s'est rien passé. C'était délicieux quand même !`;
                break;

            default:
                // Remettre l'item car il a été retiré au début mais n'a pas d'effet
                if (!isSelfManaged) {
                    addItemToInventory(userId, itemId, 1);
                }
                const defaultMsg = `❌ Cet item (${itemId}) n'a pas d'effet implémenté pour le moment.`;
                await interaction.editReply({ content: defaultMsg, embeds: [], components: [] });
                return;
        }

        // Pour les items auto-gérés, on ne retire pas ici (ils gèrent leur propre retrait dans leurs collectors)
        // Pour les autres, l'item a déjà été retiré au début de la fonction
        await interaction.editReply({ content: message, embeds: [], components: [] });
    } catch (error) {
        console.error('Erreur lors de l\'utilisation de l\'item:', error);
        // Remettre l'item en cas d'erreur (si non auto-géré et déjà retiré)
        if (!isSelfManaged) {
            addItemToInventory(userId, itemId, 1);
        }
        // Laisser l'erreur remonter pour être traitée par handleCommandError
        throw error;
    }
}

async function applyDrop(interaction, userId, drop) {
    const guild = interaction.guild;

    switch (drop.item) {
        case 'xp':
            grantResources(interaction.client, userId, { xp: drop.amount, source: 'coffre' });
            return `Vous avez gagné ${drop.amount} XP!`;
        case 'starss':
            grantResources(interaction.client, userId, { stars: drop.amount, source: 'coffre' });
            return `Vous avez gagné ${drop.amount} starss!`;
        case 'rp':
            grantResources(interaction.client, userId, { points: drop.amount, source: 'coffre' });
            return `Vous avez gagné ${drop.amount} points de rang!`;
        case 'xp_boost':
            addItemToInventory(userId, 'xp_boost', drop.amount);
            return `Vous avez gagné ${drop.amount} Boost XP (x2 - 1h) !`;
        case 'points_boost':
            addItemToInventory(userId, 'points_boost', drop.amount);
            return `Vous avez gagné ${drop.amount} Boost RP (x2 - 1h) !`;
        case 'points_comptas_x2':
            addItemToInventory(userId, 'counting_boost', drop.amount);
            return `Vous avez gagné ${drop.amount} Boost Points Comptage (x2 - 1h) !`;
        case 'joker_guilde':
            addItemToInventory(userId, 'joker_guilde', drop.amount);
            return `Vous avez gagné ${drop.amount} Joker de guilde!`;
        case 'reset_boutique':
            addItemToInventory(userId, 'reset_boutique', drop.amount);
            return `Vous avez gagné ${drop.amount} Reset Boutique!`;
        case 'streak_keeper':
            addItemToInventory(userId, 'streak_keeper', drop.amount);
            return `Vous avez gagné ${drop.amount} Streak Keeper!`;
        case 'mega_boost':
            addItemToInventory(userId, 'mega_boost', drop.amount);
            return `Vous avez gagné ${drop.amount} MEGA BOOST!`;
        case 'remboursement':
            addItemToInventory(userId, 'remboursement', drop.amount);
            return `Vous avez gagné ${drop.amount} Remboursement!`;
        case 'guild_upgrader':
            addItemToInventory(userId, 'guild_upgrader', drop.amount);
            return `Vous avez gagné ${drop.amount} Guild Upgrader!`;
        case 'pass_vip':
            // Activer le Pass VIP en base de données (1 mois)
            try {
                const ONE_MONTH_MS = 30 * 24 * 60 * 60 * 1000;
                const expiresAt = Date.now() + ONE_MONTH_MS;
                db.prepare('UPDATE users SET is_vip = 1, vip_expires_at = ? WHERE id = ?').run(expiresAt, userId);
                return `👑 Vous avez obtenu le **Pass VIP** pour **30 jours** ! Vous pouvez maintenant récupérer les récompenses VIP du Battle Pass avec \`/battlepass claim\`.`;
            } catch (e) {
                console.error('Erreur activation Pass VIP:', e);
            }
            return `👑 Vous avez gagné le Pass VIP ! (Contactez un admin en cas de problème)`;
        case 'coffre_normal':
            addItemToInventory(userId, 'coffre_normal', drop.amount);
            return `Vous avez gagné ${drop.amount} Coffre au trésor!`;
        case 'role_pirate':
            await assignRoleToCoffreUser(guild, userId, SPECIAL_ROLES.pirate);
            return `Vous avez gagné le rôle « ${SPECIAL_ROLES.pirate} »!`;
        case 'role_mega_pirate':
            await assignRoleToCoffreUser(guild, userId, SPECIAL_ROLES.megaPirate);
            return `Vous avez gagné le rôle « ${SPECIAL_ROLES.megaPirate} »!`;
        case 'role_hackeur':
            await assignRoleToCoffreUser(guild, userId, SPECIAL_ROLES.hacker);
            return `Vous avez gagné le rôle « ${SPECIAL_ROLES.hacker} »! Accédez au salon secret.`;
        default:
            addItemToInventory(userId, drop.item);
            return `Vous avez gagné l\'objet: ${drop.item}!`;
    }
}

async function assignRoleToCoffreUser(guild, userId, roleName) {
    try {
        const member = await guild.members.fetch(userId);
        const normalize = (str) => str.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
        let role = guild.roles.cache.find(r => r.name === roleName);
        if (!role) {
            role = guild.roles.cache.find(r => normalize(r.name) === normalize(roleName));
        }

        if (role) {
            await member.roles.add(role);
        } else {
            console.warn(`Rôle "${roleName}" non trouvé sur le serveur`);
        }
    } catch (error) {
        console.error(`Erreur lors de l'attribution du rôle ${roleName} à ${userId}:`, error);
    }
}

// Helper exporté pour l'usage direct dans la boutique
async function useCoeurRouge(interaction, userId) {
    const member = await interaction.guild.members.fetch(userId).catch(() => null);
    if (!member) return null;

    const rand = Math.random() * 100;
    let rewardRoleName = '';
    let compensationStars = 0;

    if (rand < 1) { // 1%
        rewardRoleName = SPECIAL_ROLES.valentin.couple.name;
        compensationStars = 100000;
    } else { // 99%
        rewardRoleName = SPECIAL_ROLES.valentin.celib.name;
        compensationStars = 5000;
    }

    let role = interaction.guild.roles.cache.find(r => r.name === rewardRoleName);
    if (!role) {
        try {
            const color = rewardRoleName === SPECIAL_ROLES.valentin.couple.name
                ? SPECIAL_ROLES.valentin.couple.color
                : SPECIAL_ROLES.valentin.celib.color;
            role = await interaction.guild.roles.create({
                name: rewardRoleName,
                reason: 'Rôle automatique Saint-Valentin',
                color: color
            });
        } catch (e) {
            logger.error(`Erreur création rôle ${rewardRoleName}:`, e);
        }
    }

    let message = '';
    const { grantResources } = require('./db-users');

    if (member.roles.cache.has(role?.id)) {
        grantResources(interaction.client, userId, { stars: compensationStars, source: 'item' });
        message = `❤️ Vous avez déjà le rôle **${rewardRoleName}** ! Vous recevez **${compensationStars.toLocaleString('fr-FR')} Starss** en compensation.`;
    } else {
        if (role) {
            await member.roles.add(role).catch(e => logger.error(`Erreur ajout rôle ${rewardRoleName}:`, e));
            message = `❤️ **Félicitations !** Vous avez reçu le rôle **${rewardRoleName}** !`;
        } else {
            grantResources(interaction.client, userId, { stars: compensationStars, source: 'item' });
            message = `❤️ Impossible d'attribuer le rôle. Vous recevez **${compensationStars.toLocaleString('fr-FR')} Starss** en compensation.`;
        }
    }
    return message;
}

module.exports = { useItem, useCoeurRouge };
