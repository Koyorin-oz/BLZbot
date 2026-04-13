const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { postServerMusicPanel } = require('../../utils/voice-music-manager');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('music-panel')
        .setDescription(
            '[Admin] Affiche un panneau musique dans ce salon (en plus de celui des vocaux privés).'
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    async execute(interaction) {
        if (!interaction.guild) {
            return interaction.reply({ content: 'Utilise cette commande sur un serveur.', flags: 64 });
        }

        const ch = interaction.channel;
        if (!ch?.isTextBased?.() || typeof ch.send !== 'function') {
            return interaction.reply({
                content: 'Utilise cette commande dans un salon **texte** où le bot peut écrire.',
                flags: 64,
            });
        }

        await interaction.deferReply({ flags: 64 });

        try {
            await postServerMusicPanel(interaction.client, interaction.guild.id, ch);
        } catch (e) {
            return interaction.editReply({
                content: `Impossible d’envoyer le panneau : ${e?.message || 'erreur'}.`,
            });
        }

        return interaction.editReply({
            content:
                'Panneau musique envoyé dans ce salon. Il reste affiché pour tout le monde et se met à jour avec la lecture. Le panneau dans le chat des vocaux privés continue de fonctionner en parallèle.',
        });
    },
};
