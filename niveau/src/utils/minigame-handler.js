
const { getGame, updateGame, endGame } = require('./minigame-system');
const { getOrCreateUser, updateUserBalance, updateUserItemQuantity } = require('./db-users');
const { adjustWarInitialValues } = require('./guild/guild-wars');
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, EmbedBuilder, ContainerBuilder, TextDisplayBuilder, MessageFlags } = require('discord.js');
const { checkQuestProgress } = require('./quests');

async function handleGameInteraction(interaction) {
    // Parse custom ID format: "action-gameId" or "action-gameId-choice"
    const parts = interaction.customId.split('-');
    const action = parts[0];

    let gameId, choice;
    if (parts.length === 2) {
        // Format: "accept-gameId" or "decline-gameId"
        gameId = parts[1];
    } else if (parts.length === 3) {
        // Format: "rps-gameId-choice" or "morpion-gameId-choice" etc
        gameId = parts[1];
        choice = parts[2];
    }

    const game = getGame(gameId);

    if (!game) {
        const errorText = new TextDisplayBuilder().setContent("Ce jeu n'existe plus.");
        const container = new ContainerBuilder().addTextDisplayComponents(errorText);
        return interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2, ephemeral: true });
    }

    if (action === 'accept') {
        if (interaction.user.id !== game.player2.id) {
            const errorText = new TextDisplayBuilder().setContent("Vous n'êtes pas l'adversaire de ce jeu.");
            const container = new ContainerBuilder().addTextDisplayComponents(errorText);
            return interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2, ephemeral: true });
        }

        // Vérifier que l'adversaire (player2) a assez de starss pour couvrir la mise
        const betAmount = parseInt(game.bet) || 0;
        if (betAmount > 0) {
            const player2Data = getOrCreateUser(game.player2.id, game.player2.username);
            if (player2Data.stars < betAmount) {
                const errorText = new TextDisplayBuilder()
                    .setContent(`❌ Vous n'avez que **${player2Data.stars.toLocaleString('fr-FR')}** starss. Vous ne pouvez pas accepter une mise de **${betAmount.toLocaleString('fr-FR')}** starss.`);
                const container = new ContainerBuilder().addTextDisplayComponents(errorText);
                return interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2, ephemeral: true });
            }
        }

        updateGame(gameId, { status: 'accepted' });

        if (game.type === 'rps') {
            const row = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId(`rps-${gameId}-rock`)
                        .setLabel('Pierre')
                        .setStyle(ButtonStyle.Primary),
                    new ButtonBuilder()
                        .setCustomId(`rps-${gameId}-paper`)
                        .setLabel('Feuille')
                        .setStyle(ButtonStyle.Primary),
                    new ButtonBuilder()
                        .setCustomId(`rps-${gameId}-scissors`)
                        .setLabel('Ciseaux')
                        .setStyle(ButtonStyle.Primary)
                );

            const startText = new TextDisplayBuilder().setContent(`Le jeu a commencé! Faites votre choix.`);
            const container = new ContainerBuilder()
                .addTextDisplayComponents(startText)
                .addActionRowComponents(row);
            await interaction.update({ components: [container], flags: MessageFlags.IsComponentsV2 });
        } else if (game.type === 'morpion') {
            const board = Array(9).fill(null); // 3x3 board
            updateGame(gameId, { board: board, turn: game.player1.id });
            const startText = new TextDisplayBuilder().setContent(`Le jeu a commencé! C'est au tour de <@${game.player1.id}>.`);
            const container = new ContainerBuilder()
                .addTextDisplayComponents(startText)
                .addActionRowComponents(...createMorpionBoard(gameId, board));
            await interaction.update({ components: [container], flags: MessageFlags.IsComponentsV2 });
        } else if (game.type === 'puissance4') {
            const board = Array(42).fill(null); // 6 rows x 7 columns
            updateGame(gameId, { board: board, turn: game.player1.id });

            // Créer l'affichage du board (V2)
            const boardText = createPuissance4TextDisplay({ ...game, board: board }, game.player1.id);
            const container = new ContainerBuilder().addTextDisplayComponents(boardText);

            const message = await interaction.update({ components: [container], flags: MessageFlags.IsComponentsV2, fetchReply: true });

            // Ajouter les réactions pour les colonnes
            const reactions = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣'];
            for (const emoji of reactions) {
                await message.react(emoji);
            }

            // Stocker l'ID du message dans le jeu
            updateGame(gameId, { messageId: message.id, channelId: message.channel.id });
        }

    } else if (action === 'decline') {
        if (interaction.user.id !== game.player2.id) {
            const errorText = new TextDisplayBuilder().setContent("Vous n'êtes pas l'adversaire de ce jeu.");
            const container = new ContainerBuilder().addTextDisplayComponents(errorText);
            return interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2, ephemeral: true });
        }

        endGame(gameId);
        const declineText = new TextDisplayBuilder().setContent("Vous avez refusé le jeu.");
        const container = new ContainerBuilder().addTextDisplayComponents(declineText);
        await interaction.update({ components: [container], flags: MessageFlags.IsComponentsV2 });

    } else if (action === 'rps') {
        const player = interaction.user.id === game.player1.id ? 'player1' : 'player2';
        game[player].choice = choice;
        updateGame(gameId, game);

        if (game.player1.choice && game.player2.choice) {
            // Determine winner
            const winner = determineRpsWinner(game.player1, game.player2);
            const betAmount = parseInt(game.bet) || 0;

            // Mapper les choix
            const choiceDisplay = {
                'rock': 'Pierre 🪨',
                'paper': 'Papier 📄',
                'scissors': 'Ciseaux ✂️'
            };

            if (winner) {
                const winnerUser = winner === 'player1' ? game.player1 : game.player2;
                const loserUser = winner === 'player1' ? game.player2 : game.player1;

                // Handle bet
                if (isNaN(game.bet)) { // Item bet
                    updateUserItemQuantity(loserUser.id, game.bet, -1);
                    updateUserItemQuantity(winnerUser.id, game.bet, 1);
                } else { // Starss bet - SANS multiplicateurs
                    updateUserBalance(loserUser.id, { stars: -betAmount });
                    updateUserBalance(winnerUser.id, { stars: betAmount });
                    // Ajuster les valeurs de guerre pour éviter l'exploit de farming
                    adjustWarInitialValues(loserUser.id, { stars: -betAmount });
                    adjustWarInitialValues(winnerUser.id, { stars: betAmount });
                }

                // Créer l'affichage de fin (V2 TextDisplay)
                let endContent = '';
                if (betAmount > 0) {
                    const p1Before = getOrCreateUser(winner === 'player1' ? loserUser.id : winnerUser.id).stars;
                    const p2Before = getOrCreateUser(winner === 'player1' ? winnerUser.id : loserUser.id).stars;
                    const p1After = getOrCreateUser(winner === 'player1' ? loserUser.id : winnerUser.id).stars;
                    const p2After = getOrCreateUser(winner === 'player1' ? winnerUser.id : loserUser.id).stars;

                    endContent = `# 🎉 PIERRE-PAPIER-CISEAUX - FIN DE PARTIE 🎉\n` +
                        `**${game.player1.username} vs ${game.player2.username}**\n` +
                        `${winnerUser.username} a gagné!\n` +
                        `Il vient de gagner ${betAmount} starss\n\n` +
                        `### Résultats\n` +
                        `${game.player1.username}: ${choiceDisplay[game.player1.choice]}\n` +
                        `${game.player2.username}: ${choiceDisplay[game.player2.choice]}\n\n` +
                        `### ${winnerUser.username} - GAGNANT\n` +
                        `Avant: ${p2Before}\nGagné: +${betAmount}\nAprès: ${p2After}\n\n` +
                        `### ${loserUser.username} - PERDANT\n` +
                        `Avant: ${p1Before}\nPerdu: -${betAmount}\nAprès: ${p1After}`;
                } else {
                    endContent = `# 🎉 PIERRE-PAPIER-CISEAUX - FIN DE PARTIE 🎉\n` +
                        `**${winnerUser.username} a gagné!**\n\n` +
                        `### Résultats\n` +
                        `${game.player1.username}: ${choiceDisplay[game.player1.choice]}\n` +
                        `${game.player2.username}: ${choiceDisplay[game.player2.choice]}`;
                }

                // Check Quests
                checkQuestProgress(interaction.client, 'MINIGAME_WIN', winnerUser);
                try {
                    const { trackMinijeuWinForReborn } = require('./rebornQuestBridge');
                    trackMinijeuWinForReborn(winnerUser.id);
                } catch { /* optional reborn */ }

                const endText = new TextDisplayBuilder().setContent(endContent);

                // Créer les boutons bloqués pour afficher les choix
                const row = new ActionRowBuilder()
                    .addComponents(
                        new ButtonBuilder()
                            .setCustomId(`rps-${gameId}-rock`)
                            .setLabel('Pierre')
                            .setStyle(ButtonStyle.Primary)
                            .setDisabled(true),
                        new ButtonBuilder()
                            .setCustomId(`rps-${gameId}-paper`)
                            .setLabel('Papier')
                            .setStyle(ButtonStyle.Primary)
                            .setDisabled(true),
                        new ButtonBuilder()
                            .setCustomId(`rps-${gameId}-scissors`)
                            .setLabel('Ciseaux')
                            .setStyle(ButtonStyle.Primary)
                            .setDisabled(true)
                    );

                const container = new ContainerBuilder()
                    .addTextDisplayComponents(endText)
                    .addActionRowComponents(row);

                await interaction.update({ components: [container], flags: MessageFlags.IsComponentsV2 });
                // FollowUp is not needed if we updated the message with the result, but logic was to update buttons then send embed.
                // In V2, we can just update the whole container.
                // But wait, the original logic was: update buttons to disabled, THEN send new message with result.
                // If we want to keep that flow:
                // 1. Update buttons (disabled)
                // 2. FollowUp with result
                // But V2 allows replacing everything. Let's just replace the game UI with the result UI + disabled buttons.
                // So the above `interaction.update` is enough.
                // Removing the followUp.
            } else {
                // Draw
                const drawContent = `# 🤝 PIERRE-PAPIER-CISEAUX - ÉGALITÉ 🤝\n` +
                    `Les deux joueurs ont choisi: ${choiceDisplay[game.player1.choice]}`;

                const drawText = new TextDisplayBuilder().setContent(drawContent);

                const row = new ActionRowBuilder()
                    .addComponents(
                        new ButtonBuilder()
                            .setCustomId(`rps-${gameId}-rock`)
                            .setLabel('Pierre')
                            .setStyle(ButtonStyle.Primary)
                            .setDisabled(true),
                        new ButtonBuilder()
                            .setCustomId(`rps-${gameId}-paper`)
                            .setLabel('Papier')
                            .setStyle(ButtonStyle.Primary)
                            .setDisabled(true),
                        new ButtonBuilder()
                            .setCustomId(`rps-${gameId}-scissors`)
                            .setLabel('Ciseaux')
                            .setStyle(ButtonStyle.Primary)
                            .setDisabled(true)
                    );

                const container = new ContainerBuilder()
                    .addTextDisplayComponents(drawText)
                    .addActionRowComponents(row);

                await interaction.update({ components: [container], flags: MessageFlags.IsComponentsV2 });
            }

            endGame(gameId);
        } else {
            const confirmText = new TextDisplayBuilder().setContent('Votre choix a été enregistré.');
            const container = new ContainerBuilder().addTextDisplayComponents(confirmText);
            await interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2, ephemeral: true });
        }
    } else if (action === 'morpion') {
        if (interaction.user.id !== game.turn) {
            const errorText = new TextDisplayBuilder().setContent("Ce n'est pas votre tour.");
            const container = new ContainerBuilder().addTextDisplayComponents(errorText);
            return interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2, ephemeral: true });
        }

        const position = parseInt(choice);
        if (game.board[position] !== null) {
            const errorText = new TextDisplayBuilder().setContent("Cette case est déjà prise.");
            const container = new ContainerBuilder().addTextDisplayComponents(errorText);
            return interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2, ephemeral: true });
        }

        game.board[position] = game.turn === game.player1.id ? 'X' : 'O';
        game.turn = game.turn === game.player1.id ? game.player2.id : game.player1.id;
        updateGame(gameId, game);

        const winner = checkMorpionWinner(game.board);
        if (winner) {
            const winnerUser = winner === 'X' ? game.player1 : game.player2;
            const loserUser = winner === 'X' ? game.player2 : game.player1;
            const betAmount = parseInt(game.bet) || 0;

            // Handle bet
            if (isNaN(game.bet)) { // Item bet
                updateUserItemQuantity(loserUser.id, game.bet, -1);
                updateUserItemQuantity(winnerUser.id, game.bet, 1);
            } else { // Starss bet - SANS multiplicateurs
                updateUserBalance(loserUser.id, { stars: -betAmount });
                updateUserBalance(winnerUser.id, { stars: betAmount });
                // Ajuster les valeurs de guerre pour éviter l'exploit de farming
                adjustWarInitialValues(loserUser.id, { stars: -betAmount });
                adjustWarInitialValues(winnerUser.id, { stars: betAmount });
            }

            // Créer l'affichage de fin (V2 TextDisplay)
            let endContent = '';
            if (betAmount > 0) {
                const p1Before = getOrCreateUser(winner === 'X' ? loserUser.id : winnerUser.id).stars;
                const p2Before = getOrCreateUser(winner === 'X' ? winnerUser.id : loserUser.id).stars;
                const p1After = getOrCreateUser(winner === 'X' ? loserUser.id : winnerUser.id).stars;
                const p2After = getOrCreateUser(winner === 'X' ? winnerUser.id : loserUser.id).stars;

                endContent = `# 🎉 MORPION - FIN DE PARTIE 🎉\n` +
                    `**${winnerUser.username} a gagné!**\n` +
                    `Il vient de gagner ${betAmount} starss\n\n` +
                    `### ${winnerUser.username} (❌) - GAGNANT\n` +
                    `Avant: ${p2Before}\nGagné: +${betAmount}\nAprès: ${p2After}\n\n` +
                    `### ${loserUser.username} (⭕) - PERDANT\n` +
                    `Avant: ${p1Before}\nPerdu: -${betAmount}\nAprès: ${p1After}`;
            } else {
                endContent = `# 🎉 MORPION - FIN DE PARTIE 🎉\n` +
                    `**${winnerUser.username} a gagné!**`;
            }

            // Check Quests
            checkQuestProgress(interaction.client, 'MINIGAME_WIN', winnerUser);
            try {
                const { trackMinijeuWinForReborn } = require('./rebornQuestBridge');
                trackMinijeuWinForReborn(winnerUser.id);
            } catch { /* optional reborn */ }

            const endText = new TextDisplayBuilder().setContent(endContent);

            // Mettre à jour le board (boutons bloqués mais pas supprimés)
            const container = new ContainerBuilder()
                .addTextDisplayComponents(endText)
                .addActionRowComponents(...createMorpionBoard(gameId, game.board, true));

            await interaction.update({ components: [container], flags: MessageFlags.IsComponentsV2 });

            // Poster le message de fin avec mention du gagnant (Optionnel en V2 car on a déjà tout affiché, mais pour la mention...)
            // On peut ajouter la mention dans le TextDisplay ou faire un followUp.
            // Le TextDisplay supporte les mentions.
            // Mais pour notifier, un message séparé est mieux.
            // Poster le message de fin avec mention du gagnant (Optionnel en V2 car on a déjà tout affiché, mais pour la mention...)
            // On peut ajouter la mention dans le TextDisplay ou faire un followUp.
            // Le TextDisplay supporte les mentions.
            // Mais pour notifier, un message séparé est mieux.
            const mentionText = new TextDisplayBuilder().setContent(`<@${winnerUser.id}>`);
            const mentionContainer = new ContainerBuilder().addTextDisplayComponents(mentionText);
            await interaction.followUp({ components: [mentionContainer], flags: MessageFlags.IsComponentsV2 });
            endGame(gameId);
        } else if (game.board.every(cell => cell !== null)) {
            // Draw
            const drawContent = `# 🤝 MORPION - ÉGALITÉ 🤝\nLe plateau est rempli. Aucun gagnant!`;
            const drawText = new TextDisplayBuilder().setContent(drawContent);

            const container = new ContainerBuilder()
                .addTextDisplayComponents(drawText)
                .addActionRowComponents(...createMorpionBoard(gameId, game.board, true));

            await interaction.update({ components: [container], flags: MessageFlags.IsComponentsV2 });
            endGame(gameId);
        } else {
            const turnText = new TextDisplayBuilder().setContent(`C'est au tour de <@${game.turn}>.`);
            const container = new ContainerBuilder()
                .addTextDisplayComponents(turnText)
                .addActionRowComponents(...createMorpionBoard(gameId, game.board));
            await interaction.update({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }
    }
}


