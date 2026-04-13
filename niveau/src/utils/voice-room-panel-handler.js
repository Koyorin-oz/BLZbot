const {
    PermissionFlagsBits,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    ActionRowBuilder,
} = require('discord.js');
const logger = require('./logger');
const {
    getPrivateRoomStaffRoleId,
    parseVoicePanelButtonId,
    parseVoicePanelModalId,
    parseVocPanelOpenId,
    buildPrivateVoicePanelPayload,
} = require('./voice-room-panel');
const { buildOverwrites, getPrivateRoomVoiceMeta } = require('./private-voice-rooms');

function sessionKey(guildId, userId) {
    return `${guildId}:${userId}`;
}

/**
 * @param {import('discord.js').ButtonInteraction} interaction
 */
function canUseVoicePanel(interaction, voiceChannelId, restricted) {
    const member = interaction.member;
    if (!member || !interaction.guild) return false;
    if (member.permissions.has(PermissionFlagsBits.Administrator)) return true;

    const meta = getPrivateRoomVoiceMeta(interaction.client, voiceChannelId);
    if (!meta || meta.guildId !== interaction.guild.id) return false;

    const staffRole = getPrivateRoomStaffRoleId();
    const isStaff = member.roles.cache.has(staffRole);
    const isOwner = member.id === meta.ownerId;

    if (restricted) {
        return isOwner || isStaff;
    }

    // Panneau /panel-voc : tout membre du serveur peut utiliser les boutons (message posté dans un salon au choix).
    return true;
}

function sanitizeChannelName(raw) {
    return String(raw || '')
        .replace(/[\r\n\t]/g, ' ')
        .trim()
        .slice(0, 100);
}

/**
 * @param {import('discord.js').ButtonInteraction} interaction
 */
