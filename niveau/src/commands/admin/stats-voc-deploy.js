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
            '[ADMIN] 3 vocaux compteur (total / humains / bots), connexion réservée aux admins.'
        )
        .addStringOption((opt) =>
            opt
                .setName('categorie_id')
                .setDescription(
                    'ID catégorie parent. Sinon MEMBER_STATS_CATEGORY_ID ou ID défaut du bot.'
                )
                .setRequired(false)
        )
        .addBooleanOption((opt) =>
            opt
                .setName('recreate')
                .setDescription('Supprime les 3 salons suivis puis les recrée (destructif).')
                .setRequired(false)
        ),
    // Pas de setDefaultMemberPermissions : sinon Discord masque / aux non-Administrateurs
    // (un rôle « Staff » sans le bit Administrateur ne voit pas la commande du tout).

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
        const categoryId = /^\d{17,22}$/.test(rawCat) ? rawCat : defaultCategoryId();

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
