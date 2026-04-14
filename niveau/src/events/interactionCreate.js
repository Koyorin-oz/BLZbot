const { Events, PermissionFlagsBits } = require('discord.js');
const logger = require('../utils/logger');
const { isMaintenanceMode } = require('../utils/maintenance');
const { handleCommandError } = require('../utils/error-handler');
module.exports = {
    name: Events.InteractionCreate,
    async execute(interaction) {
        const { runWithEconomyGuild } = require('../utils/economy-scope');
        const run = async () => {
        // Gérer l'autocomplete
        if (interaction.isAutocomplete()) {
            const command = interaction.client.commands.get(interaction.commandName);

            if (!command) {
                // Ignorer les autocompletes inconnus
                return;
            }

            try {
                await command.autocomplete(interaction);
            } catch (error) {
                logger.error('Error in autocomplete:', error);
            }
            return;
        }

        if (interaction.isChatInputCommand()) {
            // Vérification du mode maintenance
            if (isMaintenanceMode()) {
                if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
                    return interaction.reply({ content: 'Le bot est actuellement en maintenance. Veuillez réessayer plus tard.', flags: 64 });
                }
            }

            const command = interaction.client.commands.get(interaction.commandName);

            if (!command) {
                // Ignorer les commandes inconnues - peuvent être gérées par d'autres bots/scripts
                return;
            }

            try {
                await command.execute(interaction);
            } catch (error) {
                await handleCommandError(interaction, error);
            }
        } else if (interaction.isButton()) {
            // Gérer les interactions de boutons pour les giveaways
            if (interaction.customId.startsWith('giveaway_join_')) {
                // Gérer la participation aux giveaways
                await handleGiveawayParticipation(interaction);
            } else if (interaction.customId.startsWith('giveaway_')) {
                const { handleGiveawayInteraction } = require('../commands/giveaway/handlers');
                try {
                    await handleGiveawayInteraction(interaction);
                } catch (error) {
                    logger.error('Error handling giveaway button interaction:', error);
                    try {
                        if (!interaction.replied && !interaction.deferred) {
                            await interaction.reply({ content: 'Une erreur est survenue.', flags: 64 });
                        }
                    } catch (replyError) {
                        logger.error('Failed to reply to user after error:', replyError.code || replyError.message);
                        // swallow to prevent unhandled error event
                    }
                }
            } else if (interaction.customId.startsWith('accept-loan-') || interaction.customId.startsWith('decline-loan-')) {
                await handleLoanInteraction(interaction);
            } else if (interaction.customId.startsWith('accept_trade_') || interaction.customId.startsWith('decline_trade_') || interaction.customId.startsWith('trade_')) {
                const { handleTradeInteraction } = require('../utils/trade-handler');
                await handleTradeInteraction(interaction);
            } else if (interaction.customId.startsWith('accept_war_') || interaction.customId.startsWith('decline_war_')) {
                await handleWarInteraction(interaction);
            } else if (interaction.customId.startsWith('accept-') || interaction.customId.startsWith('decline-') || interaction.customId.startsWith('rps-') || interaction.customId.startsWith('morpion-') || interaction.customId.startsWith('puissance4-')) {
                const { handleGameInteraction } = require('../utils/minigame-handler');
                await handleGameInteraction(interaction);
            } else if (interaction.customId === 'hacker_daily_item') {
                await handleHackerItemClaim(interaction);
            } else if (interaction.customId === 'tutorial_check_rules') {
                // Gestion du bouton "Fait !" pour vérifier le rôle de règlement
                const { handleCheckRules } = require('../utils/tutorial-handler');
                await handleCheckRules(interaction);
            } else if (interaction.customId === 'tutorial_continue' || interaction.customId === 'tutorial_skip') {
                // Gestion des boutons du tutoriel (choix continuer/skip)
                const { handleTutorialChoice } = require('../utils/tutorial-handler');
                const choice = interaction.customId === 'tutorial_skip' ? 'skip' : 'continue';
                await handleTutorialChoice(interaction, choice);
            } else if (interaction.customId.startsWith('tutorial_next_')) {
                // Gestion du bouton "Continuer" dans le tutoriel
                const { handleTutorialNext } = require('../utils/tutorial-handler');
                await handleTutorialNext(interaction);
            } else if (interaction.customId === 'tutorial_finish') {
                // Gestion du bouton de fin de tutoriel
                const { handleFinalConfirmation } = require('../utils/tutorial-handler');
                await handleFinalConfirmation(interaction);
            } else if (interaction.customId.startsWith('valentin_claim_')) {
                await handleValentinClaim(interaction);
            } else if (interaction.customId.startsWith('valentin_loan_accept_')) {
                await handleValentinLoanAccept(interaction);
            } else if (interaction.customId.startsWith('valentin_loan_decline_')) {
                await handleValentinLoanDecline(interaction);
            } else if (interaction.customId.startsWith('perm_toggle_') || interaction.customId.startsWith('role_assign_start_')) {
                // Routing pour les boutons de permissions/assignation des rôles personnalisés
                const { handleCustomRoleInteraction } = require('../utils/guild/guild-custom-roles-handler');
                await handleCustomRoleInteraction(interaction);
            } else if (interaction.customId.startsWith('pvropen:')) {
                const { handleVocPanelOpenButton } = require('../utils/voice-room-panel-handler');
                try {
                    await handleVocPanelOpenButton(interaction);
                } catch (error) {
                    logger.error('Error handling voc-panel open button:', error);
                    try {
                        if (!interaction.replied && !interaction.deferred) {
                            await interaction.reply({ content: 'Une erreur est survenue.', flags: 64 });
                        }
                    } catch (replyError) {
                        logger.error('Failed to reply after pvropen error:', replyError.code || replyError.message);
                    }
                }
            } else if (interaction.customId.startsWith('pvr:')) {
                const { handleVoiceRoomPanelButton } = require('../utils/voice-room-panel-handler');
                try {
                    await handleVoiceRoomPanelButton(interaction);
                } catch (error) {
                    logger.error('Error handling private voice panel button:', error);
                    try {
                        if (!interaction.replied && !interaction.deferred) {
                            await interaction.reply({ content: 'Une erreur est survenue.', flags: 64 });
                        }
                    } catch (replyError) {
                        logger.error('Failed to reply after PVR panel error:', replyError.code || replyError.message);
                    }
                }
            } else if (interaction.customId.startsWith('blzmpl:')) {
                const { handlePlaylistButtonInteraction } = require('../utils/voice-music-playlist-ui');
                try {
                    await handlePlaylistButtonInteraction(interaction);
                } catch (error) {
                    logger.error('[MUSIC] playlist bouton:', error);
                    try {
                        if (!interaction.replied && !interaction.deferred) {
                            await interaction.reply({ content: 'Erreur playlist.', flags: 64 });
                        }
                    } catch (replyError) {
                        logger.error('[MUSIC] playlist reply:', replyError.code || replyError.message);
                    }
                }
            } else if (interaction.customId.startsWith('blzm:')) {
                const { handleMusicButton } = require('../utils/voice-music-handler');
                try {
                    await handleMusicButton(interaction);
                } catch (error) {
                    logger.error('[MUSIC] bouton:', error);
                    try {
                        if (!interaction.replied && !interaction.deferred) {
                            await interaction.reply({ content: 'Erreur lecteur musique.', flags: 64 });
                        }
                    } catch (replyError) {
                        logger.error('[MUSIC] reply:', replyError.code || replyError.message);
                    }
                }
            }
            // Ignorer les boutons inconnus (guild_*, etc.) - ils sont gérés par les collectors dans les commandes
        } else if (interaction.isStringSelectMenu()) {
            if (interaction.customId.startsWith('trade_')) {
                const { handleTradeInteraction } = require('../utils/trade-handler');
                await handleTradeInteraction(interaction);
            }

            // Gérer les menus déroulants pour les giveaways
            if (interaction.customId.startsWith('roleMenu_') || interaction.customId.startsWith('giveaway_')) {
                const { handleGiveawayInteraction } = require('../commands/giveaway/handlers');
                try {
                    await handleGiveawayInteraction(interaction);
                } catch (error) {
                    logger.error('Error handling giveaway select menu interaction:', error);
                    try {
                        if (!interaction.replied && !interaction.deferred) {
                            await interaction.reply({ content: 'Une erreur est survenue.', flags: 64 });
                        }
                    } catch (replyError) {
                        logger.error('Failed to reply to user after error:', replyError.code || replyError.message);
                        // swallow to prevent unhandled error event
                    }
                }
            } else if (interaction.customId.startsWith('custom_role_')) {
                // Routing pour la gestion des rôles personnalisés (Select Menu)
                const { handleCustomRoleInteraction } = require('../utils/guild/guild-custom-roles-handler');
                await handleCustomRoleInteraction(interaction);
            } else if (interaction.customId.startsWith('blzmpick:')) {
                const { handleMusicSelect } = require('../utils/voice-music-handler');
                try {
                    await handleMusicSelect(interaction);
                } catch (error) {
                    logger.error('[MUSIC] sélection:', error);
                    try {
                        if (!interaction.replied && !interaction.deferred) {
                            await interaction.reply({ content: 'Erreur lors du choix.', flags: 64 });
                        }
                    } catch (replyError) {
                        logger.error('[MUSIC] reply select:', replyError.code || replyError.message);
                    }
                }
            }
            // Ignorer les select menus inconnus - ils sont gérés par les collectors dans les commandes
        } else if (interaction.isModalSubmit()) {
            // Gérer les soumissions de modals pour les giveaways
            if (interaction.customId.startsWith('giveaway_modal_')) {
                const { handleModalSubmit } = require('../commands/giveaway/handlers');
                try {
                    await handleModalSubmit(interaction);
                } catch (error) {
                    logger.error('Error handling giveaway modal submit:', error);
                    try {
                        if (!interaction.replied && !interaction.deferred) {
                            await interaction.reply({ content: 'Une erreur est survenue.', flags: 64 });
                        }
                    } catch (replyError) {
                        logger.error('Failed to reply to user after error:', replyError.code || replyError.message);
                        // swallow to prevent unhandled error event
                    }
                }
            } else if (interaction.customId === 'bonbon_surprise_quantity_modal') {
                // Gestion du modal d'achat de bonbons surprise
                await handleBonbonSurpriseModal(interaction);
            } else if (interaction.customId === 'bonbon_surprise_quantity_modal') {
                // Gestion du modal d'achat de bonbons surprise
                await handleBonbonSurpriseModal(interaction);
            } else if (interaction.customId === 'cadeau_surprise_quantity_modal') {
                // Gestion du modal d'achat de cadeaux surprise
                await handleCadeauSurpriseModal(interaction);
            } else if (interaction.customId.startsWith('custom_role_')) {
                // Routing pour la gestion des rôles personnalisés
                const { handleCustomRoleInteraction } = require('../utils/guild/guild-custom-roles-handler');
                await handleCustomRoleInteraction(interaction);
            } else if (interaction.customId === 'vip_role_modal') {
                // Routing pour le modal de rôle VIP personnalisé
                const { handleVipRoleModal } = require('../utils/vip-role-handler');
                await handleVipRoleModal(interaction);
            } else if (interaction.customId.startsWith('blzmm:play:')) {
                const { handleMusicPlayModal } = require('../utils/voice-music-handler');
                try {
                    await handleMusicPlayModal(interaction);
                } catch (error) {
                    logger.error('[MUSIC] modal play:', error);
                    try {
                        if (!interaction.replied && !interaction.deferred) {
                            await interaction.reply({ content: 'Erreur musique.', flags: 64 });
                        }
                    } catch (replyError) {
                        logger.error('[MUSIC] modal reply:', replyError.code || replyError.message);
                    }
                }
            } else if (interaction.customId.startsWith('pvrm:')) {
                const { handleVoiceRoomPanelModal } = require('../utils/voice-room-panel-handler');
                try {
                    await handleVoiceRoomPanelModal(interaction);
                } catch (error) {
                    logger.error('Error handling private voice panel modal:', error);
                    try {
                        if (!interaction.replied && !interaction.deferred) {
                            await interaction.reply({ content: 'Une erreur est survenue.', flags: 64 });
                        }
                    } catch (replyError) {
                        logger.error('Failed to reply after PVR modal error:', replyError.code || replyError.message);
                    }
                }
            } else if (interaction.customId === 'bug_report_modal') {
                const { handleModalSubmit } = require('../commands/misc/bug');
                try {
                    await handleModalSubmit(interaction);
                } catch (error) {
                    logger.error('Error handling bug report modal:', error);
                    try {
                        if (interaction.deferred) {
                            await interaction.editReply({
                                content: '❌ Une erreur est survenue lors de l’envoi du signalement.',
                            });
                        } else if (!interaction.replied) {
                            await interaction.reply({ content: '❌ Une erreur est survenue.', flags: 64 });
                        }
                    } catch (replyError) {
                        logger.error('Failed to reply after bug modal error:', replyError.code || replyError.message);
                    }
                }
            } else if (interaction.customId === 'anti_afk_config_modal') {
                const { handleAntiAfkModalSubmit } = require('../commands/admin/anti-afk');
                try {
                    await handleAntiAfkModalSubmit(interaction);
                } catch (error) {
                    logger.error('Error handling anti-AFK modal:', error);
                    try {
                        if (!interaction.replied && !interaction.deferred) {
                            await interaction.reply({ content: '❌ Erreur enregistrement anti-AFK.', flags: 64 });
                        }
                    } catch (replyError) {
                        logger.error('Failed to reply after anti-AFK modal error:', replyError.code || replyError.message);
                    }
                }
            }
            // Ignorer les modals inconnus (rank_*, etc.) - ils sont gérés par les collectors dans les commandes
        } else if (interaction.isUserSelectMenu()) {
            if (interaction.customId.startsWith('role_assign_finish_')) {
                // Routing pour l'assignation de rôle personnalisé via User Select
                const { handleCustomRoleInteraction } = require('../utils/guild/guild-custom-roles-handler');
                await handleCustomRoleInteraction(interaction);
            }
        }
        };
        if (interaction.guildId) {
            return runWithEconomyGuild(interaction.guildId, run);
        }
        return run();
    },
};

