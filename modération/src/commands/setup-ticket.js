const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const CONFIG = require('../config.js');
const { buildTicketPanelPayload } = require('../utils/ticket-panel-payload');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('setup-ticket')
        .setDescription('🎫 Configurer le panneau de tickets')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addChannelOption(option =>
            option.setName('salon')
                .setDescription('Salon où afficher le panneau (défaut: salon actuel)')
                .setRequired(false)
                .addChannelTypes(ChannelType.GuildText)),

    async execute(interaction) {
        const channel = interaction.options.getChannel('salon') || interaction.channel;

        // Vérifier les permissions du bot
        if (!channel.permissionsFor(interaction.guild.members.me).has(['ViewChannel', 'SendMessages', 'EmbedLinks'])) {
            return interaction.reply({
                content: '❌ Je n\'ai pas les permissions nécessaires dans ce salon.',
                ephemeral: true
            });
        }

        const embed = new EmbedBuilder()
            .setTitle('📩 Support - Ouvrir un ticket')
            .setDescription(
                '**Besoin d\'aide ?**\n\n' +
                'Clique sur le bouton ci-dessous pour créer un ticket et contacter l\'équipe.\n\n' +
                '> ⚠️ **Merci de ne pas ouvrir de ticket pour rien**\n' +
                '> Les abus seront sanctionnés.'
            )
            .setColor(CONFIG.TICKETS?.EMBED_COLOR || BLZ_EMBED_STRIP_HEX)
            .setFooter({ text: 'BLZstarss - Système de tickets' });

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('ticket_create')
                .setLabel('🎟️ Créer un ticket')
                .setStyle(ButtonStyle.Primary)
        );

        await channel.send({ embeds: [embed], components: [row] });

        await interaction.reply({
            content: `✅ Panneau de ticket envoyé dans ${channel} !`,
            ephemeral: true
        });
    }
};
