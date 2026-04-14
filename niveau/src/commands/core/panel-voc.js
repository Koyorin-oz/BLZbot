const { SlashCommandBuilder, ChannelType } = require('discord.js');
const { buildPrivateVoicePanelPayload } = require('../../utils/voice-room-panel');
const {
    getPrivateRoomVoiceMeta,
    resolvePrivateRoomConfig,
    ensureSessions,
} = require('../../utils/private-voice-rooms');
const { canUseVoicePanel } = require('../../utils/voice-room-panel-handler');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('panel-voc')
        .setDescription('Affiche le panneau de contrôle d’un salon vocal privé dans ce salon.')
        .addChannelOption((opt) =>
            opt
                .setName('vocal')
                .setDescription('Le salon vocal privé à contrôler (par défaut : ton vocal actuel)')
                .addChannelTypes(ChannelType.GuildVoice)
                .setRequired(false)
        ),

    async execute(interaction) {
        const postChannel = interaction.channel;
        if (!interaction.guild || !postChannel || typeof postChannel.send !== 'function') {
            return interaction.reply({
                content: 'Utilise cette commande sur le serveur, dans un salon où le bot peut envoyer des messages.',
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

        let voiceCh = interaction.options.getChannel('vocal');
        if (!voiceCh) {
            const mid = interaction.member?.voice?.channelId;
            if (mid) {
                voiceCh = await interaction.guild.channels.fetch(mid).catch(() => null);
            }
        }
        if (!voiceCh?.isVoiceBased?.()) {
            const sess = ensureSessions(interaction.client).get(`${interaction.guild.id}:${interaction.user.id}`);
            if (sess?.voiceChannelId) {
                voiceCh = await interaction.guild.channels.fetch(sess.voiceChannelId).catch(() => null);
            }
        }

        if (!voiceCh?.isVoiceBased?.()) {
            return interaction.reply({
                content:
                    'Indique un salon **vocal**, connecte-toi à ton privé, ou crée d’abord un salon via le lobby **Crée ton vocal**.',
                flags: 64,
            });
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
                content: 'Ce salon vocal n’est pas un salon privé créé via le lobby du bot.',
                flags: 64,
            });
        }

        await interaction.reply({
            content: `Panneau pour ${voiceCh}`,
            ...buildPrivateVoicePanelPayload(voiceCh.id, 'public'),
        });
    },
};
