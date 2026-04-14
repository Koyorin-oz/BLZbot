const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const CONFIG = require('../config.js');
const { getModeratorTitleWithArticle } = require('../utils/helpers.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('demute')
        .setDescription('Révoquer le mute d\'un utilisateur.')
        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
        .addUserOption(option =>
            option.setName('utilisateur')
                .setDescription('L\'utilisateur à démute')
                .setRequired(true))
        .toJSON(),

    async execute(interaction, { dbManager }) {
        if (!interaction.member.permissions.has(PermissionFlagsBits.ModerateMembers)) {
            return interaction.reply({
                content: '❌ Vous n\'avez pas la permission d\'utiliser cette commande.',
                flags: MessageFlags.Ephemeral,
            });
        }

        const utilisateur = interaction.options.getUser('utilisateur');
        const membre = await interaction.guild.members.fetch(utilisateur.id).catch(() => null);

        if (!membre) {
            return interaction.reply({ content: '❌ Membre introuvable.', ephemeral: true });
        }

        try {
            await membre.timeout(null);
            
            // Restaurer les rôles administrateurs temporairement retirés
            const dbTempRemovedRoles = dbManager.getTempRemovedRolesDb();
            dbTempRemovedRoles.all(
                'SELECT * FROM temp_removed_roles WHERE userId = ?',
                [utilisateur.id],
                async (err, rows) => {
                    if (!err && rows && rows.length > 0) {
                        for (const row of rows) {
                            try {
                                const role = interaction.guild.roles.cache.get(row.roleId);
                                if (role && !membre.roles.cache.has(row.roleId)) {
                                    await membre.roles.add(role, 'Restauration après demute manuel');
                                    console.log(`✅ Rôle ${role.name} restauré pour ${utilisateur.tag} après demute`);
                                }

                                // Supprimer l'entrée de la base de données
                                dbTempRemovedRoles.run(
                                    'DELETE FROM temp_removed_roles WHERE userId = ? AND roleId = ?',
                                    [utilisateur.id, row.roleId]
                                );
                            } catch (error) {
                                console.error('Erreur lors de la restauration d\'un rôle:', error);
                            }
                        }
                    }
                }
            );

            await interaction.reply({ 
                content: `✅ ${utilisateur.tag} a été démute.`, 
                ephemeral: true 
            });

            const canalLog = interaction.guild.channels.cache.get(CONFIG.STAFF_WARN_CHANNEL_ID);
            if (canalLog && canalLog.isTextBased()) {
                const moderatorTitleWithArticle = getModeratorTitleWithArticle(interaction.member);
                canalLog.send(`# ${utilisateur.tag} (${utilisateur.id}) a été démute par ${moderatorTitleWithArticle} <@${interaction.member.id}>`);
            }
        } catch (error) {
            console.error('Erreur lors du demute:', error);
            interaction.reply({ 
                content: '❌ Une erreur est survenue lors du demute.', 
                ephemeral: true 
            });
        }
    }
};