async function handleBonbonSurpriseModal(interaction) {
    const { getOrCreateEventUser, grantEventCurrency } = require('../utils/db-halloween');
    const logger = require('../utils/logger');

    logger.info(`Modal bonbon surprise soumis par ${interaction.user.username}`);

    const quantityField = interaction.fields.getTextInputValue('bonbon_quantity');
    logger.info(`Quantité entrée: ${quantityField}`);

    const quantity = parseInt(quantityField);
    const userId = interaction.user.id;

    if (isNaN(quantity) || quantity <= 0) {
        logger.warn(`Quantité invalide: ${quantityField}`);
        return interaction.reply({ content: 'Veuillez entrer un nombre valide pour la quantité.', flags: 64 });
    }

    const BONBON_SURPRISE_PRICE = 10000; // Prix unitaire d'un bonbon surprise
    const totalCost = BONBON_SURPRISE_PRICE * quantity;

    const currentUserState = getOrCreateEventUser(userId, interaction.user.username);
    logger.info(`User ${interaction.user.username} a ${currentUserState.bonbons} bonbons, coût total: ${totalCost}`);

    if (currentUserState.bonbons < totalCost) {
        logger.info(`Pas assez de bonbons pour acheter ${quantity} bonbons surprise`);
        return interaction.reply({ content: `Il vous manque **${(totalCost - currentUserState.bonbons).toLocaleString('fr-FR')}** bonbons pour acheter ${quantity} Bonbons Surprise.`, flags: 64 });
    }

    // Déduction des bonbons
    logger.info(`Déduction de ${totalCost} bonbons`);
    grantEventCurrency(userId, { bonbons: -totalCost });

    // Attribution des bonbons surprise
    logger.info(`Attribution de ${quantity} bonbons surprise`);
    grantEventCurrency(userId, { bonbons_surprise: quantity });

    logger.info(`Achat réussi: ${quantity} bonbons surprise pour ${totalCost} bonbons`);
    await interaction.reply({
        content: `Félicitations ! Vous avez acheté **${quantity.toLocaleString('fr-FR')}** Bonbons Surprise pour **${totalCost.toLocaleString('fr-FR')}** bonbons. Utilisez /bonbons-ouvrir pour découvrir vos récompenses.`,
        flags: 64
    });
}

