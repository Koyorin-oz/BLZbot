const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { denyUnlessCanMod } = require('../utils/mod-access');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('note')
        .setDescription('Gérer les notes d\'un membre.')
        .setDefaultMemberPermissions(null)
        .addSubcommand(subcommand =>
            subcommand
                .setName('ajouter')
                .setDescription('Ajouter une note à un membre.')
                .addUserOption(option =>
                    option.setName('utilisateur')
                        .setDescription('Le membre à noter')
                        .setRequired(true))
                .addStringOption(option =>
                    option.setName('contenu')
                        .setDescription('Contenu de la note')
                        .setRequired(true)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('retirer')
                .setDescription('Retirer une note d\'un membre.')
                .addUserOption(option =>
                    option.setName('utilisateur')
                        .setDescription('Le membre concerné')
                        .setRequired(true))
                .addIntegerOption(option =>
                    option.setName('id')
                        .setDescription('ID de la note à retirer (visible dans /modlog)')
                        .setRequired(true))),

    async execute(interaction, { dbManager }) {
        const notesDb = dbManager.getNotesDb();
        const subcommand = interaction.options.getSubcommand();
        const targetUser = interaction.options.getUser('utilisateur');

        if (subcommand === 'ajouter') {
            const content = interaction.options.getString('contenu');
            const moderator = interaction.user;

            notesDb.run(
                `INSERT INTO notes (userId, note, moderatorId, date) VALUES (?, ?, ?, ?)`, 
                [targetUser.id, content, moderator.id, Date.now()],
                function(err) {
                    if (err) {
                        console.error('Erreur ajout note:', err);
                        return interaction.reply({ content: '❌ Erreur lors de l\'ajout de la note.', ephemeral: true });
                    }
                    interaction.reply({
                        content: `✅ Note ajoutée au dossier de ${targetUser.tag} (ID: ${this.lastID}).`,
                        ephemeral: true 
                    });
                }
            );
        } 
        else if (subcommand === 'retirer') {
            const noteId = interaction.options.getInteger('id');

            // Vérifier que la note existe et appartient à l\'utilisateur
            notesDb.get(
                'SELECT id FROM notes WHERE id = ? AND userId = ?', 
                [noteId, targetUser.id],
                (err, row) => {
                    if (err) {
                        return interaction.reply({ content: '❌ Erreur lors de la vérification.', ephemeral: true });
                    }
                    if (!row) {
                        return interaction.reply({ content: '❌ Aucune note trouvée avec cet ID pour cet utilisateur.', ephemeral: true });
                    }

                    notesDb.run('DELETE FROM notes WHERE id = ?', [noteId], (err) => {
                        if (err) {
                            return interaction.reply({ content: '❌ Erreur lors de la suppression.', ephemeral: true });
                        }
                        interaction.reply({
                            content: `🗑️ Note #${noteId} retirée du dossier de ${targetUser.tag}.`, 
                            ephemeral: true 
                        });
                    });
                }
            );
        }
    }
};