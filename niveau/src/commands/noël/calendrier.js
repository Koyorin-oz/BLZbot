const { SlashCommandBuilder, EmbedBuilder, AttachmentBuilder } = require('discord.js');
const { getEventState, getOrCreateEventUser, canClaimCalendarToday, setCalendarCooldown, hasClaimedCalendarReward, addClaimedCalendarReward } = require('../../utils/db-noel');
const { grantResources } = require('../../utils/db-users');
const { grantEventCurrency, setMultiplier, getEventState: getNoel } = require('../../utils/db-noel');
const { generateCalendarImage } = require('../../utils/canvas-noël-calendar');
const logger = require('../../utils/logger');
const fs = require('fs');
const path = require('path');

const CALENDAR_REWARDS = {
    12: { name: '100 000 Starss', fn: (client, userId) => grantResources(client, userId, { stars: 100000, source: 'noel' }) },
    13: { name: '20 000 Rubans', fn: (client, userId) => grantEventCurrency(userId, { rubans: 20000 }) },
    14: { name: '24h de XP x2', fn: (client, userId) => setMultiplier(userId, 'xp_x2_calendar', 86400000) },
    15: { name: '2 Cadeaux Surprise', fn: (client, userId) => grantEventCurrency(userId, { cadeaux_surprise: 2 }) },
    16: { name: '24h de Points de Rang x2', fn: (client, userId) => setMultiplier(userId, 'rank_points_x2_calendar', 86400000) },
    17: { name: '50 000 Rubans', fn: (client, userId) => grantEventCurrency(userId, { rubans: 50000 }) },
    18: { name: '24h de X2 Starss', fn: (client, userId) => setMultiplier(userId, 'stars_x2_calendar', 86400000) },
    19: { name: '5 Cadeaux Surprise', fn: (client, userId) => grantEventCurrency(userId, { cadeaux_surprise: 5 }) },
    20: {
        name: '5 Bonbons d\'Halloween', fn: (client, userId) => {
            const db = require('../../utils/db-halloween');
            db.grantEventCurrency(userId, { bonbons_surprise: 5 });
        }
    },
    21: { name: '50 000 XP', fn: (client, userId) => grantResources(client, userId, { xp: 50000, source: 'noel' }) },
    22: { name: '666 666 Starss', fn: (client, userId) => grantResources(client, userId, { stars: 666666, source: 'noel' }) },
    23: { name: '10 Cadeaux Surprise', fn: (client, userId) => grantEventCurrency(userId, { cadeaux_surprise: 10 }) },
    24: {
        name: '100 000 Rubans + 10 000 XP + 1 000 000 Starss', fn: (client, userId) => {
            grantEventCurrency(userId, { rubans: 100000 });
            grantResources(client, userId, { xp: 10000, stars: 1000000, source: 'noel' });
        }
    },
    25: {
        name: 'Rôle "Sapin de Noël"', fn: async (client, userId) => {
            const guild = await client.guilds.fetch(process.env.GUILD_ID);
            let role = guild.roles.cache.find(r => r.name === 'Sapin de Noël');
            if (!role) {
                role = await guild.roles.create({
                    name: 'Sapin de Noël',
                    color: '#228B22',
                    reason: 'Récompense Calendrier de l\'Avent Noël'
                });
            }
            const member = await guild.members.fetch(userId);
            if (member && !member.roles.cache.has(role.id)) {
                await member.roles.add(role);
            }
        }
    },
};

