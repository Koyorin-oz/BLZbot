const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const {
    defaultCategoryId,
    deployMemberStatsVoice,
    startScheduler,
} = require('../../utils/member-stats-voice');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('stats-voc-panel')
        .setDescription(
            '[ADMIN] 3 vocaux compteur (total / humains / bots), connexion réservée aux admins.'
        )
        .addStringOption((opt) =>
            opt
                .setName('categorie_id')
                .setDescription(
                    'ID catégorie sur ce serveur. Obligatoire si ta guilde n’est pas dans MEMBER_STATS_CATEGORY_IDS.'
                )
                .setRequired(false)
        )
        .addBooleanOption((opt) =>
            opt
                .setName('recreate')
                .setDescription('Supprime les 3 salons suivis puis les recrée (destructif).')
                .setRequired(false)
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

        const guild = interaction.guild;
        const me = guild.members.me ?? (await guild.members.fetchMe().catch(() => null));
        if (!me?.permissions.has(PermissionFlagsBits.ManageChannels)) {
            return interaction.editReply({
                content: '❌ Le bot a besoin de la permission **Gérer les salons**.',
            });
        }

        const rawCat = String(interaction.options.getString('categorie_id') || '').trim();
        const categoryId = /^\d{17,22}$/.test(rawCat)
            ? rawCat
            : defaultCategoryId(guild.id);

        if (!categoryId || !/^\d{17,22}$/.test(String(categoryId))) {
            return interaction.editReply({
                content:
                    '❌ Sur ce serveur il n’y a **pas de catégorie par défaut**. Renseigne l’option **categorie_id** (ID de la catégorie **sur ce serveur**), ou ajoute cette guilde dans **MEMBER_STATS_CATEGORY_IDS** dans le `.env`.',
            });
        }

        const recreate = interaction.options.getBoolean('recreate') === true;

        try {
            await deployMemberStatsVoice(guild, categoryId, { recreate });
            startScheduler(interaction.client);
            return interaction.editReply({
                content:
                    `✅ Compteurs vocaux déployés dans la catégorie \`${categoryId}\`.\n` +
                    `• **Tous Les Membres** / **Membres** (humains) / **Bots** — visibles par tous, **connexion** réservée aux rôles avec **Administrateur**.\n` +
                    `• Les noms se mettent à jour automatiquement **environ toutes les 10 minutes** (limite Discord) ; les arrivées / départs de **bots** sont suivis en temps réel dans l’état interne.`,
            });
        } catch (e) {
            const msg = e?.message || String(e);
            return interaction.editReply({ content: `❌ ${msg}` });
        }
    },
};
