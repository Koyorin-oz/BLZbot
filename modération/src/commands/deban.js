const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const CONFIG = require('../config.js');
const { denyUnlessCanMod } = require('../utils/mod-access');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('deban')
        .setDescription('Révoquer le bannissement d\'un utilisateur.')
        .setDefaultMemberPermissions(null)
        .addUserOption(option =>
            option.setName('utilisateur')
                .setDescription('L\'utilisateur à débannir')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('raison')
                .setDescription('La raison du débannissement')
                .setRequired(false)
        )
        .toJSON(),

    async execute(interaction, { dbManager }) {
        const denied = denyUnlessCanMod(interaction, PermissionFlagsBits.BanMembers);
        if (denied) {
            return interaction.reply({ ...denied, ephemeral: true });
        }

        const modérateur = interaction.member;
        const utilisateur = interaction.options.getUser('utilisateur');
        const raison = interaction.options.getString('raison');
        const BLOCKED_DEBAN_USER_ID = '296653370788151296';

        const finalRaison = raison || 'Aucune raison fournie';

        if (utilisateur.id === BLOCKED_DEBAN_USER_ID) {
            return interaction.reply({
                content: "Erreur Impossible de deban l'utilisateur",
                ephemeral: true
            });
        }

        try {
            await interaction.guild.bans.remove(utilisateur.id, `Débanni par ${interaction.user.tag}: ${finalRaison} - Effectué par ${modérateur.user.tag} (${modérateur.id})`);
            await interaction.reply({
                content: `✅ ${utilisateur.tag} a été débanni.`,
                ephemeral: true
            });

            const canalLog = interaction.guild.channels.cache.get(CONFIG.STAFF_WARN_CHANNEL_ID);
            if (canalLog && canalLog.isTextBased()) {
                canalLog.send(`# ${utilisateur.tag} (${utilisateur.id}) a été débanni par ${modérateur.user.tag} (${modérateur.id})`);
            }
        } catch (error) {
            console.error('Erreur lors du deban:', error);
            interaction.reply({
                content: "Erreur Impossible de deban l'utilisateur",
                ephemeral: true
            });
        }
    }
};
