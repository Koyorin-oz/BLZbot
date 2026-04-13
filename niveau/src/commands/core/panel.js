const { SlashCommandBuilder } = require('discord.js');
const { getMusicSession } = require('../../utils/voice-music-manager');
const { buildMusicPanelPayload } = require('../../utils/voice-music-panel');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('panel')
        .setDescription('Ouvre des panneaux d’interaction (musique, etc.)')
        .addSubcommand((s) =>
            s
                .setName('musique')
                .setDescription('Panneau lecteur YouTube (boutons — visible par toi seul)')
        ),

    async execute(interaction) {
        if (!interaction.guild) {
            return interaction.reply({ content: 'Utilise cette commande sur un serveur.', flags: 64 });
        }

        const sub = interaction.options.getSubcommand();
        if (sub === 'musique') {
            const guildId = interaction.guild.id;
            const session = getMusicSession(guildId);
            session._client = interaction.client;

            await interaction.reply({
                flags: 64,
                content: '🎵 **Ton panneau musique** (éphémère) — même boutons que dans le vocal.',
                ...buildMusicPanelPayload(guildId, session),
            });
            const msg = await interaction.fetchReply();
            session.addPanelRegistration(interaction.channelId, msg.id);
            return;
        }

        return interaction.reply({ content: 'Sous-commande inconnue.', flags: 64 });
    },
};
