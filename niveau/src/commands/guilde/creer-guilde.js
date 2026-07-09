const { SlashCommandBuilder } = require('discord.js');
const { getOrCreateUser, grantResources } = require('../../utils/db-users');
const { getGuildOfUser, getGuildByName, createGuild, addMemberToGuild } = require('../../utils/db-guilds');
const { checkQuestProgress } = require('../../utils/quests');
const logger = require('../../utils/logger');

const GUILD_COST = 500000;

module.exports = {
    data: new SlashCommandBuilder()
        .setName('creerguilde')
        .setDescription('Crée une nouvelle guilde.')
        .addStringOption(option =>
            option.setName('nom')
                .setDescription('Le nom de votre nouvelle guilde.')
                .setRequired(true)
                .setMinLength(3)
                .setMaxLength(30))
        .addStringOption(option =>
            option.setName('emoji')
                .setDescription('Un émoji pour représenter votre guilde.')
                .setRequired(true)),

    async execute(interaction) {
        const userId = interaction.user.id;
        const guildName = interaction.options.getString('nom');
        const guildEmoji = interaction.options.getString('emoji');

        // 1. Vérifier si l'utilisateur est déjà dans une guilde
        if (getGuildOfUser(userId)) {
            return interaction.reply({ content: 'Vous êtes déjà membre d\'une guilde. Vous devez la quitter avant d\'en créer une nouvelle.', flags: 64 });
        }

        // 2. Valider le nom de guilde (pas de caractères spéciaux non-latins)
        const validNameRegex = /^[a-zA-Z0-9àâäéèêëïîôùûüÿçÀÂÄÉÈÊËÏÎÔÙÛÜŸÇ\s'-]+$/;
        if (!validNameRegex.test(guildName)) {
            return interaction.reply({ content: '❌ Le nom de la guilde ne peut contenir que des lettres, chiffres, espaces, tirets et apostrophes.', flags: 64 });
        }

        // 3. Vérifier si le nom est déjà pris
        if (getGuildByName(guildName)) {
            return interaction.reply({ content: `Une guilde avec le nom "${guildName}" existe déjà. Veuillez choisir un autre nom.`, flags: 64 });
        }

        // 4. Vérifier les prérequis de l'utilisateur (niveau min désactivé)
        const user = getOrCreateUser(userId, interaction.user.username);
        if (user.stars < GUILD_COST) {
            return interaction.reply({ content: `Il vous manque **${(GUILD_COST - user.stars).toLocaleString('fr-FR')}** Starss pour créer une guilde.`, flags: 64 });
        }

        try {
            // 5. Procéder à la création
            await interaction.deferReply();

            // Retirer le coût
            grantResources(interaction.client, userId, { stars: -GUILD_COST, source: 'guild' });

            // Créer la guilde et ajouter le membre
            const newGuildId = createGuild(guildName, userId, guildEmoji);
            addMemberToGuild(userId, newGuildId);

            await interaction.editReply({ content: `Félicitations ! Votre guilde ${guildEmoji} "**${guildName}**" a été créée avec succès ! 🥳` });

            // Vérifier la quête de création de guilde
            checkQuestProgress(interaction.client, 'GUILD_ACTION', interaction.user, { action: 'create' });

        } catch (error) {
            console.error(`Erreur lors de la création de la guilde "${guildName}" par ${interaction.user.username}:`, error);
            await interaction.followUp({ content: 'Une erreur est survenue lors de la création de la guilde. Veuillez réessayer.', flags: 64 });
        }
    },
};