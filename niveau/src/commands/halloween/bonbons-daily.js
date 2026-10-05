const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getEventState, getDailyBonbonCooldown, setDailyBonbonCooldown, grantEventCurrency, getOrCreateEventUser } = require('../../utils/db-halloween');
const { msToTime } = require('../../utils/time');
const { isSameParisDay, parisNextMidnightMs } = require('../../../../utils/paris-time');

const DAILY_AMOUNT = 1000;

module.exports = {
    data: new SlashCommandBuilder()
        .setName('bonbons-daily')
        .setDescription("Récupérez votre récompense journalière de bonbons pendant l'événement Halloween."),

    async execute(interaction) {
        if (!getEventState('halloween')) {
            return interaction.reply({ content: "Il n'y a pas d'événement Halloween actif pour le moment.", ephemeral: true });
        }

        const userId = interaction.user.id;
        const cooldown = getDailyBonbonCooldown(userId);
        const now = Date.now();

        if (cooldown && isSameParisDay(cooldown.last_claimed, now)) {
            const remainingTime = parisNextMidnightMs(now) - now;
            return interaction.reply({ 
                content: `Vous avez déjà réclamé votre récompense journalière de bonbons. Veuillez patienter encore ${msToTime(remainingTime)}.`, 
                ephemeral: true 
            });
        }

        try {
            getOrCreateEventUser(userId, interaction.user.username);
            grantEventCurrency(userId, { bonbons: DAILY_AMOUNT });
            setDailyBonbonCooldown(userId);

            const embed = new EmbedBuilder()
                .setTitle('🍬 Récompense Journalière de Bonbons 🍬')
                .setDescription(`Vous avez reçu **${DAILY_AMOUNT.toLocaleString('fr-FR')}** bonbons !`)
                .setColor('Orange')
                .setThumbnail(interaction.user.displayAvatarURL())
                .setFooter({ text: 'Revenez demain pour en réclamer plus !' })
                .setTimestamp();

            await interaction.reply({ embeds: [embed] });

        } catch (error) {
            console.error("Erreur lors de l'exécution de /bonbons-daily:", error);
            await interaction.reply({ content: "Une erreur est survenue.", ephemeral: true });
        }
    },
};