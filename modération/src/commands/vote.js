const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { denyUnlessCanMod } = require('../utils/mod-access');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('vote')
        .setDescription('Démarrer un vote pour un utilisateur ou personnalisé')
        .setDefaultMemberPermissions(null)
        .addSubcommand(sub =>
            sub.setName('utilisateur')
                .setDescription('Démarrer un vote pour un utilisateur')
                .addUserOption(opt =>
                    opt.setName('utilisateur')
                        .setDescription('Utilisateur pour le vote')
                        .setRequired(true)
                )
        )
        .addSubcommand(sub =>
            sub.setName('personnalise')
                .setDescription('Démarrer un vote personnalisé')
                .addStringOption(opt =>
                    opt.setName('sujet')
                        .setDescription('Sujet du vote')
                        .setRequired(true)
                )
        ),

    async execute(interaction, { voteManager, config }) {
        const denied = denyUnlessCanMod(interaction, PermissionFlagsBits.ModerateMembers);
        if (denied) {
            return interaction.reply({ ...denied, ephemeral: true });
        }

        const subcommand = interaction.options.getSubcommand();

        try {
            if (subcommand === 'utilisateur') {
                await handleVoteUtilisateur(interaction, voteManager);
            } else if (subcommand === 'personnalise') {
                await handleVotePersonnalise(interaction, voteManager);
            }
        } catch (error) {
            console.error('Erreur lors du démarrage du vote:', error);
            await interaction.reply({
                content: '❌ Une erreur est survenue lors du lancement du vote.',
                ephemeral: true
            });
        }
    }
};

// ============================================
// Handler: Vote pour utilisateur
// ============================================
async function handleVoteUtilisateur(interaction, voteManager) {
    const user = interaction.options.getUser('utilisateur');
    const channel = interaction.channel;

    await voteManager.startVote(user, 'Vote pour', channel);
    
    await interaction.reply({
        content: `✅ Le vote pour <@${user.id}> a été lancé !`,
        ephemeral: true
    });
}

// ============================================
// Handler: Vote personnalisé
// ============================================
async function handleVotePersonnalise(interaction, voteManager) {
    const sujet = interaction.options.getString('sujet');

    await voteManager.startCustomVote(interaction, sujet);
}
