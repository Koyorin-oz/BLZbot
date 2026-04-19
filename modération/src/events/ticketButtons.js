/**
 * Gestionnaire des boutons de tickets - Components V2
 */
const {
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    PermissionsBitField,
    ChannelType,
    ModalBuilder,
    UserSelectMenuBuilder,
    AttachmentBuilder
} = require('discord.js');
const path = require('path');
const CONFIG = require('../config.js');
const { BLZ_EMBED_STRIP_HEX } = require(path.join(__dirname, '..', '..', '..', 'blz-embed-theme'));
const ticketManager = require('../modules/tickets.js');

/**
 * Gère les interactions de boutons liés aux tickets
 * @param {ButtonInteraction} interaction
 * @param {Client} client
 */
async function handleTicketButton(interaction, client) {
    const customId = interaction.customId;

    switch (customId) {
        case 'ticket_create':
            await handleCreateTicket(interaction);
            break;
        case 'ticket_close':
            await handleCloseRequest(interaction);
            break;
        case 'ticket_close_confirm':
            await handleCloseConfirm(interaction, client);
            break;
        case 'ticket_close_cancel':
            await interaction.update({ content: '❌ Fermeture annulée.', components: [] });
            break;
        case 'ticket_transcript':
            await handleTranscript(interaction);
            break;
        case 'ticket_delete':
            await handleDeleteRequest(interaction);
            break;
        case 'ticket_delete_confirm':
            await handleDeleteConfirm(interaction, client);
            break;
        case 'ticket_delete_cancel':
            await interaction.update({ content: '❌ Suppression annulée.', components: [] });
            break;
        case 'ticket_add':
            await handleAddUser(interaction);
            break;
        case 'ticket_remove':
            await handleRemoveUser(interaction);
            break;
    }
}

/**
 * Gère les interactions de sélection d'utilisateurs
 * @param {UserSelectMenuInteraction} interaction
 */
async function handleTicketSelectMenu(interaction) {
    const customId = interaction.customId;
    const ticketId = ticketManager.getTicketIdFromChannel(interaction.channel);

    if (customId === 'ticket_add_select') {
        const selectedUser = interaction.users.first();
        if (!selectedUser) {
            return interaction.reply({ content: '❌ Aucun utilisateur sélectionné.', ephemeral: true });
        }

        try {
            // Récupérer le membre du serveur
            const member = await interaction.guild.members.fetch(selectedUser.id).catch(() => null);
            if (!member) {
                return interaction.reply({ content: '❌ Utilisateur introuvable sur ce serveur.', ephemeral: true });
            }

            await interaction.channel.permissionOverwrites.edit(member, {
                ViewChannel: true,
                SendMessages: true,
                ReadMessageHistory: true
            });

            ticketManager.addUserToTicket(ticketId, selectedUser.id);

            await interaction.reply({
                content: `✅ ${selectedUser.tag} a été ajouté au ticket.`
            });
        } catch (error) {
            console.error('[Tickets] Erreur ajout utilisateur:', error);
            await interaction.reply({
                content: '❌ Une erreur est survenue lors de l\'ajout.',
                ephemeral: true
            });
        }
    } else if (customId === 'ticket_remove_select') {
        const selectedUser = interaction.users.first();
        if (!selectedUser) {
            return interaction.reply({ content: '❌ Aucun utilisateur sélectionné.', ephemeral: true });
        }

        try {
            // Récupérer le membre du serveur
            const member = await interaction.guild.members.fetch(selectedUser.id).catch(() => null);
            if (!member) {
                return interaction.reply({ content: '❌ Utilisateur introuvable sur ce serveur.', ephemeral: true });
            }

            await interaction.channel.permissionOverwrites.edit(member, {
                ViewChannel: false,
                SendMessages: false,
                ReadMessageHistory: false
            });

            ticketManager.removeUserFromTicket(ticketId, selectedUser.id);

            await interaction.reply({
                content: `✅ ${selectedUser.tag} a été retiré du ticket.`
            });
        } catch (error) {
            console.error('[Tickets] Erreur retrait utilisateur:', error);
            await interaction.reply({
                content: '❌ Une erreur est survenue lors du retrait.',
                ephemeral: true
            });
        }
    }
}

/**
 * Crée un nouveau ticket
 */