async function handleCadeauSurpriseModal(interaction) {
    const { getOrCreateEventUser, grantEventCurrency, grantGifts } = require('../utils/db-noel');
    const logger = require('../utils/logger');

    logger.info(`Modal cadeau surprise soumis par ${interaction.user.username}`);

    const quantityField = interaction.fields.getTextInputValue('cadeau_quantity');
    logger.info(`Quantité entrée: ${quantityField}`);

    const quantity = parseInt(quantityField);
    const userId = interaction.user.id;

    if (isNaN(quantity) || quantity <= 0 || quantity > 99) {
        logger.warn(`Quantité invalide: ${quantityField}`);
        return interaction.reply({ content: 'Veuillez entrer un nombre valide entre 1 et 99.', flags: 64 });
    }

    const CADEAU_SURPRISE_PRICE = 20000; // Prix unitaire d'un cadeau surprise
    const totalCost = CADEAU_SURPRISE_PRICE * quantity;

    const currentUserState = getOrCreateEventUser(userId, interaction.user.username);
    logger.info(`User ${interaction.user.username} a ${currentUserState.rubans} rubans, coût total: ${totalCost}`);

    if (currentUserState.rubans < totalCost) {
        logger.info(`Pas assez de rubans pour acheter ${quantity} cadeaux surprise`);
        return interaction.reply({ content: `Il vous manque **${(totalCost - currentUserState.rubans).toLocaleString('fr-FR')}** rubans pour acheter ${quantity} Cadeaux Surprise.`, flags: 64 });
    }

    // Déduction des rubans
    logger.info(`Déduction de ${totalCost} rubans`);
    grantEventCurrency(userId, { rubans: -totalCost });

    // Attribution des cadeaux surprise
    logger.info(`Attribution de ${quantity} cadeaux surprise`);
    grantGifts(userId, quantity);

    logger.info(`Achat réussi: ${quantity} cadeaux surprise pour ${totalCost} rubans`);
    await interaction.reply({
        content: `✅ Félicitations ! Vous avez acheté **${quantity.toLocaleString('fr-FR')}** Cadeaux Surprise pour **${totalCost.toLocaleString('fr-FR')}** rubans.\nUtilisez \`/cadeau-ouvrir\` pour découvrir vos récompenses.`,
        flags: 64
    });
}

