const { SlashCommandBuilder, AttachmentBuilder } = require('discord.js');
const { getGuildOfUser, getGuildByName, getGuildMembersWithDetails, getGuildById } = require('../../utils/db-guilds');
const { getOngoingWar } = require('../../utils/guild/guild-wars');
const {
    GUILD_PREVIEW_VARIANTS,
    renderGuildProfilePreviewVariant,
    normalizeGuildVariant,
} = require('../../utils/canvas-guild-profile-variants');
const { handleCommandError } = require('../../utils/error-handler');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('testprofilguilde')
        .setDescription('Aperçu canvas : 3 variantes visuelles du profil guilde (hors /profil-guilde).')
        .addStringOption((opt) =>
            opt
                .setName('style')
                .setDescription('Variante à afficher')
                .setRequired(true)
                .addChoices(
                    { name: 'Bastion — pierre & or', value: 'bastion' },
                    { name: 'Orbit — espace & halos', value: 'orbit' },
                    { name: 'Registre — style tableau', value: 'ledger' }
                )
        )
        .addStringOption((opt) =>
            opt
                .setName('nom')
                .setDescription('Nom de la guilde (défaut : la vôtre)')
                .setRequired(false)
        ),

    async execute(interaction) {
        try {
            await interaction.deferReply({ flags: 64 });

            const variant = normalizeGuildVariant(interaction.options.getString('style', true));
            const guildName = interaction.options.getString('nom');
            const guild = guildName ? getGuildByName(guildName) : getGuildOfUser(interaction.user.id);

            if (!guild) {
                return interaction.editReply({
                    content:
                        "❌ Guilde introuvable. Précise `nom` ou rejoignez une guilde pour tester sur la vôtre.",
                });
            }

            const members = getGuildMembersWithDetails(guild.id);
            const owner = await interaction.client.users.fetch(guild.owner_id).catch(() => null);
            const war = getOngoingWar(guild.id);
            let warInfo = null;
            if (war) {
                const opponentId = war.guild1_id === guild.id ? war.guild2_id : war.guild1_id;
                const opponent = getGuildById(opponentId);
                warInfo = {
                    status: 'ongoing',
                    opponent: opponent ? opponent.name : 'Inconnu',
                    timeRemaining: war.end_time - Date.now(),
                };
            }

            const png = await renderGuildProfilePreviewVariant(
                {
                    guild,
                    members: members.slice(0, 10),
                    owner: owner || { username: 'Inconnu' },
                    warInfo,
                    totalMembers: members.length,
                },
                variant
            );

            const meta = GUILD_PREVIEW_VARIANTS.find((v) => v.id === variant);
            const file = new AttachmentBuilder(png, { name: `testprofilguilde-${variant}.png` });
            const hint = meta ? `**${meta.label}** — _${meta.hint}_` : variant;

            return interaction.editReply({
                content:
                    `🧪 Prévisualisation guilde **${variant}** (${hint})\n` +
                    `Guilde : **${guild.name}** · \`/profil-guilde\` officiel inchangé.`,
                files: [file],
            });
        } catch (error) {
            await handleCommandError(interaction, error, interaction.client);
        }
    },
};