async function handleCreateTicket(interaction) {
    if (!CONFIG.TICKETS?.ENABLED) {
        return interaction.reply({
            content: '❌ Le système de tickets est désactivé.',
            ephemeral: true
        });
    }

    const userId = interaction.user.id;
    const config = CONFIG.TICKETS;

    // Vérifier si l'utilisateur peut créer un ticket
    const { canCreate, reason } = ticketManager.canCreateTicket(userId, config);
    if (!canCreate) {
        return interaction.reply({
            content: `❌ ${reason}`,
            ephemeral: true
        });
    }

    await interaction.deferReply({ ephemeral: true });

    try {
        // Permissions du ticket
        const overwrites = [
            {
                id: interaction.guild.roles.everyone,
                deny: [PermissionsBitField.Flags.ViewChannel]
            },
            {
                id: interaction.member,
                allow: [
                    PermissionsBitField.Flags.ViewChannel,
                    PermissionsBitField.Flags.SendMessages,
                    PermissionsBitField.Flags.ReadMessageHistory,
                    PermissionsBitField.Flags.AttachFiles
                ]
            }
        ];

        // Ajouter le rôle de ping si configuré et en cache
        if (config.PING_ROLE_ID) {
            const pingRole = interaction.guild.roles.cache.get(config.PING_ROLE_ID);
            if (pingRole) {
                overwrites.push({
                    id: pingRole,
                    allow: [
                        PermissionsBitField.Flags.ViewChannel,
                        PermissionsBitField.Flags.SendMessages,
                        PermissionsBitField.Flags.ReadMessageHistory
                    ]
                });
            } else {
                console.warn(`[Tickets] Rôle de ping ${config.PING_ROLE_ID} non trouvé dans le cache`);
            }
        }

        // Ajouter le rôle staff qui peut voir tous les tickets
        if (config.STAFF_ACCESS_ROLE_ID) {
            const staffRole = interaction.guild.roles.cache.get(config.STAFF_ACCESS_ROLE_ID);
            if (staffRole) {
                overwrites.push({
                    id: staffRole,
                    allow: [
                        PermissionsBitField.Flags.ViewChannel,
                        PermissionsBitField.Flags.SendMessages,
                        PermissionsBitField.Flags.ReadMessageHistory,
                        PermissionsBitField.Flags.AttachFiles
                    ]
                });
            } else {
                console.warn(`[Tickets] Rôle staff ${config.STAFF_ACCESS_ROLE_ID} non trouvé dans le cache`);
            }
        }

        // Préparer les options de création
        const createOptions = {
            name: `ticket-temp`,
            type: ChannelType.GuildText,
            permissionOverwrites: overwrites,
            topic: `Ticket en cours de création...`
        };

        // Ajouter la catégorie si configurée
        if (config.CATEGORY_ID) {
            const category = interaction.guild.channels.cache.get(config.CATEGORY_ID);
            if (category && category.type === ChannelType.GuildCategory) {
                createOptions.parent = config.CATEGORY_ID;
            }
        }

        const ticketChannel = await interaction.guild.channels.create(createOptions);

        // Créer le ticket dans le manager et obtenir l'ID
        const ticketId = ticketManager.createTicket(userId, ticketChannel.id);

        // Mettre à jour le nom et le topic avec l'ID
        await ticketChannel.edit({
            name: `ticket-${ticketId}`,
            topic: `Ticket créé par ${interaction.user.tag} (ID:${userId}) - TICKET_ID:${ticketId}`
        });

        // Créer l'embed de bienvenue
        const ticketEmbed = new EmbedBuilder()
            .setTitle(`🎫 Ticket #${ticketId}`)
            .setDescription(
                `Bonjour <@${userId}> 👋\n\n` +
                `Merci d'avoir ouvert un ticket.\n` +
                `L'équipe ${config.PING_ROLE_ID ? `<@&${config.PING_ROLE_ID}>` : 'staff'} va bientôt venir t'aider.\n\n` +
                `**Décris ton problème en détail** pour qu'on puisse t'aider au mieux.`
            )
            .setColor(config.EMBED_COLOR || BLZ_EMBED_STRIP_HEX)
            .setFooter({ text: `ID: ${ticketId}` })
            .setTimestamp();

        // Boutons de gestion (sans Transcript - il apparaîtra à la fermeture)
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('ticket_add')
                .setLabel('➕ Ajouter')
                .setStyle(ButtonStyle.Success),
            new ButtonBuilder()
                .setCustomId('ticket_remove')
                .setLabel('➖ Retirer')
                .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId('ticket_close')
                .setLabel('🔒 Fermer')
                .setStyle(ButtonStyle.Danger)
        );

        const welcomeMsg = await ticketChannel.send({
            content: config.PING_ROLE_ID ? `<@&${config.PING_ROLE_ID}>` : undefined,
            embeds: [ticketEmbed],
            components: [row]
        });

        await welcomeMsg.pin().catch(() => { });

        await interaction.editReply({
            content: `✅ Ticket créé ! ${ticketChannel}`
        });

        // Log la création si configuré
        if (config.LOG_CHANNEL_ID) {
            try {
                const logChannel = await interaction.client.channels.fetch(config.LOG_CHANNEL_ID);
                if (logChannel) {
                    const logEmbed = new EmbedBuilder()
                        .setColor('#00FF00')
                        .setTitle('🎫 Nouveau ticket créé')
                        .addFields(
                            { name: 'Ticket', value: `#${ticketId}`, inline: true },
                            { name: 'Créé par', value: `<@${userId}>`, inline: true },
                            { name: 'Salon', value: `${ticketChannel}`, inline: true }
                        )
                        .setTimestamp();
                    await logChannel.send({ embeds: [logEmbed] });
                }
            } catch (error) {
                console.error('[Tickets] Erreur log:', error);
            }
        }

    } catch (error) {
        console.error('[Tickets] Erreur création:', error);
        await interaction.editReply({
            content: '❌ Une erreur est survenue lors de la création du ticket.'
        });
    }
}