async function handleGiveawayParticipation(interaction) {
    const { getGiveaway, addParticipant, removeParticipant, canParticipate } = require('../utils/db-giveaway');
    const { buildGiveawayEmbed } = require('../commands/giveaway/ui');

    const giveawayId = parseInt(interaction.customId.replace('giveaway_join_', ''));
    const userId = interaction.user.id;

    const giveaway = getGiveaway(giveawayId);

    if (!giveaway) {
        return interaction.reply({ content: 'Ce giveaway n\'existe plus.', flags: 64 });
    }

    if (!giveaway.is_active) {
        return interaction.reply({ content: 'Ce giveaway est terminé.', flags: 64 });
    }

    // Vérifier si l'utilisateur participe déjà
    const isParticipating = giveaway.participants.includes(userId);

    if (isParticipating) {
        // L'utilisateur veut se retirer
        removeParticipant(giveawayId, userId);
        await interaction.reply({ content: '❌ Vous ne participez plus à ce giveaway.', flags: 64 });
    } else {
        // L'utilisateur veut participer - vérifier les conditions
        const member = await interaction.guild.members.fetch(userId).catch(() => null);
        if (!member) {
            return interaction.reply({ content: 'Impossible de vérifier vos permissions.', flags: 64 });
        }

        const userData = {
            roles: member.roles.cache.map(r => r.id)
        };

        if (!canParticipate(giveawayId, userId, userData)) {
            return interaction.reply({ content: '❌ Vous ne remplissez pas les conditions pour participer à ce giveaway.', flags: 64 });
        }

        addParticipant(giveawayId, userId);
        await interaction.reply({ content: '✅ Vous participez maintenant à ce giveaway ! Bonne chance ! 🎉', flags: 64 });
    }

    // Mettre à jour le message du giveaway avec le nouveau nombre de participants
    try {
        const updatedGiveaway = getGiveaway(giveawayId);
        const giveawayEmbed = buildGiveawayEmbed(updatedGiveaway);
        giveawayEmbed.setFooter({ text: `Giveaway #${giveawayId}` });

        await interaction.message.edit({ embeds: [giveawayEmbed] });
    } catch (error) {
        logger.error('Erreur lors de la mise à jour du message du giveaway:', error);
    }
}