function createMorpionBoard(gameId, board, allDisabled = false) {
    const rows = [];
    for (let i = 0; i < 3; i++) {
        const row = new ActionRowBuilder();
        for (let j = 0; j < 3; j++) {
            const index = i * 3 + j;
            const cellValue = board[index];
            let label = '⬜'; // Case vide
            let style = ButtonStyle.Secondary;

            if (cellValue === 'X') {
                label = '❌';
                style = ButtonStyle.Danger;
            } else if (cellValue === 'O') {
                label = '⭕';
                style = ButtonStyle.Success;
            }

            row.addComponents(
                new ButtonBuilder()
                    .setCustomId(`morpion-${gameId}-${index}`)
                    .setLabel(label)
                    .setStyle(style)
                    .setDisabled(allDisabled || cellValue !== null)
            );
        }
        rows.push(row);
    }
    return rows;
}

function checkMorpionWinner(board) {
    const lines = [
        [0, 1, 2], [3, 4, 5], [6, 7, 8], // rows
        [0, 3, 6], [1, 4, 7], [2, 5, 8], // columns
        [0, 4, 8], [2, 4, 6] // diagonals
    ];

    for (const line of lines) {
        const [a, b, c] = line;
        if (board[a] && board[a] === board[b] && board[a] === board[c]) {
            return board[a];
        }
    }

    return null;
}