/**
 * Affiche la confirmation de fermeture
 */
async function handleCloseRequest(interaction) {
    if (!ticketManager.isTicketChannel(interaction.channel)) {
        return interaction.reply({
            content: '❌ Cette commande ne peut être utilisée que dans un ticket.',
            ephemeral: true
        });
    }

    const confirmRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('ticket_close_confirm')
            .setLabel('✅ Confirmer la fermeture')
            .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
            .setCustomId('ticket_close_cancel')
            .setLabel('❌ Annuler')
            .setStyle(ButtonStyle.Secondary)
    );

    await interaction.reply({
        content: '⚠️ **Es-tu sûr de vouloir fermer ce ticket ?**\nL\'utilisateur ne pourra plus voir ce canal mais le ticket ne sera pas supprimé.',
        components: [confirmRow],
        ephemeral: true
    });
}

/**
 * Confirme et ferme le ticket (exclut l'utilisateur au lieu de supprimer)
 */
async function handleCloseConfirm(interaction, client) {
    const ticketId = ticketManager.getTicketIdFromChannel(interaction.channel);
    const ticket = ticketManager.getTicket(ticketId);

    if (!ticket) {
        return interaction.update({
            content: '❌ Ticket introuvable dans la base de données.',
            components: []
        });
    }

    await interaction.update({
        content: '⏳ Fermeture du ticket en cours...',
        components: []
    });

    try {
        // Exclure le propriétaire du ticket
        const ownerMember = await interaction.guild.members.fetch(ticket.owner).catch(() => null);
        if (ownerMember) {
            await interaction.channel.permissionOverwrites.edit(ownerMember, {
                ViewChannel: false,
                SendMessages: false
            });
        }

        // Exclure tous les utilisateurs ajoutés
        const addedUsers = ticket.addedUsers || [];
        for (const userId of addedUsers) {
            try {
                const member = await interaction.guild.members.fetch(userId).catch(() => null);
                if (member) {
                    await interaction.channel.permissionOverwrites.edit(member, {
                        ViewChannel: false,
                        SendMessages: false
                    });
                }
            } catch (e) {
                console.warn(`[Tickets] Impossible d'exclure l'utilisateur ${userId}:`, e);
            }
        }

        ticketManager.updateTicketStatus(ticketId, 'closed');

        // Message de fermeture avec boutons Transcript + Supprimer
        const closedEmbed = new EmbedBuilder()
            .setTitle('🔒 Ticket fermé')
            .setDescription(
                `Ce ticket a été fermé par ${interaction.user.tag}.\n` +
                `L'utilisateur <@${ticket.owner}> ne peut plus voir ce canal.`
            )
            .setColor('#FF6B6B')
            .setTimestamp();

        const closedRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('ticket_transcript')
                .setLabel('📜 Transcript')
                .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
                .setCustomId('ticket_delete')
                .setLabel('🗑️ Supprimer le ticket')
                .setStyle(ButtonStyle.Danger)
        );

        await interaction.channel.send({
            embeds: [closedEmbed],
            components: [closedRow]
        });

        // Log la fermeture
        if (CONFIG.TICKETS?.LOG_CHANNEL_ID) {
            try {
                const logChannel = await client.channels.fetch(CONFIG.TICKETS.LOG_CHANNEL_ID);
                if (logChannel) {
                    const logEmbed = new EmbedBuilder()
                        .setColor('#FFA500')
                        .setTitle('🔒 Ticket fermé')
                        .addFields(
                            { name: 'Ticket', value: `#${ticketId}`, inline: true },
                            { name: 'Fermé par', value: `<@${interaction.user.id}>`, inline: true },
                            { name: 'Propriétaire', value: `<@${ticket.owner}>`, inline: true }
                        )
                        .setTimestamp();
                    await logChannel.send({ embeds: [logEmbed] });
                }
            } catch (error) {
                console.error('[Tickets] Erreur log fermeture:', error);
            }
        }

    } catch (error) {
        console.error('[Tickets] Erreur fermeture:', error);
        await interaction.followUp({
            content: '❌ Une erreur est survenue lors de la fermeture.',
            ephemeral: true
        });
    }
}

