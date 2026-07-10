const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const {
    DEFAULT_VOICE_CATEGORY_ID,
    ensureLobbyChannel,
    resolvePrivateRoomConfig,
} = require('../../utils/private-voice-rooms');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('setup-lobby')
        .setDescription(
            '[ADMIN] Crée ou répare le salon lobby vocal (catégorie vocaux privés — jamais supprimé par le bot).',
        )
        .addStringOption((opt) =>
            opt
                .setName('categorie_id')
                .setDescription(`ID de la catégorie (défaut : ${DEFAULT_VOICE_CATEGORY_ID})`)
                .setRequired(false),
        ),

    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });

        if (!interaction.guild) {
            return interaction.editReply({ content: '❌ Utilisable seulement sur un serveur.' });
        }

        const member = interaction.member;
        const isOwner = interaction.guild.ownerId === interaction.user.id;
        if (!isOwner && !member?.permissions?.has(PermissionFlagsBits.Administrator)) {
            return interaction.editReply({
                content:
                    '❌ Réservé au **propriétaire du serveur** ou aux membres avec la permission **Administrateur**.',
            });
        }

        const rawCat = String(interaction.options.getString('categorie_id') || '').trim();
        const categoryId = /^\d{17,22}$/.test(rawCat) ? rawCat : DEFAULT_VOICE_CATEGORY_ID;

        try {
            const lobby = await ensureLobbyChannel(interaction.guild, categoryId);
            const cfg = await resolvePrivateRoomConfig(interaction.client, interaction.guild);

            return interaction.editReply({
                content:
                    `✅ **Salon lobby prêt** : <#${lobby.id}>\n` +
                    `• Catégorie : \`${categoryId}\`\n` +
                    `• En rejoignant ce vocal : **pas de parole / pas d’écoute** dans le lobby → création automatique de **ton salon perso** + panneau BLZbot dans le chat du vocal.\n` +
                    `• Ce salon **n’est jamais supprimé** par le bot (seuls les vocaux privés vides le sont).\n\n` +
                    `**Optionnel** — mets dans le \`.env\` Pebble :\n` +
                    `\`PRIVATE_ROOM_LOBBY_CHANNEL_ID=${lobby.id}\`\n` +
                    `\`PRIVATE_ROOM_CATEGORY_ID=${categoryId}\`\n` +
                    (cfg.panelTextChannelId ? `Panneau secours texte : <#${cfg.panelTextChannelId}>` : ''),
            });
        } catch (e) {
            return interaction.editReply({ content: `❌ ${e?.message || e}` });
        }
    },
};