function determineRpsWinner(player1, player2) {
    if (player1.choice === player2.choice) {
        return null; // Draw
    }

    if (
        (player1.choice === 'rock' && player2.choice === 'scissors') ||
        (player1.choice === 'paper' && player2.choice === 'rock') ||
        (player1.choice === 'scissors' && player2.choice === 'paper')
    ) {
        return 'player1';
    } else {
        return 'player2';
    }
}

function createPuissance4Board(gameId, board) {
    // Créer une représentation visuelle du board en texte
    let boardDisplay = '```\n';
    for (let i = 0; i < 6; i++) {
        for (let j = 0; j < 7; j++) {
            const index = i * 7 + j;
            const cell = board[index];
            if (cell === 'X') {
                boardDisplay += '🔴 ';
            } else if (cell === 'O') {
                boardDisplay += '🟡 ';
            } else {
                boardDisplay += '⚪ ';
            }
        }
        boardDisplay += '\n';
    }
    boardDisplay += '1️⃣ 2️⃣ 3️⃣ 4️⃣ 5️⃣ 6️⃣ 7️⃣\n```';

    // Créer les boutons pour choisir une colonne (2 lignes de boutons)
    const row1 = new ActionRowBuilder();
    const row2 = new ActionRowBuilder();

    for (let col = 0; col < 7; col++) {
        // Vérifier si la colonne est pleine
        let isFull = true;
        for (let row = 0; row < 6; row++) {
            if (board[row * 7 + col] === null) {
                isFull = false;
                break;
            }
        }

        const button = new ButtonBuilder()
            .setCustomId(`puissance4-${gameId}-${col}`)
            .setLabel(`${col + 1}`)
            .setStyle(ButtonStyle.Primary)
            .setDisabled(isFull);

        if (col < 4) {
            row1.addComponents(button);
        } else {
            row2.addComponents(button);
        }
    }

    return 'player2';
}

