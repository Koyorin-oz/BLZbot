const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, ContainerBuilder, TextDisplayBuilder, MessageFlags } = require('discord.js');
const { startGame, getGame, updateGame, endGame } = require('../../utils/minigame-system');
const { getOrCreateUser, grantResources, updateUserItemQuantity } = require('../../utils/db-users');
const { getTotalDebt } = require('../../utils/loan-system');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('minijeu')
        .setDescription('Jouer à des mini-jeux.')
        .addSubcommand(subcommand =>
            subcommand
                .setName('morpion')
                .setDescription('Jouer au morpion.')
                .addUserOption(option => option.setName('adversaire').setDescription('L\'adversaire à défier').setRequired(true))
                .addStringOption(option => option.setName('mise').setDescription('La mise (starss ou objet)').setRequired(false)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('puissance4')
                .setDescription('Jouer au Puissance 4.')
                .addUserOption(option => option.setName('adversaire').setDescription('L\'adversaire à défier').setRequired(true))
                .addStringOption(option => option.setName('mise').setDescription('La mise (starss ou objet)').setRequired(false)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('pierre-feuille-ciseaux')
                .setDescription('Jouer à Pierre, feuille, ciseaux.')
                .addUserOption(option => option.setName('adversaire').setDescription('L\'adversaire à défier').setRequired(true))
                .addStringOption(option => option.setName('mise').setDescription('La mise (starss ou objet)').setRequired(false))),
    async execute(interaction) {
        try {
            await interaction.deferReply();
            const subcommand = interaction.options.getSubcommand();

            if (subcommand === 'pierre-feuille-ciseaux') {
                const opponent = interaction.options.getUser('adversaire');

                // Empêcher de jouer contre soi-même
                if (opponent.id === interaction.user.id) {
                    const errorText = new TextDisplayBuilder().setContent('❌ Vous ne pouvez pas jouer contre vous-même !');
                    const container = new ContainerBuilder().addTextDisplayComponents(errorText);
                    return interaction.editReply({ components: [container], flags: 32768 });
                }

                const bet = interaction.options.getString('mise') || '0';
                const player1 = getOrCreateUser(interaction.user.id, interaction.user.username);

                // Vérifier la dette totale
                const totalDebt = getTotalDebt(interaction.user.id);
                if (totalDebt >= 5_000_000) {
                    const errorText = new TextDisplayBuilder().setContent(`Vous avez une dette de **${totalDebt.toLocaleString('fr-FR')}** starss. Vous ne pouvez pas jouer tant que vous n'avez pas remboursé votre dette.`);
                    const container = new ContainerBuilder().addTextDisplayComponents(errorText);
                    return interaction.editReply({ components: [container], flags: 32768 });
                }

                // Vérifier que le joueur n'a pas une mise supérieure à ses starss
                if (bet !== '0' && isNaN(bet)) {
                    // C'est un objet, pas de vérification
                } else if (bet !== '0') {
                    const betAmount = parseInt(bet);
                    if (betAmount > player1.stars) {
                        const errorText = new TextDisplayBuilder().setContent(`Vous n'avez que **${player1.stars}** starss, vous ne pouvez pas miser **${betAmount}** starss.`);
                        const container = new ContainerBuilder().addTextDisplayComponents(errorText);
                        return interaction.editReply({ components: [container], flags: 32768 });
                    }
                }

                const gameId = startGame('rps', interaction.user.id, interaction.user.username, opponent.id, opponent.username, bet);

                const row = new ActionRowBuilder()
                    .addComponents(
                        new ButtonBuilder()
                            .setCustomId(`accept-${gameId}`)
                            .setLabel('Accepter')
                            .setStyle(ButtonStyle.Success),
                        new ButtonBuilder()
                            .setCustomId(`decline-${gameId}`)
                            .setLabel('Refuser')
                            .setStyle(ButtonStyle.Danger)
                    );

                const betText = bet === '0' ? 'sans mise' : `avec une mise de ${bet}`;
                const opponentData = getOrCreateUser(opponent.id, opponent.username);
                const shouldPing = opponentData.notify_minigame_invite !== 0;

                const challengeText = new TextDisplayBuilder().setContent(`${opponent}, ${interaction.user.username} vous défie à une partie de Pierre, feuille, ciseaux ${betText}!`);
                const container = new ContainerBuilder()
                    .addTextDisplayComponents(challengeText)
                    .addActionRowComponents(row);
                await interaction.editReply({
                    components: [container],
                    flags: 32768,
                    allowedMentions: shouldPing ? undefined : { parse: [] }
                });
            } else if (subcommand === 'morpion') {
                const opponent = interaction.options.getUser('adversaire');

                // Empêcher de jouer contre soi-même
                if (opponent.id === interaction.user.id) {
                    const errorText = new TextDisplayBuilder().setContent('❌ Vous ne pouvez pas jouer contre vous-même !');
                    const container = new ContainerBuilder().addTextDisplayComponents(errorText);
                    return interaction.editReply({ components: [container], flags: 32768 });
                }

                const bet = interaction.options.getString('mise') || '0';
                const player1 = getOrCreateUser(interaction.user.id, interaction.user.username);

                // Vérifier la dette totale
                const totalDebt = getTotalDebt(interaction.user.id);
                if (totalDebt >= 5_000_000) {
                    const errorText = new TextDisplayBuilder().setContent(`Vous avez une dette de **${totalDebt.toLocaleString('fr-FR')}** starss. Vous ne pouvez pas jouer tant que vous n'avez pas remboursé votre dette.`);
                    const container = new ContainerBuilder().addTextDisplayComponents(errorText);
                    return interaction.editReply({ components: [container], flags: 32768 });
                }

                // Vérifier que le joueur n'a pas une mise supérieure à ses starss
                if (bet !== '0' && isNaN(bet)) {
                    // C'est un objet, pas de vérification
                } else if (bet !== '0') {
                    const betAmount = parseInt(bet);
                    if (betAmount > player1.stars) {
                        const errorText = new TextDisplayBuilder().setContent(`Vous n'avez que **${player1.stars}** starss, vous ne pouvez pas miser **${betAmount}** starss.`);
                        const container = new ContainerBuilder().addTextDisplayComponents(errorText);
                        return interaction.editReply({ components: [container], flags: 32768 });
                    }
                }

                const gameId = startGame('morpion', interaction.user.id, interaction.user.username, opponent.id, opponent.username, bet);

                const row = new ActionRowBuilder()
                    .addComponents(
                        new ButtonBuilder()
                            .setCustomId(`accept-${gameId}`)
                            .setLabel('Accepter')
                            .setStyle(ButtonStyle.Success),
                        new ButtonBuilder()
                            .setCustomId(`decline-${gameId}`)
                            .setLabel('Refuser')
                            .setStyle(ButtonStyle.Danger)
                    );

                const betText = bet === '0' ? 'sans mise' : `avec une mise de ${bet}`;
                const opponentData = getOrCreateUser(opponent.id, opponent.username);
                const shouldPing = opponentData.notify_minigame_invite !== 0;

                const challengeText = new TextDisplayBuilder().setContent(`${opponent}, ${interaction.user.username} vous défie à une partie de Morpion ${betText}!`);
                const container = new ContainerBuilder()
                    .addTextDisplayComponents(challengeText)
                    .addActionRowComponents(row);
                await interaction.editReply({
                    components: [container],
                    flags: 32768,
                    allowedMentions: shouldPing ? undefined : { parse: [] }
                });
            } else if (subcommand === 'puissance4') {
                const opponent = interaction.options.getUser('adversaire');

                // Empêcher de jouer contre soi-même
                if (opponent.id === interaction.user.id) {
                    const errorText = new TextDisplayBuilder().setContent('❌ Vous ne pouvez pas jouer contre vous-même !');
                    const container = new ContainerBuilder().addTextDisplayComponents(errorText);
                    return interaction.editReply({ components: [container], flags: 32768 });
                }

                const bet = interaction.options.getString('mise') || '0';
                const player1 = getOrCreateUser(interaction.user.id, interaction.user.username);

                // Vérifier la dette totale
                const totalDebt = getTotalDebt(interaction.user.id);
                if (totalDebt >= 5_000_000) {
                    const errorText = new TextDisplayBuilder().setContent(`Vous avez une dette de **${totalDebt.toLocaleString('fr-FR')}** starss. Vous ne pouvez pas jouer tant que vous n'avez pas remboursé votre dette.`);
                    const container = new ContainerBuilder().addTextDisplayComponents(errorText);
                    return interaction.editReply({ components: [container], flags: 32768 });
                }

                // Vérifier que le joueur n'a pas une mise supérieure à ses starss
                if (bet !== '0' && isNaN(bet)) {
                    // C'est un objet, pas de vérification
                } else if (bet !== '0') {
                    const betAmount = parseInt(bet);
                    if (betAmount > player1.stars) {
                        const errorText = new TextDisplayBuilder().setContent(`Vous n'avez que **${player1.stars}** starss, vous ne pouvez pas miser **${betAmount}** starss.`);
                        const container = new ContainerBuilder().addTextDisplayComponents(errorText);
                        return interaction.editReply({ components: [container], flags: 32768 });
                    }
                }

                const gameId = startGame('puissance4', interaction.user.id, interaction.user.username, opponent.id, opponent.username, bet);

                const row = new ActionRowBuilder()
                    .addComponents(
                        new ButtonBuilder()
                            .setCustomId(`accept-${gameId}`)
                            .setLabel('Accepter')
                            .setStyle(ButtonStyle.Success),
                        new ButtonBuilder()
                            .setCustomId(`decline-${gameId}`)
                            .setLabel('Refuser')
                            .setStyle(ButtonStyle.Danger)
                    );

                const betText = bet === '0' ? 'sans mise' : `avec une mise de ${bet}`;
                const opponentData = getOrCreateUser(opponent.id, opponent.username);
                const shouldPing = opponentData.notify_minigame_invite !== 0;

                const challengeText = new TextDisplayBuilder().setContent(`${opponent}, ${interaction.user.username} vous défie à une partie de Puissance 4 ${betText}!`);
                const container = new ContainerBuilder()
                    .addTextDisplayComponents(challengeText)
                    .addActionRowComponents(row);
                await interaction.editReply({
                    components: [container],
                    flags: 32768,
                    allowedMentions: shouldPing ? undefined : { parse: [] }
                });
            } else {
                await interaction.editReply({ content: `La logique pour le jeu "${subcommand}" n'est pas encore implémentée.` });
            }
        } catch (error) {
            if (error.code !== 10062) {
                const { handleCommandError } = require('../../utils/error-handler');
                await handleCommandError(interaction, error);
            }
        }
    }
};
