const { SlashCommandBuilder, ChannelType, PermissionFlagsBits } = require('discord.js');
const { buildVocPanelOpenerPayload } = require('../../utils/voice-room-panel');
const { getPrivateRoomVoiceMeta, resolvePrivateRoomConfig } = require('../../utils/private-voice-rooms');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('voc-panel')
        .setDescription(
            '[Admin] Publie un accès au panneau d’un vocal privé (interface visible en privé pour chaque membre).'
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addChannelOption((opt) =>
            opt
                .setName('vocal')
                .setDescription('Le salon vocal privé à contrôler')
                .addChannelTypes(ChannelType.GuildVoice)
                .setRequired(true)
        ),

    async execute(interaction) {
        if (!interaction.guild) {
            return interaction.reply({
                content: 'Utilise cette commande sur un serveur.',
                flags: 64,
            });
        }

        const postChannel = interaction.channel;
        if (!postChannel?.isTextBased?.() || typeof postChannel.send !== 'function') {
            return interaction.reply({
                content: 'Utilise cette commande dans un **salon texte** (ou un fil) où le bot peut écrire.',
                flags: 64,
            });
        }

        const cfg = await resolvePrivateRoomConfig(interaction.client, interaction.guild);
        if (!cfg.enabled) {
            return interaction.reply({
                content: 'Les salons vocaux privés ne sont pas configurés sur ce serveur.',
                flags: 64,
            });
        }

        const voiceCh = interaction.options.getChannel('vocal');
        if (!voiceCh?.isVoiceBased?.()) {
            return interaction.reply({ content: 'Choisis un salon **vocal** valide.', flags: 64 });
        }

        if (String(voiceCh.parentId || '') !== String(cfg.voiceCategoryId)) {
            return interaction.reply({
                content: 'Ce salon n’est pas un vocal privé géré par le bot (mauvaise catégorie).',
                flags: 64,
            });
        }

        const meta = getPrivateRoomVoiceMeta(interaction.client, voiceCh.id);
        if (!meta || meta.guildId !== interaction.guild.id) {
            return interaction.reply({
                content: 'Ce salon n’est pas un vocal privé enregistré par le bot (créé via le lobby).',
                flags: 64,
            });
        }

        await interaction.deferReply({ flags: 64 });

        try {
            await postChannel.send({
                content: `Panneau vocal — ${voiceCh}`,
                ...buildVocPanelOpenerPayload(voiceCh.id),
            });
        } catch (e) {
            return interaction.editReply({
                content: `Impossible d’envoyer le message : ${e?.message || 'erreur'}. Vérifie les permissions du bot dans ce salon.`,
            });
        }

        return interaction.editReply({
            content:
                'Message publié. Les membres cliquent sur **Ouvrir le panneau** : le panneau complet leur est montré **en privé** (éphémère), sans encombrer le salon.',
        });
    },
};