// Fonction pour créer l'affichage du Puissance 4 (V2)
function createPuissance4TextDisplay(game, currentPlayer) {
    const board = game.board;
    const isPlayer1Turn = currentPlayer === game.player1.id;

    // Créer la grille avec les numéraux intégrés
    let gridText = '```\n';

    // Première ligne avec les numéraux
    gridText += '1️⃣  2️⃣  3️⃣  4️⃣  5️⃣  6️⃣  7️⃣\n';
    gridText += '─────────────────────────\n';

    for (let i = 0; i < 6; i++) {
        for (let j = 0; j < 7; j++) {
            const index = i * 7 + j;
            const cell = board[index];

            let emoji;
            if (cell === '🟡') {
                emoji = '🟡';
            } else if (cell === '🔴') {
                emoji = '🔴';
            } else {
                // Les cases vides changent de couleur selon le joueur
                emoji = isPlayer1Turn ? '⚫' : '⚪';
            }
            gridText += emoji + '  ';
        }
        gridText += '\n';
    }
    gridText += '```';

    const content = `# 🎮 PUISSANCE 4 🎮\n` +
        `${gridText}\n\n` +
        `**Joueur 1 (🟡)**: <@${game.player1.id}>\n` +
        `**Joueur 2 (🔴)**: <@${game.player2.id}>\n\n` +
        `### 👤 À jouer: <@${currentPlayer}>\n` +
        `*Réagissez avec 1️⃣-7️⃣ pour jouer*`;

    return new TextDisplayBuilder().setContent(content);
}

