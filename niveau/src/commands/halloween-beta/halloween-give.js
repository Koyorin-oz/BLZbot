const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { isLive } = require('../../halloween2026/live');
const { grantEventCurrency, getOrCreateEventUser } = require('../../utils/db-halloween');

const LABEL = { bonbons: 'Bonbons 🍬', citrouilles: 'Citrouilles 🎃' };

module.exports = {
    data: new SlashCommandBuilder()
        .setName('halloween-give')
        .setDescription('[Admin] Donne ou retire des bonbons / citrouilles.')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addUserOption((o) => o.setName('membre').setDescription('La personne').setRequired(true))
        .addStringOption((o) => o.setName('monnaie').setDescription('Bonbons ou citrouilles').setRequired(true).addChoices(
            { name: 'Bonbons 🍬', value: 'bonbons' },
            { name: 'Citrouilles 🎃', value: 'citrouilles' },
        ))
        .addIntegerOption((o) => o.setName('montant').setDescription('Négatif pour retirer').setRequired(true)
            .setMinValue(-1000000).setMaxValue(1000000)),

    async execute(interaction) {
        if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
            return interaction.reply({ content: 'Réservé aux admins.', ephemeral: true });
        }
        if (!isLive(interaction.guildId)) {
            return interaction.reply({ content: 'Update Halloween pas encore sur ce serveur.', ephemeral: true });
        }
        const target = interaction.options.getUser('membre');
        const currency = interaction.options.getString('monnaie');
        let amount = interaction.options.getInteger('montant');
        if (target.bot || amount === 0) {
            return interaction.reply({ content: 'Cible ou montant invalide.', ephemeral: true });
        }

        const before = getOrCreateEventUser(target.id, target.username)[currency] || 0;
        if (amount < 0) amount = -Math.min(before, -amount);
        const after = grantEventCurrency(target.id, { [currency]: amount })[currency];

        const verb = amount >= 0 ? 'donné' : 'retiré';
        return interaction.reply({
            content: `${Math.abs(amount).toLocaleString('fr-FR')} ${LABEL[currency]} ${verb} à ${target}. Nouveau solde : **${after.toLocaleString('fr-FR')}**.`,
            ephemeral: true,
        });
    },
};
