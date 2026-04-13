const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const CONFIG = require('../config.js');
const { getModeratorTitleWithArticle } = require('../utils/helpers.js');
const { resolveModerationSanctionLogChannelId } = require('../utils/log-channel-resolve');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('sanction-modifier')
        .setDescription('Modifier le descriptif d\'une sanction que vous avez émise.')
        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
        .addIntegerOption(option =>
            option.setName('sanction_id')
                .setDescription('ID de la sanction à modifier')
                .setRequired(true)
                .setAutocomplete(true))
        .addStringOption(option =>
            option.setName('nouvelle_raison')
                .setDescription('Nouvelle raison de la sanction')
                .setRequired(true))
        .toJSON(),

    async autocomplete(interaction, { dbManager }) {
        const focusedValue = interaction.options.getFocused();
        const dbSanctions = dbManager.getSanctionsDb();
        const moderatorId = interaction.user.id;
        const oneWeekAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);

        dbSanctions.all(
            'SELECT id, userId, type, reason, date FROM sanctions WHERE moderatorId = ? AND date >= ? ORDER BY date DESC LIMIT 25',
            [moderatorId, oneWeekAgo],
            async (err, rows) => {
                if (err) {
                    console.error('Erreur autocomplete sanctions:', err);
                    return interaction.respond([]);
                }

                const choices = [];
                for (const row of rows) {
                    try {
                        const user = await interaction.client.users.fetch(row.userId).catch(() => null);
                        const username = user ? user.tag : row.userId;
                        const dateStr = new Date(row.date).toLocaleDateString('fr-FR');
                        const reasonPreview = row.reason.length > 50 ? row.reason.substring(0, 47) + '...' : row.reason;
                        
                        choices.push({
                            name: `#${row.id} - ${username} - ${row.type} - ${dateStr} - ${reasonPreview}`,
                            value: row.id
                        });
                    } catch (e) {
                        console.error('Erreur lors du fetch user:', e);
                    }
                }

                const filtered = focusedValue 
                    ? choices.filter(choice => choice.name.toLowerCase().includes(focusedValue.toLowerCase()))
                    : choices;

                interaction.respond(filtered.slice(0, 25));
            }
        );
    },

    async execute(interaction, { dbManager }) {
        if (!interaction.member.permissions.has(PermissionFlagsBits.ModerateMembers)) {
            return interaction.reply({ 
                content: '❌ Vous n\'avez pas la permission d\'utiliser cette commande.', 
                ephemeral: true 
            });
        }

        const sanctionId = interaction.options.getInteger('sanction_id');
        const nouvelleRaison = interaction.options.getString('nouvelle_raison');
        const modérateur = interaction.member;

        const dbSanctions = dbManager.getSanctionsDb();
        const oneWeekAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);

        // Vérifier que la sanction existe et appartient au modérateur
        dbSanctions.get(
            'SELECT * FROM sanctions WHERE id = ?',
            [sanctionId],
            async (err, sanction) => {
                if (err) {
                    console.error('Erreur lors de la récupération de la sanction:', err);
                    return interaction.reply({
                        content: '❌ Erreur lors de la récupération de la sanction.',
                        ephemeral: true
                    });
                }

                if (!sanction) {
                    return interaction.reply({
                        content: '❌ Sanction introuvable.',
                        ephemeral: true
                    });
                }

                // Vérifier que c'est bien le modérateur qui a créé la sanction
                if (sanction.moderatorId !== modérateur.id) {
                    return interaction.reply({
                        content: '❌ Vous ne pouvez modifier que les sanctions que vous avez vous-même émises.',
                        ephemeral: true
                    });
                }

                // Vérifier que la sanction date de moins d'une semaine
                if (sanction.date < oneWeekAgo) {
                    return interaction.reply({
                        content: '❌ Vous ne pouvez modifier que les sanctions datant de moins d\'une semaine.',
                        ephemeral: true
                    });
                }

                const ancienneRaison = sanction.reason;

                // Mettre à jour la sanction
                dbSanctions.run(
                    'UPDATE sanctions SET reason = ? WHERE id = ?',
                    [nouvelleRaison, sanctionId],
                    async function(updateErr) {
                        if (updateErr) {
                            console.error('Erreur lors de la mise à jour de la sanction:', updateErr);
                            return interaction.reply({
                                content: '❌ Erreur lors de la mise à jour de la sanction.',
                                ephemeral: true
                            });
                        }

                        // Envoyer un message de confirmation
                        await interaction.reply({
                            content: `✅ La sanction #${sanctionId} a été modifiée avec succès.`,
                            ephemeral: true
                        });

                        // Tenter d'éditer le message original dans les logs
                        const moderatorTitleWithArticle = getModeratorTitleWithArticle(modérateur);
                        const user = await interaction.client.users.fetch(sanction.userId).catch(() => null);
                        const username = user ? user.tag : sanction.userId;
                        let messageEdited = false;

                        if (sanction.log_channel_id && sanction.log_message_id) {
                            try {
                                const logChannel = await interaction.guild.channels.fetch(sanction.log_channel_id);
                                if (logChannel && logChannel.isTextBased()) {
                                    const logMessage = await logChannel.messages.fetch(sanction.log_message_id).catch(() => null);
                                    if (logMessage) {
                                        // Éditer le message original
                                        // On remplace l'ancienne raison en échappant les caractères spéciaux pour la regex
                                        const escapedOldReason = ancienneRaison.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                                        let updatedContent = logMessage.content.replace(
                                            new RegExp(`"${escapedOldReason}"`), 
                                            `"${nouvelleRaison}"`
                                        );
                                        
                                        // Ajouter la mention de modification si elle n'y est pas déjà
                                        if (!updatedContent.includes('Raison modifiée par')) {
                                            updatedContent += `\n-# ⚠️ Raison modifiée par ${moderatorTitleWithArticle} <@${modérateur.id}>`;
                                        } else {
                                            // Mettre à jour la mention existante
                                            updatedContent = updatedContent.replace(/\n-# ⚠️ Raison modifiée par.*/, `\n-# ⚠️ Raison modifiée par ${moderatorTitleWithArticle} <@${modérateur.id}>`);
                                        }
                                        
                                        await logMessage.edit(updatedContent);
                                        messageEdited = true;
                                    }
                                }
                            } catch (error) {
                                console.error('Erreur lors de l\'édition du message de log:', error);
                            }
                        }

                        // Envoyer un message de modification dans le canal de logs SEULEMENT si l'édition a échoué
                        if (!messageEdited) {
                            const modLogId = resolveModerationSanctionLogChannelId(interaction.guild.id);
                            const canalLog = modLogId
                                ? interaction.guild.channels.cache.get(modLogId) ||
                                  (await interaction.guild.channels.fetch(modLogId).catch(() => null))
                                : null;
                            if (canalLog && canalLog.isTextBased()) {
                                await canalLog.send(
                                    `# 📝 Modification de sanction #${sanctionId}\n` +
                                    `**Utilisateur :** ${username} (${sanction.userId})\n` +
                                    `**Type :** ${sanction.type}\n` +
                                    `**Ancienne raison :** "${ancienneRaison}"\n` +
                                    `**Nouvelle raison :** "${nouvelleRaison}"\n` +
                                    `**Modifié par :** ${moderatorTitleWithArticle} <@${modérateur.id}>`
                                );
                            }
                        }
                    }
                );
            }
        );
    }
};