/**
 * Affiche la confirmation de suppression
 */
async function handleDeleteRequest(interaction) {
    if (!ticketManager.isTicketChannel(interaction.channel)) {
        return interaction.reply({
            content: '❌ Cette commande ne peut être utilisée que dans un ticket.',
            ephemeral: true
        });
    }

    // Vérifier si l'utilisateur est staff
    if (!interaction.member.permissions.has(PermissionsBitField.Flags.ModerateMembers)) {
        return interaction.reply({
            content: '❌ Seul un membre du staff peut supprimer ce ticket.',
            ephemeral: true
        });
    }

    const confirmRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('ticket_delete_confirm')
            .setLabel('✅ Supprimer définitivement')
            .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
            .setCustomId('ticket_delete_cancel')
            .setLabel('❌ Annuler')
            .setStyle(ButtonStyle.Secondary)
    );

    await interaction.reply({
        content: '⚠️ **ATTENTION**: Cette action est **irréversible**.\nLe ticket sera supprimé définitivement.',
        components: [confirmRow],
        ephemeral: true
    });
}

/**
 * Confirme et supprime le ticket
 */
async function handleDeleteConfirm(interaction, client) {
    const ticketId = ticketManager.getTicketIdFromChannel(interaction.channel);
    const ticket = ticketManager.getTicket(ticketId);

    await interaction.update({
        content: '⏳ Suppression du ticket en cours...',
        components: []
    });

    // Log la suppression
    if (CONFIG.TICKETS?.LOG_CHANNEL_ID && ticket) {
        try {
            const logChannel = await client.channels.fetch(CONFIG.TICKETS.LOG_CHANNEL_ID);
            if (logChannel) {
                const logEmbed = new EmbedBuilder()
                    .setColor('#FF0000')
                    .setTitle('🗑️ Ticket supprimé')
                    .addFields(
                        { name: 'Ticket', value: `#${ticketId}`, inline: true },
                        { name: 'Supprimé par', value: `<@${interaction.user.id}>`, inline: true },
                        { name: 'Propriétaire', value: `<@${ticket.owner}>`, inline: true }
                    )
                    .setTimestamp();
                await logChannel.send({ embeds: [logEmbed] });
            }
        } catch (error) {
            console.error('[Tickets] Erreur log suppression:', error);
        }
    }

    // Supprimer le canal après un court délai
    setTimeout(() => {
        interaction.channel.delete().catch(err => {
            console.error('[Tickets] Erreur suppression canal:', err);
        });
    }, 2000);
}

/**
 * Génère un transcript HTML complet du ticket (sans limite de messages)
 */
async function handleTranscript(interaction) {
    if (!ticketManager.isTicketChannel(interaction.channel)) {
        return interaction.reply({
            content: '❌ Cette commande ne peut être utilisée que dans un ticket.',
            ephemeral: true
        });
    }

    await interaction.deferReply();

    try {
        // Récupérer TOUS les messages (pagination sans limite)
        const allMessages = [];
        let lastId;
        while (true) {
            const options = { limit: 100 };
            if (lastId) options.before = lastId;
            const batch = await interaction.channel.messages.fetch(options);
            if (batch.size === 0) break;
            allMessages.push(...batch.values());
            lastId = batch.last().id;
            if (batch.size < 100) break;
        }
        const sortedMessages = allMessages.sort((a, b) => a.createdTimestamp - b.createdTimestamp);

        // Cache des utilisateurs pour les mentions
        const userCache = new Map();
        for (const msg of sortedMessages) {
            if (!userCache.has(msg.author.id)) {
                userCache.set(msg.author.id, {
                    tag: msg.author.tag,
                    displayName: msg.author.displayName || msg.author.username,
                    avatar: msg.author.displayAvatarURL({ extension: 'png', size: 64 }),
                    bot: msg.author.bot
                });
            }
        }

        // Générer le HTML
        const html = generateTicketHtml(interaction.channel, sortedMessages, interaction.guild, userCache);

        const buffer = Buffer.from(html, 'utf8');
        const attachment = new AttachmentBuilder(buffer, {
            name: `transcript-${interaction.channel.name}.html`
        });

        await interaction.editReply({
            content: `📜 Transcript HTML du ticket (**${sortedMessages.length}** messages) :`,
            files: [attachment]
        });

    } catch (error) {
        console.error('[Tickets] Erreur transcript:', error);
        await interaction.editReply({
            content: '❌ Une erreur est survenue lors de la génération du transcript.'
        });
    }
}

/**
 * Échappe les caractères HTML
 */
