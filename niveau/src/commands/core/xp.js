const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { getOrCreateUser, updateUserBalance, setLevel } = require('../../utils/db-users');
const { adjustWarInitialValues } = require('../../utils/guild/guild-wars');
const { getGuildOfUser, updateGuildLevel } = require('../../utils/db-guilds');
const { updateLevelRoles } = require('../../utils/level-roles');
const logger = require('../../utils/logger');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('xp')
        .setDescription('Gérer l\'XP et les niveaux des membres (Admin)')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addSubcommand(subcommand =>
            subcommand
                .setName('give')
                .setDescription('Donner de l\'XP à un membre')
                .addUserOption(option =>
                    option.setName('membre')
                        .setDescription('Le membre à qui donner de l\'XP')
                        .setRequired(true))
                .addIntegerOption(option =>
                    option.setName('montant')
                        .setDescription('La quantité d\'XP à donner')
                        .setRequired(true)
                        .setMinValue(1)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('remove')
                .setDescription('Retirer de l\'XP à un membre')
                .addUserOption(option =>
                    option.setName('membre')
                        .setDescription('Le membre à qui retirer de l\'XP')
                        .setRequired(true))
                .addIntegerOption(option =>
                    option.setName('montant')
                        .setDescription('La quantité d\'XP à retirer')
                        .setRequired(true)
                        .setMinValue(1)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('set-level')
                .setDescription('Définir le niveau d\'un membre')
                .addUserOption(option =>
                    option.setName('membre')
                        .setDescription('Le membre à modifier')
                        .setRequired(true))
                .addIntegerOption(option =>
                    option.setName('niveau')
                        .setDescription('Le nouveau niveau')
                        .setRequired(true)
                        .setMinValue(1))),

    async execute(interaction) {
        const subcommand = interaction.options.getSubcommand();
        const targetUser = interaction.options.getUser('membre');

        if (targetUser.bot) {
            return interaction.reply({ content: 'Vous ne pouvez pas modifier l\'XP/niveau d\'un bot.', flags: 64 });
        }

        getOrCreateUser(targetUser.id, targetUser.username);

        try {
            if (subcommand === 'give') {
                const amount = interaction.options.getInteger('montant');
                updateUserBalance(targetUser.id, { xp: amount });
                adjustWarInitialValues(targetUser.id, { xp: amount }); // Ne compte pas pour la guerre

                await interaction.reply({
                    content: `✅ Vous avez donné **${amount.toLocaleString('fr-FR')}** XP à **${targetUser.username}**.`,
                    flags: 64
                });
                logger.info(`Admin ${interaction.user.tag} gave ${amount} XP to ${targetUser.tag}`);

            } else if (subcommand === 'remove') {
                const amount = interaction.options.getInteger('montant');
                updateUserBalance(targetUser.id, { xp: -amount });
                adjustWarInitialValues(targetUser.id, { xp: -amount }); // Ne compte pas pour la guerre

                await interaction.reply({
                    content: `✅ Vous avez retiré **${amount.toLocaleString('fr-FR')}** XP à **${targetUser.username}**.`,
                    flags: 64
                });
                logger.info(`Admin ${interaction.user.tag} removed ${amount} XP from ${targetUser.tag}`);

            } else if (subcommand === 'set-level') {
                const level = interaction.options.getInteger('niveau');
                const { rebornEconomyActive, getRebornLevelState } = require('../../utils/reborn-integration');
                const beforeLevel = rebornEconomyActive()
                    ? (getRebornLevelState(targetUser.id, targetUser.username)?.level ?? 1)
                    : (getOrCreateUser(targetUser.id, targetUser.username).level ?? 1);

                await setLevel(targetUser.id, level, interaction.client);

                const userGuild = getGuildOfUser(targetUser.id);
                if (userGuild) {
                    updateGuildLevel(userGuild.id);
                }

                const member = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
                if (member) {
                    const displayLevel = rebornEconomyActive()
                        ? (getRebornLevelState(targetUser.id, targetUser.username)?.level ?? level)
                        : level;
                    await updateLevelRoles(member, displayLevel);
                }

                await interaction.reply({
                    content: `✅ Le niveau de **${targetUser.username}** a été défini sur **${level}**.`,
                    flags: 64
                });
                logger.info(`Admin ${interaction.user.tag} set level for ${targetUser.tag} to ${level} (was ${beforeLevel})`);
            }
        } catch (error) {
            logger.error(`Error in xp command:`, error);
            await interaction.reply({
                content: `❌ Une erreur est survenue lors de l'opération.`,
                flags: 64
            });
        }
    },
};
