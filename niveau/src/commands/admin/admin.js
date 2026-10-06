const { SlashCommandBuilder, PermissionFlagsBits, ButtonBuilder, ButtonStyle, ActionRowBuilder, ComponentType, EmbedBuilder, UserSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, MessageFlags, ContainerBuilder, TextDisplayBuilder, SectionBuilder, StringSelectMenuBuilder } = require('discord.js');
const db = require('../../database/database');
const { getGuildByName, updateGuildDetails, changeGuildOwner, addMemberToGuild, removeGuildSubChief, getGuildOfUser, getAllGuilds, dissolveGuild, createGuild, addGuildSubChief, updateGuildUpgrade, updateGuildLevel, getGuildById } = require('../../utils/db-guilds');
const { getOrCreateUser, updateUserBalance, setPoints, transferUserData } = require('../../utils/db-users');
const { updateGuildPrivateChannelName, UPGRADE_MATRIX } = require('../../utils/guild/guild-upgrades');
const { updateUserRank } = require('../../utils/ranks');
const logger = require('../../utils/logger');
const roleConfig = require('../../config/role.config.json');
const { parisDayStartMs } = require('../../../../utils/paris-time');

const USER_SETTINGS = [
    { id: 'notify_rank_up', label: 'Notifications de Rang', description: 'Notification lors d’une montée de rang.' },
    { id: 'notify_level_up', label: 'Notifications de Niveau', description: 'Notification lors d’une montée de niveau.' },
    { id: 'notify_streak', label: 'Notifications de Streak', description: 'Notification lors d’une streak gagnée ou perdue.' },
    { id: 'notify_guild_invite', label: 'Invitations de Guilde', description: 'Notification lors d’une invitation de guilde.' },
    { id: 'notify_quest_complete', label: 'Quêtes Terminées', description: 'Notification lorsqu’une quête est terminée.' },
    { id: 'notify_trade', label: 'Demandes d’Échange', description: 'Notification lors d’une demande d’échange.' },
    { id: 'notify_minigame_invite', label: 'Invitations Mini-jeu', description: 'Notification lors d’une invitation à un mini-jeu.' },
    { id: 'notify_love_calc', label: 'Ping calcul d’amour', description: 'Mention dans les résultats du calcul d’amour.' },
    { id: 'notify_debt_reminder', label: 'Rappels de Dettes', description: 'Notification lors d’un rappel de dette.' },
];

function readUserSettings(userData) {
    return Object.fromEntries(USER_SETTINGS.map(setting => [setting.id, Number(userData[setting.id]) === 1 ? 1 : 0]));
}

function getChangedSettings(previousSettings, nextSettings) {
    return USER_SETTINGS
        .filter(setting => previousSettings[setting.id] !== nextSettings[setting.id])
        .map(setting => ({
            ...setting,
            previousValue: previousSettings[setting.id],
            nextValue: nextSettings[setting.id],
        }));
}

function buildUserSettingsContainer(targetUser, userData, options = {}) {
    const { notice = null, locked = false } = options;
    const container = new ContainerBuilder();
    container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
            `# ⚙️ Paramètres de ${targetUser.username}\nUtilisateur : <@${targetUser.id}>${notice ? `\n\n${notice}` : ''}`
        )
    );

    for (const setting of USER_SETTINGS) {
        const isEnabled = Number(userData[setting.id]) === 1;
        const button = new ButtonBuilder()
            .setCustomId(`admin-setting-toggle:${setting.id}`)
            .setLabel(isEnabled ? 'Activée' : 'Désactivée')
            .setStyle(isEnabled ? ButtonStyle.Success : ButtonStyle.Danger)
            .setDisabled(locked);
        const section = new SectionBuilder()
            .addTextDisplayComponents(
                new TextDisplayBuilder().setContent(
                    `### ${setting.label}\n${setting.description}\nÉtat : **${isEnabled ? 'Activé' : 'Désactivé'}**`
                )
            )
            .setButtonAccessory(button);
        container.addSectionComponents(section);
    }

    return container;
}

function buildUserSettingsComponents(targetUser, userData, options = {}) {
    const { hasPendingChanges = false, notice = null, locked = false } = options;
    const components = [buildUserSettingsContainer(targetUser, userData, options)];

    if (hasPendingChanges) {
        components.push(
            new TextDisplayBuilder().setContent(
                'Des modifications ont été effectuées, souhaitez-vous les sauvegarder ?'
            ),
            new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('admin-settings-save')
                    .setLabel('Sauvegarder')
                    .setStyle(ButtonStyle.Success)
                    .setDisabled(locked),
                new ButtonBuilder()
                    .setCustomId('admin-settings-reset')
                    .setLabel('Réinitialiser')
                    .setStyle(ButtonStyle.Secondary)
                    .setDisabled(locked),
            )
        );
    }

    if (notice) {
        components.push(new TextDisplayBuilder().setContent(notice));
    }

    return components;
}

function hasUnsavedSettingsChanges(savedSettings, draftSettings) {
    return getChangedSettings(savedSettings, draftSettings).length > 0;
}

function buildSettingConfirmationContainer(setting, nextValue, remainingSeconds = null, ready = false) {
    const actionLabel = nextValue === 1 ? 'Activer' : 'Désactiver';
    const container = new ContainerBuilder();
    container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
            `# ⚙️ Confirmation\nSouhaitez-vous vraiment ${actionLabel.toLowerCase()} le paramètre **${setting.label}** ?`
        )
    );
    const confirmButton = new ButtonBuilder()
        .setCustomId(`admin-setting-confirm:${setting.id}`)
        .setLabel(ready ? actionLabel : `${actionLabel} (${remainingSeconds})`)
        .setStyle(nextValue === 1 ? ButtonStyle.Success : ButtonStyle.Danger)
        .setDisabled(!ready);
    const cancelButton = new ButtonBuilder()
        .setCustomId(`admin-setting-cancel:${setting.id}`)
        .setLabel('Annuler')
        .setStyle(ButtonStyle.Secondary);
    container.addActionRowComponents(new ActionRowBuilder().addComponents(confirmButton, cancelButton));
    return container;
}

function buildSettingsChangeNotice(adminName, customId) {
    const container = new ContainerBuilder();
    container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
            `# Vos paramètres ont été modifiés\nVos paramètres ont été modifiés par l’administrateur **${adminName}**. Vous pouvez consulter les changements en cliquant sur le bouton ci-dessous.\n\n-# [**Une erreur ? Contactez-nous !**](https://discord.com/channels/1097110036192448656/1454477715494404212)`
        )
    );
    container.addActionRowComponents(
        new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(customId)
                .setLabel('Voir les paramètres changés')
                .setStyle(ButtonStyle.Secondary)
        )
    );
    return container;
}

