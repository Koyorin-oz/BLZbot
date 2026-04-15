const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const {
    defaultCategoryId,
    deployMemberStatsVoice,
    startScheduler,
} = require('../../utils/member-stats-voice');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('stats-voc-deploy')
        .setDescription(
            '[ADMIN] Déploie 3 salons vocaux sous la catégorie : total membres, humains, bots (non joignables sauf admins).'
        )
        .addStringOption((opt) =>
            opt
                .setName('categorie_id')
                .setDescription('ID de la catégorie Discord (sinon MEMBER_STATS_CATEGORY_ID ou défaut serveur)')
                .setRequired(false)
        )
        .addBooleanOption((opt) =>
            opt
                .setName('recréer')
                .setDescription('Supprime les anciens salons enregistrés et les recrée (attention)')
                .setRequired(false)
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });

        if (!interaction.guild) {
            return interaction.editReply({ content: '❌ Utilisable seulement sur un serveur.' });
        }

        const guild = interaction.guild;
        const me = guild.members.me ?? (await guild.members.fetchMe().catch(() => null));
        if (!me?.permissions.has(PermissionFlagsBits.ManageChannels)) {
            return interaction.editReply({
                content: '❌ Le bot a besoin de la permission **Gérer les salons**.',
            });
        }

        const rawCat = String(interaction.options.getString('categorie_id') || '').trim();
        const categoryId = /^\d{17,22}$/.test(rawCat) ? rawCat : defaultCategoryId();

        const recreate = interaction.options.getBoolean('recréer') === true;

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
