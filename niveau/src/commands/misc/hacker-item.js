const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('hacker-item')
        .setDescription('Récupérer un item aléatoire du salon secret hackeur (Usage admin seulement)')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    
    async execute(interaction) {
        // Vérifier les permissions admin
        if (!interaction.member?.permissions?.has(PermissionFlagsBits.Administrator)) {
            return interaction.reply({
                content: '❌ Cette commande est réservée aux admins (mise à jour du panneau legacy). Les joueurs utilisent `/salon-hacker` et le **jeton hacker** depuis `/inventaire`.',
                flags: 64,
            });
        }

        if (!process.env.HACKER_CHANNEL) {
            return interaction.reply({
                content: '❌ L\'ID du salon Hackeur n\'est pas configuré. Vérifiez HACKER_CHANNEL dans le .env',
                flags: 64,
            });
        }

        const hackerChannel = await interaction.client.channels.fetch(process.env.HACKER_CHANNEL).catch(() => null);
        if (!hackerChannel) {
            return interaction.reply({
                content: '❌ Le salon Hackeur est introuvable sur le serveur.',
                ephemeral: true
            });
        }

        // Créer le bouton
        const row = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('hacker_daily_item')
                    .setLabel('Récupérer mon item')
                    .setStyle(ButtonStyle.Primary)
            );

        const embed = new EmbedBuilder()
            .setTitle('🔓 Salon Secret Hackeur')
            .setDescription('En tant que Hackeur, vous pouvez récupérer un item aléatoire toutes les 12 heures!\n\nCliquez sur le bouton ci-dessous pour récupérer votre item.')
            .setColor('#00FF00')
            .setFooter({ text: 'Vous ne pouvez réclamer qu\'une fois toutes les 12 heures' });

        try {
            // Récupérer les messages du bot dans le canal
            const messages = await hackerChannel.messages.fetch({ limit: 10 });
            let botMessage = messages.find(m => m.author.id === interaction.client.user.id);

            if (botMessage) {
                // Modifier le message existant
                await botMessage.edit({ embeds: [embed], components: [row] });
                return interaction.reply({
                    content: '✅ Message du salon Hackeur mis à jour!',
                    ephemeral: true
                });
            } else {
                // Envoyer un nouveau message
                await hackerChannel.send({ embeds: [embed], components: [row] });
                return interaction.reply({
                    content: '✅ Message envoyé au salon Hackeur!',
                    ephemeral: true
                });
            }
        } catch (error) {
            console.error('Erreur dans la commande hacker-item:', error);
            return interaction.reply({
                content: '❌ Une erreur s\'est produite.',
                ephemeral: true
            });
        }
    }
};