function buildSettingsChangeDetailsContent(adminName, changes) {
    const details = changes.map(change =>
        `- **${change.label} : ${change.nextValue === 1 ? '✅ `Activé`' : '❌ `Désactivé`'}**`
    ).join('\n');
    return `# ⚙️ Paramètres changés\nModifiés par **${adminName}** :\n\n${details}`;
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('admin')
        .setDescription('Commandes administratives générales.')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addSubcommand(subcommand =>
            subcommand
                .setName('guilde-changer-nom')
                .setDescription('Changer le nom d\'une guilde.')
                .addStringOption(option =>
                    option.setName('guilde')
                        .setDescription('Le nom actuel de la guilde')
                        .setRequired(true)
                        .setAutocomplete(true))
                .addStringOption(option =>
                    option.setName('nouveau_nom')
                        .setDescription('Le nouveau nom de la guilde')
                        .setRequired(true)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('guilde-transferer-propriete')
                .setDescription('Transférer la propriété d\'une guilde à un autre utilisateur.')
                .addStringOption(option =>
                    option.setName('guilde')
                        .setDescription('Le nom de la guilde')
                        .setRequired(true)
                        .setAutocomplete(true))
                .addUserOption(option =>
                    option.setName('nouveau_proprietaire')
                        .setDescription('Le nouveau propriétaire')
                        .setRequired(true)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('guilde-supprimer')
                .setDescription('Supprimer définitivement une guilde.')
                .addStringOption(option =>
                    option.setName('guilde')
                        .setDescription('Le nom de la guilde à supprimer')
                        .setRequired(true)
                        .setAutocomplete(true)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('add-rp')
                .setDescription('Ajouter des RP (Points) à un utilisateur.')
                .addUserOption(option => option.setName('utilisateur').setDescription('L\'utilisateur').setRequired(true))
                .addIntegerOption(option => option.setName('montant').setDescription('Le montant de RP à ajouter').setRequired(true).setMinValue(1)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('remove-rp')
                .setDescription('Retirer des RP (Points) à un utilisateur.')
                .addUserOption(option => option.setName('utilisateur').setDescription('L\'utilisateur').setRequired(true))
                .addIntegerOption(option => option.setName('montant').setDescription('Le montant de RP à retirer').setRequired(true).setMinValue(1)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('set-rp')
                .setDescription('Définir le montant de RP (Points) d\'un utilisateur.')
                .addUserOption(option => option.setName('utilisateur').setDescription('L\'utilisateur').setRequired(true))
                .addIntegerOption(option => option.setName('montant').setDescription('Le nouveau montant de RP').setRequired(true).setMinValue(0)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('set-streak')
                .setDescription('Définir le nombre de jours de streak d\'un utilisateur.')
                .addUserOption(option => option.setName('utilisateur').setDescription('L\'utilisateur').setRequired(true))
                .addIntegerOption(option => option.setName('jours').setDescription('Le nouveau nombre de jours').setRequired(true).setMinValue(0))
                .addStringOption(option => option
                    .setName('recompense')
                    .setDescription('Choisir si la récompense de ce palier doit être accordée')
                    .setRequired(true)
                    .addChoices(
                        { name: 'Donner (conseillé)', value: 'donner' },
                        { name: 'Ne pas donner', value: 'ne_pas_donner' },
                    )))
        .addSubcommand(subcommand =>
            subcommand
                .setName('transferer-compte')
                .setDescription('Transférer les données d\'un compte vers un autre (Irréversible).')
                .addUserOption(option => option.setName('source').setDescription('Le compte source (données à garder)').setRequired(true))
                .addUserOption(option => option.setName('cible').setDescription('Le compte cible (recevra les données)').setRequired(true)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('cree-guilde')
                .setDescription('Créer une nouvelle guilde avec configuration complète (admin only).'))
        .addSubcommand(subcommand =>
            subcommand
                .setName('guilde-fix')
                .setDescription('Corriger/reconfigurer les paramètres d\'une guilde existante.')
                .addStringOption(option =>
                    option.setName('guilde')
                        .setDescription('Le nom de la guilde à corriger')
                        .setRequired(true)
                        .setAutocomplete(true))
                .addIntegerOption(option =>
                    option.setName('upgrade')
                        .setDescription('Le niveau d\'upgrade à appliquer (0-10)')
                        .setRequired(true)
                        .setMinValue(0)
                        .setMaxValue(10)))
        .addSubcommandGroup(group =>
            group
                .setName('nerf-vocal')
                .setDescription('Gérer le système de nerf vocal.')
                .addSubcommand(subcommand =>
                    subcommand
                        .setName('voir')
                        .setDescription('Voir le statut du nerf vocal d\'un utilisateur.')
                        .addUserOption(option => option.setName('utilisateur').setDescription('L\'utilisateur').setRequired(true)))
                .addSubcommand(subcommand =>
                    subcommand
                        .setName('reset')
                        .setDescription('Réinitialiser le nerf vocal d\'un utilisateur (remet l\'XP vocal journalier à 0).')
                        .addUserOption(option => option.setName('utilisateur').setDescription('L\'utilisateur').setRequired(true)))
                .addSubcommand(subcommand =>
                    subcommand
                        .setName('definir')
                        .setDescription('Définir manuellement l\'XP vocal journalier d\'un utilisateur.')
                        .addUserOption(option => option.setName('utilisateur').setDescription('L\'utilisateur').setRequired(true))
                        .addIntegerOption(option => option.setName('montant').setDescription('Le montant d\'XP vocal journalier').setRequired(true).setMinValue(0))))
        .addSubcommand(subcommand =>
            subcommand
                .setName('guilde-war-fix')
                .setDescription('Reset une guerre de guilde (points et/ou temps).')
                .addStringOption(option =>
                    option.setName('guilde')
                        .setDescription('Nom d\'une des guildes en guerre')
                        .setRequired(true)
                        .setAutocomplete(true))
                .addBooleanOption(option =>
                    option.setName('reset-points')
                        .setDescription('Recapturer les valeurs initiales et remettre les points à 0')
                        .setRequired(false))
                .addIntegerOption(option =>
                    option.setName('ajouter-heures')
                        .setDescription('Ajouter des heures au temps restant')
                        .setRequired(false)
                        .setMinValue(1)
                        .setMaxValue(168)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('guilde-victoires')
                .setDescription('Ajouter manuellement des victoires à une guilde.')
                .addStringOption(option =>
                    option.setName('guilde')
                        .setDescription('Nom de la guilde')
                        .setRequired(true)
                        .setAutocomplete(true))
                .addIntegerOption(option =>
                    option.setName('victoires')
                        .setDescription('Nombre de victoires à ajouter au compteur wars_won')
                        .setRequired(false)
                        .setMinValue(1))
                .addIntegerOption(option =>
                    option.setName('victoires-70')
                        .setDescription('Nombre de victoires 70%+ à ajouter')
                        .setRequired(false)
                        .setMinValue(1))
                .addIntegerOption(option =>
                    option.setName('victoires-80')
                        .setDescription('Nombre de victoires 80%+ à ajouter')
                        .setRequired(false)
                        .setMinValue(1))
                .addIntegerOption(option =>
                    option.setName('victoires-90')
                        .setDescription('Nombre de victoires 90%+ à ajouter')
                        .setRequired(false)
                        .setMinValue(1)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('guilde-war-supprimer')
                .setDescription('Supprimer une guerre de guilde en cours ou une déclaration en attente.'))
        .addSubcommand(subcommand =>
            subcommand
                .setName('reset-profil')
                .setDescription('Réinitialise complètement les données d\'un membre')
                .addUserOption(option =>
                    option.setName('membre')
                        .setDescription('Le membre dont le profil doit être réinitialisé')
                        .setRequired(true)))
        .addSubcommandGroup(subcommand =>
            subcommand
                .setName('parametres')
                .setDescription('Gérer les paramètres d’un utilisateur.')
                .addSubcommand(settingsSubcommand =>
                    settingsSubcommand
                        .setName('utilisateur')
                        .setDescription('Afficher et modifier les paramètres d’un utilisateur.')
                    .addUserOption(option =>
                        option.setName('utilisateur').setDescription('L’utilisateur').setRequired(true)))),

    async autocomplete(interaction) {
        const focusedValue = interaction.options.getFocused();
        const guilds = getAllGuilds();
        const filtered = guilds.filter(guild => guild.name.toLowerCase().includes(focusedValue.toLowerCase()));

        // Discord limits autocomplete choices to 25
        await interaction.respond(
            filtered.slice(0, 25).map(guild => ({ name: guild.name, value: guild.name }))
        );
    },

    async execute(interaction) {
        const subcommand = interaction.options.getSubcommand();
        const subcommandGroup = interaction.options.getSubcommandGroup();

        if (subcommandGroup === 'parametres' && subcommand === 'utilisateur') {
            const targetUser = interaction.options.getUser('utilisateur', true);
            let userData = getOrCreateUser(targetUser.id, targetUser.username);
            let savedSettings = readUserSettings(userData);
            let draftSettings = { ...savedSettings };
            const response = await interaction.reply({
                components: buildUserSettingsComponents(
                    targetUser,
                    { ...userData, ...draftSettings }
                ),
                flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
            });
            let activeConfirmation = null;

            const renderSettings = (notice = null, locked = false) => interaction.editReply({
                components: buildUserSettingsComponents(
                    targetUser,
                    { ...userData, ...draftSettings },
                    {
                        notice,
                        locked,
                        hasPendingChanges: hasUnsavedSettingsChanges(savedSettings, draftSettings),
                    }
                ),
            });

            const saveSettings = async buttonInteraction => {
                if (activeConfirmation) {
                    return buttonInteraction.reply({
                        content: 'Terminez ou annulez d’abord la confirmation en cours.',
                        flags: MessageFlags.Ephemeral,
                    });
                }

                const changes = getChangedSettings(savedSettings, draftSettings);
                if (changes.length === 0) {
                    await buttonInteraction.deferUpdate();
                    return renderSettings('Aucune modification à sauvegarder.');
                }

                await buttonInteraction.deferUpdate();
                try {
                    const saveChanges = db.transaction(() => {
                        for (const change of changes) {
                            db.prepare(`UPDATE users SET ${change.id} = ? WHERE id = ?`)
                                .run(change.nextValue, targetUser.id);
                        }
                    });
                    saveChanges();
                } catch (error) {
                    logger.error(`Erreur lors de la sauvegarde des paramètres de ${targetUser.id}:`, error);
                    return renderSettings('❌ La sauvegarde a échoué. Les changements restent en attente.');
                }

                savedSettings = { ...draftSettings };
                userData = getOrCreateUser(targetUser.id, targetUser.username);

                const adminName = interaction.member?.displayName
                    || interaction.user.globalName
                    || interaction.user.username;
                const reportId = interaction.id;
                const customId = `admin-settings-view:${reportId}`;
                let dmSent = false;
                let reportDb = null;
                try {
                    reportDb = typeof db.getMainDb === 'function' ? db.getMainDb() : db;
                    reportDb.prepare(`
                        INSERT OR REPLACE INTO admin_settings_change_reports
                            (report_id, target_user_id, details_content, created_at)
                        VALUES (?, ?, ?, ?)
                    `).run(
                        reportId,
                        targetUser.id,
                        buildSettingsChangeDetailsContent(adminName, changes),
                        Date.now()
                    );

                    const dmMessage = await targetUser.send({
                        components: [buildSettingsChangeNotice(adminName, customId)],
                        flags: MessageFlags.IsComponentsV2,
                        allowedMentions: { parse: [] },
                    });
                    dmSent = true;
                } catch (error) {
                    reportDb?.prepare(
                        'DELETE FROM admin_settings_change_reports WHERE report_id = ?'
                    ).run(reportId);
                    logger.warn(`Impossible d’envoyer le récapitulatif des paramètres à ${targetUser.id}:`, error);
                }

                return renderSettings(
                    dmSent
                        ? '✅ Modifications sauvegardées. Un MP a été envoyé à l’utilisateur.'
                        : '✅ Modifications sauvegardées, mais le MP n’a pas pu être envoyé.'
                );
            };

            const collector = response.createMessageComponentCollector({
                componentType: ComponentType.Button,
                time: 15 * 60 * 1000,
            });

            collector.on('collect', async buttonInteraction => {
                if (buttonInteraction.user.id !== interaction.user.id) {
                    return buttonInteraction.reply({
                        content: 'Seul l’administrateur ayant lancé la commande peut modifier ces paramètres.',
                        flags: MessageFlags.Ephemeral,
                    });
                }

                if (buttonInteraction.customId === 'admin-settings-save') {
                    return saveSettings(buttonInteraction);
                }

                if (buttonInteraction.customId === 'admin-settings-reset') {
                    draftSettings = { ...savedSettings };
                    await buttonInteraction.deferUpdate();
                    return renderSettings('Les modifications non sauvegardées ont été annulées.');
                }

                const [action, settingId] = buttonInteraction.customId.split(':');

                const setting = USER_SETTINGS.find(candidate => candidate.id === settingId);
                if (!setting) return;

                if (action === 'admin-setting-toggle' && !activeConfirmation) {
                    const nextValue = draftSettings[settingId] === 1 ? 0 : 1;
                    const confirmation = { settingId, nextValue, ready: false };
                    activeConfirmation = confirmation;
                    await buttonInteraction.deferUpdate();
                    await interaction.editReply({
                        components: [buildSettingConfirmationContainer(setting, nextValue, 3)],
                    });

                    const advanceCountdown = async () => {
                        for (const remainingSeconds of [2, 1, 0]) {
                            await new Promise(resolve => setTimeout(resolve, 1000));
                            if (activeConfirmation !== confirmation) return;
                            await interaction.editReply({
                                components: [buildSettingConfirmationContainer(setting, nextValue, remainingSeconds)],
                            });
                        }

                        await new Promise(resolve => setTimeout(resolve, 1000));
                        if (activeConfirmation !== confirmation) return;
                        confirmation.ready = true;
                        await interaction.editReply({
                            components: [buildSettingConfirmationContainer(setting, nextValue, null, true)],
                        });
                    };

                    advanceCountdown().catch(error =>
                        logger.error('Erreur pendant le compte à rebours des paramètres admin :', error)
                    );
                    return;
                }

                if (action === 'admin-setting-cancel' && activeConfirmation?.settingId === settingId) {
                    activeConfirmation = null;
                    await buttonInteraction.deferUpdate();
                    return renderSettings();
                }

                if (
                    action === 'admin-setting-confirm' &&
                    activeConfirmation?.settingId === settingId &&
                    activeConfirmation.ready
                ) {
                    const confirmedValue = activeConfirmation.nextValue;
                    activeConfirmation = null;
                    await buttonInteraction.deferUpdate();
                    draftSettings[settingId] = confirmedValue;
                    return renderSettings();
                }

                if (!buttonInteraction.deferred && !buttonInteraction.replied) {
                    await buttonInteraction.deferUpdate();
                }
            });

            collector.on('end', () => {
                activeConfirmation = null;
                draftSettings = { ...savedSettings };
                userData = getOrCreateUser(targetUser.id, targetUser.username);
                renderSettings('Session expirée. Les modifications non sauvegardées ont été annulées.', true)
                    .catch(() => {});
            });

            return response;
        }

        if (subcommandGroup === 'nerf-vocal') {
            const targetUser = interaction.options.getUser('utilisateur');
            const user = getOrCreateUser(targetUser.id, targetUser.username); // Ensure user exists in DB logic
            // Note: getOrCreateUser returns DB object, not Discord user. But we need DB read/write.

            if (subcommand === 'voir') {
                const dailyXP = user.daily_voice_xp || 0;
                const dailyPoints = user.daily_voice_points || 0;
                const lastReset = user.daily_voice_last_reset || 0;

                let status = "✅ Normal (100%)";
                let multiplier = 1;

                // Check reset validity
                const today = parisDayStartMs();
                let effectiveXP = dailyXP;
                let effectivePoints = dailyPoints;

                if (lastReset < today) {
                    effectiveXP = 0;
                    effectivePoints = 0;
                    status += " (Sera reset à la prochaine activité)";
                } else {
                    // Hard Caps
                    if (dailyXP >= 15000 || dailyPoints >= 7000) {
                        status = "⛔ Hard Nerf (STOP - 0 gains)";
                        multiplier = 0;
                    }
                    // Soft Caps
                    else if (dailyXP >= 10000 || dailyPoints >= 5000) {
                        status = "⚠️ Soft Nerf (Divisé par 5)";
                        multiplier = 0.2;
                    }
                }

                const embed = new EmbedBuilder()
                    .setTitle(`🎙️ Statut Nerf Vocal : ${targetUser.username}`)
                    .setColor(multiplier < 1 ? (multiplier === 0 ? 0xFF0000 : 0xFFA500) : 0x00FF00)
                    .addFields(
                        { name: 'XP Journalier', value: `${effectiveXP.toLocaleString()} / 10 000 (Soft) - 15 000 (Hard)`, inline: true },
                        { name: 'RP Journalier', value: `${effectivePoints.toLocaleString()} / 5 000 (Soft) - 7 000 (Hard)`, inline: true },
                        { name: 'Multiplicateur', value: `x${multiplier}`, inline: true },
                        { name: 'Statut', value: status, inline: false },
                        { name: 'Dernier Reset', value: lastReset ? `<t:${Math.floor(lastReset / 1000)}:R>` : 'Jamais', inline: false }
                    );

                return interaction.reply({ embeds: [embed], ephemeral: true });
            }

            else if (subcommand === 'reset') {
                const today = parisDayStartMs();
                db.prepare('UPDATE users SET daily_voice_points = 0, daily_voice_last_reset = ? WHERE id = ?').run(today, targetUser.id);
                return interaction.reply({ content: `✅ Le nerf vocal de **${targetUser.username}** a été réinitialisé (RP vocal journalier remis à 0).` });
            }

            else if (subcommand === 'definir') {
                const amount = interaction.options.getInteger('montant');
                const today = parisDayStartMs();
                // On met à jour le montant ET la date de reset pour que ce soit pris en compte immédiatement
                // We assume the admin specifies the accumulated points
                db.prepare('UPDATE users SET daily_voice_points = ?, daily_voice_last_reset = ? WHERE id = ?').run(amount, today, targetUser.id);
                return interaction.reply({ content: `✅ Le RP vocal journalier de **${targetUser.username}** a été défini à **${amount}**.` });
            }
        }

        if (subcommand === 'guilde-changer-nom') {
            const guildName = interaction.options.getString('guilde');
            const newName = interaction.options.getString('nouveau_nom');

            const guild = getGuildByName(guildName);

            if (!guild) {
                return interaction.reply({ content: `❌ La guilde "**${guildName}**" n'existe pas.`, ephemeral: true });
            }

            // Vérifier si le nouveau nom est déjà pris
            const existingGuild = getGuildByName(newName);
            if (existingGuild) {
                return interaction.reply({ content: `❌ Une guilde avec le nom "**${newName}**" existe déjà.`, ephemeral: true });
            }

            await interaction.deferReply();

            try {
                // Update guild name
                updateGuildDetails(guild.id, newName, guild.emoji);

                // Update private channel name
                await updateGuildPrivateChannelName(interaction.client, guild, newName, guild.emoji);

                return interaction.editReply({ content: `✅ Le nom de la guilde a été changé de "**${guildName}**" à "**${newName}**".` });
            } catch (error) {
                logger.error(`Erreur lors du changement de nom de la guilde ${guildName}:`, error);
                return interaction.editReply({ content: '❌ Une erreur est survenue lors du changement de nom.' });
            }
        }

        else if (subcommand === 'guilde-supprimer') {
            const guildName = interaction.options.getString('guilde');
            const guild = getGuildByName(guildName);

            if (!guild) {
                return interaction.reply({ content: `❌ La guilde "**${guildName}**" n'existe pas.`, ephemeral: true });
            }

            const confirmButton = new ButtonBuilder()
                .setCustomId('delete_guild_confirm')
                .setLabel('🗑️ SUPPRIMER DÉFINITIVEMENT')
                .setStyle(ButtonStyle.Danger);

            const cancelButton = new ButtonBuilder()
                .setCustomId('delete_guild_cancel')
                .setLabel('Annuler')
                .setStyle(ButtonStyle.Secondary);

            const row = new ActionRowBuilder().addComponents(confirmButton, cancelButton);

            const reply = await interaction.reply({
                content: `⚠️ **ATTENTION : SUPPRESSION DE GUILDE** ⚠️\n\nVous êtes sur le point de supprimer la guilde **${guild.name}**.\nCette action est **IRRÉVERSIBLE**.\n\nÊtes-vous sûr de vouloir continuer ?`,
                components: [row],
                fetchReply: true
            });

            const collector = reply.createMessageComponentCollector({
                componentType: ComponentType.Button,
                time: 60000
            });

            collector.on('collect', async (i) => {
                if (i.user.id !== interaction.user.id) {
                    return i.reply({ content: '❌ Seul l\'administrateur ayant lancé la commande peut confirmer.', ephemeral: true });
                }

                if (i.customId === 'delete_guild_confirm') {
                    try {
                        await i.deferUpdate();

                        // Delete Discord channel if exists
                        if (guild.channel_id) {
                            const channel = await interaction.guild.channels.fetch(guild.channel_id).catch(() => null);
                            if (channel) {
                                await channel.delete().catch(err => logger.error(`Failed to delete channel for guild ${guild.name}:`, err));
                            }
                        }

                        // Remove 'Créateur de Guilde' role from owner
                        const ownerRole = interaction.guild.roles.cache.find(r => r.name === roleConfig.questRewardRoles.guildCreator);
                        if (ownerRole && guild.owner_id) {
                            const ownerMember = await interaction.guild.members.fetch(guild.owner_id).catch(() => null);
                            if (ownerMember) {
                                await ownerMember.roles.remove(ownerRole).catch(err => logger.warn(`Failed to remove role from owner ${guild.owner_id}:`, err));
                            }
                        }

                        dissolveGuild(guild.id);

                        await i.editReply({
                            content: `✅ La guilde **${guild.name}** a été supprimée avec succès.`,
                            components: []
                        });
                    } catch (error) {
                        logger.error(`Erreur lors de la suppression de la guilde ${guild.name}:`, error);
                        await i.editReply({
                            content: `❌ Une erreur est survenue lors de la suppression : ${error.message}`,
                            components: []
                        });
                    }
                    collector.stop();
                } else if (i.customId === 'delete_guild_cancel') {
                    await i.update({
                        content: '❌ Suppression annulée.',
                        components: []
                    });
                    collector.stop();
                }
            });
        }

        else if (subcommand === 'guilde-transferer-propriete') {
            const guildName = interaction.options.getString('guilde');
            const newOwnerUser = interaction.options.getUser('nouveau_proprietaire');

            const guild = getGuildByName(guildName);
            if (!guild) {
                return interaction.reply({ content: `❌ La guilde "**${guildName}**" n'existe pas.`, ephemeral: true });
            }

            if (guild.owner_id === newOwnerUser.id) {
                return interaction.reply({ content: `❌ ${newOwnerUser} est déjà le propriétaire de cette guilde.`, ephemeral: true });
            }

            const currentGuildOfTarget = getGuildOfUser(newOwnerUser.id);
            if (currentGuildOfTarget && currentGuildOfTarget.id !== guild.id) {
                return interaction.reply({ content: `❌ ${newOwnerUser} est déjà membre de la guilde "**${currentGuildOfTarget.name}**". Il doit la quitter avant de pouvoir devenir propriétaire d'une autre guilde.`, ephemeral: true });
            }

            try {
                const oldOwnerId = guild.owner_id;

                // Si l'utilisateur n'est pas dans la guilde, on l'ajoute
                if (!currentGuildOfTarget) {
                    addMemberToGuild(newOwnerUser.id, guild.id);
                }

                // S'il était sous-chef, on le retire de la liste
                removeGuildSubChief(guild.id, newOwnerUser.id);

                // Changer le propriétaire dans la DB
                changeGuildOwner(guild.id, newOwnerUser.id);

                // --- Gestion des rôles Discord ---
                const guildDiscord = interaction.guild;
                const ownerRole = guildDiscord.roles.cache.find(r => r.name === roleConfig.questRewardRoles.guildCreator);

                if (ownerRole) {
                    // Retirer le rôle à l'ancien propriétaire
                    const oldOwnerMember = await guildDiscord.members.fetch(oldOwnerId).catch(() => null);
                    if (oldOwnerMember) {
                        await oldOwnerMember.roles.remove(ownerRole).catch(e => logger.warn(`Impossible de retirer le rôle owner à ${oldOwnerId}: ${e.message}`));
                    }

                    // Ajouter le rôle au nouveau propriétaire
                    const newOwnerMember = await guildDiscord.members.fetch(newOwnerUser.id).catch(() => null);
                    if (newOwnerMember) {
                        await newOwnerMember.roles.add(ownerRole).catch(e => logger.warn(`Impossible d'ajouter le rôle owner à ${newOwnerUser.id}: ${e.message}`));
                    }
                }

                // Mettre à jour les permissions du salon
                const { updateGuildChannelPermissions } = require('../../utils/guild/guild-upgrades');
                // Need to re-fetch guild to get updated owner? No, we have IDs.
                // But updateGuildChannelPermissions checks guild.owner_id. 
                // We should manually pass the correct IDs or update the guild object.
                // Actually, updateGuildChannelPermissions takes (client, guild, userId, action).
                // It checks `if (userId === guild.owner_id)`.
                // Since we just updated the DB, if we re-fetch the guild it will be correct.
                const { getGuildById } = require('../../utils/db-guilds');
                const updatedGuild = getGuildById(guild.id);

                await updateGuildChannelPermissions(interaction.client, updatedGuild, newOwnerUser.id, 'add');
                // Retirer d'abord toutes les permissions de l'ancien propriétaire pour effacer "ManageMessages"
                await updateGuildChannelPermissions(interaction.client, updatedGuild, oldOwnerId, 'remove');
                // Puis lui remettre les permissions classiques de membre
                await updateGuildChannelPermissions(interaction.client, updatedGuild, oldOwnerId, 'add');

                return interaction.reply({ content: `✅ La propriété de la guilde "**${guild.name}**" a été transférée à ${newOwnerUser}.` });

            } catch (error) {
                logger.error(`Erreur lors du transfert de propriété de la guilde ${guildName}:`, error);
                return interaction.reply({ content: '❌ Une erreur est survenue lors du transfert de propriété.', ephemeral: true });
            }
        }

        else if (subcommand === 'add-rp') {
            const user = interaction.options.getUser('utilisateur');
            const amount = interaction.options.getInteger('montant');

            try {
                getOrCreateUser(user.id, user.username);
                updateUserBalance(user.id, { points: amount });
                await updateUserRank(interaction.client, user.id);
                return interaction.reply({ content: `✅ **${amount} RP** ont été ajoutés à ${user}.` });
            } catch (error) {
                logger.error(`Erreur add-rp pour ${user.id}:`, error);
                return interaction.reply({ content: '❌ Erreur lors de l\'ajout de RP.', ephemeral: true });
            }
        }

        else if (subcommand === 'remove-rp') {
            const user = interaction.options.getUser('utilisateur');
            const amount = interaction.options.getInteger('montant');

            try {
                getOrCreateUser(user.id, user.username);
                updateUserBalance(user.id, { points: -amount });
                await updateUserRank(interaction.client, user.id);
                return interaction.reply({ content: `✅ **${amount} RP** ont été retirés à ${user}.` });
            } catch (error) {
                logger.error(`Erreur remove-rp pour ${user.id}:`, error);
                return interaction.reply({ content: '❌ Erreur lors du retrait de RP.', ephemeral: true });
            }
        }

        else if (subcommand === 'set-rp') {
            const user = interaction.options.getUser('utilisateur');
            const amount = interaction.options.getInteger('montant');

            try {
                getOrCreateUser(user.id, user.username);
                setPoints(user.id, amount);
                await updateUserRank(interaction.client, user.id);
                return interaction.reply({ content: `✅ Les RP de ${user} ont été définis à **${amount}**.` });
            } catch (error) {
                logger.error(`Erreur set-rp pour ${user.id}:`, error);
                return interaction.reply({ content: '❌ Erreur lors de la définition des RP.', ephemeral: true });
            }
        }

        else if (subcommand === 'set-streak') {
            if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
                return interaction.reply({ content: '❌ Cette commande est réservée aux administrateurs du serveur.', ephemeral: true });
            }

            const user = interaction.options.getUser('utilisateur');
            const days = interaction.options.getInteger('jours');
            const shouldGiveReward = interaction.options.getString('recompense') === 'donner';
            const targetMember = interaction.guild?.members.cache.get(user.id)
                ?? await interaction.guild?.members.fetch(user.id).catch(() => null);
            const displayName = targetMember?.displayName || user.globalName || user.username;
            const avatarURL = targetMember?.displayAvatarURL({ extension: 'png', size: 128 })
                || user.displayAvatarURL({ extension: 'png', size: 128 });
            const createStreakEmbed = (description, color) => new EmbedBuilder()
                .setAuthor({ name: displayName, iconURL: avatarURL })
                .setDescription(description)
                .setFooter({ text: 'Envoyé par ' + interaction.user.displayName, iconURL: interaction.user.displayAvatarURL({ extension: 'png', size: 128 }) })
                .setColor(color);

            try {
                getOrCreateUser(user.id, user.username);
                const todayTimestamp = parisDayStartMs();
                db.prepare(`
                    UPDATE users
                    SET streak = ?, last_streak_timestamp = ?, streak_lost_timestamp = 0, previous_streak = 0
                    WHERE id = ?
                `).run(days, todayTimestamp, user.id);

                let rewardMessage = '';
                if (shouldGiveReward) {
                    try {
                        const { grantStreakReward } = require('../../utils/streak-system');
                        const reward = await grantStreakReward(interaction.client, user.id, days);
                        if (reward.stars > 0) {
                            rewardMessage = `\n\n🎁 Récompense accordée : **${reward.stars.toLocaleString('fr-FR')} stars**.`;
                        } else if (reward.item) {
                            const itemName = reward.item === 'coffre_normal' ? 'Coffre Bonus' : reward.item;
                            rewardMessage = `\n\n🎁 Récompense accordée : **${itemName}**.`;
                        } else {
                            rewardMessage = '\n\nℹ️ Aucune récompense n’est prévue pour ce palier.';
                        }
                    } catch (rewardError) {
                        logger.error(`Erreur lors de l'attribution de la récompense de streak pour ${user.id}:`, rewardError);
                        rewardMessage = '\n\n⚠️ La streak a été définie, mais la récompense n’a pas pu être attribuée.';
                    }
                }

                let successEmbed;

                if (days === 0) {
                    successEmbed = createStreakEmbed(
                        `✅ La streak de ${user} a été réinitialisée à **${days} jours**.${rewardMessage}`,
                        0x2ecc71,
                    );
                }
                else {
                    const dayText = days === 1 ? 'jour' : 'jours';
                    successEmbed = createStreakEmbed(
                        `✅ La streak de ${user} a été définie à **${days} ${dayText}**.${rewardMessage}`,
                        0x2ecc71,
                    );
                }
                const publishButton = new ButtonBuilder()
                    .setCustomId(`publish_streak_${interaction.id}`)
                    .setLabel('Envoyer publiquement')
                    .setStyle(ButtonStyle.Secondary);
                const publishedButton = new ButtonBuilder()
                    .setCustomId(`published_streak_${interaction.id}`)
                    .setLabel('Embed envoyé publiquement')
                    .setStyle(ButtonStyle.Secondary)
                    .setDisabled(true);
                const response = await interaction.reply({
                    embeds: [successEmbed],
                    components: [new ActionRowBuilder().addComponents(publishButton)],
                    flags: MessageFlags.Ephemeral
                });

                const collector = response.createMessageComponentCollector({
                    componentType: ComponentType.Button,
                    time: 120_000,
                });
                collector.on('collect', async buttonInteraction => {
                    if (buttonInteraction.user.id !== interaction.user.id) {
                        return buttonInteraction.reply({
                            content: 'Seul l’administrateur ayant lancé la commande peut publier cet embed.',
                            flags: MessageFlags.Ephemeral,
                        });
                    }

                    await buttonInteraction.deferUpdate();
                    try {
                        await interaction.channel.send({
                            embeds: [successEmbed],
                            allowedMentions: { parse: [] },
                        });
                        await interaction.editReply({
                            embeds: [successEmbed],
                            components: [new ActionRowBuilder().addComponents(publishedButton)],
                            allowedMentions: { parse: [] },
                        });
                    } catch (error) {
                        logger.error(`Erreur lors de la publication de la streak pour ${user.id}:`, error);
                        await interaction.editReply({
                            embeds: [createStreakEmbed(`❌ Impossible d’envoyer l’embed publiquement dans ce salon.\n\n\`\`\`\n${error.message}\n\`\`\``, 0xe74c3c)],
                            components: [],
                        }).catch(() => {});
                    }
                    collector.stop();
                });
                collector.on('end', (_collected, reason) => {
                    if (reason === 'time') {
                        interaction.editReply({ components: [] }).catch(() => {});
                    }
                });

                return response;
            } catch (error) {
                logger.error(`Erreur set-streak pour ${user.id}:`, error);
                return interaction.reply({
                    embeds: [createStreakEmbed(`❌ Erreur lors de la définition de la streak.\n\n\`\`\`\n${error.message}\n\`\`\``, 0xe74c3c)],
                    flags: MessageFlags.Ephemeral
                });
            }
        }

        else if (subcommand === 'transferer-compte') {
            const sourceUser = interaction.options.getUser('source');
            const targetUser = interaction.options.getUser('cible');

            if (sourceUser.id === targetUser.id) {
                return interaction.reply({ content: '❌ La source et la cible doivent être différentes.', ephemeral: true });
            }

            const confirmButton = new ButtonBuilder()
                .setCustomId('transfer_confirm')
                .setLabel('✅ CONFIRMER LE TRANSFERT')
                .setStyle(ButtonStyle.Danger);

            const cancelButton = new ButtonBuilder()
                .setCustomId('transfer_cancel')
                .setLabel('❌ Annuler')
                .setStyle(ButtonStyle.Secondary);

            const row = new ActionRowBuilder().addComponents(confirmButton, cancelButton);

            const reply = await interaction.reply({
                content: `⚠️ **ATTENTION : TRANSFERT DE COMPTE** ⚠️\n\nVous êtes sur le point de transférer les données de **${sourceUser.tag}** vers **${targetUser.tag}**.\n\n**Conséquences :**\n1. Toutes les données actuelles de **${targetUser.tag}** (cible) seront **SUPPRIMÉES**.\n2. Les données de **${sourceUser.tag}** (source) seront copiées sur **${targetUser.tag}**.\n3. Le compte **${sourceUser.tag}** (source) sera **RÉINITIALISÉ**.\n\nCette action est **IRRÉVERSIBLE**.\nÊtes-vous sûr de vouloir continuer ?`,
                components: [row],
                fetchReply: true
            });

            const collector = reply.createMessageComponentCollector({
                componentType: ComponentType.Button,
                time: 60000
            });

            collector.on('collect', async (i) => {
                if (i.user.id !== interaction.user.id) {
                    return i.reply({ content: '❌ Seul l\'administrateur ayant lancé la commande peut confirmer.', ephemeral: true });
                }

                if (i.customId === 'transfer_confirm') {
                    try {
                        await i.deferUpdate();
                        transferUserData(sourceUser.id, targetUser.id);
                        await updateUserRank(interaction.client, targetUser.id);

                        await i.editReply({
                            content: `✅ **Transfert réussi !**\n\nLes données de ${sourceUser} ont été transférées vers ${targetUser}.\nLe compte source a été réinitialisé.`,
                            components: []
                        });
                    } catch (error) {
                        logger.error(`Erreur lors du transfert de compte de ${sourceUser.id} vers ${targetUser.id}:`, error);
                        await i.editReply({
                            content: `❌ Une erreur est survenue lors du transfert : ${error.message}`,
                            components: []
                        });
                    }
                    collector.stop();
                } else if (i.customId === 'transfer_cancel') {
                    await i.update({
                        content: '❌ Transfert annulée.',
                        components: []
                    });
                    collector.stop();
                }
            });

            collector.on('end', (collected, reason) => {
                if (reason === 'time') {
                    interaction.editReply({
                        content: '⏱️ Temps écoulé. Le transfert a été annulé.',
                        components: []
                    }).catch(() => { });
                }
            });
        }
        // ============================================
        // SUBCOMMAND: cree-guilde
        // ============================================
        else if (subcommand === 'cree-guilde') {
            // Créer le modal V2 avec format JSON brut (type 18 = Label, type 5 = UserSelect, type 4 = TextInput)
            // Note: Discord limite les modals à 5 composants maximum
            const modalData = {
                title: '🏰 Création de Guilde (Admin)',
                custom_id: 'admin_create_guild_modal',
                components: [
                    {
                        type: 18, // Label container
                        label: '👑 Chef de guilde (obligatoire)',
                        component: {
                            type: 5, // USER_SELECT
                            custom_id: 'guild_chef',
                            placeholder: 'Sélectionner le chef',
                            max_values: 1,
                            min_values: 1
                        }
                    },
                    {
                        type: 18, // Label container
                        label: '⚔️ Sous-Chef (optionnel)',
                        required: false,
                        component: {
                            type: 5, // USER_SELECT
                            custom_id: 'guild_souschef',
                            placeholder: 'Sélectionner un sous-chef',
                            max_values: 1
                        }
                    },
                    {
                        type: 18, // Label container
                        label: '👥 Membres (optionnel, max 10)',
                        required: false,
                        component: {
                            type: 5, // USER_SELECT
                            custom_id: 'guild_membres',
                            placeholder: 'Sélectionner les membres',
                            max_values: 10
                        }
                    },
                    {
                        type: 18, // Label container
                        label: '📝 Emoji + Nom (ex: 💀 Ma Guilde)',
                        component: {
                            type: 4, // TEXT_INPUT
                            custom_id: 'guild_emoji_nom',
                            style: 1, // Short
                            placeholder: '⚔️ Les Conquérants',
                            min_length: 3,
                            max_length: 35,
                            required: true
                        }
                    },
                    {
                        type: 18, // Label container
                        label: '⬆️ Niveau d\'upgrade (0-10, optionnel)',
                        required: false,
                        component: {
                            type: 4, // TEXT_INPUT
                            custom_id: 'guild_upgrade',
                            style: 1, // Short
                            placeholder: '0',
                            max_length: 2
                        }
                    }
                ]
            };

            await interaction.showModal(modalData);

            try {
                const modalSubmit = await interaction.awaitModalSubmit({
                    time: 300_000, // 5 minutes
                    filter: (submission) => submission.customId === 'admin_create_guild_modal' && submission.user.id === interaction.user.id
                });

                await modalSubmit.deferReply({ ephemeral: true });

                // Récupérer les valeurs du modal V2
                let chefId, sousChefId, membresIds, guildName, guildEmoji, upgradeStr;

                try {
                    // UserSelect values sont dans .values[], TextInput values sont dans .value
                    chefId = modalSubmit.fields.fields.get('guild_chef')?.values?.[0];
                    sousChefId = modalSubmit.fields.fields.get('guild_souschef')?.values?.[0] || null;
                    membresIds = modalSubmit.fields.fields.get('guild_membres')?.values || [];

                    // Parse le champ combiné "emoji nom" - l'emoji est au début
                    const emojiNomRaw = modalSubmit.fields.fields.get('guild_emoji_nom')?.value || '';

                    // Regex pour détecter les emojis au début du texte (Unicode emoji pattern)
                    const emojiRegex = /^(\p{Emoji_Presentation}|\p{Emoji}\uFE0F?)/u;
                    const emojiMatch = emojiNomRaw.match(emojiRegex);

                    if (emojiMatch) {
                        guildEmoji = emojiMatch[0];
                        guildName = emojiNomRaw.slice(emojiMatch[0].length).trim();
                    } else {
                        // Pas d'emoji trouvé - utiliser un placeholder
                        guildEmoji = '🏰';
                        guildName = emojiNomRaw.trim();
                    }

                    // Upgrade séparé
                    upgradeStr = modalSubmit.fields.fields.get('guild_upgrade')?.value || '0';
                } catch (err) {
                    logger.error('Erreur lors de la récupération des champs du modal:', err);
                    return modalSubmit.editReply({ content: '❌ Erreur lors de la récupération des données du modal.' });
                }

                // Validation du chef
                if (!chefId) {
                    return modalSubmit.editReply({ content: '❌ Vous devez sélectionner un **Chef** pour créer une guilde.' });
                }

                // Vérifier si le chef est déjà dans une guilde
                const chefGuild = getGuildOfUser(chefId);
                if (chefGuild) {
                    return modalSubmit.editReply({
                        content: `❌ **Création annulée !**\n\nLe chef sélectionné (<@${chefId}>) est déjà membre de la guilde **${chefGuild.name}**.\n\nLe chef doit d'abord quitter sa guilde actuelle.`
                    });
                }

                // Validation du nom
                if (!guildName || guildName.length < 2) {
                    return modalSubmit.editReply({ content: '❌ Le nom de la guilde doit contenir au moins 2 caractères (après l\'emoji).' });
                }

                // Vérifier si le nom est déjà pris
                if (getGuildByName(guildName)) {
                    return modalSubmit.editReply({ content: `❌ Une guilde avec le nom **${guildName}** existe déjà.` });
                }

                const upgradeLevel = Math.min(10, Math.max(0, parseInt(upgradeStr) || 0));

                // Créer la guilde
                const newGuildId = createGuild(guildName, chefId, guildEmoji);

                // S'assurer que le chef existe dans la DB users
                const chefDiscord = await interaction.client.users.fetch(chefId).catch(() => null);
                if (chefDiscord) {
                    getOrCreateUser(chefId, chefDiscord.username);
                }

                // Ajouter le chef comme membre
                addMemberToGuild(chefId, newGuildId);

                // Configurer la guilde en fonction du niveau d'upgrade
                // Calculer les slots totaux (5 de base + cumul des slots_gained pour chaque niveau)
                let totalSlots = 5; // Slots de base
                let treasuryCapacity = 0;

                for (let lvl = 1; lvl <= upgradeLevel; lvl++) {
                    const upgradeData = UPGRADE_MATRIX[lvl];
                    if (upgradeData) {
                        totalSlots += upgradeData.slots_gained || 0;
                        treasuryCapacity = upgradeData.treasury_capacity || treasuryCapacity;
                    }
                }

                // Mettre à jour la guilde avec tous les paramètres
                db.prepare('UPDATE guilds SET upgrade_level = ?, member_slots = ?, treasury_capacity = ? WHERE id = ?')
                    .run(upgradeLevel, totalSlots, treasuryCapacity, newGuildId);

                logger.info(`Guilde ${guildName} initialisée: upgrade=${upgradeLevel}, slots=${totalSlots}, treasury_cap=${treasuryCapacity}`);

                // Traitement des erreurs pour les membres déjà dans une guilde
                const membresAjoutes = [];
                const membresErreur = [];

                // Ajouter le sous-chef si spécifié
                if (sousChefId && sousChefId !== chefId) {
                    const sousChefGuild = getGuildOfUser(sousChefId);
                    if (sousChefGuild) {
                        membresErreur.push({ id: sousChefId, reason: `déjà dans la guilde "${sousChefGuild.name}"` });
                    } else {
                        const sousChefDiscord = await interaction.client.users.fetch(sousChefId).catch(() => null);
                        if (sousChefDiscord) {
                            getOrCreateUser(sousChefId, sousChefDiscord.username);
                        }
                        addMemberToGuild(sousChefId, newGuildId);
                        addGuildSubChief(newGuildId, sousChefId);
                        membresAjoutes.push(sousChefId);
                    }
                }

                // Ajouter les membres
                for (const membreId of membresIds) {
                    if (membreId === chefId || membreId === sousChefId) continue;

                    const membreGuild = getGuildOfUser(membreId);
                    if (membreGuild) {
                        membresErreur.push({ id: membreId, reason: `déjà dans la guilde "${membreGuild.name}"` });
                    } else {
                        const membreDiscord = await interaction.client.users.fetch(membreId).catch(() => null);
                        if (membreDiscord) {
                            getOrCreateUser(membreId, membreDiscord.username);
                        }
                        addMemberToGuild(membreId, newGuildId);
                        membresAjoutes.push(membreId);
                    }
                }

                // Mettre à jour le niveau de la guilde (somme des niveaux des membres)
                updateGuildLevel(newGuildId);

                // Récupérer les infos de la guilde après mise à jour
                const createdGuild = getGuildById(newGuildId);
                const guildLevel = createdGuild?.level || 0;

                // Construire le message de résultat
                let resultMessage = `# ✅ Guilde créée avec succès !\n\n`;
                resultMessage += `**${guildEmoji} ${guildName}**\n`;
                resultMessage += `• **Chef:** <@${chefId}>\n`;
                if (sousChefId && !membresErreur.find(e => e.id === sousChefId)) {
                    resultMessage += `• **Sous-Chef:** <@${sousChefId}>\n`;
                }
                resultMessage += `\n### 📊 Statistiques\n`;
                resultMessage += `• **Niveau de guilde:** ${guildLevel}\n`;
                resultMessage += `• **Upgrade:** Niveau ${upgradeLevel}\n`;
                resultMessage += `• **Places:** ${totalSlots}\n`;
                resultMessage += `• **Capacité trésorerie:** ${treasuryCapacity > 0 ? treasuryCapacity.toLocaleString('fr-FR') + ' ⭐' : 'Non débloquée (< U2)'}\n`;
                resultMessage += `• **Membres ajoutés:** ${membresAjoutes.length + 1}/${totalSlots}\n`;

                if (membresErreur.length > 0) {
                    resultMessage += `\n### ⚠️ Membres non ajoutés\n`;
                    for (const err of membresErreur) {
                        resultMessage += `• <@${err.id}> - ${err.reason}\n`;
                    }
                }

                await modalSubmit.editReply({ content: resultMessage });

            } catch (modalError) {
                if (modalError.code === 'InteractionCollectorError') {
                    // Modal timeout - pas besoin de répondre car l'utilisateur n'a rien soumis
                    logger.info('Modal cree-guilde timeout');
                } else {
                    logger.error('Erreur lors de la création de guilde (modal):', modalError);
                    try {
                        await interaction.followUp({
                            content: `❌ Une erreur est survenue: ${modalError.message}`,
                            ephemeral: true
                        });
                    } catch (e) { }
                }
            }
        }

        // ============================================
        // SUBCOMMAND: guilde-fix
        // ============================================
        else if (subcommand === 'guilde-fix') {
            const guildeName = interaction.options.getString('guilde');
            const upgradeLevel = interaction.options.getInteger('upgrade');

            // Récupérer la guilde
            const guild = getGuildByName(guildeName);
            if (!guild) {
                return interaction.reply({
                    content: `❌ Guilde **${guildeName}** introuvable.`,
                    ephemeral: true
                });
            }

            // Calculer les slots totaux (5 de base + cumul des slots_gained pour chaque niveau)
            let totalSlots = 5; // Slots de base
            let treasuryCapacity = 0;

            for (let lvl = 1; lvl <= upgradeLevel; lvl++) {
                const upgradeData = UPGRADE_MATRIX[lvl];
                if (upgradeData) {
                    totalSlots += upgradeData.slots_gained || 0;
                    treasuryCapacity = upgradeData.treasury_capacity || treasuryCapacity;
                }
            }

            // Mettre à jour la guilde avec tous les paramètres
            db.prepare('UPDATE guilds SET upgrade_level = ?, member_slots = ?, treasury_capacity = ? WHERE id = ?')
                .run(upgradeLevel, totalSlots, treasuryCapacity, guild.id);

            // Recalculer le niveau de guilde
            updateGuildLevel(guild.id);

            // Récupérer les infos mises à jour
            const updatedGuild = getGuildById(guild.id);

            logger.info(`Guilde ${guild.name} corrigée: upgrade=${upgradeLevel}, slots=${totalSlots}, treasury_cap=${treasuryCapacity}`);

            await interaction.reply({
                content: `# ✅ Guilde corrigée !\n\n**${guild.emoji} ${guild.name}**\n\n### 📊 Nouveaux paramètres\n• **Upgrade:** Niveau ${upgradeLevel}\n• **Places:** ${totalSlots}\n• **Capacité trésorerie:** ${treasuryCapacity > 0 ? treasuryCapacity.toLocaleString('fr-FR') + ' ⭐' : 'Non débloquée (< U2)'}\n• **Niveau de guilde:** ${updatedGuild?.level || 0}`,
                ephemeral: true
            });
        }

        // ============================================
        // SUBCOMMAND: guilde-war-fix
        // ============================================
        else if (subcommand === 'guilde-war-fix') {
            const guildeName = interaction.options.getString('guilde');
            const resetPoints = interaction.options.getBoolean('reset-points') || false;
            const addHours = interaction.options.getInteger('ajouter-heures') || 0;

            // Récupérer la guilde
            const guild = getGuildByName(guildeName);
            if (!guild) {
                return interaction.reply({
                    content: `❌ Guilde **${guildeName}** introuvable.`,
                    ephemeral: true
                });
            }

            // Trouver la guerre en cours
            const war = db.prepare("SELECT * FROM guild_wars WHERE (guild1_id = ? OR guild2_id = ?) AND (status = 'ongoing' OR status = 'overtime')").get(guild.id, guild.id);
            if (!war) {
                return interaction.reply({
                    content: `❌ La guilde **${guild.name}** n'est pas en guerre actuellement.`,
                    ephemeral: true
                });
            }

            const guild1 = getGuildById(war.guild1_id);
            const guild2 = getGuildById(war.guild2_id);

            let resultMessage = `# ⚔️ Guerre corrigée !\n\n**${guild1?.emoji || '🛡️'} ${guild1?.name}** VS **${guild2?.emoji || '🛡️'} ${guild2?.name}**\n\n`;

            // Reset des points
            if (resetPoints) {
                // Récupérer tous les membres de la guerre
                const warMembers = db.prepare('SELECT * FROM guild_war_members WHERE war_id = ?').all(war.id);

                for (const member of warMembers) {
                    const user = db.prepare('SELECT xp, points, stars, points_comptage FROM users WHERE id = ?').get(member.user_id);
                    if (user) {
                        // Recapturer les valeurs actuelles comme nouvelles valeurs initiales et remettre war_points à 0
                        db.prepare('UPDATE guild_war_members SET initial_xp = ?, initial_points = ?, initial_stars = ?, initial_pc = ?, war_points = 0 WHERE war_id = ? AND user_id = ?')
                            .run(user.xp, user.points, user.stars, user.points_comptage || 0, war.id, member.user_id);
                    }
                }

                resultMessage += `### ✅ Points réinitialisés\n`;
                resultMessage += `• Les valeurs initiales ont été recapturées\n`;
                resultMessage += `• Les deux guildes sont maintenant à **0 points**\n\n`;

                logger.info(`War ${war.id} points reset by ${interaction.user.tag}`);
            }

            // Ajout de temps
            if (addHours > 0) {
                const additionalMs = addHours * 60 * 60 * 1000;
                const newEndTime = war.end_time + additionalMs;
                db.prepare('UPDATE guild_wars SET end_time = ? WHERE id = ?').run(newEndTime, war.id);

                resultMessage += `### ⏱️ Temps ajouté\n`;
                resultMessage += `• **+${addHours} heure(s)** ajoutée(s)\n`;
                resultMessage += `• Nouvelle fin: <t:${Math.floor(newEndTime / 1000)}:F>\n`;

                logger.info(`War ${war.id} extended by ${addHours}h by ${interaction.user.tag}`);
            }

            if (!resetPoints && !addHours) {
                resultMessage += `⚠️ Aucune modification effectuée. Utilisez \`reset-points:true\` et/ou \`ajouter-heures:N\`.`;
            }

            await interaction.reply({
                content: resultMessage,
                ephemeral: true
            });
        }

        // ============================================
        // SUBCOMMAND: guilde-victoires
        // ============================================
        else if (subcommand === 'guilde-victoires') {
            const guildeName = interaction.options.getString('guilde');
            const addVictoires = interaction.options.getInteger('victoires') || 0;
            const addVictoires70 = interaction.options.getInteger('victoires-70') || 0;
            const addVictoires80 = interaction.options.getInteger('victoires-80') || 0;
            const addVictoires90 = interaction.options.getInteger('victoires-90') || 0;

            // Récupérer la guilde
            const guild = getGuildByName(guildeName);
            if (!guild) {
                return interaction.reply({
                    content: `❌ Guilde **${guildeName}** introuvable.`,
                    ephemeral: true
                });
            }

            // Vérifier qu'au moins une option est spécifiée
            if (addVictoires === 0 && addVictoires70 === 0 && addVictoires80 === 0 && addVictoires90 === 0) {
                return interaction.reply({
                    content: `❌ Vous devez spécifier au moins une option (victoires, victoires-70, victoires-80 ou victoires-90).`,
                    ephemeral: true
                });
            }

            // Mettre à jour les compteurs
            if (addVictoires > 0) {
                db.prepare('UPDATE guilds SET wars_won = wars_won + ? WHERE id = ?').run(addVictoires, guild.id);
            }
            if (addVictoires70 > 0) {
                db.prepare('UPDATE guilds SET wars_won_70 = wars_won_70 + ? WHERE id = ?').run(addVictoires70, guild.id);
            }
            if (addVictoires80 > 0) {
                db.prepare('UPDATE guilds SET wars_won_80 = wars_won_80 + ? WHERE id = ?').run(addVictoires80, guild.id);
            }
            if (addVictoires90 > 0) {
                db.prepare('UPDATE guilds SET wars_won_90 = wars_won_90 + ? WHERE id = ?').run(addVictoires90, guild.id);
            }

            // Récupérer les valeurs mises à jour
            const updatedGuild = getGuildById(guild.id);

            let resultMessage = `# ✅ Victoires ajoutées !\n\n`;
            resultMessage += `**${guild.emoji || '🏰'} ${guild.name}**\n\n`;
            resultMessage += `### 📊 Modifications\n`;
            if (addVictoires > 0) resultMessage += `• **+${addVictoires}** victoire(s) (total: ${updatedGuild.wars_won})\n`;
            if (addVictoires70 > 0) resultMessage += `• **+${addVictoires70}** victoire(s) 70%+ (total: ${updatedGuild.wars_won_70})\n`;
            if (addVictoires80 > 0) resultMessage += `• **+${addVictoires80}** victoire(s) 80%+ (total: ${updatedGuild.wars_won_80})\n`;
            if (addVictoires90 > 0) resultMessage += `• **+${addVictoires90}** victoire(s) 90%+ (total: ${updatedGuild.wars_won_90})\n`;

            logger.info(`Admin ${interaction.user.tag} added victories to guild ${guild.name}: wars_won+${addVictoires}, 70%+${addVictoires70}, 80%+${addVictoires80}, 90%+${addVictoires90}`);

            await interaction.reply({
                content: resultMessage,
                ephemeral: true
            });
        }

        // ============================================
        // SUBCOMMAND: guilde-war-supprimer
        // ============================================
        else if (subcommand === 'guilde-war-supprimer') {
            const { getAllActiveWars, deleteWar: deleteWarFn } = require('../../utils/guild/guild-wars');
            const { wars, declarations } = getAllActiveWars();

            if (wars.length === 0 && declarations.length === 0) {
                return interaction.reply({
                    content: '❌ Aucune guerre en cours ni déclaration en attente à supprimer.',
                    ephemeral: true
                });
            }

            // Construire les options du sélecteur
            const options = [];

            for (const war of wars) {
                const statusText = war.status === 'overtime' ? '⏰ Overtime' : '⚔️ En cours';
                const durationText = war.duration_type === 'short' ? '12h' : war.duration_type === 'normal' ? '48h' : '7j';
                options.push({
                    label: `${war.guild1_name} VS ${war.guild2_name}`,
                    description: `${statusText} | ${durationText} | Fin: ${new Date(war.end_time).toLocaleDateString('fr-FR')} ${new Date(war.end_time).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`,
                    value: `war_${war.id}`,
                    emoji: '⚔️'
                });
            }

            for (const decl of declarations) {
                const durationText = decl.duration_type === 'short' ? '12h' : decl.duration_type === 'normal' ? '48h' : '7j';
                options.push({
                    label: `${decl.from_guild_name} → ${decl.to_guild_name} (Déclaration)`,
                    description: `📩 En attente | ${durationText} | ${new Date(decl.timestamp).toLocaleDateString('fr-FR')}`,
                    value: `decl_${decl.id}`,
                    emoji: '📩'
                });
            }

            const selectMenu = new StringSelectMenuBuilder()
                .setCustomId('admin_delete_war_select')
                .setPlaceholder('Sélectionner la guerre à supprimer...')
                .addOptions(options.slice(0, 25));

            const row = new ActionRowBuilder().addComponents(selectMenu);

            const reply = await interaction.reply({
                content: `## 🗑️ Supprimer une guerre\n\nSélectionnez la guerre ou déclaration à supprimer.\n⚠️ **Cette action est irréversible** — aucun résultat ne sera appliqué.\n\n**${wars.length}** guerre(s) en cours, **${declarations.length}** déclaration(s) en attente.`,
                components: [row],
                ephemeral: true,
                fetchReply: true
            });

            const collector = reply.createMessageComponentCollector({
                componentType: ComponentType.StringSelect,
                time: 60000
            });

            collector.on('collect', async (selectInteraction) => {
                if (selectInteraction.user.id !== interaction.user.id) {
                    return selectInteraction.reply({ content: '❌ Seul l\'administrateur ayant lancé la commande peut sélectionner.', ephemeral: true });
                }

                const selectedValue = selectInteraction.values[0];
                const [type, id] = selectedValue.split('_');
                const warId = parseInt(id);

                // Déterminer le label pour la confirmation
                let warLabel;
                if (type === 'war') {
                    const war = wars.find(w => w.id === warId);
                    warLabel = `⚔️ Guerre **${war.guild1_emoji} ${war.guild1_name}** VS **${war.guild2_emoji} ${war.guild2_name}** (#${warId})`;
                } else {
                    const decl = declarations.find(d => d.id === warId);
                    warLabel = `📩 Déclaration **${decl.from_guild_emoji} ${decl.from_guild_name}** → **${decl.to_guild_emoji} ${decl.to_guild_name}** (#${warId})`;
                }

                // Boutons de confirmation
                const confirmButton = new ButtonBuilder()
                    .setCustomId('confirm_delete_war')
                    .setLabel('🗑️ SUPPRIMER')
                    .setStyle(ButtonStyle.Danger);

                const cancelButton = new ButtonBuilder()
                    .setCustomId('cancel_delete_war')
                    .setLabel('Annuler')
                    .setStyle(ButtonStyle.Secondary);

                const confirmRow = new ActionRowBuilder().addComponents(confirmButton, cancelButton);

                await selectInteraction.update({
                    content: `## ⚠️ Confirmer la suppression\n\n${warLabel}\n\nCette action va **supprimer définitivement** cette ${type === 'war' ? 'guerre et toutes ses données (points, membres)' : 'déclaration de guerre'} sans appliquer aucun résultat.\n\n**Êtes-vous sûr ?**`,
                    components: [confirmRow]
                });

                const buttonCollector = reply.createMessageComponentCollector({
                    componentType: ComponentType.Button,
                    time: 30000
                });

                buttonCollector.on('collect', async (btnInteraction) => {
                    if (btnInteraction.user.id !== interaction.user.id) {
                        return btnInteraction.reply({ content: '❌ Seul l\'administrateur ayant lancé la commande peut confirmer.', ephemeral: true });
                    }

                    if (btnInteraction.customId === 'confirm_delete_war') {
                        try {
                            deleteWarFn(warId, type === 'decl' ? 'declaration' : 'war');

                            await btnInteraction.update({
                                content: `## ✅ Suppression effectuée\n\n${warLabel}\n\nLa ${type === 'war' ? 'guerre' : 'déclaration'} a été supprimée avec succès.`,
                                components: []
                            });

                            logger.info(`Admin ${interaction.user.tag} deleted ${type === 'war' ? 'war' : 'declaration'} #${warId}`);
                        } catch (error) {
                            logger.error(`Erreur lors de la suppression de la guerre #${warId}:`, error);
                            await btnInteraction.update({
                                content: `❌ Erreur lors de la suppression : ${error.message}`,
                                components: []
                            });
                        }
                    } else if (btnInteraction.customId === 'cancel_delete_war') {
                        await btnInteraction.update({
                            content: '❌ Suppression annulée.',
                            components: []
                        });
                    }

                    buttonCollector.stop();
                    collector.stop();
                });

                buttonCollector.on('end', (collected, reason) => {
                    if (reason === 'time' && collected.size === 0) {
                        interaction.editReply({
                            content: '⏱️ Temps écoulé. Suppression annulée.',
                            components: []
                        }).catch(() => { });
                    }
                });
            });

            collector.on('end', (collected, reason) => {
                if (reason === 'time' && collected.size === 0) {
                    interaction.editReply({
                        content: '⏱️ Temps écoulé. Suppression annulée.',
                        components: []
                    }).catch(() => { });
                }
            });
        }

        // ============================================
        // SUBCOMMAND: reset-profil
        // ============================================
        if (subcommand === 'reset-profil') {
            const targetUser = interaction.options.getUser('membre');
            const { resetUser } = require('../../utils/db-users');

            // Vérifier si l'utilisateur existe dans la DB avant de demander confirmation
            getOrCreateUser(targetUser.id, targetUser.username);

            const confirmButton = new ButtonBuilder()
                .setCustomId('confirm_reset')
                .setLabel('Oui, réinitialiser')
                .setStyle(ButtonStyle.Danger);

            const cancelButton = new ButtonBuilder()
                .setCustomId('cancel_reset')
                .setLabel('Non, annuler')
                .setStyle(ButtonStyle.Secondary);

            const row = new ActionRowBuilder().addComponents(confirmButton, cancelButton);

            const response = await interaction.reply({
                content: `⚠️ **ATTENTION** ⚠️\n\nÊtes-vous sûr de vouloir réinitialiser complètement le profil de **${targetUser.username}** ?\n\n**Cette action est irréversible** et supprimera:\n• Niveau et XP\n• Points de rang\n• Starss\n• Inventaire\n• Quêtes\n• Statistiques d'événements`,
                components: [row],
                flags: 64,
            });

            const collector = response.createMessageComponentCollector({
                componentType: ComponentType.Button,
                time: 60 * 1000, // 60 secondes pour confirmer
            });

            collector.on('collect', async i => {
                if (i.user.id !== interaction.user.id) {
                    await i.reply({ content: 'Vous ne pouvez pas interagir avec cette confirmation.', flags: 64 });
                    return;
                }

                if (i.customId === 'confirm_reset') {
                    resetUser(targetUser.id);
                    logger.info(`Admin ${interaction.user.tag} reset profile of ${targetUser.tag}`);
                    await i.update({ content: `✅ Le profil de **${targetUser.username}** a été complètement réinitialisé.`, components: [] });
                } else if (i.customId === 'cancel_reset') {
                    await i.update({ content: '❌ Réinitialisation annulée.', components: [] });
                }
                collector.stop();
            });

            collector.on('end', (collected, reason) => {
                if (reason === 'time') {
                    response.edit({ content: '⏱️ Confirmation expirée. Réinitialisation annulée.', components: [] }).catch(() => { });
                }
            });
        }
    }
};
