const path = require('path');
const { SlashCommandBuilder, ContainerBuilder, SectionBuilder, StringSelectMenuBuilder, MessageFlags } = require('discord.js');
const { BLZ_EMBED_STRIP_INT } = require(path.join(__dirname, '..', '..', '..', '..', 'blz-embed-theme'));
const logger = require('../../utils/logger');

const developers = [
    {
        name: 'Koyorin',
        id: '965984018216665099',
        role: 'Lead développeur et superviseur du projet',
        description: 'Le cerveau derrière le projet, responsable de la majeure partie du code et de la vision globale du bot.',
        emoji: '👑'
    },
    {
        name: 'Roxxor',
        id: '1057705135515639859',
        description: 'La différence entre moi et Koyorin ? Ma beauté naturelle.',
        role: 'Développeur',
        emoji: '👨‍💻'
    }
];

module.exports = {
    data: new SlashCommandBuilder()
        .setName('crédit')
        .setDescription('Affiche les crédits des développeurs du bot.'),

    async execute(interaction) {
        try {
            const userId = interaction.user.id;
            let currentDevId = developers[0].id;

            const generateContainer = async (devId) => {
                const dev = developers.find(d => d.id === devId);
                const user = await interaction.client.users.fetch(dev.id);
                const avatar = user.displayAvatarURL({ size: 256, extension: 'png' });

                const container = new ContainerBuilder()
                    .setAccentColor(BLZ_EMBED_STRIP_INT)
                    .addTextDisplayComponents((textDisplay) =>
                        textDisplay.setContent(`# Crédits du Bot\n\nChoisissez un développeur pour voir ses informations.`)
                    )
                    .addActionRowComponents((actionRow) => {
                        const selectMenu = new StringSelectMenuBuilder()
                            .setCustomId('credit_dev_select')
                            .setPlaceholder('Sélectionner un développeur');

                        developers.forEach(dev => {
                            selectMenu.addOptions({
                                label: dev.name,
                                description: dev.role,
                                value: dev.id,
                                emoji: dev.emoji
                            });
                        });

                        return actionRow.setComponents(selectMenu);
                    })
                    .addSeparatorComponents((separator) => separator)
                    .addSectionComponents((section) =>
                        section
                            .addTextDisplayComponents((textDisplay) =>
                                textDisplay.setContent(`
**${dev.emoji} <@${dev.id}> (\`@${dev.name}\`)**
*${dev.role}*

**Description**
*${dev.description}*`)
                            )
                            .setThumbnailAccessory((thumbnail) =>
                                thumbnail.setDescription(`${dev.name}'s Avatar`).setURL(avatar)
                            )
                    );

                return container;
            };

            const container = await generateContainer(currentDevId);

            const response = await interaction.reply({
                components: [container],
                flags: MessageFlags.IsComponentsV2,
                allowedMentions: { parse: [] },
                ephemeral: false
            });

            const collector = response.createMessageComponentCollector({
                time: 10 * 60 * 1000,
            });

            collector.on('collect', async (i) => {
                if (i.user.id !== userId) {
                    const selectedUserId = i.values[0];
                    if (developers.find(d => d.id === selectedUserId)) {
                        const dev = developers.find(d => d.id === selectedUserId);
                        const user = await interaction.client.users.fetch(dev.id);
                        const avatar = user.displayAvatarURL({ size: 256, extension: 'png' });

                        const ephemeralContainer = new ContainerBuilder()
                            .setAccentColor(BLZ_EMBED_STRIP_INT)
                            .addSectionComponents((section) =>
                                section
                                    .addTextDisplayComponents((textDisplay) =>
                                        textDisplay.setContent(`
**${dev.emoji} <@${dev.id}> (\`@${dev.name}\`)**
*${dev.role}*

**Description**
*${dev.description}*`)
                                    )
                                    .setThumbnailAccessory((thumbnail) =>
                                        thumbnail.setDescription(`${dev.name}'s Avatar`).setURL(avatar)
                                    )
                            );

                        return i.reply({
                            components: [ephemeralContainer],
                            flags: MessageFlags.IsComponentsV2,
                            allowedMentions: { parse: [] },
                            ephemeral: true
                        });
                    } else {
                        return i.reply({ content: 'Cet utilisateur n\'est pas un développeur.', ephemeral: true });
                    }
                }

                if (i.customId === 'credit_dev_select') {
                    const selectedUserId = i.values[0];
                    if (developers.find(d => d.id === selectedUserId)) {
                        currentDevId = selectedUserId;
                    } else {
                        return i.reply({ content: 'Cet utilisateur n\'est pas un développeur.', ephemeral: true });
                    }
                }

                const newContainer = await generateContainer(currentDevId);

                try {
                    await i.update({
                        components: [newContainer],
                        allowedMentions: { parse: [] },
                        flags: MessageFlags.IsComponentsV2
                    });
                } catch (error) {
                    if (error.code !== 10062) {
                        logger.error('Erreur lors de la mise à jour du crédit:', error);
                    }
                }
            });

            collector.on('end', () => {});

        } catch (error) {
            logger.error('Erreur lors de la récupération des crédits:', error);
            await interaction.reply({
                content: 'Une erreur s\'est produite lors de l\'affichage des crédits.',
                ephemeral: true
            });
        }
    },
};