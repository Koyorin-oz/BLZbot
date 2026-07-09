const { ApplicationCommandOptionType, PermissionFlagsBits } = require('discord.js');
const { denyUnlessCanMod } = require('../utils/mod-access');

module.exports = {
    data: {
        name: 'clear',
        description: 'Supprime un nombre de messages dans le salon.',
        default_member_permissions: PermissionFlagsBits.ManageMessages.toString(),
        options: [
            {
                type: ApplicationCommandOptionType.Integer,
                name: 'nombre',
                description: 'Nombre de messages à supprimer (1 à 100).',
                required: true,
                min_value: 1,
                max_value: 100,
            },
            {
                type: ApplicationCommandOptionType.User,
                name: 'utilisateur',
                description: 'Ne supprimer que les messages de ce membre.',
                required: false,
            },
        ],
    },

    async execute(interaction) {
        if (!interaction.member.permissions.has(PermissionFlagsBits.ManageMessages)) {
            return interaction.reply({
                content: "Tu n'as pas la permission de gérer les messages.",
                ephemeral: true,
            });
        }

        const channel = interaction.channel;
        const me = interaction.guild.members.me;
        if (!channel || !channel.permissionsFor(me)?.has(PermissionFlagsBits.ManageMessages)) {
            return interaction.reply({
                content: "Je n'ai pas la permission de supprimer des messages dans ce salon.",
                ephemeral: true,
            });
        }

        const nombre = interaction.options.getInteger('nombre');
        const user = interaction.options.getUser('utilisateur');

        await interaction.deferReply({ ephemeral: true });

        try {
            const TWO_WEEKS = 14 * 24 * 60 * 60 * 1000;
            const now = Date.now();

            // Avec un filtre membre on récupère un plus gros lot pour avoir de quoi filtrer.
            const fetchLimit = user ? 100 : Math.min(nombre, 100);
            const fetched = await channel.messages.fetch({ limit: fetchLimit });

            let candidates = [...fetched.values()].filter(
                (m) => now - m.createdTimestamp < TWO_WEEKS,
            );
            if (user) candidates = candidates.filter((m) => m.author.id === user.id);

            // fetch renvoie du plus récent au plus ancien : on garde les N plus récents.
            candidates = candidates.slice(0, nombre);

            if (candidates.length === 0) {
                return interaction.editReply(
                    'Aucun message supprimable trouvé (les messages de plus de 14 jours ne peuvent pas être supprimés en masse).',
                );
            }

            const deleted = await channel.bulkDelete(candidates, true);
            const suffix = user ? ` de ${user}` : '';
            return interaction.editReply(
                `${deleted.size} message(s)${suffix} supprimé(s). (Les messages de plus de 14 jours ne sont pas supprimables en masse.)`,
            );
        } catch (error) {
            console.error('Erreur commande clear:', error);
            return interaction.editReply(`Une erreur est survenue : ${error.message}`);
        }
    },
};