function getTodayCalendarDay() {
    // Obtenir la date actuelle en timezone Europe/Paris
    const formatter = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Europe/Paris',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    });
    const parts = formatter.formatToParts(new Date());
    const dateObj = {};
    parts.forEach(part => {
        dateObj[part.type] = part.value;
    });

    const day = parseInt(dateObj.day);

    // Entre 12 et 25 décembre
    if (day >= 12 && day <= 25) {
        return day;
    }
    return null;
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('calendrier')
        .setDescription('Affiche le calendrier de l\'Avent et réclamez votre récompense du jour.'),

    async execute(interaction) {
        if (!getEventState('noël')) {
            return interaction.reply({ content: "Il n'y a pas d'événement Noël actif pour le moment.", ephemeral: true });
        }

        // DEFER IMMÉDIATEMENT car la génération d'image et les traitements prennent du temps
        await interaction.deferReply();

        const userId = interaction.user.id;
        const eventUser = getOrCreateEventUser(userId, interaction.user.username);
        const todayDay = getTodayCalendarDay();

        // Si on est pas dans la période du calendrier
        if (!todayDay) {
            // Passer les jours réellement ouverts (pas un tableau par index)
            const attachment = new AttachmentBuilder(
                generateCalendarImage(eventUser.claimed_calendar_rewards),
                { name: 'calendrier.png' }
            );

            const embed = new EmbedBuilder()
                .setTitle('🎄 Calendrier de l\'Avent Noël 🎄')
                .setImage('attachment://calendrier.png')
                .setColor('#DC143C')
                .setDescription('Le calendrier de l\'Avent n\'est disponible que du **12 au 25 décembre** !');
            return interaction.editReply({ embeds: [embed], files: [attachment] });
        }

        // Vérifier si le jour a déjà été réclamé aujourd'hui
        if (hasClaimedCalendarReward(userId, todayDay)) {
            // Passer les jours réellement ouverts
            const attachment = new AttachmentBuilder(
                generateCalendarImage(eventUser.claimed_calendar_rewards),
                { name: 'calendrier.png' }
            );

            const embed = new EmbedBuilder()
                .setTitle('🎄 Calendrier de l\'Avent Noël 🎄')
                .setImage('attachment://calendrier.png')
                .setColor('#DC143C')
                .setDescription(`Vous avez déjà réclamé votre récompense du jour pour le **${todayDay} décembre** ! Revenez demain !`);
            return interaction.editReply({ embeds: [embed], files: [attachment] });
        }

        // Réclamer la récompense
        const reward = CALENDAR_REWARDS[todayDay];
        if (!reward) {
            logger.error(`Récompense non trouvée pour le jour ${todayDay}`);
            return interaction.editReply({ content: 'Erreur: récompense non trouvée.' });
        }

        try {
            // Appliquer la récompense
            await reward.fn(interaction.client, userId);

            // Enregistrer que le jour a été réclamé
            addClaimedCalendarReward(userId, todayDay);
            setCalendarCooldown(userId);

            // Régénérer l'image du calendrier APRÈS avoir ajouté la réclamation
            const updatedEventUser = getOrCreateEventUser(userId, interaction.user.username);

            const attachment = new AttachmentBuilder(
                generateCalendarImage(updatedEventUser.claimed_calendar_rewards),
                { name: 'calendrier.png' }
            );

            const embed = new EmbedBuilder()
                .setTitle('🎄 Calendrier de l\'Avent Noël 🎄')
                .setImage('attachment://calendrier.png')
                .setColor('Green')
                .setDescription(`**Récompense du ${todayDay} décembre réclamée !**\n\n Vous avez reçu : **${reward.name}**`);

            await interaction.editReply({ embeds: [embed], files: [attachment] });
            logger.info(`${interaction.user.username} a réclamé sa récompense du calendrier pour le ${todayDay} décembre: ${reward.name}`);

        } catch (error) {
            logger.error(`Erreur lors de la réclamation de la récompense du calendrier pour ${userId}:`, error);

            // Générer l'image même en cas d'erreur
            const errorEventUser = getOrCreateEventUser(userId, interaction.user.username);

            const attachment = new AttachmentBuilder(
                generateCalendarImage(errorEventUser.claimed_calendar_rewards),
                { name: 'calendrier.png' }
            );

            const embed = new EmbedBuilder()
                .setTitle('🎄 Calendrier de l\'Avent Noël 🎄')
                .setImage('attachment://calendrier.png')
                .setColor('Red')
                .setDescription('Une erreur est survenue lors de la réclamation de votre récompense. Veuillez réessayer.');
            await interaction.editReply({ embeds: [embed], files: [attachment] });
        }
    },
};