function escapeHtml(text) {
    if (!text) return '';
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

/**
 * Formate le contenu avec le markdown Discord, les mentions avec tooltip d'ID
 */
function formatTicketContent(text, guild, userCache) {
    if (!text) return '';

    let formatted = escapeHtml(text);

    // Blocs de code multilignes (avant le reste)
    formatted = formatted.replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, code) => {
        return `<pre class="codeblock"><code>${code}</code></pre>`;
    });

    // Code inline
    formatted = formatted.replace(/`([^`]+)`/g, '<code class="inline-code">$1</code>');

    // Liens markdown [texte](url)
    formatted = formatted.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" class="link">$1</a>');

    // URLs brutes
    formatted = formatted.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" class="link">$1</a>');

    // Gras + Italique
    formatted = formatted.replace(/\*\*\*([^*]+)\*\*\*/g, '<strong><em>$1</em></strong>');
    // Gras
    formatted = formatted.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    // Italique
    formatted = formatted.replace(/\*([^*]+)\*/g, '<em>$1</em>');
    // Souligné
    formatted = formatted.replace(/__([^_]+)__/g, '<u>$1</u>');
    // Barré
    formatted = formatted.replace(/~~([^~]+)~~/g, '<del>$1</del>');

    // Mentions utilisateur <@ID> ou <@!ID> → tooltip avec l'ID
    formatted = formatted.replace(/&lt;@!?(\d+)&gt;/g, (_, id) => {
        const user = userCache?.get(id);
        const display = user ? `@${user.displayName}` : `@Utilisateur`;
        return `<span class="mention user-mention" title="ID: ${id}">${display}</span>`;
    });

    // Mentions rôle <@&ID>
    formatted = formatted.replace(/&lt;@&amp;(\d+)&gt;/g, (_, id) => {
        const role = guild?.roles?.cache?.get(id);
        const display = role ? `@${role.name}` : `@Rôle`;
        const color = role?.hexColor && role.hexColor !== '#000000' ? role.hexColor : '#99aab5';
        return `<span class="mention role-mention" style="color: ${color}; background: ${color}20;" title="ID: ${id}">@${escapeHtml(role?.name || 'Rôle')}</span>`;
    });

    // Mentions salon <#ID>
    formatted = formatted.replace(/&lt;#(\d+)&gt;/g, (_, id) => {
        const channel = guild?.channels?.cache?.get(id);
        const display = channel ? `#${channel.name}` : `#salon`;
        return `<span class="mention channel-mention" title="ID: ${id}">${display}</span>`;
    });

    // Emoji custom <:name:id> ou <a:name:id>
    formatted = formatted.replace(/&lt;(a?):(\w+):(\d+)&gt;/g, (_, animated, name, id) => {
        const ext = animated ? 'gif' : 'png';
        return `<img class="emoji" src="https://cdn.discordapp.com/emojis/${id}.${ext}?size=48" alt=":${name}:" title=":${name}:">`;
    });

    // Sauts de ligne
    formatted = formatted.replace(/\n/g, '<br>');

    return formatted;
}

/**
 * Génère le HTML complet du transcript ticket
 */