// Handler pour les réactions du Puissance 4
async function handlePuissance4Reaction(reaction, user, client) {
    // const { getGame, updateGame, endGame } = require('./minigame-system'); // Removed redundant require

    // Ignorer les réactions parasites
    const validEmojis = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣'];
    if (!validEmojis.includes(reaction.emoji.name)) {
        return;
    }

    // Trouver le jeu correspondant au message
    const games = require('./minigame-system').games || {};
    let targetGame = null;
    let targetGameId = null;

    for (const [gameId, game] of Object.entries(games)) {
        if (game.messageId === reaction.message.id && game.type === 'puissance4') {
            targetGame = game;
            targetGameId = gameId;
            break;
        }
    }

    if (!targetGame) return;

    // Retirer la réaction immédiatement (que ce soit le bon joueur ou pas)
    try {
        await reaction.users.remove(user.id);
    } catch (error) {
        // Ignorer l'erreur si la réaction ne peut pas être retirée
    }

    // Vérifier que c'est le bon joueur
    if (user.id !== targetGame.turn) {
        return; // Ignorer les réactions parasites
    }

    // Mapper les emojis aux colonnes
    const emojiToColumn = {
        '1️⃣': 0, '2️⃣': 1, '3️⃣': 2, '4️⃣': 3,
        '5️⃣': 4, '6️⃣': 5, '7️⃣': 6
    };

    const column = emojiToColumn[reaction.emoji.name];
    if (column === undefined) return;

    // Trouver la ligne la plus basse disponible (lois de la physique)
    let row = -1;
    for (let i = 5; i >= 0; i--) {
        if (targetGame.board[i * 7 + column] === null) {
            row = i;
            break;
        }
    }

    if (row === -1) return; // Colonne pleine

    // Placer le jeton (🟡 pour joueur 1, 🔴 pour joueur 2)
    targetGame.board[row * 7 + column] = targetGame.turn === targetGame.player1.id ? '🟡' : '🔴';
    targetGame.turn = targetGame.turn === targetGame.player1.id ? targetGame.player2.id : targetGame.player1.id;
    updateGame(targetGameId, targetGame);

    // Vérifier le gagnant
    const winner = checkPuissance4Winner(targetGame.board);

    if (winner) {
        const winnerSymbol = winner;
        const winnerPlayer = winner === '🟡' ? targetGame.player1 : targetGame.player2;
        const loserPlayer = winner === '🟡' ? targetGame.player2 : targetGame.player1;

        // Récupérer l'argent avant la mise
        const p1Before = winner === '🟡' ? getOrCreateUser(loserPlayer.id).stars : getOrCreateUser(winnerPlayer.id).stars;
        const p2Before = winner === '🟡' ? getOrCreateUser(winnerPlayer.id).stars : getOrCreateUser(loserPlayer.id).stars;

        // Handle bet
        const betAmount = parseInt(targetGame.bet) || 0;
        if (isNaN(targetGame.bet)) {
            updateUserItemQuantity(loserPlayer.id, targetGame.bet, -1);
            updateUserItemQuantity(winnerPlayer.id, targetGame.bet, 1);
        } else {
            updateUserBalance(loserPlayer.id, { stars: -betAmount });
            updateUserBalance(winnerPlayer.id, { stars: betAmount });
            // Ajuster les valeurs de guerre pour éviter l'exploit de farming
            adjustWarInitialValues(loserPlayer.id, { stars: -betAmount });
            adjustWarInitialValues(winnerPlayer.id, { stars: betAmount });
        }

        // Récupérer l'argent après la mise
        const p1After = getOrCreateUser(winner === '🟡' ? loserPlayer.id : winnerPlayer.id).stars;
        const p2After = getOrCreateUser(winner === '🟡' ? winnerPlayer.id : loserPlayer.id).stars;

        // Créer l'affichage de fin (V2)
        const boardText = createPuissance4TextDisplay(targetGame, null);
        const boardContainer = new ContainerBuilder().addTextDisplayComponents(boardText);

        // Vérifier s'il y a une mise
        const hasBet = betAmount > 0;

        let endContent;
        if (hasBet) {
            endContent = `# 🎉 PUISSANCE 4 - FIN DE PARTIE 🎉\n` +
                `**${winnerPlayer.username} a gagné!**\n` +
                `Il vient de gagner ${betAmount} starss\n\n` +
                `### ${winnerPlayer.username} (🟡) - GAGNANT\n` +
                `Avant: ${p2Before}\nGagné: +${betAmount}\nAprès: ${p2After}\n\n` +
                `### ${loserPlayer.username} (🔴) - PERDANT\n` +
                `Avant: ${p1Before}\nPerdu: -${betAmount}\nAprès: ${p1After}`;
        } else {
            endContent = `# 🎉 PUISSANCE 4 - FIN DE PARTIE 🎉\n` +
                `**${winnerPlayer.username} a gagné!**`;
        }

        // Check Quests
        checkQuestProgress(reaction.client, 'MINIGAME_WIN', winnerPlayer);
        try {
            const { trackMinijeuWinForReborn } = require('./rebornQuestBridge');
            trackMinijeuWinForReborn(winnerPlayer.id);
        } catch { /* optional reborn */ }

        const endText = new TextDisplayBuilder().setContent(endContent);
        const endContainer = new ContainerBuilder().addTextDisplayComponents(endText);

        // Poster le message de fin avec mention du gagnant
        // Poster le message de fin avec mention du gagnant
        const mentionText = new TextDisplayBuilder().setContent(`<@${winnerPlayer.id}>`);
        const mentionContainer = new ContainerBuilder().addTextDisplayComponents(mentionText);
        await reaction.message.channel.send({ components: [mentionContainer, endContainer], flags: MessageFlags.IsComponentsV2 });

        // Mettre à jour le board avec l'affichage final
        await reaction.message.edit({ components: [boardContainer], flags: MessageFlags.IsComponentsV2 });
        await reaction.message.reactions.removeAll();
        endGame(targetGameId);
    } else if (targetGame.board.every(cell => cell !== null)) {
        // Égalité
        const boardText = createPuissance4TextDisplay(targetGame, null);
        const boardContainer = new ContainerBuilder().addTextDisplayComponents(boardText);

        const drawContent = `# 🤝 PUISSANCE 4 - ÉGALITÉ 🤝\nLe plateau est rempli. Aucun gagnant!`;
        const drawText = new TextDisplayBuilder().setContent(drawContent);
        const drawContainer = new ContainerBuilder().addTextDisplayComponents(drawText);

        await reaction.message.channel.send({ components: [drawContainer], flags: MessageFlags.IsComponentsV2 });
        await reaction.message.edit({ components: [boardContainer], flags: MessageFlags.IsComponentsV2 });
        await reaction.message.reactions.removeAll();
        endGame(targetGameId);
    } else {
        // Continuer le jeu
        const boardText = createPuissance4TextDisplay(targetGame, targetGame.turn);
        const boardContainer = new ContainerBuilder().addTextDisplayComponents(boardText);
        await reaction.message.edit({ components: [boardContainer], flags: MessageFlags.IsComponentsV2 });
    }
}