function safeReply(interaction, options) {
    if (interaction.replied || interaction.deferred) {
        return interaction.followUp(options);
    } else {
        return interaction.reply(options);
    }
}

async function handleLoanInteraction(interaction) {
    const db = require('../database/database');
    const { updateUserBalance } = require('../utils/db-users');

    // Parse custom ID format: "action-loan-loanId"
    const parts = interaction.customId.split('-');
    const action = parts[0];
    const loanId = parts[2]; // Skip 'loan' which is at index 1

    const getLoanStmt = db.prepare('SELECT * FROM loans WHERE id = ?');
    const loan = getLoanStmt.get(loanId);

    if (!loan) {
        return interaction.reply({ content: "Ce prêt n'existe plus.", ephemeral: true });
    }

    if (interaction.user.id !== loan.borrowerId) {
        return interaction.reply({ content: "Vous n'êtes pas l'emprunteur de ce prêt.", ephemeral: true });
    }

    if (loan.accepted) {
        return interaction.reply({ content: 'Ce prêt a déjà été traité.', ephemeral: true });
    }

    if (action === 'accept') {
        // Defer update pour avoir plus de temps de traitement
        await interaction.deferUpdate();

        const updateLoanStmt = db.prepare('UPDATE loans SET accepted = ? WHERE id = ?');
        updateLoanStmt.run(1, loanId);

        // Transfer starss - SANS multiplicateurs
        updateUserBalance(loan.lenderId, { stars: -loan.amount });
        updateUserBalance(loan.borrowerId, { stars: loan.amount });

        // Ajuster les valeurs de guerre pour éviter l'exploit de farming
        const { adjustWarInitialValues } = require('../utils/guild/guild-wars');
        adjustWarInitialValues(loan.lenderId, { stars: -loan.amount });
        adjustWarInitialValues(loan.borrowerId, { stars: loan.amount });

        // Faire les opérations asynchrones après la defer
        try {
            const lender = await interaction.client.users.fetch(loan.lenderId);
            await lender.send(`${interaction.user.username} a accepté votre prêt de ${loan.amount} starss.`);
        } catch (error) {
            console.error(`Impossible d'envoyer un DM au prêteur ${loan.lenderId}:`, error.message);
        }

        // Éditer le message original pour confirmer
        await interaction.editReply({ content: `✅ Vous avez accepté le prêt de ${loan.amount} starss.`, components: [] });

    } else if (action === 'decline') {
        // Defer update pour avoir plus de temps de traitement
        await interaction.deferUpdate();

        const deleteLoanStmt = db.prepare('DELETE FROM loans WHERE id = ?');
        deleteLoanStmt.run(loanId);

        // Faire les opérations asynchrones après la defer
        try {
            const lender = await interaction.client.users.fetch(loan.lenderId);
            await lender.send(`${interaction.user.username} a refusé votre prêt de ${loan.amount} starss.`);
        } catch (error) {
            console.error(`Impossible d'envoyer un DM au prêteur ${loan.lenderId}:`, error.message);
        }

        // Éditer le message original pour confirmer
        await interaction.editReply({ content: `✅ Vous avez refusé le prêt de ${loan.amount} starss.`, components: [] });
    }
}