function generateTicketHtml(channel, messages, guild, userCache) {
    const css = `
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: 'Inter', 'Segoe UI', sans-serif;
            background-color: #313338;
            color: #dbdee1;
            line-height: 1.5;
        }
        .header {
            background: linear-gradient(135deg, #5865f2 0%, #7289da 100%);
            padding: 24px 32px;
            color: white;
            position: sticky;
            top: 0;
            z-index: 100;
            box-shadow: 0 4px 12px rgba(0,0,0,0.3);
        }
        .header h1 { font-size: 22px; font-weight: 700; margin-bottom: 6px; }
        .header .meta { font-size: 13px; opacity: 0.85; display: flex; gap: 16px; flex-wrap: wrap; }
        .messages-container { padding: 16px 0; }
        .message-group {
            padding: 4px 48px 4px 72px;
            position: relative;
            margin-top: 16px;
        }
        .message-group:hover { background: #2e3035; }
        .message-group .avatar {
            position: absolute;
            left: 16px;
            top: 4px;
            width: 40px;
            height: 40px;
            border-radius: 50%;
            cursor: pointer;
        }
        .message-single {
            padding: 2px 48px 2px 72px;
        }
        .message-single:hover { background: #2e3035; }
        .author-info {
            display: flex;
            align-items: baseline;
            gap: 8px;
        }
        .author-name {
            font-weight: 600;
            font-size: 15px;
            color: #f2f3f5;
            cursor: pointer;
        }
        .author-name:hover { text-decoration: underline; }
        .bot-badge {
            background: #5865f2;
            color: white;
            font-size: 10px;
            font-weight: 600;
            padding: 1px 5px;
            border-radius: 3px;
            text-transform: uppercase;
            vertical-align: middle;
        }
        .timestamp {
            font-size: 12px;
            color: #949ba4;
            font-weight: 400;
        }
        .msg-content {
            font-size: 15px;
            color: #dbdee1;
            word-wrap: break-word;
            margin-top: 2px;
        }
        .mention {
            padding: 0 3px;
            border-radius: 3px;
            cursor: pointer;
            font-weight: 500;
        }
        .user-mention {
            color: #c9cdfb;
            background: rgba(88, 101, 242, 0.3);
        }
        .user-mention:hover { background: rgba(88, 101, 242, 0.5); color: #fff; }
        .channel-mention {
            color: #c9cdfb;
            background: rgba(88, 101, 242, 0.15);
        }
        .channel-mention:hover { background: rgba(88, 101, 242, 0.3); }
        .role-mention { padding: 0 3px; border-radius: 3px; font-weight: 500; }
        .link { color: #00a8fc; text-decoration: none; }
        .link:hover { text-decoration: underline; }
        .inline-code {
            background: #2b2d31;
            padding: 2px 6px;
            border-radius: 4px;
            font-family: 'Consolas', 'Courier New', monospace;
            font-size: 13.5px;
            color: #e8e8e8;
        }
        .codeblock {
            background: #2b2d31;
            border: 1px solid #1e1f22;
            border-radius: 8px;
            padding: 12px;
            margin: 6px 0;
            overflow-x: auto;
        }
        .codeblock code {
            font-family: 'Consolas', 'Courier New', monospace;
            font-size: 13px;
            color: #e8e8e8;
            white-space: pre;
        }
        .emoji {
            width: 22px;
            height: 22px;
            vertical-align: middle;
            object-fit: contain;
        }
        .attachment {
            margin-top: 6px;
        }
        .attachment img, .attachment video {
            max-width: 400px;
            max-height: 350px;
            border-radius: 8px;
            cursor: pointer;
            display: block;
        }
        .attachment-file {
            display: inline-flex;
            align-items: center;
            gap: 8px;
            background: #2b2d31;
            border: 1px solid #1e1f22;
            border-radius: 8px;
            padding: 10px 14px;
            margin-top: 4px;
            max-width: 400px;
        }
        .attachment-file a { color: #00a8fc; text-decoration: none; font-weight: 500; }
        .attachment-file a:hover { text-decoration: underline; }
        .attachment-file .file-size { color: #949ba4; font-size: 12px; }
        .embed {
            margin-top: 6px;
            padding: 12px 16px;
            background: #2b2d31;
            border-radius: 4px;
            border-left: 4px solid #5865f2;
            max-width: 520px;
            display: inline-block;
        }
        .embed-author {
            display: flex;
            align-items: center;
            gap: 8px;
            margin-bottom: 6px;
            font-size: 13px;
            font-weight: 600;
            color: #f2f3f5;
        }
        .embed-author img { width: 24px; height: 24px; border-radius: 50%; }
        .embed-title {
            font-weight: 700;
            font-size: 15px;
            color: #00a8fc;
            margin-bottom: 6px;
        }
        .embed-title a { color: #00a8fc; text-decoration: none; }
        .embed-title a:hover { text-decoration: underline; }
        .embed-description {
            font-size: 14px;
            color: #dbdee1;
            margin-bottom: 8px;
        }
        .embed-fields {
            display: flex;
            flex-wrap: wrap;
            gap: 8px;
        }
        .embed-field {
            min-width: 0;
        }
        .embed-field.inline { flex: 1; min-width: 120px; }
        .embed-field.full { width: 100%; }
        .embed-field-name {
            font-weight: 700;
            font-size: 13px;
            color: #f2f3f5;
            margin-bottom: 2px;
        }
        .embed-field-value {
            font-size: 14px;
            color: #b5bac1;
        }
        .embed-thumbnail {
            float: right;
            margin-left: 16px;
            max-width: 80px;
            max-height: 80px;
            border-radius: 4px;
        }
        .embed-image {
            max-width: 100%;
            max-height: 300px;
            border-radius: 4px;
            margin-top: 8px;
            display: block;
        }
        .embed-footer {
            display: flex;
            align-items: center;
            gap: 8px;
            margin-top: 8px;
            font-size: 12px;
            color: #949ba4;
        }
        .embed-footer img { width: 20px; height: 20px; border-radius: 50%; }
        .divider {
            height: 1px;
            background: #3f4147;
            margin: 0 16px;
        }
        .reactions {
            display: flex;
            gap: 4px;
            flex-wrap: wrap;
            margin-top: 4px;
        }
        .reaction {
            display: inline-flex;
            align-items: center;
            gap: 4px;
            background: #2b2d31;
            border: 1px solid #3f4147;
            border-radius: 8px;
            padding: 2px 8px;
            font-size: 13px;
        }
        .reaction .emoji { width: 18px; height: 18px; }
        .footer-bar {
            padding: 20px 32px;
            background: #2b2d31;
            text-align: center;
            color: #949ba4;
            font-size: 12px;
            margin-top: 20px;
            border-top: 1px solid #3f4147;
        }
        /* Tooltip natif via title + un style custom optional */
        [title] { cursor: help; }
        .sticker {
            margin-top: 6px;
        }
        .sticker img {
            width: 160px;
            height: 160px;
            object-fit: contain;
        }
    `;

    const ticketId = ticketManager.getTicketIdFromChannel(channel);
    const ticket = ticketManager.getTicket(ticketId);
    const ownerName = ticket?.owner ? (userCache.get(ticket.owner)?.tag || ticket.owner) : 'Inconnu';

    let html = `<!DOCTYPE html>
<html lang="fr">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Transcript - #${escapeHtml(channel.name)}</title>
    <style>${css}</style>
</head>
<body>
    <div class="header">
        <h1>🎫 #${escapeHtml(channel.name)}</h1>
        <div class="meta">
            <span>📋 Serveur: ${escapeHtml(guild.name)}</span>
            <span>👤 Créé par: ${escapeHtml(ownerName)}</span>
            <span>💬 ${messages.length} messages</span>
            <span>📅 Généré le: ${new Date().toLocaleString('fr-FR')}</span>
        </div>
    </div>
    <div class="messages-container">`;

    let lastAuthorId = null;
    let lastTimestamp = 0;

    for (const msg of messages) {
        const timeDiff = msg.createdTimestamp - lastTimestamp;
        const newGroup = msg.author.id !== lastAuthorId || timeDiff > 7 * 60 * 1000; // 7 min = nouveau groupe
        const timestamp = new Date(msg.createdTimestamp).toLocaleString('fr-FR');
        const userData = userCache.get(msg.author.id);

        if (newGroup) {
            const avatar = userData?.avatar || msg.author.displayAvatarURL({ extension: 'png', size: 64 });
            html += `
        <div class="message-group">
            <img class="avatar" src="${avatar}" alt="Avatar" title="ID: ${msg.author.id}">
            <div class="author-info">
                <span class="author-name" title="ID: ${msg.author.id}">${escapeHtml(msg.author.displayName || msg.author.username)}</span>`;

            if (msg.author.bot) {
                html += ` <span class="bot-badge">BOT</span>`;
            }

            html += `
                <span class="timestamp">${timestamp}</span>
            </div>`;
        } else {
            html += `
        <div class="message-single">`;
        }

        // Contenu du message
        if (msg.content) {
            html += `<div class="msg-content">${formatTicketContent(msg.content, guild, userCache)}</div>`;
        }

        // Pièces jointes (images, vidéos, fichiers)
        if (msg.attachments.size > 0) {
            for (const att of msg.attachments.values()) {
                html += `<div class="attachment">`;
                if (att.contentType?.startsWith('image/')) {
                    html += `<a href="${att.url}" target="_blank"><img src="${att.url}" alt="${escapeHtml(att.name)}" title="${escapeHtml(att.name)}"></a>`;
                } else if (att.contentType?.startsWith('video/')) {
                    html += `<video controls src="${att.url}" title="${escapeHtml(att.name)}"></video>`;
                } else {
                    const sizeKb = att.size ? `${(att.size / 1024).toFixed(1)} KB` : '';
                    html += `<div class="attachment-file">📎 <a href="${att.url}" target="_blank">${escapeHtml(att.name)}</a> <span class="file-size">${sizeKb}</span></div>`;
                }
                html += `</div>`;
            }
        }

        // Stickers
        if (msg.stickers?.size > 0) {
            for (const sticker of msg.stickers.values()) {
                html += `<div class="sticker"><img src="https://media.discordapp.net/stickers/${sticker.id}.webp?size=160" alt="${escapeHtml(sticker.name)}" title="${escapeHtml(sticker.name)}"></div>`;
            }
        }

        // Embeds
        for (const embed of msg.embeds) {
            const borderColor = embed.color ? `#${embed.color.toString(16).padStart(6, '0')}` : '#5865f2';
            html += `<div class="embed" style="border-left-color: ${borderColor};">`;

            // Thumbnail (float right)
            if (embed.thumbnail?.url) {
                html += `<img class="embed-thumbnail" src="${embed.thumbnail.url}" alt="Thumbnail">`;
            }

            // Author
            if (embed.author) {
                html += `<div class="embed-author">`;
                if (embed.author.iconURL) html += `<img src="${embed.author.iconURL}" alt="">`;
                if (embed.author.url) {
                    html += `<a href="${embed.author.url}" target="_blank" class="link">${escapeHtml(embed.author.name)}</a>`;
                } else {
                    html += escapeHtml(embed.author.name);
                }
                html += `</div>`;
            }

            // Title
            if (embed.title) {
                html += `<div class="embed-title">`;
                if (embed.url) {
                    html += `<a href="${embed.url}" target="_blank">${escapeHtml(embed.title)}</a>`;
                } else {
                    html += escapeHtml(embed.title);
                }
                html += `</div>`;
            }

            // Description
            if (embed.description) {
                html += `<div class="embed-description">${formatTicketContent(embed.description, guild, userCache)}</div>`;
            }

            // Fields
            if (embed.fields?.length > 0) {
                html += `<div class="embed-fields">`;
                for (const field of embed.fields) {
                    const fieldClass = field.inline ? 'embed-field inline' : 'embed-field full';
                    html += `<div class="${fieldClass}">
                        <div class="embed-field-name">${escapeHtml(field.name)}</div>
                        <div class="embed-field-value">${formatTicketContent(field.value, guild, userCache)}</div>
                    </div>`;
                }
                html += `</div>`;
            }

            // Image
            if (embed.image?.url) {
                html += `<img class="embed-image" src="${embed.image.url}" alt="Embed image">`;
            }

            // Footer
            if (embed.footer || embed.timestamp) {
                html += `<div class="embed-footer">`;
                if (embed.footer?.iconURL) html += `<img src="${embed.footer.iconURL}" alt="">`;
                if (embed.footer?.text) html += `<span>${escapeHtml(embed.footer.text)}</span>`;
                if (embed.footer?.text && embed.timestamp) html += `<span>•</span>`;
                if (embed.timestamp) html += `<span>${new Date(embed.timestamp).toLocaleString('fr-FR')}</span>`;
                html += `</div>`;
            }

            html += `</div>`;
        }

        // Réactions
        if (msg.reactions?.cache?.size > 0) {
            html += `<div class="reactions">`;
            for (const reaction of msg.reactions.cache.values()) {
                const emoji = reaction.emoji;
                const emojiStr = emoji.id
                    ? `<img class="emoji" src="https://cdn.discordapp.com/emojis/${emoji.id}.${emoji.animated ? 'gif' : 'png'}?size=48" alt=":${emoji.name}:">`
                    : emoji.name;
                html += `<div class="reaction">${emojiStr} <span>${reaction.count}</span></div>`;
            }
            html += `</div>`;
        }

        html += `
        </div>`;

        lastAuthorId = msg.author.id;
        lastTimestamp = msg.createdTimestamp;
    }

    html += `
    </div>
    <div class="footer-bar">
        Transcript généré par BLZstarss Bot • ${messages.length} messages • ${new Date().toLocaleString('fr-FR')}
    </div>
</body>
</html>`;

    return html;
}

