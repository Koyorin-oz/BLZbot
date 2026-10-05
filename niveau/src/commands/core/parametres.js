const { SlashCommandBuilder, TextDisplayBuilder, SectionBuilder, ContainerBuilder, ButtonBuilder, ButtonStyle, ComponentType, MessageFlags } = require('discord.js');
const { getOrCreateUser, toggleUserSetting } = require('../../utils/db-users');
const { handleCommandError } = require('../../utils/error-handler');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('parametres')
        .setDescription('Configurez vos préférences de notifications.'),

    async execute(interaction) {
        try {
            const userId = interaction.user.id;
            // Récupérer l'utilisateur pour avoir l'état actuel des settings
            let user = getOrCreateUser(userId, interaction.user.username);

            // Définition des paramètres
            const settingsConfig = [
                { id: 'notify_rank_up', label: 'Notifications de Rang', description: 'Me mentionner lorsque je monte d\'un rang' },
                { id: 'notify_level_up', label: 'Notifications de Niveau', description: 'Me mentionner lorsque je monte d\'un level' },
                { id: 'notify_streak', label: 'Notifications de Streak', description: 'Me mentionner lorsque je prends une streak / streak perdue' },
                { id: 'notify_guild_invite', label: 'Invitations de Guilde', description: 'Me mentionner lorsque je reçois une invitation de guilde' },
                { id: 'notify_quest_complete', label: 'Quêtes Terminées', description: 'Me mentionner lorsque je termine une quête' },
                { id: 'notify_trade', label: 'Demandes d\'Échange', description: 'Me mentionner lorsque quelqu\'un veut me trade' },
                { id: 'notify_minigame_invite', label: 'Invitations Mini-jeu', description: 'Me mentionner lorsque quelqu\'un m\'invite en mini jeu' },
                { id: 'notify_debt_reminder', label: 'Rappels de Dettes', description: 'Me mentionner lors de rappels de dettes à régler (singe si tu met off btw)' },
            ];

            const generateMessagePayload = () => {
                const container = new ContainerBuilder();

                const headerText = new TextDisplayBuilder()
                    .setContent(`# ⚙️ Paramètres\nConfigurez ici vos préférences de notifications. Si vous désactivez une option, le bot ne vous mentionnera plus pour cet événement (ou n'enverra plus de DM le cas échéant).`);

                container.addTextDisplayComponents(headerText);

                for (const setting of settingsConfig) {
                    const isEnabled = user[setting.id] === 1; // 1 = ON, 0 = OFF (en supposant que c'est stocké en INT)

                    const statusEmoji = isEnabled ? '✅' : '❌';
                    const statusText = isEnabled ? 'ACTIVÉ' : 'DÉSACTIVÉ';
                    const buttonStyle = isEnabled ? ButtonStyle.Success : ButtonStyle.Danger;
                    const buttonLabel = isEnabled ? 'Activée' : 'Désactivée';

                    const sectionText = new TextDisplayBuilder()
                        .setContent(`### ${setting.label} - ${statusEmoji} ${statusText}\n${setting.description}`);

                    const toggleButton = new ButtonBuilder()
                        .setCustomId(`toggle_${setting.id}`)
                        .setLabel(buttonLabel)
                        .setStyle(buttonStyle);

                    const section = new SectionBuilder()
                        .addTextDisplayComponents(sectionText)
                        .setButtonAccessory(toggleButton);

                    container.addSectionComponents(section);
                }

                return {
                    components: [container],
                    flags: MessageFlags.IsComponentsV2,
                    ephemeral: true
                };
            };

            const response = await interaction.reply(generateMessagePayload());

            const collector = response.createMessageComponentCollector({
                componentType: ComponentType.Button,
                time: 15 * 60 * 1000,
            });

            collector.on('collect', async (i) => {
                try {
                    if (i.user.id !== userId) return i.reply({ content: 'Ces paramètres ne sont pas les vôtres.', ephemeral: true });

                    const customId = i.customId;

                    if (customId.startsWith('toggle_')) {
                        const settingKey = customId.replace('toggle_', '');

                        // Basculer le paramètre dans la DB
                        const newValue = toggleUserSetting(userId, settingKey);

                        // Mettre à jour l'objet user local pour le ré-affichage
                        user[settingKey] = newValue;

                        await i.update(generateMessagePayload());
                    }
                } catch (error) {
                    await handleCommandError(i, error, i.client);
                }
            });

            collector.on('end', () => {
                // Optionnel: désactiver les boutons ou laisser tel quel
            });

        } catch (error) {
            await handleCommandError(interaction, error, interaction.client);
        }
    },
};
