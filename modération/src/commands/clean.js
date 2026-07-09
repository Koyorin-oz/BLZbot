const { ApplicationCommandOptionType, PermissionFlagsBits, ChannelType } = require('discord.js');
const { denyUnlessCanMod } = require('../utils/mod-access');

module.exports = {
    data: {
        name: 'clean',
        description: 'Supprime plusieurs messages en masse.',
        default_member_permissions: null,
        options: [
            {
                type: ApplicationCommandOptionType.Subcommand,
                name: 'before',
                description: 'Supprime les messages AVANT un certain message (plus anciens).',
                options: [
                    {
                        type: ApplicationCommandOptionType.String,
                        name: 'message_id',
                        description: 'L\'ID du message de référence.',
                        required: true
                    }
                ]
            },
            {
                type: ApplicationCommandOptionType.Subcommand,
                name: 'channel',
                description: 'Supprime tous les messages du salon (récents).',
                options: [
                    {
                        type: ApplicationCommandOptionType.Channel,
                        name: 'salon',
                        description: 'Le salon à nettoyer (par défaut: salon actuel).',
                        required: false,
                        channel_types: [ChannelType.GuildText]
                    }
                ]
            },
            {
                type: ApplicationCommandOptionType.Subcommand,
                name: 'discussion',
                description: 'Supprime les messages entre deux messages inclus.',
                options: [
                    {
                        type: ApplicationCommandOptionType.String,
                        name: 'start_message_id',
                        description: 'ID du premier message (le plus ancien).',
                        required: true
                    },
                    {
                        type: ApplicationCommandOptionType.String,
                        name: 'end_message_id',
                        description: 'ID du dernier message (le plus récent).',
                        required: true
                    }
                ]
            }
        ],
    },

    async execute(interaction) {
        // Vérification permission (redondant avec default_member_permissions mais sécurité supp)
        if (!interaction.member.permissions.has(PermissionFlagsBits.ManageMessages)) {
            return interaction.reply({
                content: "❌ Vous n'avez pas la permission de gérer les messages.",
                ephemeral: true
            });
        }

        const subcommand = interaction.options.getSubcommand();
        const channel = interaction.options.getChannel('salon') || interaction.channel;

        // Vérifier que le bot peut supprimer des messages dans ce salon
        if (!channel.permissionsFor(interaction.guild.members.me).has(PermissionFlagsBits.ManageMessages)) {
            return interaction.reply({
                content: "❌ Je n'ai pas la permission de supprimer des messages dans ce salon.",
                ephemeral: true
            });
        }

        await interaction.deferReply({ ephemeral: true });

        try {
            if (subcommand === 'before') {
                const messageId = interaction.options.getString('message_id');
                await this.cleanBefore(interaction, channel, messageId);
            } else if (subcommand === 'channel') {
                await this.cleanChannel(interaction, channel);
            } else if (subcommand === 'discussion') {
                const startId = interaction.options.getString('start_message_id');
                const endId = interaction.options.getString('end_message_id');
                await this.cleanDiscussion(interaction, channel, startId, endId);
            }
        } catch (error) {
            console.error('Erreur commande clean:', error);
            await interaction.editReply({
                content: `❌ Une erreur est survenue : ${error.message}`
            });
        }
    },

    async cleanBefore(interaction, channel, messageId) {
        // Récupérer les messages avant l'ID donné
        // On procède par lots de 100
        let deletedCount = 0;
        let lastId = messageId;
        let keepGoing = true;

        while (keepGoing) {
            const messages = await channel.messages.fetch({ limit: 100, before: lastId });
            if (messages.size === 0) {
                keepGoing = false;
                break;
            }

            // Filtrer les messages trop vieux (> 14 jours)
            const now = Date.now();
            const validMessages = messages.filter(m => (now - m.createdTimestamp) < 1209600000); // 14 jours en ms

            if (validMessages.size === 0) {
                // Tous les messages restants sont trop vieux
                keepGoing = false;
                break;
            }

            await channel.bulkDelete(validMessages, true);
            deletedCount += validMessages.size;
            lastId = messages.first().id;

            if (messages.size < 100) {
                keepGoing = false;
            }
        }

        await interaction.editReply(`✅ **${deletedCount}** messages supprimés avant le message ${messageId}. (Les messages de plus de 14 jours ne peuvent pas être supprimés en masse).`);
    },

    async cleanChannel(interaction, channel) {
        let deletedCount = 0;
        let keepGoing = true;

        while (keepGoing) {
            const messages = await channel.messages.fetch({ limit: 100 });
            if (messages.size === 0) {
                keepGoing = false;
                break;
            }

            const now = Date.now();
            const validMessages = messages.filter(m => (now - m.createdTimestamp) < 1209600000);

            if (validMessages.size === 0) {
                keepGoing = false;
                break;
            }

            await channel.bulkDelete(validMessages, true);
            deletedCount += validMessages.size;

            if (messages.size < 100) {
                keepGoing = false;
            }

            // Petite pause pour éviter le rate limit
            await new Promise(resolve => setTimeout(resolve, 1000));
        }

        await interaction.editReply(`✅ **${deletedCount}** messages supprimés dans ${channel}. (Les messages de plus de 14 jours ne peuvent pas être supprimés en masse).`);
    },

    async cleanDiscussion(interaction, channel, startId, endId) {
        // Validation basique des IDs (snowflake)
        if (BigInt(startId) > BigInt(endId)) {
            // Inversion si l'utilisateur s'est trompé d'ordre
            [startId, endId] = [endId, startId];
        }

        let deletedCount = 0;
        let currentEndId = endId;
        let foundStart = false;
        let keepGoing = true;

        // On doit inclure le message de fin, donc on commence par fetcher le message de fin s'il existe, ou on fetch before un ID théorique futur
        // Pour simplifier, on fetch depuis la fin (endId) en remontant

        // D'abord, on essaie de supprimer le message de fin lui-même s'il est récent
        try {
            const endMsg = await channel.messages.fetch(endId).catch(() => null);
            if (endMsg && (Date.now() - endMsg.createdTimestamp) < 1209600000) {
                await endMsg.delete();
                deletedCount++;
            }
        } catch (e) { /* ignore */ }

        while (keepGoing) {
            // On cherche les messages AVANT le currentEndId
            const messages = await channel.messages.fetch({ limit: 100, before: currentEndId });

            if (messages.size === 0) {
                keepGoing = false;
                break;
            }

            // On cherche si le startId est dans ce lot
            let messagesToDelete = new Set();

            for (const [id, msg] of messages) {
                if (BigInt(id) >= BigInt(startId)) {
                    messagesToDelete.add(id);
                }
                if (id === startId) {
                    foundStart = true;
                }
            }

            // Convertir en collection pour le filtre de date
            const toDeleteCollection = messages.filter(m => messagesToDelete.has(m.id));

            const now = Date.now();
            const validMessages = toDeleteCollection.filter(m => (now - m.createdTimestamp) < 1209600000);

            if (validMessages.size > 0) {
                await channel.bulkDelete(validMessages, true);
                deletedCount += validMessages.size;
            }

            if (foundStart || messages.size < 100) {
                keepGoing = false;
            } else {
                currentEndId = messages.first().id;
            }
        }

        await interaction.editReply(`✅ **${deletedCount}** messages supprimés entre les deux bornes. (Les messages de plus de 14 jours ne peuvent pas être supprimés en masse).`);
    }
};