/**
 * Affiche le sélecteur pour ajouter un utilisateur
 */
async function handleAddUser(interaction) {
    if (!ticketManager.isTicketChannel(interaction.channel)) {
        return interaction.reply({
            content: '❌ Cette commande ne peut être utilisée que dans un ticket.',
            ephemeral: true
        });
    }

    // Vérifier les permissions staff
    if (!interaction.member.permissions.has(PermissionsBitField.Flags.ModerateMembers)) {
        return interaction.reply({
            content: '❌ Tu n\'as pas la permission d\'ajouter des utilisateurs.',
            ephemeral: true
        });
    }

    const selectMenu = new UserSelectMenuBuilder()
        .setCustomId('ticket_add_select')
        .setPlaceholder('Sélectionne un utilisateur à ajouter')
        .setMinValues(1)
        .setMaxValues(1);

    const row = new ActionRowBuilder().addComponents(selectMenu);

    await interaction.reply({
        content: '👤 **Sélectionne l\'utilisateur à ajouter au ticket :**',
        components: [row],
        ephemeral: true
    });
}

/**
 * Affiche le sélecteur pour retirer un utilisateur
 */
async function handleRemoveUser(interaction) {
    if (!ticketManager.isTicketChannel(interaction.channel)) {
        return interaction.reply({
            content: '❌ Cette commande ne peut être utilisée que dans un ticket.',
            ephemeral: true
        });
    }

    // Vérifier les permissions staff
    if (!interaction.member.permissions.has(PermissionsBitField.Flags.ModerateMembers)) {
        return interaction.reply({
            content: '❌ Tu n\'as pas la permission de retirer des utilisateurs.',
            ephemeral: true
        });
    }

    const selectMenu = new UserSelectMenuBuilder()
        .setCustomId('ticket_remove_select')
        .setPlaceholder('Sélectionne un utilisateur à retirer')
        .setMinValues(1)
        .setMaxValues(1);

    const row = new ActionRowBuilder().addComponents(selectMenu);

    await interaction.reply({
        content: '👤 **Sélectionne l\'utilisateur à retirer du ticket :**',
        components: [row],
        ephemeral: true
    });
}

module.exports = {
    handleTicketButton,
    handleTicketSelectMenu
};