async function handleWarInteraction(interaction) {
    const db = require('../database/database');
    const { getGuildById } = require('../utils/db-guilds');
    const [action, warId] = interaction.customId.split('_');

    const getWarStmt = db.prepare('SELECT * FROM guild_wars WHERE id = ?');
    const war = getWarStmt.get(warId);

    if (!war) {
        return interaction.reply({ content: "Cette guerre n'existe plus.", ephemeral: true });
    }

    const guild2 = getGuildById(war.guild2_id);

    if (interaction.user.id !== guild2.owner_id) {
        return interaction.reply({ content: "Vous n'êtes pas le chef de la guilde défiée.", ephemeral: true });
    }

    if (action === 'accept') {
        let durationMs;
        switch (war.type) {
            case 'courte':
                durationMs = 12 * 60 * 60 * 1000;
                break;
            case 'classique':
                durationMs = 48 * 60 * 60 * 1000;
                break;
            case 'longue':
                durationMs = 168 * 60 * 60 * 1000;
                break;
        }

        const startTime = new Date();
        const endTime = new Date(startTime.getTime() + durationMs);

        const updateWarStmt = db.prepare('UPDATE guild_wars SET status = ?, start_time = ?, end_time = ? WHERE id = ?');
        updateWarStmt.run('ongoing', startTime.toISOString(), endTime.toISOString(), warId);

        const guild1 = getGuildById(war.guild1_id);

        const insertMemberStmt = db.prepare('INSERT INTO guild_war_members (war_id, user_id, guild_id, initial_xp, initial_points, initial_stars) VALUES (?, ?, ?, ?, ?, ?)');

        const guild1Members = getGuildMembersWithDetails(guild1.id);
        for (const member of guild1Members) {
            const user = getOrCreateUser(member.id, member.username);
            insertMemberStmt.run(warId, member.id, guild1.id, user.xp, user.points, user.stars);
        }

        const guild2Members = getGuildMembersWithDetails(guild2.id);
        for (const member of guild2Members) {
            const user = getOrCreateUser(member.id, member.username);
            insertMemberStmt.run(warId, member.id, guild2.id, user.xp, user.points, user.stars);
        }

        await interaction.update({ content: `La guerre contre la guilde ${guild1.name} a commencé!`, components: [] });

    } else if (action === 'decline') {
        const deleteWarStmt = db.prepare('DELETE FROM guild_wars WHERE id = ?');
        deleteWarStmt.run(warId);

        await interaction.update({ content: 'Vous avez refusé la guerre.', components: [] });
    }
}

