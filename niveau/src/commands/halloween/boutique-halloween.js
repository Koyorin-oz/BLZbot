const { SlashCommandBuilder, EmbedBuilder, StringSelectMenuBuilder, ActionRowBuilder, ComponentType, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const { getOrCreateEventUser, grantEventCurrency, getEventState } = require('../../utils/db-halloween');
const mainDb = require('../../database/database'); // Import main DB for boosts
const logger = require('../../utils/logger');

const HALLOWEEN_SHOP_ITEMS = [
    {
        id: 'xp_boost_halloween',
        name: '⚡ Boost XP (x2 - 1h)',
        description: 'Double votre gain d\'XP pendant 1 heure.',
        price: 30000,
    },
    {
        id: 'points_boost_halloween',
        name: '✨ Boost Points de Rang (x2 - 1h)',
        description: 'Double votre gain de points de rang pendant 1 heure.',
        price: 50000,
    },
    {
        id: 'role_fantome',
        name: '👻 Rôle Fantôme',
        description: 'Affiche votre présence spectrale sur le serveur.',
        price: 300000,
    },
    {
        id: 'bonbon_surprise',
        name: '🎁 Bonbon Surprise',
        description: 'Contient une récompense aléatoire. Utilisez /bonbons-ouvrir pour l\'ouvrir.',
        price: 10000,
    },
];

module.exports = {
    data: new SlashCommandBuilder()
        .setName('boutique-halloween')
        .setDescription('Dépensez vos bonbons dans la boutique de l\'événement Halloween.'),



    async execute(interaction) {
        if (!getEventState('halloween')) {
            return interaction.reply({ content: "Il n'y a pas d'événement Halloween actif pour le moment.", ephemeral: true });
        }

        const userId = interaction.user.id;
        const eventUser = getOrCreateEventUser(userId, interaction.user.username);

        const embed = new EmbedBuilder()
            .setTitle('🎃 Boutique d\'Halloween 🎃')
            .setDescription(`Votre solde : **${eventUser.bonbons.toLocaleString('fr-FR')}** Bonbons`)
            .setColor('Orange');

        const menuOptions = HALLOWEEN_SHOP_ITEMS.map(item => {
            // On ne peut pas acheter le rôle si on l'a déjà
            let isDisabled = false;
            if (item.id === 'role_fantome' && interaction.member.roles.cache.some(r => r.name === 'Fantôme')) {
                isDisabled = true;
            }

            embed.addFields({
                name: `${item.name} ${isDisabled ? '(✅ Possédé)' : ''}`,
                value: `${item.description}\nPrix : **${item.price.toLocaleString('fr-FR')}** bonbons`,
                inline: false,
            });

            return {
                label: item.name,
                value: item.id,
                description: `Prix : ${item.price.toLocaleString('fr-FR')} bonbons${isDisabled ? ' (Possédé)' : ''}`,
                disabled: isDisabled,
            };
        });

        // Ne créer le menu que s'il y a au moins une option non désactivée
        const availableOptions = menuOptions.filter(opt => !opt.disabled);
        if (availableOptions.length === 0) {
            return interaction.reply({ 
                embeds: [embed], 
                content: 'Vous possédez déjà tous les items uniques de la boutique !', 
                ephemeral: true 
            });
        }

        const row = new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
                .setCustomId('halloween_boutique_select')
                .setPlaceholder('Sélectionnez un item à acheter')
                .addOptions(availableOptions)
        );

        const response = await interaction.reply({ embeds: [embed], components: [row], ephemeral: true });

        const collector = response.createMessageComponentCollector({ componentType: ComponentType.StringSelect, time: 5 * 60 * 1000 });

        collector.on('collect', async i => {
            if (i.user.id !== userId) return i.reply({ content: 'Vous ne pouvez pas utiliser ce menu.', ephemeral: true }).catch(() => null);

            const itemId = i.values[0];
            const selectedItem = HALLOWEEN_SHOP_ITEMS.find(item => item.id === itemId);
            const currentUserState = getOrCreateEventUser(userId, i.user.username);

            if (currentUserState.bonbons < selectedItem.price) {
                return i.reply({ content: `Il vous manque **${(selectedItem.price - currentUserState.bonbons).toLocaleString('fr-FR')}** bonbons.`, ephemeral: true });
            }

            let replyMessage = `Félicitations ! Vous avez acheté : **${selectedItem.name}** !`;

            // Attribution de l'item
            switch (itemId) {
                case 'xp_boost_halloween':
                case 'points_boost_halloween':
                    // Déduction des bonbons
                    grantEventCurrency(userId, { bonbons: -selectedItem.price });
                    
                    const boostType = itemId === 'xp_boost_halloween' ? 'xp_boost_until' : 'points_boost_until';
                    const boostDuration = 60 * 60 * 1000; // 1 heure
                    const boostEndTime = Date.now() + boostDuration;
                    mainDb.prepare(`UPDATE users SET ${boostType} = ? WHERE id = ?`).run(boostEndTime, userId);
                    await i.update({ content: replyMessage, components: [], embeds: [] });
                    break;
                
                case 'role_fantome':
                    // Déduction des bonbons
                    grantEventCurrency(userId, { bonbons: -selectedItem.price });
                    
                    const guild = i.guild;
                    let role = guild.roles.cache.find(r => r.name === 'Fantôme');
                    if (!role) {
                        role = await guild.roles.create({ name: 'Fantôme', color: '#8A2BE2', reason: 'Achat boutique Halloween' });
                    }
                    await i.member.roles.add(role);
                    await i.update({ content: replyMessage, components: [], embeds: [] });
                    break;

                case 'bonbon_surprise':
                    // NE PAS déduire les bonbons ici, c'est fait dans le modal
                    const modal = new ModalBuilder()
                        .setCustomId('bonbon_surprise_quantity_modal')
                        .setTitle('Acheter des Bonbons Surprise');

                    const quantityInput = new TextInputBuilder()
                        .setCustomId('bonbon_quantity')
                        .setLabel('Quantité de Bonbons Surprise ?')
                        .setStyle(TextInputStyle.Short)
                        .setPlaceholder('Entrez un nombre')
                        .setRequired(true);

                    const firstActionRow = new ActionRowBuilder().addComponents(quantityInput);
                    modal.addComponents(firstActionRow);

                    await i.showModal(modal);
                    return;
            }
        });

        collector.on('end', () => interaction.editReply({ components: [] }).catch(() => {}));
    },
};

// Export HALLOWEEN_SHOP_ITEMS separately
module.exports.HALLOWEEN_SHOP_ITEMS = HALLOWEEN_SHOP_ITEMS;
