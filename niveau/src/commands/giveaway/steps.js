const { EmbedBuilder, ModalBuilder, TextInputBuilder, ActionRowBuilder, TextInputStyle, MessageFlags, ButtonBuilder, ButtonStyle, PermissionFlagsBits } = require('discord.js');
const { getSession, createSession, deleteSession } = require('./session');
const { showConfigurationStep, showRewardStep, showConditionStep, showConfirmStep, showRoleSelection, formatDuration, formatRewards, formatConditions, buildGiveawayEmbed, safeUpdate } = require('./ui');
const { createGiveaway, updateGiveawayMessageId } = require('../../utils/db-giveaway');
const logger = require('../../utils/logger');

function parseDuration(durationStr) {
    const regex = /(\d+)(s|m|h|j|mois)/g;
    let totalMs = 0;
    let match;
    const now = new Date();
    while ((match = regex.exec(durationStr.toLowerCase())) !== null) {
        const value = parseInt(match[1]);
        const unit = match[2];
        switch (unit) {
            case 's': totalMs += value * 1000; break;
            case 'm': totalMs += value * 60 * 1000; break;
            case 'h': totalMs += value * 60 * 60 * 1000; break;
            case 'j': totalMs += value * 24 * 60 * 60 * 1000; break;
            case 'mois':
                const d = new Date(now);
                d.setMonth(d.getMonth() + value);
                totalMs += d.getTime() - now.getTime();
                break;
        }
    }
    return totalMs > 0 ? totalMs : null;
}

async function handleCreateGiveaway(interaction) {
    const perms = interaction.memberPermissions || interaction.member?.permissions;
    if (!perms || typeof perms.has !== 'function' || !perms.has(PermissionFlagsBits.Administrator)) {
        return interaction.reply({ content: "Vous n'avez pas la permission de créer un giveaway.", flags: [MessageFlags.Ephemeral] });
    }
    createSession(interaction.user.id);
    const { showInitialEmbed } = require('./ui');
    await showInitialEmbed(interaction);
}

async function showInitialConfigModal(interaction, session) {
    session.step = 'config';

    const modal = new ModalBuilder()
        .setCustomId('giveaway_modal_config_initial')
        .setTitle('Configuration du giveaway');

    const titleInput = new TextInputBuilder()
        .setCustomId('title')
        .setLabel('Titre du giveaway')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(100);
    if (session.data.title) {
        titleInput.setValue(session.data.title.substring(0, 100));
    }

    const descriptionInput = new TextInputBuilder()
        .setCustomId('description')
        .setLabel('Description (optionnelle)')
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(false)
        .setMaxLength(4000);
    if (session.data.description) {
        descriptionInput.setValue(session.data.description.substring(0, 4000));
    }

    const winnersInput = new TextInputBuilder()
        .setCustomId('winners')
        .setLabel('Nombre de gagnants')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setPlaceholder('1');
    if (session.data.winnerCount) {
        winnersInput.setValue(String(session.data.winnerCount));
    }

    const durationInput = new TextInputBuilder()
        .setCustomId('duration')
        .setLabel('Durée (ex: 1h30m, 2j)')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setPlaceholder('Unités: s, m, h, j, mois');
    if (session.data.durationInput) {
        durationInput.setValue(session.data.durationInput.substring(0, 100));
    }

    modal.addComponents(
        new ActionRowBuilder().addComponents(titleInput),
        new ActionRowBuilder().addComponents(descriptionInput),
        new ActionRowBuilder().addComponents(winnersInput),
        new ActionRowBuilder().addComponents(durationInput)
    );

    await interaction.showModal(modal);
}

async function handleConfigurationStep(interaction, session) {
    const configType = interaction.customId.split('_')[2];
    if (configType === 'next') {
        return await showRewardStep(interaction, session);
    }

    if (configType === 'edit') {
        return await showInitialConfigModal(interaction, session);
    }

    const translations = {
        title: 'Titre',
        description: 'Description',
        winners: 'Gagnants',
        duration: 'Durée'
    };
    const formattedType = translations[configType] || configType.charAt(0).toUpperCase() + configType.slice(1);

    const modal = new ModalBuilder().setCustomId(`giveaway_modal_config_${configType}`).setTitle(`Config: ${formattedType}`);
    const style = configType === 'description' ? TextInputStyle.Paragraph : TextInputStyle.Short;
    const input = new TextInputBuilder().setCustomId('value').setLabel(formattedType).setStyle(style).setRequired(true);
    if (configType === 'duration') {
        input.setPlaceholder('Unités: s, m, h, j, mois');
    }
    modal.addComponents(new ActionRowBuilder().addComponents(input));
    await interaction.showModal(modal);
}

