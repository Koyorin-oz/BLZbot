const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const CONFIG = require('../config.js');
const { buildTicketPanelPayload } = require('../utils/ticket-panel-payload');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('setup-ticket')
        .setDescription('Configurer le panneau de tickets')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addChannelOption(option =>
            option.setName('salon')
                .setDescription('Salon où afficher le panneau (défaut: salon actuel)')
                .setRequired(false)
                .addChannelTypes(ChannelType.GuildText)),

    async execute(interaction) {
        const channel = interaction.options.getChannel('salon') || interaction.channel;

        if (!channel?.guild || !interaction.guild) {
            return interaction.reply({
                content: '❌ Cette commande doit être utilisée dans un serveur Discord.',
                ephemeral: true
            });
        }

        const me = interaction.guild.members.me ?? await interaction.guild.members.fetchMe().catch(() => null);
        if (!me) {
            return interaction.reply({
                content: '❌ Impossible de récupérer mon compte dans ce serveur.',
                ephemeral: true
            });
        }

        if (!channel.permissionsFor(me)?.has(['ViewChannel', 'SendMessages', 'EmbedLinks'])) {
            return interaction.reply({
                content: '❌ Je n\'ai pas les permissions nécessaires dans ce salon.',
                ephemeral: true
            });
        }

        await channel.send(buildTicketPanelPayload());

        await interaction.reply({
            content: `✅ Panneau de ticket envoyé dans ${channel} !`,
            ephemeral: true
        });
    }
};
