const { SlashCommandBuilder, EmbedBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder, ComponentType } = require('discord.js');
const { getAllUserQuests } = require('../../utils/db-quests');
const { QUESTS, checkQuestProgress } = require('../../utils/quests'); // Ajout de checkQuestProgress
const { getEventState, getOrCreateEventUser } = require('../../utils/db-halloween'); // Ajout de getOrCreateEventUser
const logger = require('../../utils/logger');

const QUESTS_PER_PAGE = 5;

const createProgressBar = (current, goal) => {
    if (goal === 0) return '[░░░░░░░░░░] 0%';
    const percentage = Math.min(Math.floor((current / goal) * 100), 100);
    const filledBlocks = Math.floor(percentage / 10);
    const emptyBlocks = 10 - filledBlocks;
    return `[${ '█'.repeat(filledBlocks) }${ '░'.repeat(emptyBlocks) }] ${percentage}%`;
};

// On ne travaille qu'avec les quêtes d'Halloween pour cette commande
const HALLOWEEN_QUESTS = Object.values(QUESTS).filter(q => q.rarity === 'Halloween');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('halloween-quetes')
        .setDescription("Affiche votre progression dans les quêtes et succès d'Halloween."),

    async execute(interaction) {
        // La commande ne fonctionne que si l'événement est actif
        if (!getEventState('halloween')) {
            return interaction.reply({ content: "Il n'y a pas d'événement Halloween actif pour le moment.", ephemeral: true });
        }

        try {
            const userId = interaction.user.id;

            // Vérifier la quête des citrouilles
            const eventUser = getOrCreateEventUser(userId, interaction.user.username);
            checkQuestProgress(interaction.client, 'HALLOWEEN_PUMPKIN_CHECK', interaction.user, { pumpkinCount: eventUser.citrouilles });

            // Le reste de la logique de la commande
            const userQuests = getAllUserQuests(userId);

            const activeQuests = [];
            const completedQuests = [];

            // On itère uniquement sur les quêtes d'Halloween
            for (const quest of HALLOWEEN_QUESTS) {
                const userProgress = userQuests.find(q => q.quest_id === quest.id);

                if (userProgress && userProgress.completed) {
                    completedQuests.push(quest);
                } else {
                    activeQuests.push({ ...quest, progress: userProgress ? userProgress.progress : 0 });
                }
            }

            let currentPage = 0;
            let currentView = 'active'; // 'active' or 'completed'

            const createPagedEmbed = () => {
                const embed = new EmbedBuilder();

                if (currentView === 'active') {
                    embed.setTitle('🎃 Quêtes d\'Halloween Actives 🎃').setColor('Orange');
                    const totalPages = Math.ceil(activeQuests.length / QUESTS_PER_PAGE);
                    if (activeQuests.length > 0) {
                        const start = currentPage * QUESTS_PER_PAGE;
                        const end = start + QUESTS_PER_PAGE;
                        const questsOnPage = activeQuests.slice(start, end);

                        questsOnPage.forEach(q => {
                            const progressText = typeof q.goal === 'number' ? createProgressBar(q.progress, q.goal) :
                                `Objectif: ${q.goal}`;
                            embed.addFields({ name: `${q.name} (${q.rarity})`, value: `${q.description}\n*${progressText}*` });
                        });
                        if (totalPages > 0) {
                            embed.setFooter({ text: `Page ${currentPage + 1} / ${totalPages}` });
                        }
                    } else {
                        embed.setDescription('Vous avez terminé toutes les quêtes d\'Halloween ! Félicitations !');
                    }
                } else { // completed view
                    embed.setTitle('🏆 Succès d\'Halloween Déverrouillés 🏆').setColor('Gold');
                    if (completedQuests.length > 0) {
                        embed.setDescription(completedQuests.map(q => `**${q.name}** (${q.rarity})`).join('\n'));
                    } else {
                        embed.setDescription("Vous n'avez encore déverrouillé aucun succès d\'Halloween.");
                    }
                }
                return embed;
            };

            const getComponents = () => {
                const totalPages = Math.ceil(activeQuests.length / QUESTS_PER_PAGE);

                const viewButtons = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('hquests_view_active').setLabel('Quêtes Actives').setStyle(ButtonStyle.Primary).setDisabled(currentView === 'active'),
                    new ButtonBuilder().setCustomId('hquests_view_completed').setLabel('Succès').setStyle(ButtonStyle.Success).setDisabled(currentView === 'completed'),
                );

                const navigationButtons = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('hquests_nav_prev').setLabel('Précédent').setStyle(ButtonStyle.Secondary).setDisabled(currentPage === 0),
                    new ButtonBuilder().setCustomId('hquests_nav_next').setLabel('Suivant').setStyle(ButtonStyle.Secondary).setDisabled(currentPage >= totalPages - 1),
                );

                if (currentView === 'active' && totalPages > 1) {
                    return [viewButtons, navigationButtons];
                }
                return [viewButtons];
            };

            const response = await interaction.reply({
                embeds: [createPagedEmbed()],
                components: getComponents(),
                flags: 64,
            });

            const collector = response.createMessageComponentCollector({ componentType: ComponentType.Button, time: 5 * 60 * 1000 });

            collector.on('collect', async i => {
                if (i.user.id !== userId) return i.reply({ content: 'Vous ne pouvez pas utiliser ces boutons.', flags: 64 });

                const [type, action] = i.customId.split('_').slice(1);

                if (type === 'view') {
                    currentView = action;
                    currentPage = 0;
                } else if (type === 'nav') {
                    if (action === 'prev') {
                        currentPage--;
                    } else if (action === 'next') {
                        currentPage++;
                    }
                }

                await i.update({ embeds: [createPagedEmbed()], components: getComponents() });
            });

            collector.on('end', () => {
                interaction.editReply({ components: [] }).catch(err => logger.warn(`Failed to remove components from /halloween-quetes message for ${userId}`, err));
            });

        } catch (error) {
            logger.error('Error executing /halloween-quetes command:', error);
            await interaction.reply({ content: 'Une erreur est survenue.', ephemeral: true });
        }
    },
};