async function handleVoiceRoomPanelButton(interaction) {
    const parsed = parseVoicePanelButtonId(interaction.customId);
    if (!parsed) return;

    const { restricted, voiceChannelId, action } = parsed;
    const meta = getPrivateRoomVoiceMeta(interaction.client, voiceChannelId);

    if (!meta || meta.guildId !== interaction.guild?.id) {
        return interaction.reply({
            content: 'Ce salon vocal n’est plus géré par le bot ou n’existe pas.',
            flags: 64,
        });
    }

    if (!canUseVoicePanel(interaction, voiceChannelId, restricted)) {
        return interaction.reply({
            content: restricted
                ? 'Tu n’as pas accès à ce panneau (créateur du salon ou staff uniquement).'
                : 'Tu n’as pas accès à ce panneau (créateur du salon ou staff uniquement).',
            flags: 64,
        });
    }

    const guild = interaction.guild;
    const channel = await guild.channels.fetch(voiceChannelId).catch(() => null);
    if (!channel?.isVoiceBased?.()) {
        return interaction.reply({ content: 'Salon vocal introuvable.', flags: 64 });
    }

    const modeChar = parsed.mode === 'r' ? 'r' : parsed.mode === 'e' ? 'e' : 'p';
    const modalBase = (kind) => `pvrm:${modeChar}:${voiceChannelId}:${kind}`;

    try {
        switch (action) {
            case 'rename': {
                const modal = new ModalBuilder()
                    .setCustomId(modalBase('rename'))
                    .setTitle('Renommer le salon');
                modal.addComponents(
                    new ActionRowBuilder().addComponents(
                        new TextInputBuilder()
                            .setCustomId('pvr_input_name')
                            .setLabel('Nouveau nom du salon')
                            .setStyle(TextInputStyle.Short)
                            .setMinLength(1)
                            .setMaxLength(100)
                            .setRequired(true)
                    )
                );
                return interaction.showModal(modal);
            }
            case 'limit': {
                const modal = new ModalBuilder()
                    .setCustomId(modalBase('limit'))
                    .setTitle('Limite de places');
                modal.addComponents(
                    new ActionRowBuilder().addComponents(
                        new TextInputBuilder()
                            .setCustomId('pvr_input_limit')
                            .setLabel('Nombre de places (0 = illimité)')
                            .setStyle(TextInputStyle.Short)
                            .setPlaceholder('0 à 99')
                            .setRequired(true)
                    )
                );
                return interaction.showModal(modal);
            }
            case 'kick': {
                const modal = new ModalBuilder()
                    .setCustomId(modalBase('kick'))
                    .setTitle('Expulser du salon vocal');
                modal.addComponents(
                    new ActionRowBuilder().addComponents(
                        new TextInputBuilder()
                            .setCustomId('pvr_input_user')
                            .setLabel('ID Discord du membre')
                            .setStyle(TextInputStyle.Short)
                            .setRequired(true)
                    )
                );
                return interaction.showModal(modal);
            }
            case 'ban_room': {
                const modal = new ModalBuilder()
                    .setCustomId(modalBase('ban_room'))
                    .setTitle('Bannir du salon (ne plus voir / rejoindre)');
                modal.addComponents(
                    new ActionRowBuilder().addComponents(
                        new TextInputBuilder()
                            .setCustomId('pvr_input_user')
                            .setLabel('ID Discord du membre')
                            .setStyle(TextInputStyle.Short)
                            .setRequired(true)
                    )
                );
                return interaction.showModal(modal);
            }
            case 'transfer': {
                const modal = new ModalBuilder()
                    .setCustomId(modalBase('transfer'))
                    .setTitle('Transférer la propriété');
                modal.addComponents(
                    new ActionRowBuilder().addComponents(
                        new TextInputBuilder()
                            .setCustomId('pvr_input_user')
                            .setLabel('ID du nouveau propriétaire')
                            .setStyle(TextInputStyle.Short)
                            .setRequired(true)
                    )
                );
                return interaction.showModal(modal);
            }
            case 'lock': {
                await channel.permissionOverwrites.edit(guild.id, {
                    ViewChannel: true,
                    Connect: false,
                    Speak: true,
                });
                return interaction.reply({
                    content: 'Salon verrouillé : les membres ne peuvent plus rejoindre (sauf exceptions déjà définies).',
                    flags: 64,
                });
            }
            case 'unlock': {
                const ownerMember = await guild.members.fetch(meta.ownerId).catch(() => null);
                if (!ownerMember) {
                    return interaction.reply({
                        content: 'Impossible de retrouver le créateur pour rétablir les permissions.',
                        flags: 64,
                    });
                }
                await channel.permissionOverwrites.set(buildOverwrites(guild, ownerMember));
                return interaction.reply({ content: 'Permissions du salon réinitialisées (déverrouillé).', flags: 64 });
            }
            case 'invite': {
                const url = `https://discord.com/channels/${guild.id}/${channel.id}`;
                return interaction.reply({
                    content: `Lien vers le salon vocal :\n${url}`,
                    flags: 64,
                });
            }
            case 'disconnect_others': {
                let n = 0;
                for (const [, vm] of channel.members) {
                    if (vm.user.bot) continue;
                    if (vm.id === meta.ownerId) continue;
                    await vm.voice.disconnect().catch(() => null);
                    n += 1;
                }
                return interaction.reply({
                    content: n ? `${n} membre(s) déconnecté(s).` : 'Aucun autre membre à déconnecter.',
                    flags: 64,
                });
            }
            case 'delete': {
                await interaction.reply({ content: 'Salon en cours de suppression…', flags: 64 });
                await channel.delete('Panneau vocal privé — suppression').catch((e) => {
                    logger.warn(`[PVR_PANEL] delete: ${e.message}`);
                });
                return;
            }
            case 'timer':
            case 'permit':
            case 'ring':
            case 'region':
            case 'claim':
                return interaction.reply({
                    content: 'Cette option arrive bientôt.',
                    flags: 64,
                });
            default:
                return interaction.reply({ content: 'Action inconnue.', flags: 64 });
        }
    } catch (e) {
        logger.error('[PVR_PANEL] button', e);
        try {
            if (!interaction.replied && !interaction.deferred) {
                await interaction.reply({ content: 'Une erreur est survenue.', flags: 64 });
            } else if (interaction.deferred) {
                await interaction.editReply({ content: 'Une erreur est survenue.' });
            }
        } catch (_) {
            /* ignore */
        }
    }
}

/**
 * @param {import('discord.js').ModalSubmitInteraction} interaction
 */
