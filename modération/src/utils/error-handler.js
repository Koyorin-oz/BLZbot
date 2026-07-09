const path = require('node:path');
const { ButtonBuilder, ButtonStyle, ActionRowBuilder, ComponentType } = require('discord.js');
const { isInteractionGone } = require('./interaction-ack');

/**
 * Gère les erreurs de commandes — rapport sur le forum blzbot-bugs.
 */
async function handleCommandError(interaction, error, client = null) {
    const discordClient = client || interaction.client;
    const bugId = `bug-${Date.now()}`;
    console.error(
        `[ERREUR ${bugId}] Une erreur est survenue lors de l'exécution de la commande '${interaction.commandName}':`,
        error,
    );

    const reportButton = new ButtonBuilder()
        .setCustomId(`report_bug_${bugId}`)
        .setLabel('Signaler le bug')
        .setStyle(ButtonStyle.Danger)
        .setEmoji('🐛');

    const row = new ActionRowBuilder().addComponents(reportButton);

    const replyOptions = {
        content: `❌ Oups ! Une erreur est survenue. Si le problème persiste, tu peux le signaler sur le forum staff. (ID Erreur: ${bugId})`,
        embeds: [],
        components: [row],
        flags: 64,
    };

    try {
        if (interaction.replied || interaction.deferred) {
            await interaction.editReply(replyOptions);
        } else {
            await interaction.reply(replyOptions);
        }
    } catch (e) {
        if (!isInteractionGone(e)) {
            console.error(`[ERREUR ${bugId}] Impossible de répondre à l'interaction pour signaler l'erreur:`, e);
        }
        return;
    }

    let replyMsg;
    try {
        replyMsg = await interaction.fetchReply();
    } catch {
        return;
    }

    const collector = replyMsg.createMessageComponentCollector({
        componentType: ComponentType.Button,
        filter: (i) => i.customId === `report_bug_${bugId}` && i.user.id === interaction.user.id,
        time: 120000,
    });

    collector.on('collect', async (i) => {
        try {
            const { createBugForumPost } = require(path.join(
                __dirname,
                '..',
                '..',
                '..',
                'niveau',
                'src',
                'utils',
                'bug-forum-tags',
            ));
            const commandOptions = (interaction.options?.data || [])
                .map((opt) => `  - ${opt.name}: ${opt.value}`)
                .join('\n');
            const stack = String(error?.stack || error?.message || 'n/a').slice(0, 1500);
            const reporterLabel = `${interaction.member?.displayName || interaction.user.globalName || interaction.user.username} (@${interaction.user.username})`;

            const description = [
                '**Rapport automatique** (modération)',
                '',
                `**Commande :** \`/${interaction.commandName}\``,
                '',
                commandOptions ? `**Options :**\n\`\`\`\n${commandOptions}\n\`\`\`` : '',
                `**Message d'erreur :**\n\`\`\`\n${error?.message || 'inconnu'}\n\`\`\``,
                '',
                `**Stack :**\n\`\`\`\n${stack}\n\`\`\``,
            ]
                .filter(Boolean)
                .join('\n');

            await createBugForumPost(discordClient, {
                threadTitle: `[Auto] /${interaction.commandName}`.slice(0, 100),
                description,
                reporterLabel,
                reporterId: interaction.user.id,
                bugId,
            });

            await i.update({
                content: '✅ Signalement créé sur le forum **blzbot-bugs**. Merci !',
                components: [],
            });
        } catch (reportError) {
            console.error(`[ERREUR ${bugId}] Impossible de créer le post forum:`, reportError);
            await i
                .update({
                    content:
                        '❌ Impossible de créer le signalement. Utilise `/bug` sur le serveur principal ou préviens un dev.',
                    components: [],
                })
                .catch(() => {});
        }
        collector.stop();
    });

    collector.on('end', (collected) => {
        if (collected.size === 0) {
            interaction.editReply({ components: [] }).catch(() => {});
        }
    });
}

module.exports = { handleCommandError };