async function handleHackerItemClaim(interaction) {
    const { EmbedBuilder } = require('discord.js');
    const { canClaimHackerItem, giveHackerItem, getItemDisplayName } = require('../utils/hacker-system');
    const roleConfig = require('../config/role.config.json');
    const hackerRoleName = roleConfig.specialRoles.hacker;

    const userId = interaction.user.id;

    // Vérifier que l'utilisateur a le rôle "Hacker"
    const member = await interaction.guild.members.fetch(userId).catch(() => null);
    if (!member) {
        return interaction.reply({ content: '❌ Impossible de vérifier votre rôle.', ephemeral: true });
    }

    const hackerRole = interaction.guild.roles.cache.find(r => r.name === hackerRoleName);
    if (!hackerRole || !member.roles.cache.has(hackerRole.id)) {
        const embed = new EmbedBuilder()
            .setTitle('❌ Accès refusé')
            .setDescription(`Seuls les membres avec le rôle **${hackerRoleName}** peuvent utiliser ce bouton.\n\nVous pouvez obtenir ce rôle en ouvrant un **Coffre Légendaire** (0.1% de chance).`)
            .setColor('#FF0000');
        return interaction.reply({ embeds: [embed], ephemeral: true });
    }

    if (!canClaimHackerItem(userId)) {
        const db = require('../database/database');
        const userStmt = db.prepare('SELECT hacker_item_timestamp FROM users WHERE id = ?');
        const user = userStmt.get(userId);

        const lastClaim = new Date(user.hacker_item_timestamp);
        const nextClaim = new Date(lastClaim.getTime() + 12 * 60 * 60 * 1000);
        const now = new Date();

        const timeRemaining = new Date(nextClaim - now);
        const hours = timeRemaining.getUTCHours();
        const minutes = timeRemaining.getUTCMinutes();

        const embed = new EmbedBuilder()
            .setTitle('❌ Réclamation non disponible')
            .setDescription(`Vous pourrez récupérer votre prochain item dans **${hours}h ${minutes}m**.`)
            .setColor('#FF0000');

        return interaction.reply({ embeds: [embed], ephemeral: true });
    }

    const item = giveHackerItem(userId);

    if (!item) {
        return interaction.reply({
            content: '❌ Une erreur s\'est produite lors de la réclamation.',
            ephemeral: true
        });
    }

    const embed = new EmbedBuilder()
        .setTitle('🎁 Item Reçu!')
        .setDescription(`Vous avez reçu: **${getItemDisplayName(item)}**`)
        .setColor('#00FF00')
        .setFooter({ text: 'Prochain item disponible dans 12 heures' });

    await interaction.reply({ embeds: [embed], ephemeral: true });
}

