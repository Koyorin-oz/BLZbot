const { ButtonBuilder, ButtonStyle, ActionRowBuilder, ComponentType, EmbedBuilder } = require('discord.js');
const { isInteractionGone } = require('./interaction-ack');

/**
 * Gère les erreurs de commandes avec un système de rapport de bug
 * @param {Interaction} interaction - L'interaction Discord
 * @param {Error} error - L'erreur survenue
 * @param {Client} client - Le client Discord (optionnel, sera récupéré depuis interaction.client)
 */
async function handleCommandError(interaction, error, client = null) {
    const discordClient = client || interaction.client;
    const bugId = `bug-${Date.now()}`;
    console.error(`[ERREUR ${bugId}] Une erreur est survenue lors de l'exécution de la commande '${interaction.commandName}':`, error);

    const reportButton = new ButtonBuilder()
        .setCustomId(`report_bug_${bugId}`)
        .setLabel('Signaler le bug')
        .setStyle(ButtonStyle.Danger)
        .setEmoji('🐛');

    const row = new ActionRowBuilder().addComponents(reportButton);

    const replyOptions = {
        content: `❌ Oups ! Une erreur est survenue. Si le problème persiste, vous pouvez le signaler au développeur. (ID Erreur: ${bugId})`,
        embeds: [],
        components: [row],
        ephemeral: true
    };

    try {
        if (interaction.replied || interaction.deferred) {
            await interaction.editReply(replyOptions);
        } else {
            await interaction.reply(replyOptions);
        }
    } catch (e) {
        // Ignorer silencieusement si l'interaction a expiré (10062)
        if (e.code !== 10062) {
            console.error(`[ERREUR ${bugId}] Impossible de répondre à l'interaction pour signaler l'erreur:`, e);
        }
    }

    const collector = interaction.channel.createMessageComponentCollector({
        componentType: ComponentType.Button,
        filter: i => i.customId === `report_bug_${bugId}` && i.user.id === interaction.user.id,
        time: 60000 // 1 minute
    });

    collector.on('collect', async i => {
        const devId = '1222548578539536405';
        try {
            const devUser = await discordClient.users.fetch(devId);
            const commandOptions = interaction.options.data.map(opt => `  - ${opt.name}: ${opt.value}`).join('\n');

            const reportEmbed = new EmbedBuilder()
                .setTitle('🐛 Nouveau Rapport de Bug')
                .setColor('Red')
                .addFields(
                    { name: 'ID du Bug', value: bugId },
                    { name: 'Utilisateur', value: `${interaction.user.tag} (${interaction.user.id})` },
                    { name: 'Commande', value: `/${interaction.commandName}` },
                    { name: 'Options', value: commandOptions.length > 0 ? `\`\`\`\n${commandOptions}\n\`\`\`` : 'Aucune' },
                    { name: 'Message d\'erreur', value: `\`\`\n${error.message}\n\`\`` },
                    { name: 'Stack Trace', value: `\`\`\n${error.stack.substring(0, 1000)}\n\`\`` }
                )
                .setTimestamp();

            await devUser.send({ embeds: [reportEmbed] });
            await i.update({ content: '✅ Votre rapport de bug a été envoyé au développeur. Merci !', components: [] });
        } catch (dmError) {
            console.error(`[ERREUR ${bugId}] Impossible d'envoyer le rapport de bug en DM:`, dmError);
            await i.update({ content: '❌ Impossible d\'envoyer le rapport de bug. Veuillez contacter le développeur manuellement.', components: [] });
        }
        collector.stop();
    });

    collector.on('end', collected => {
        if (collected.size === 0) {
            // Si le bouton n'a pas été cliqué, on le retire du message pour éviter les erreurs futures
            interaction.editReply({ components: [] }).catch(() => { });
        }
    });
}

module.exports = { handleCommandError };
