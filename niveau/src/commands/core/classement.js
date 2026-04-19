const path = require('path');
const { SlashCommandBuilder, TextDisplayBuilder, ContainerBuilder, StringSelectMenuBuilder, ActionRowBuilder, ComponentType, MessageFlags, ButtonBuilder, ButtonStyle } = require('discord.js');
const { BLZ_EMBED_STRIP_INT } = require(path.join(__dirname, '..', '..', '..', '..', 'blz-embed-theme'));
const db = require('../../database/database');
const dbHalloween = require('../../utils/db-halloween');
const dbNoel = require('../../utils/db-noel');
const dbValentin = require('../../utils/db-valentin');
const { getRankFromPoints, getDisplayRank } = require('../../utils/ranks');
const { getValueLeaderboard, getUserValueRank } = require('../../utils/trophy-value-system');
const logger = require('../../utils/logger');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('classement')
        .setDescription('Affiche le classement des joueurs.'),

    async execute(interaction) {
        const userId = interaction.user.id;

        let currentType = 'stars'; // Default type
        let isAllTime = false; // Toggle state

        const generateLeaderboard = (type, allTime = false) => {
            let query = '';
            let title = '';
            let unit = '';
            let emoji = '';
            let customData = null;

            const halloweenActive = dbHalloween.getEventState('halloween');
            const christmasActive = dbNoel.getEventState('noël');
            const valentineActive = dbValentin.getEventState('valentin');

            // Only 'stars' and 'points' support all-time stats
            const supportAllTime = ['stars', 'points'].includes(type);
            const effectiveAllTime = allTime && supportAllTime;

            switch (type) {
                case 'stars':
                    if (effectiveAllTime) {
                        query = 'SELECT username, max_stars as score FROM users ORDER BY max_stars DESC LIMIT 10';
                        title = 'Classement Stars (All Time)';
                    } else {
                        query = 'SELECT username, stars as score FROM users ORDER BY stars DESC LIMIT 10';
                        title = 'Classement Stars';
                    }
                    unit = 'Stars';
                    emoji = '💸';
                    break;
                case 'level':
                    query = 'SELECT username, level as score FROM users ORDER BY level DESC, xp DESC LIMIT 10';
                    title = 'Classement Niveaux';
                    unit = 'Niveau';
                    emoji = '⭐';
                    break;
                case 'guild':
                    query = 'SELECT name as username, level as score FROM guilds ORDER BY level DESC, treasury DESC LIMIT 10';
                    title = 'Classement Guildes';
                    unit = 'Niveau';
                    emoji = '🛡️';
                    break;
                case 'points':
                    if (effectiveAllTime) {
                        query = 'SELECT id, username, max_points as score FROM users ORDER BY max_points DESC LIMIT 10';
                        title = 'Classement Points (All Time)';
                    } else {
                        query = 'SELECT id, username, points as score FROM users ORDER BY points DESC LIMIT 10';
                        title = 'Classement Points de Rang';
                    }
                    unit = 'Points';
                    emoji = '🏆';
                    break;
                case 'counting':
                    query = 'SELECT username, points_comptage as score FROM users ORDER BY points_comptage DESC LIMIT 10';
                    title = 'Classement Comptage';
                    unit = 'Points';
                    emoji = '🔢';
                    break;

                case 'bonbons':
                    if (!halloweenActive) return { title: 'Classement par Bonbons 🍬', text: "L'événement Halloween n'est pas actif." };
                    customData = dbHalloween.getLeaderboard('bonbons');
                    title = 'Classement par Bonbons';
                    unit = 'Bonbons';
                    emoji = '🍬';
                    break;
                case 'citrouilles':
                    if (!halloweenActive) return { title: 'Classement par Citrouilles 🎃', text: "L'événement Halloween n'est pas actif." };
                    customData = dbHalloween.getLeaderboard('citrouilles');
                    title = 'Classement par Citrouilles';
                    unit = 'Citrouilles';
                    emoji = '🎃';
                    break;
                case 'rubans':
                    if (!christmasActive) return { title: 'Classement par Rubans 🎀', text: "L'événement Noël n'est pas actif." };
                    customData = dbNoel.getLeaderboard('rubans');
                    title = 'Classement par Rubans';
                    unit = 'Rubans';
                    emoji = '🎀';
                    break;
                case 'coeurs':
                    if (!valentineActive) return { title: 'Classement par Cœurs 💕', text: "L'événement Saint-Valentin n'est pas actif." };
                    customData = dbValentin.getLeaderboard('coeurs');
                    title = 'Classement par Cœurs';
                    unit = 'Cœurs';
                    emoji = '💕';
                    break;


                case 'streak':
                    query = 'SELECT username, streak as score FROM users WHERE streak > 0 ORDER BY streak DESC LIMIT 10';
                    title = 'Classement Streaks';
                    unit = 'jours';
                    emoji = '🔥';
                    break;
                case 'valeur':
                    customData = getValueLeaderboard(10).map(u => ({
                        username: u.username,
                        score: u.total_value,
                        level: u.level,
                    }));
                    title = 'Classement Valeur';
                    unit = 'valeur';
                    emoji = '💎';
                    break;
            }

            let leaderboardText = '';

            if (customData) {
                leaderboardText = customData.map((user, index) => {
                    let rankEmoji = '👤';
                    if (index === 0) rankEmoji = '🥇';
                    if (index === 1) rankEmoji = '🥈';
                    if (index === 2) rankEmoji = '🥉';

                    // Handle different property names for events
                    let score = 0;
                    if (type === 'bonbons') score = user.bonbons;
                    else if (type === 'citrouilles') score = user.citrouilles;
                    else if (type === 'rubans') score = user.rubans;
                    else if (type === 'coeurs') score = user.coeurs;
                    else if (type === 'points_part2') {
                        score = user.score;
                        const rankText = user.rank ? ` [${user.rank.name}]` : '';
                        return `${rankEmoji} **${index + 1}. ${user.username}** - 100k + ${score.toLocaleString('fr-FR')} RP${rankText}`;
                    }
                    else score = user.score || 0;

                    return `${rankEmoji} **${index + 1}. ${user.username}** - ${score.toLocaleString('fr-FR')} ${unit}`;
                }).join('\n');
            } else if (query) {
                const topUsers = db.prepare(query).all();
                leaderboardText = topUsers.map((user, index) => {
                    let rankEmoji = '👤';
                    if (index === 0) rankEmoji = '🥇';
                    if (index === 1) rankEmoji = '🥈';
                    if (index === 2) rankEmoji = '🥉';

                    let scoreDisplay = `${user.score.toLocaleString('fr-FR')} ${unit}`;
                    if (type === 'points' && !effectiveAllTime) {
                        const rank = getDisplayRank(user.id, user.score);
                        scoreDisplay = `${rank.name} (${user.score.toLocaleString('fr-FR')} points)`;
                    } else if (effectiveAllTime) {
                        scoreDisplay = `${user.score.toLocaleString('fr-FR')} ${unit} (Record)`;
                    }

                    return `${rankEmoji} **${index + 1}. ${user.username}** - ${scoreDisplay}`;
                }).join('\n');
            } else {
                if (!leaderboardText) leaderboardText = "Aucune donnée.";
            }

            if (!leaderboardText) {
                leaderboardText = 'Aucun joueur classé pour le moment.';
            }

            const container = new ContainerBuilder()
                .setAccentColor(0xFFD700); // Gold color

            const textDisplay = new TextDisplayBuilder()
                .setContent(`# ${emoji} ${title}\n\n${leaderboardText}`);

            container.addTextDisplayComponents(textDisplay);

            // --- Ajouter la position personnelle de l'utilisateur ---
            let userPosition = null;
            let userScore = null;
            let positionQuery = '';

            switch (type) {
                case 'stars':
                    positionQuery = effectiveAllTime
                        ? 'SELECT COUNT(*) + 1 as pos FROM users WHERE max_stars > (SELECT max_stars FROM users WHERE id = ?)'
                        : 'SELECT COUNT(*) + 1 as pos FROM users WHERE stars > (SELECT stars FROM users WHERE id = ?)';
                    break;
                case 'level':
                    positionQuery = 'SELECT COUNT(*) + 1 as pos FROM users WHERE level > (SELECT level FROM users WHERE id = ?) OR (level = (SELECT level FROM users WHERE id = ?) AND xp > (SELECT xp FROM users WHERE id = ?))';
                    break;
                case 'points':
                    positionQuery = effectiveAllTime
                        ? 'SELECT COUNT(*) + 1 as pos FROM users WHERE max_points > (SELECT max_points FROM users WHERE id = ?)'
                        : 'SELECT COUNT(*) + 1 as pos FROM users WHERE points < 100000 AND points > (SELECT points FROM users WHERE id = ?)';
                    break;
                case 'counting':
                    positionQuery = 'SELECT COUNT(*) + 1 as pos FROM users WHERE points_comptage > (SELECT points_comptage FROM users WHERE id = ?)';
                    break;
                case 'streak':
                    positionQuery = 'SELECT COUNT(*) + 1 as pos FROM users WHERE streak > (SELECT streak FROM users WHERE id = ?)';
                    break;
                case 'valeur':
                    positionQuery = 'SELECT COUNT(*) + 1 as pos FROM users WHERE total_value > (SELECT COALESCE(total_value, 0) FROM users WHERE id = ?)';
                    break;
            }

            if (positionQuery && type !== 'guild' && type !== 'bonbons' && type !== 'citrouilles' && type !== 'rubans' && type !== 'coeurs' && type !== 'points_part2' && type !== 'valeur') {
                try {
                    // Requête de position
                    let posResult;
                    if (type === 'level') {
                        posResult = db.prepare(positionQuery).get(userId, userId, userId);
                    } else {
                        posResult = db.prepare(positionQuery).get(userId);
                    }
                    userPosition = posResult ? posResult.pos : null;

                    // Requête du score de l'utilisateur
                    let scoreQuery = '';
                    switch (type) {
                        case 'stars':
                            scoreQuery = effectiveAllTime ? 'SELECT max_stars as score FROM users WHERE id = ?' : 'SELECT stars as score FROM users WHERE id = ?';
                            break;
                        case 'level':
                            scoreQuery = 'SELECT level as score FROM users WHERE id = ?';
                            break;
                        case 'points':
                            scoreQuery = effectiveAllTime ? 'SELECT max_points as score FROM users WHERE id = ?' : 'SELECT points as score FROM users WHERE id = ?';
                            break;
                        case 'counting':
                            scoreQuery = 'SELECT points_comptage as score FROM users WHERE id = ?';
                            break;
                        case 'streak':
                            scoreQuery = 'SELECT streak as score FROM users WHERE id = ?';
                            break;
                    }
                    if (scoreQuery) {
                        const scoreResult = db.prepare(scoreQuery).get(userId);
                        userScore = scoreResult ? scoreResult.score : 0;
                    }
                } catch (err) {
                    // Ignore errors for position calculation
                }
            }

            // Afficher la position personnelle si disponible
            if (userPosition !== null && userScore !== null) {
                const positionText = new TextDisplayBuilder()
                    .setContent(`📍 **Ta position:** #${userPosition} avec ${userScore.toLocaleString('fr-FR')} ${unit}`);
                container.addTextDisplayComponents(positionText);
            }

            // Position spéciale pour valeur (utilise getUserValueRank)
            if (type === 'valeur') {
                const myRank = getUserValueRank(userId);
                const myUser = db.prepare('SELECT total_value FROM users WHERE id = ?').get(userId);
                if (myRank && myUser) {
                    const positionText = new TextDisplayBuilder()
                        .setContent(`📍 **Ta position:** #${myRank} avec ${(myUser.total_value || 0).toLocaleString('fr-FR')} valeur`);
                    container.addTextDisplayComponents(positionText);
                }
            }

            return container;
        };

        const initialContainer = generateLeaderboard(currentType, isAllTime);

        const selectMenu = new StringSelectMenuBuilder()
            .setCustomId('leaderboard_select')
            .setPlaceholder('Choisir un classement')
            .addOptions([
                { label: 'Stars', value: 'stars', emoji: '💸', description: 'Classement par richesse' },
                { label: 'Niveaux', value: 'level', emoji: '⭐', description: 'Classement par niveau' },
                { label: 'Guildes', value: 'guild', emoji: '🛡️', description: 'Classement des guildes' },
                { label: 'Points de Rang', value: 'points', emoji: '🏆', description: 'Classement RP' },
                { label: 'Comptage', value: 'counting', emoji: '🔢', description: 'Classement du comptage' },
                { label: 'Streaks', value: 'streak', emoji: '🔥', description: 'Classement par série de jours' },
                { label: 'Valeur', value: 'valeur', emoji: '💎', description: 'Classement par valeur totale' },
            ]);

        // Add event options if active
        const halloweenActive = dbHalloween.getEventState('halloween');
        const christmasActive = dbNoel.getEventState('noël');
        const valentineActive = dbValentin.getEventState('valentin');

        if (halloweenActive) {
            selectMenu.addOptions([
                { label: 'Bonbons', value: 'bonbons', emoji: '🍬', description: 'Classement par bonbons' },
                { label: 'Citrouilles', value: 'citrouilles', emoji: '🎃', description: 'Classement par citrouilles' }
            ]);
        }
        if (christmasActive) {
            selectMenu.addOptions([
                { label: 'Rubans', value: 'rubans', emoji: '🎀', description: 'Classement par rubans' }
            ]);
        }
        if (valentineActive) {
            selectMenu.addOptions([
                { label: 'Cœurs', value: 'coeurs', emoji: '💕', description: 'Classement par cœurs' }
            ]);
        }

        // Button to toggle All-Time
        const allTimeButton = new ButtonBuilder()
            .setCustomId('toggle_all_time')
            .setLabel('Voir All Time')
            .setStyle(ButtonStyle.Secondary)
            .setEmoji('📅');

        const row = new ActionRowBuilder().addComponents(selectMenu);
        const rowButtons = new ActionRowBuilder().addComponents(allTimeButton);

        // Update button state based on current selection compatibility
        if (!['stars', 'points'].includes(currentType)) {
            allTimeButton.setDisabled(true);
        } else {
            allTimeButton.setDisabled(false);
        }

        initialContainer.addActionRowComponents(row);
        initialContainer.addActionRowComponents(rowButtons);

        const response = await interaction.reply({
            components: [initialContainer],
            flags: MessageFlags.IsComponentsV2,
            ephemeral: false
        });

        const collector = response.createMessageComponentCollector({
            time: 5 * 60 * 1000,
        });

        collector.on('collect', async (i) => {
            if (i.user.id !== userId) {
                return i.reply({ content: 'Vous ne pouvez pas modifier ce classement.', ephemeral: true });
            }

            if (i.customId === 'leaderboard_select') {
                currentType = i.values[0];
                isAllTime = false; // Reset toggle when changing category
            } else if (i.customId === 'toggle_all_time') {
                isAllTime = !isAllTime;
            }

            const newContainer = generateLeaderboard(currentType, isAllTime);

            // Recreate components to update state
            const newSelectMenu = StringSelectMenuBuilder.from(selectMenu);
            // Ideally set the default value of select menu to currentType
            // But StringSelectMenuBuilder.from copies everything, we just need to know it's stateless by default in this flow logic
            // unless we specifically set default values in options. 
            // For simplicity we keep it as is, or we could update options to set 'default: true' on selected.

            const newAllTimeButton = ButtonBuilder.from(allTimeButton);
            if (isAllTime) {
                newAllTimeButton.setLabel('Voir Actuel').setStyle(ButtonStyle.Primary);
            } else {
                newAllTimeButton.setLabel('Voir All Time').setStyle(ButtonStyle.Secondary);
            }

            if (!['stars', 'points'].includes(currentType)) {
                newAllTimeButton.setDisabled(true);
                isAllTime = false;
            } else {
                newAllTimeButton.setDisabled(false);
            }

            const newRow = new ActionRowBuilder().addComponents(newSelectMenu);
            const newRowButtons = new ActionRowBuilder().addComponents(newAllTimeButton);

            newContainer.addActionRowComponents(newRow);
            newContainer.addActionRowComponents(newRowButtons);

            try {
                await i.update({
                    components: [newContainer],
                    flags: MessageFlags.IsComponentsV2
                });
            } catch (error) {
                if (error.code !== 10062) { // Ignore Unknown interaction
                    logger.error('Erreur lors de la mise à jour du classement:', error);
                }
            }
        });

        collector.on('end', () => {
            // Cleanup if needed
        });
    },
};