async function handleValentinClaim(interaction) {
    try {
        await interaction.deferReply({ ephemeral: true });
    } catch (e) {
        return; // Interaction déjà répondue ou expirée
    }

    const { valentinEvents } = require('../utils/global-state');
    const { grantEventCurrency } = require('../utils/db-valentin');
    const { EmbedBuilder } = require('discord.js');
    const eventId = interaction.customId.replace('valentin_claim_', '');
    const event = valentinEvents.get(eventId);

    if (!event) {
        return interaction.editReply({ content: '❌ Cet événement est expiré.' });
    }

    if (event.claimedBy.includes(interaction.user.id)) {
        return interaction.editReply({ content: '❌ Vous avez déjà récupéré votre récompense pour cet événement !' });
    }

    if (event.claimedBy.length >= event.maxClaims) {
        return interaction.editReply({ content: '❌ Trop tard ! Les 3 récompenses ont déjà été récupérées.' });
    }

    // Ajouter l'utilisateur à la liste des gagnants
    event.claimedBy.push(interaction.user.id);

    // Accorder les récompenses
    grantEventCurrency(interaction.user.id, { coeurs: event.amount });

    await interaction.editReply({ content: `✅ Félicitations ! Vous avez récupéré **${event.amount} cœurs** ! (Place: ${event.claimedBy.length}/3)` });

    // Si c'est le 3ème, on peut éditer le message pour montrer qu'il est fini
    if (event.claimedBy.length >= event.maxClaims) {
        try {
            const embed = EmbedBuilder.from(interaction.message.embeds[0]);
            embed.setFooter({ text: 'Événement terminé - Les 3 récompenses ont été récupérées.' });
            await interaction.message.edit({ components: [], embeds: [embed] }).catch(() => null);
        } catch (error) {
            // Ignorer si l'edit échoue
        }
    }
}

async function handleValentinLoanAccept(interaction) {
    try {
        await interaction.deferReply({ ephemeral: true });
    } catch (e) {
        return;
    }

    const { db, grantEventCurrency, getOrCreateEventUser } = require('../utils/db-valentin');
    const loanId = parseInt(interaction.customId.replace('valentin_loan_accept_', ''));

    const loan = db.prepare('SELECT * FROM valentin_loans WHERE id = ?').get(loanId);

    if (!loan) {
        return interaction.editReply({ content: '❌ Ce prêt n\'existe plus.' });
    }

    if (loan.borrower_id !== interaction.user.id) {
        return interaction.editReply({ content: '❌ Ce prêt ne vous est pas destiné.' });
    }

    if (loan.accepted === 1) {
        return interaction.editReply({ content: '❌ Ce prêt a déjà été accepté.' });
    }

    // Vérifier que le prêteur a toujours assez
    const lenderUser = getOrCreateEventUser(loan.lender_id, 'unknown');
    if (lenderUser.coeurs < loan.amount) {
        db.prepare('DELETE FROM valentin_loans WHERE id = ?').run(loanId);
        return interaction.editReply({ content: '❌ Le prêteur n\'a plus assez de Cœurs.' });
    }

    // Transférer les cœurs
    grantEventCurrency(loan.lender_id, { coeurs: -loan.amount });
    grantEventCurrency(loan.borrower_id, { coeurs: loan.amount });
    db.prepare('UPDATE valentin_loans SET accepted = 1 WHERE id = ?').run(loanId);

    await interaction.editReply({ content: `✅ Vous avez accepté le prêt de **${loan.amount.toLocaleString('fr-FR')} Cœurs** !` });
    await interaction.message.edit({ content: `✅ Prêt accepté par ${interaction.user}.`, components: [] }).catch(() => null);
}

async function handleValentinLoanDecline(interaction) {
    try {
        await interaction.deferReply({ ephemeral: true });
    } catch (e) {
        return;
    }

    const { db } = require('../utils/db-valentin');
    const loanId = parseInt(interaction.customId.replace('valentin_loan_decline_', ''));

    const loan = db.prepare('SELECT * FROM valentin_loans WHERE id = ?').get(loanId);

    if (!loan) {
        return interaction.editReply({ content: '❌ Ce prêt n\'existe plus.' });
    }

    if (loan.borrower_id !== interaction.user.id) {
        return interaction.editReply({ content: '❌ Ce prêt ne vous est pas destiné.' });
    }

    db.prepare('DELETE FROM valentin_loans WHERE id = ?').run(loanId);

    await interaction.editReply({ content: '💔 Vous avez refusé le prêt.' });
    await interaction.message.edit({ content: `💔 Prêt refusé par ${interaction.user}.`, components: [] }).catch(() => null);
}