async function handleRewardSelection(interaction, session) {
    const customId = interaction.customId;
    const creatorId = customId.split('_').pop(); // L'userId est le dernier élément
    const withoutCreatorId = customId.substring(0, customId.lastIndexOf('_')); // Enlever l'userId
    const rewardType = withoutCreatorId.split('_').slice(2).join('_'); // Extraire le type
    
    // Rôles : utiliser la sélection par menu déroulant
    if (rewardType === 'role') {
        return await showRoleSelection(interaction, session, 'reward', 0);
    }

    const formattedType = rewardType.split('_').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
    
    // Limiter le titre à 45 caractères maximum (contrainte Discord)
    let modalTitle = `Récompense ${formattedType}`;
    if (modalTitle.length > 45) {
        modalTitle = modalTitle.substring(0, 42) + '...';
    }
    
    const modal = new ModalBuilder().setCustomId(`giveaway_modal_reward_${rewardType}`).setTitle(modalTitle);
    const style = rewardType === 'autre' ? TextInputStyle.Paragraph : TextInputStyle.Short;
    
    const label = rewardType === 'autre' ? 'Description de la récompense' : `Quantité de ${formattedType}`;

    const input = new TextInputBuilder().setCustomId('value').setLabel(label).setStyle(style).setRequired(true);
    modal.addComponents(new ActionRowBuilder().addComponents(input));
    await interaction.showModal(modal);
}

async function handleRoleSelection(interaction, session, customId) {
    const contextParts = customId.split('_'); // e.g., ['roleMenu', 'reward', '0'] or ['roleMenu', 'condition', 'role', 'required', '0']
    const context = contextParts[1];
    const roleId = interaction.values[0];

    if (context === 'reward') {
        session.data.rewards.push({ type: 'role', value: roleId });
        await showRewardStep(interaction, session);
    } else if (context === 'condition') {
        const conditionType = contextParts.slice(2, -1).join('_'); // -> role_required or role_excluded
        session.data.conditions.push({ type: conditionType, value: roleId });
        await showConditionStep(interaction, session);
    }
}

async function handleConditionSelection(interaction, session) {
    const parts = interaction.customId.split('_');
    parts.pop(); // Remove userId
    const conditionType = parts.slice(1).join('_'); // -> e.g., condition_role_required
    await showRoleSelection(interaction, session, conditionType);
}

async function handleBackButton(interaction, session) {
    const context = interaction.customId.split('_')[2];
    if (context === 'reward') await showRewardStep(interaction, session);
    else if (context === 'condition') await showConditionStep(interaction, session);
}

async function handleNextOrSkip(interaction, session) {
    const action = interaction.customId.split('_')[2];
    if (action === 'next') await showConditionStep(interaction, session);
    else if (action === 'skip') await showConfirmStep(interaction, session);
}

async function handleModalSubmit(interaction) {
    const session = getSession(interaction.user.id);
    if (!session) return;

    const customId = interaction.customId;

    if (customId === 'giveaway_modal_config_initial') {
        const title = interaction.fields.getTextInputValue('title').trim();
        const description = interaction.fields.getTextInputValue('description').trim();
        const winnersRaw = interaction.fields.getTextInputValue('winners').trim();
        const durationRaw = interaction.fields.getTextInputValue('duration').trim();

        if (!title) {
            await interaction.reply({ content: 'Merci de renseigner un titre pour le giveaway.', flags: [MessageFlags.Ephemeral] });
            return;
        }

        const winnerCount = parseInt(winnersRaw, 10);
        if (!winnerCount || winnerCount <= 0) {
            await interaction.reply({ content: 'Merci d\'indiquer un nombre de gagnants valide (minimum 1).', flags: [MessageFlags.Ephemeral] });
            return;
        }

        const durationMs = parseDuration(durationRaw);
        if (!durationMs) {
            await interaction.reply({ content: 'Durée invalide. Utilisez des unités comme 30m, 2h, 7j ou 1mois.', flags: [MessageFlags.Ephemeral] });
            return;
        }

        session.data.title = title;
        session.data.description = description || null;
        session.data.winnerCount = Math.max(1, winnerCount);
        session.data.duration = durationMs;
        session.data.durationInput = durationRaw;
        session.data.ends_at = new Date().getTime() + durationMs;

        await require('./ui').showConfigurationStep(interaction, session);
        return;
    }

    const [_, modalType, type, subtype] = customId.split('_');
    const value = interaction.fields.getTextInputValue('value');

    if (type === 'config') {
        if (subtype === 'title') session.data.title = value;
        else if (subtype === 'description') session.data.description = value;
        else if (subtype === 'winners') session.data.winnerCount = parseInt(value) || 1;
        else if (subtype === 'duration') {
            const durationMs = parseDuration(value);
            session.data.duration = durationMs;
            session.data.ends_at = durationMs ? (new Date().getTime() + durationMs) : null;
            session.data.durationInput = value;
        }
    } else if (type === 'reward') {
        session.data.rewards.push({ type: subtype, value });
    } else if (type === 'repeat') {
        const interval = parseRepeatInterval(value);
        if (interval) {
            session.data.repeatInterval = interval;
        } else {
            // Peut-être envoyer un message d'erreur si le format est invalide
            interaction.followUp({ content: 'Format d\'intervalle invalide. Veuillez utiliser min, h, j, mois (max 12 mois).', flags: [1 << 6] });
            return; // Ne pas rafraîchir si l'input est mauvais
        }
    }

    if (session.step === 'config') await showConfigurationStep(interaction, session);
    else if (session.step === 'rewards') await showRewardStep(interaction, session);
    else if (session.step === 'repeat') await require('./ui').showRepeatStep(interaction, session);
}