function checkPuissance4Winner(board) {
    // Vérifier les lignes
    for (let i = 0; i < 6; i++) {
        for (let j = 0; j < 7; j++) {
            const index = i * 7 + j;
            if (board[index] && j + 3 < 7) {
                if (board[index] === board[i * 7 + j + 1] &&
                    board[index] === board[i * 7 + j + 2] &&
                    board[index] === board[i * 7 + j + 3]) {
                    return board[index];
                }
            }
        }
    }

    // Vérifier les colonnes
    for (let i = 0; i < 6; i++) {
        for (let j = 0; j < 7; j++) {
            const index = i * 7 + j;
            if (board[index] && i + 3 < 6) {
                if (board[index] === board[(i + 1) * 7 + j] &&
                    board[index] === board[(i + 2) * 7 + j] &&
                    board[index] === board[(i + 3) * 7 + j]) {
                    return board[index];
                }
            }
        }
    }

    // Vérifier les diagonales (bas-droit)
    for (let i = 0; i < 6; i++) {
        for (let j = 0; j < 7; j++) {
            const index = i * 7 + j;
            if (board[index] && i + 3 < 6 && j + 3 < 7) {
                if (board[index] === board[(i + 1) * 7 + j + 1] &&
                    board[index] === board[(i + 2) * 7 + j + 2] &&
                    board[index] === board[(i + 3) * 7 + j + 3]) {
                    return board[index];
                }
            }
        }
    }

    // Vérifier les diagonales (bas-gauche)
    for (let i = 0; i < 6; i++) {
        for (let j = 3; j < 7; j++) {
            const index = i * 7 + j;
            if (board[index] && i + 3 < 6 && j - 3 >= 0) {
                if (board[index] === board[(i + 1) * 7 + j - 1] &&
                    board[index] === board[(i + 2) * 7 + j - 2] &&
                    board[index] === board[(i + 3) * 7 + j - 3]) {
                    return board[index];
                }
            }
        }
    }

    return null;
}

module.exports = { handleGameInteraction, handlePuissance4Reaction };