async function handleVoiceRoomPanelModal(interaction) {
    const parsed = parseVoicePanelModalId(interaction.customId);
    if (!parsed) return;

    const { restricted, voiceChannelId, kind } = parsed;

    if (!canUseVoicePanel(interaction, voiceChannelId, restricted)) {
        return interaction.reply({
            content: 'Tu n’as plus la permission d’utiliser ce panneau.',
            flags: 64,
        });
    }

    const guild = interaction.guild;
    const meta = getPrivateRoomVoiceMeta(interaction.client, voiceChannelId);
    if (!meta || meta.guildId !== guild?.id) {
        return interaction.reply({ content: 'Ce salon n’est plus enregistré.', flags: 64 });
    }

    const channel = await guild.channels.fetch(voiceChannelId).catch(() => null);
    if (!channel?.isVoiceBased?.()) {
        return interaction.reply({ content: 'Salon vocal introuvable.', flags: 64 });
    }

    const sessions = interaction.client.privateRoomSessions;

    try {
        if (kind === 'rename') {
            const name = sanitizeChannelName(interaction.fields.getTextInputValue('pvr_input_name'));
            if (!name) {
                return interaction.reply({ content: 'Nom invalide.', flags: 64 });
            }
            await channel.setName(name, 'Panneau vocal privé — renommer');
            return interaction.reply({ content: `Salon renommé : **${name}**`, flags: 64 });
        }

        if (kind === 'limit') {
            const raw = interaction.fields.getTextInputValue('pvr_input_limit').trim();
            const n = parseInt(raw, 10);
            if (Number.isNaN(n) || n < 0 || n > 99) {
                return interaction.reply({ content: 'Entre un nombre entre 0 et 99 (0 = illimité).', flags: 64 });
            }
            await channel.setUserLimit(n, 'Panneau vocal privé — limite');
            return interaction.reply({
                content: n === 0 ? 'Limite retirée (illimité).' : `Limite fixée à **${n}** place(s).`,
                flags: 64,
            });
        }

        const userRaw = interaction.fields.getTextInputValue('pvr_input_user')?.trim() || '';
        if (!/^\d{17,22}$/.test(userRaw)) {
            return interaction.reply({ content: 'ID membre invalide.', flags: 64 });
        }

        if (kind === 'kick') {
            if (userRaw === meta.ownerId) {
                return interaction.reply({ content: 'Tu ne peux pas expulser le propriétaire ainsi.', flags: 64 });
            }
            const target = await guild.members.fetch(userRaw).catch(() => null);
            if (!target) {
                return interaction.reply({ content: 'Membre introuvable sur ce serveur.', flags: 64 });
            }
            if (target.voice?.channelId !== voiceChannelId) {
                return interaction.reply({ content: 'Ce membre n’est pas dans ce salon vocal.', flags: 64 });
            }
            await target.voice.disconnect().catch(() => null);
            return interaction.reply({ content: `${target} a été expulsé du vocal.`, flags: 64 });
        }

        if (kind === 'ban_room') {
            if (userRaw === meta.ownerId) {
                return interaction.reply({ content: 'Tu ne peux pas bannir le propriétaire du salon.', flags: 64 });
            }
            await channel.permissionOverwrites
                .edit(userRaw, {
                    ViewChannel: false,
                    Connect: false,
                    Speak: false,
                })
                .catch(() => null);
            const target = await guild.members.fetch(userRaw).catch(() => null);
            if (target?.voice?.channelId === voiceChannelId) {
                await target.voice.disconnect().catch(() => null);
            }
            return interaction.reply({
                content: 'Membre banni de ce salon (permissions mises à jour).',
                flags: 64,
            });
        }

        if (kind === 'transfer') {
            if (userRaw === meta.ownerId) {
                return interaction.reply({ content: 'Ce membre est déjà propriétaire.', flags: 64 });
            }
            const newOwner = await guild.members.fetch(userRaw).catch(() => null);
            if (!newOwner || newOwner.user.bot) {
                return interaction.reply({ content: 'Nouveau propriétaire introuvable ou invalide.', flags: 64 });
            }
            await channel.permissionOverwrites.set(buildOverwrites(guild, newOwner));

            if (sessions) {
                sessions.delete(sessionKey(guild.id, meta.ownerId));
                sessions.set(sessionKey(guild.id, newOwner.id), {
                    voiceChannelId,
                    ownerId: newOwner.id,
                });
            }
            interaction.client.privateRoomByVoiceId?.set(voiceChannelId, {
                guildId: guild.id,
                ownerId: newOwner.id,
            });

            return interaction.reply({
                content: `Propriété transférée à ${newOwner}.`,
                flags: 64,
            });
        }

        return interaction.reply({ content: 'Action inconnue.', flags: 64 });
    } catch (e) {
        logger.error('[PVR_PANEL] modal', e);
        return interaction.reply({ content: 'Une erreur est survenue.', flags: 64 });
    }
}

module.exports = {
    handleVoiceRoomPanelButton,
    handleVoiceRoomPanelModal,
    canUseVoicePanel,
};