async function confirmAndLaunchGiveaway(interaction, session) {
    try {
        const repeatInterval = session.data.repeatInterval || 0;
        const giveawayId = createGiveaway(interaction.guild.id, interaction.channel.id, session.data.title, session.data.description, session.data.winnerCount, session.data.duration, interaction.user.id, session.data.rewards, session.data.conditions, repeatInterval);
        
        // Calculer ends_at pour l'affichage
        const endsAt = Date.now() + session.data.duration;
        const giveawayEmbed = buildGiveawayEmbed({ 
            ...session.data, 
            participants: [],
            ends_at: endsAt,
            winner_count: session.data.winnerCount
        });
        giveawayEmbed.setFooter({ text: `Giveaway #${giveawayId}` });

        const participateButton = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`giveaway_join_${giveawayId}`).setLabel('Participer').setStyle(ButtonStyle.Primary).setEmoji('🎉'));
        const message = await interaction.channel.send({ embeds: [giveawayEmbed], components: [participateButton] });
        updateGiveawayMessageId(giveawayId, message.id);
    deleteSession(interaction.user.id);
    await safeUpdate(interaction, { content: 'Le giveaway a été créé avec succès !', embeds: [], components: [] });
    } catch (error) {
    logger.error('Erreur lors de la création du giveaway:', error);
    await safeUpdate(interaction, { content: 'Une erreur est survenue.', embeds: [], components: [] });
    }
}

async function handleRolePagination(interaction, session) {
    const parts = interaction.customId.split('_');
    const direction = parts[2]; // 'prev' ou 'next'
    
    // Reconstruire le context depuis le customId
    // Format: giveaway_role_prev/next_context_parts_userId
    const contextParts = parts.slice(3, -1); // Enlever 'giveaway', 'role', 'prev/next' et userId
    const context = contextParts.join('_');
    
    // Récupérer la page actuelle depuis la session
    const currentPage = (session.roleSelectionPages && session.roleSelectionPages[context]) || 0;
    
    // Calculer la nouvelle page
    let newPage = currentPage;
    if (direction === 'prev') {
        newPage = Math.max(0, currentPage - 1);
    } else if (direction === 'next') {
        newPage = currentPage + 1;
    }
    
    // Afficher la nouvelle page
    await showRoleSelection(interaction, session, context, newPage);
}

module.exports = {
    handleCreateGiveaway,
    handleConfigurationStep,
    handleRewardSelection,
    handleRoleSelection,
    handleConditionSelection,
    handleBackButton,
    handleNextOrSkip,
    handleModalSubmit,
    confirmAndLaunchGiveaway,
    handleRepeatStep,
    handleRolePagination,
    parseDuration,
    showInitialConfigModal
};

function parseRepeatInterval(durationStr) {
    const regex = /(\d+)(s|m|h|j|mois)/g;
    let totalMs = 0;
    let match;
    const now = new Date();

    while ((match = regex.exec(durationStr.toLowerCase())) !== null) {
        const value = parseInt(match[1]);
        const unit = match[2];
        switch (unit) {
            case 's': totalMs += value * 1000; break;
            case 'm': totalMs += value * 60 * 1000; break;
            case 'h': totalMs += value * 60 * 60 * 1000; break;
            case 'j': totalMs += value * 24 * 60 * 60 * 1000; break;
            case 'mois':
                // Ajoute des mois à la date actuelle pour gérer les variations de jours
                const d = new Date(now);
                d.setMonth(d.getMonth() + value);
                totalMs += d.getTime() - now.getTime();
                break;
        }
    }
    // Max 12 mois (approx)
    const maxInterval = 12 * 30.44 * 24 * 60 * 60 * 1000;
    if (totalMs > maxInterval) return null;

    return totalMs > 0 ? totalMs : null;
}

async function handleRepeatStep(interaction, session) {
    const action = interaction.customId.split('_')[2];

    if (action === 'set') {
        const modal = new ModalBuilder()
            .setCustomId('giveaway_modal_repeat_interval')
            .setTitle('Intervalle de répétition');
        const input = new TextInputBuilder()
            .setCustomId('value')
            .setLabel('Intervalle (ex: 30m, 2h, 7j, 1mois)')
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setPlaceholder('Max 12 mois');
        modal.addComponents(new ActionRowBuilder().addComponents(input));
        await interaction.showModal(modal);
    } else if (action === 'clear') {
        session.data.repeatInterval = null;
        await require('./ui').showRepeatStep(interaction, session);
    } else if (action === 'next') {
        await require('./ui').showConfirmStep(interaction, session);
    }
}
