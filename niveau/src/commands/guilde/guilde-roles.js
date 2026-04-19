const path = require('path');
const { SlashCommandBuilder, EmbedBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const { BLZ_EMBED_STRIP_INT } = require(path.join(__dirname, '..', '..', '..', '..', 'blz-embed-theme'));
const { getGuildOfUser, getGuildMembers, getGuildById } = require('../../utils/db-guilds');
const { areGuildFeaturesDisabled } = require('../../utils/guild/guild-overstaffing');
const { getCustomRoles, addOrUpdateCustomRole, deleteCustomRole, assignCustomRoleToUser, getUserCustomRole, revokeCustomRoleFromUser, countMembersWithRole } = require('../../utils/guild/guild-custom-roles');
const db = require('../../database/database');
const logger = require('../../utils/logger');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('guilde-roles')
        .setDescription('Gérer les rôles personnalisés de votre guilde (Upgrade 7+)')
        .addSubcommand(subcommand =>
            subcommand
                .setName('liste')
                .setDescription('Afficher la liste des rôles personnalisés de votre guilde'))
        .addSubcommand(subcommand =>
            subcommand
                .setName('creer')
                .setDescription('Créer un nouveau rôle personnalisé (max 3)'))
        .addSubcommand(subcommand =>
            subcommand
                .setName('modifier')
                .setDescription('Modifier un rôle personnalisé existant')
                .addStringOption(option =>
                    option.setName('role')
                        .setDescription('Le rôle à modifier')
                        .setRequired(true)
                        .setAutocomplete(true)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('supprimer')
                .setDescription('Supprimer un rôle personnalisé')
                .addStringOption(option =>
                    option.setName('role')
                        .setDescription('Le rôle à supprimer')
                        .setRequired(true)
                        .setAutocomplete(true)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('attribuer')
                .setDescription('Attribuer un rôle personnalisé à un membre')
                .addStringOption(option =>
                    option.setName('role')
                        .setDescription('Le rôle à attribuer')
                        .setRequired(true)
                        .setAutocomplete(true))
                .addUserOption(option =>
                    option.setName('membre')
                        .setDescription('Le membre qui recevra le rôle')
                        .setRequired(true)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('retirer')
                .setDescription('Retirer le rôle personnalisé d\'un membre')
                .addUserOption(option =>
                    option.setName('membre')
                        .setDescription('Le membre dont on retire le rôle')
                        .setRequired(true))),

    async autocomplete(interaction) {
        const focusedValue = interaction.options.getFocused();
        const guild = getGuildOfUser(interaction.user.id);
        
        if (!guild) {
            return interaction.respond([]);
        }

        const customRoles = getCustomRoles(guild.id);
        const filtered = customRoles
            .filter(role => role.name.toLowerCase().includes(focusedValue.toLowerCase()))
            .map(role => ({
                name: `${role.icon || '📋'} ${role.name}`,
                value: role.id
            }))
            .slice(0, 25);

        await interaction.respond(filtered);
    },

    async execute(interaction) {
        const subcommand = interaction.options.getSubcommand();
        const userId = interaction.user.id;

        // Vérification de la guilde
        const guild = getGuildOfUser(userId);
        if (!guild) {
            return interaction.reply({ 
                content: '❌ Vous devez être dans une guilde pour utiliser cette commande.', 
                flags: 64 
            });
        }

        // Vérification de l'upgrade minimum (Upgrade 7)
        if (guild.upgrade_level < 7) {
            return interaction.reply({ 
                content: `❌ Votre guilde doit être niveau **7** ou supérieur pour utiliser les rôles personnalisés.\n💎 Niveau actuel : **${guild.upgrade_level}**`, 
                flags: 64 
            });
        }

        // Vérification du sureffectif (sauf pour la commande liste)
        if (subcommand !== 'liste' && areGuildFeaturesDisabled(guild.id)) {
            const memberCount = db.prepare('SELECT COUNT(*) as count FROM guild_members WHERE guild_id = ?')
                .get(guild.id).count;
            return interaction.reply({
                content: `❌ **Guilde en sureffectif !**\n\n` +
                    `Votre guilde a **${memberCount} membres** mais ne peut en avoir que **12 maximum** (9 de base + 3 jokers).\n\n` +
                    `🚫 Toutes les fonctionnalités sont désactivées jusqu'à ce que vous excluiez des membres.\n` +
                    `💸 Des pénalités de **${(memberCount - 12) * 1000} starss par membre par jour** sont appliquées.`,
                flags: 64
            });
        }

        // Vérification des permissions (seuls chef et sous-chefs)
        const isOwner = guild.owner_id === userId;
        const isSubChief = guild.sub_chiefs && guild.sub_chiefs.includes(userId);

        if (!isOwner && !isSubChief) {
            return interaction.reply({ 
                content: '❌ Seuls le chef et les sous-chefs de guilde peuvent gérer les rôles personnalisés.', 
                flags: 64 
            });
        }

        switch (subcommand) {
            case 'liste':
                await handleListRoles(interaction, guild);
                break;
            case 'creer':
                await handleCreateRole(interaction, guild);
                break;
            case 'modifier':
                await handleEditRole(interaction, guild);
                break;
            case 'supprimer':
                await handleDeleteRole(interaction, guild);
                break;
            case 'attribuer':
                await handleAssignRole(interaction, guild);
                break;
            case 'retirer':
                await handleRevokeRole(interaction, guild);
                break;
        }
    }
};

/**
 * Affiche la liste des rôles personnalisés
 */
async function handleListRoles(interaction, guild) {
    const customRoles = getCustomRoles(guild.id);

    if (customRoles.length === 0) {
        return interaction.reply({
            content: `📋 **Rôles personnalisés de ${guild.name}**\n\nAucun rôle personnalisé n'a été créé.\nUtilisez \`/guilde-roles creer\` pour en créer un (max 3).`,
            flags: 64
        });
    }

    const embed = new EmbedBuilder()
        .setColor(BLZ_EMBED_STRIP_INT)
        .setTitle(`📋 Rôles personnalisés de ${guild.name}`)
        .setDescription(`Votre guilde possède **${customRoles.length}/3** rôles personnalisés.`)
        .setTimestamp();

    for (const role of customRoles) {
        const permissions = [];
        if (role.permissions.can_kick) permissions.push('👢 Expulser membres');
        if (role.permissions.can_manage_blacklist) permissions.push('🚫 Gérer liste noire/blanche');
        if (role.permissions.can_start_war) permissions.push('⚔️ Démarrer guerres');
        if (role.permissions.can_empty_treasury) permissions.push('💰 Vider trésorerie');

        // Compter les membres ayant ce rôle
        const memberCount = countMembersWithRole(guild.id, role.id);

        embed.addFields({
            name: `${role.icon || '📋'} ${role.name}`,
            value: `👥 **${memberCount}** membre(s)\n` +
                   `🔑 **Permissions :** ${permissions.length > 0 ? permissions.join(', ') : 'Aucune'}`,
            inline: false
        });
    }

    await interaction.reply({ embeds: [embed], flags: 64 });
}

/**
 * Crée un nouveau rôle personnalisé
 */
async function handleCreateRole(interaction, guild) {
    const customRoles = getCustomRoles(guild.id);

    if (customRoles.length >= 3) {
        return interaction.reply({
            content: '❌ Votre guilde a déjà atteint la limite de **3 rôles personnalisés**.\nSupprimez-en un avec `/guilde-roles supprimer` pour en créer un nouveau.',
            flags: 64
        });
    }

    // Créer le modal
    const modal = new ModalBuilder()
        .setCustomId('create_custom_role')
        .setTitle('Créer un rôle personnalisé');

    const nameInput = new TextInputBuilder()
        .setCustomId('role_name')
        .setLabel('Nom du rôle')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('Ex: Officier, Recruteur, Trésorier...')
        .setRequired(true)
        .setMaxLength(32);

    const iconInput = new TextInputBuilder()
        .setCustomId('role_icon')
        .setLabel('Icône (emoji)')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('🛡️')
        .setRequired(false)
        .setMaxLength(5);

    const permissionsInput = new TextInputBuilder()
        .setCustomId('role_permissions')
        .setLabel('Permissions (séparer par des virgules)')
        .setStyle(TextInputStyle.Paragraph)
        .setPlaceholder('kick, blacklist, war, treasury\n(laisser vide pour aucune permission)')
        .setRequired(false)
        .setMaxLength(100);

    modal.addComponents(
        new ActionRowBuilder().addComponents(nameInput),
        new ActionRowBuilder().addComponents(iconInput),
        new ActionRowBuilder().addComponents(permissionsInput)
    );

    await interaction.showModal(modal);

    // Attendre la soumission du modal
    try {
        const submitted = await interaction.awaitModalSubmit({
            filter: i => i.customId === 'create_custom_role' && i.user.id === interaction.user.id,
            time: 300_000 // 5 minutes
        });

        const roleName = submitted.fields.getTextInputValue('role_name').trim();
        const roleIcon = submitted.fields.getTextInputValue('role_icon').trim() || '📋';
        const permissionsRaw = submitted.fields.getTextInputValue('role_permissions').toLowerCase().trim();

        // Parser les permissions
        const permissions = parsePermissions(permissionsRaw);

        // Créer le rôle
        addOrUpdateCustomRole(
            guild.id,
            null, // nouveau rôle
            roleName,
            {
                can_kick: permissions.kick,
                can_manage_blacklist: permissions.blacklist,
                can_start_war: permissions.war,
                can_empty_treasury: permissions.treasury
            },
            roleIcon
        );

        const permList = [];
        if (permissions.kick) permList.push('👢 Expulser membres');
        if (permissions.blacklist) permList.push('🚫 Gérer liste noire/blanche');
        if (permissions.war) permList.push('⚔️ Démarrer guerres');
        if (permissions.treasury) permList.push('💰 Vider trésorerie');

        await submitted.reply({
            content: `✅ **Rôle créé avec succès !**\n\n` +
                     `📌 **${roleIcon} ${roleName}**\n` +
                     `🔑 **Permissions :** ${permList.length > 0 ? permList.join(', ') : 'Aucune'}\n\n` +
                     `Utilisez \`/guilde-roles attribuer\` pour assigner ce rôle à des membres.`,
            flags: 64
        });

        logger.info(`[CUSTOM_ROLES] ${interaction.user.tag} a créé le rôle "${roleName}" pour la guilde ${guild.name}`);
    } catch (error) {
        if (error.code !== 'InteractionCollectorError') {
            logger.error('[CUSTOM_ROLES] Erreur lors de la création du rôle :', error);
        }
    }
}

/**
 * Modifie un rôle personnalisé existant
 */
async function handleEditRole(interaction, guild) {
    const roleId = interaction.options.getString('role');
    const customRoles = getCustomRoles(guild.id);
    const role = customRoles.find(r => r.id === roleId);

    if (!role) {
        return interaction.reply({
            content: '❌ Ce rôle n\'existe pas ou n\'appartient pas à votre guilde.',
            flags: 64
        });
    }

    // Créer le modal avec les valeurs actuelles
    const modal = new ModalBuilder()
        .setCustomId('edit_custom_role')
        .setTitle(`Modifier : ${role.name}`);

    const nameInput = new TextInputBuilder()
        .setCustomId('role_name')
        .setLabel('Nom du rôle')
        .setStyle(TextInputStyle.Short)
        .setValue(role.name)
        .setRequired(true)
        .setMaxLength(32);

    const iconInput = new TextInputBuilder()
        .setCustomId('role_icon')
        .setLabel('Icône (emoji)')
        .setStyle(TextInputStyle.Short)
        .setValue(role.icon || '📋')
        .setRequired(false)
        .setMaxLength(5);

    const currentPerms = [];
    if (role.permissions.can_kick) currentPerms.push('kick');
    if (role.permissions.can_manage_blacklist) currentPerms.push('blacklist');
    if (role.permissions.can_start_war) currentPerms.push('war');
    if (role.permissions.can_empty_treasury) currentPerms.push('treasury');

    const permissionsInput = new TextInputBuilder()
        .setCustomId('role_permissions')
        .setLabel('Permissions (séparer par des virgules)')
        .setStyle(TextInputStyle.Paragraph)
        .setPlaceholder('kick, blacklist, war, treasury')
        .setValue(currentPerms.join(', '))
        .setRequired(false)
        .setMaxLength(100);

    modal.addComponents(
        new ActionRowBuilder().addComponents(nameInput),
        new ActionRowBuilder().addComponents(iconInput),
        new ActionRowBuilder().addComponents(permissionsInput)
    );

    await interaction.showModal(modal);

    // Attendre la soumission du modal
    try {
        const submitted = await interaction.awaitModalSubmit({
            filter: i => i.customId === 'edit_custom_role' && i.user.id === interaction.user.id,
            time: 300_000
        });

        const roleName = submitted.fields.getTextInputValue('role_name').trim();
        const roleIcon = submitted.fields.getTextInputValue('role_icon').trim() || role.icon || '📋';
        const permissionsRaw = submitted.fields.getTextInputValue('role_permissions').toLowerCase().trim();

        const permissions = parsePermissions(permissionsRaw);

        addOrUpdateCustomRole(
            guild.id,
            roleId,
            roleName,
            {
                can_kick: permissions.kick,
                can_manage_blacklist: permissions.blacklist,
                can_start_war: permissions.war,
                can_empty_treasury: permissions.treasury
            },
            roleIcon
        );

        const permList = [];
        if (permissions.kick) permList.push('👢 Expulser membres');
        if (permissions.blacklist) permList.push('🚫 Gérer liste noire/blanche');
        if (permissions.war) permList.push('⚔️ Démarrer guerres');
        if (permissions.treasury) permList.push('💰 Vider trésorerie');

        await submitted.reply({
            content: `✅ **Rôle modifié avec succès !**\n\n` +
                     `📌 **${roleIcon} ${roleName}**\n` +
                     `🔑 **Permissions :** ${permList.length > 0 ? permList.join(', ') : 'Aucune'}`,
            flags: 64
        });

        logger.info(`[CUSTOM_ROLES] ${interaction.user.tag} a modifié le rôle "${roleName}" (ID: ${roleId})`);
    } catch (error) {
        if (error.code !== 'InteractionCollectorError') {
            logger.error('[CUSTOM_ROLES] Erreur lors de la modification du rôle :', error);
        }
    }
}

/**
 * Supprime un rôle personnalisé
 */
async function handleDeleteRole(interaction, guild) {
    const roleId = interaction.options.getString('role');
    const customRoles = getCustomRoles(guild.id);
    const role = customRoles.find(r => r.id === roleId);

    if (!role) {
        return interaction.reply({
            content: '❌ Ce rôle n\'existe pas ou n\'appartient pas à votre guilde.',
            flags: 64
        });
    }

    // Compter les membres ayant ce rôle
    const memberCount = countMembersWithRole(guild.id, roleId);

    // Créer un bouton de confirmation
    const confirmButton = new ButtonBuilder()
        .setCustomId('confirm_delete_role')
        .setLabel('Confirmer la suppression')
        .setStyle(ButtonStyle.Danger);

    const cancelButton = new ButtonBuilder()
        .setCustomId('cancel_delete_role')
        .setLabel('Annuler')
        .setStyle(ButtonStyle.Secondary);

    const row = new ActionRowBuilder().addComponents(confirmButton, cancelButton);

    const response = await interaction.reply({
        content: `⚠️ **Confirmer la suppression du rôle "${role.icon || '📋'} ${role.name}"**\n\n` +
                 `👥 **${memberCount}** membre(s) possède(nt) ce rôle.\n` +
                 `Ces membres perdront leur rôle personnalisé.`,
        components: [row],
        flags: 64
    });

    try {
        const confirmation = await response.awaitMessageComponent({
            filter: i => i.user.id === interaction.user.id,
            time: 60_000
        });

        if (confirmation.customId === 'confirm_delete_role') {
            deleteCustomRole(guild.id, roleId);

            await confirmation.update({
                content: `✅ Le rôle **"${role.name}"** a été supprimé avec succès.\n${memberCount > 0 ? `Les ${memberCount} membre(s) ont perdu leur rôle.` : ''}`,
                components: []
            });

            logger.info(`[CUSTOM_ROLES] ${interaction.user.tag} a supprimé le rôle "${role.name}" (ID: ${roleId})`);
        } else {
            await confirmation.update({
                content: '❌ Suppression annulée.',
                components: []
            });
        }
    } catch (error) {
        await interaction.editReply({
            content: '⏱️ Temps écoulé. Suppression annulée.',
            components: []
        });
    }
}

/**
 * Attribue un rôle personnalisé à un membre
 */
async function handleAssignRole(interaction, guild) {
    const roleId = interaction.options.getString('role');
    const targetUser = interaction.options.getUser('membre');

    const customRoles = getCustomRoles(guild.id);
    const role = customRoles.find(r => r.id === roleId);

    if (!role) {
        return interaction.reply({
            content: '❌ Ce rôle n\'existe pas ou n\'appartient pas à votre guilde.',
            flags: 64
        });
    }

    // Vérifier que le membre est dans la guilde
    const members = getGuildMembers(guild.id);
    const targetMember = members.find(m => m.user_id === targetUser.id);

    if (!targetMember) {
        return interaction.reply({
            content: `❌ **${targetUser.username}** n'est pas membre de votre guilde.`,
            flags: 64
        });
    }

    // Vérifier si le membre a déjà un rôle personnalisé
    const currentRole = getUserCustomRole(guild.id, targetUser.id);
    if (currentRole) {
        return interaction.reply({
            content: `❌ **${targetUser.username}** possède déjà le rôle personnalisé **"${currentRole.icon || '📋'} ${currentRole.name}"**.\nRetirez d'abord son rôle actuel avec \`/guilde-roles retirer\`.`,
            flags: 64
        });
    }

    assignCustomRoleToUser(guild.id, targetUser.id, roleId);

    await interaction.reply({
        content: `✅ Le rôle **"${role.icon || '📋'} ${role.name}"** a été attribué à **${targetUser.username}** !`,
        flags: 64
    });

    logger.info(`[CUSTOM_ROLES] ${interaction.user.tag} a attribué le rôle "${role.name}" à ${targetUser.tag}`);
}

/**
 * Retire le rôle personnalisé d'un membre
 */
async function handleRevokeRole(interaction, guild) {
    const targetUser = interaction.options.getUser('membre');

    // Vérifier que le membre est dans la guilde
    const members = getGuildMembers(guild.id);
    const targetMember = members.find(m => m.user_id === targetUser.id);

    if (!targetMember) {
        return interaction.reply({
            content: `❌ **${targetUser.username}** n'est pas membre de votre guilde.`,
            flags: 64
        });
    }

    const currentRole = getUserCustomRole(guild.id, targetUser.id);
    if (!currentRole) {
        return interaction.reply({
            content: `❌ **${targetUser.username}** ne possède aucun rôle personnalisé.`,
            flags: 64
        });
    }

    revokeCustomRoleFromUser(guild.id, targetUser.id);

    await interaction.reply({
        content: `✅ Le rôle **"${currentRole.icon || '📋'} ${currentRole.name}"** a été retiré à **${targetUser.username}**.`,
        flags: 64
    });

    logger.info(`[CUSTOM_ROLES] ${interaction.user.tag} a retiré le rôle "${currentRole.name}" de ${targetUser.tag}`);
}

/**
 * Parse les permissions depuis une chaîne de caractères
 */
function parsePermissions(permissionsStr) {
    const perms = {
        kick: false,
        blacklist: false,
        war: false,
        treasury: false
    };

    if (!permissionsStr) return perms;

    const tokens = permissionsStr.split(',').map(s => s.trim().toLowerCase());

    for (const token of tokens) {
        if (token === 'kick' || token === 'expulser' || token === 'kick_member') {
            perms.kick = true;
        } else if (token === 'blacklist' || token === 'liste' || token === 'manage_blacklist') {
            perms.blacklist = true;
        } else if (token === 'war' || token === 'guerre' || token === 'start_war') {
            perms.war = true;
        } else if (token === 'treasury' || token === 'tresorerie' || token === 'trésorerie' || token === 'empty_treasury') {
            perms.treasury = true;
        }
    }

    return perms;
}
