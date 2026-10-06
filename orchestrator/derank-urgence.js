
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionsBitField, ApplicationCommandOptionType, Routes, REST } = require('discord.js');

const EMERGENCY_ROLE_ID = '1172237685763608579';
const BASE_ROLE_ID = '1323240945235529748'; // Rôles au-dessus de celui-ci seront supprimés
const REQUIRED_APPROVALS = 3;
const COOLDOWN_DURATION = 60 * 60 * 1000; // 1 heure en millisecondes

const activeProposals = new Map();
let lastDerankTimestamp = 0;


function initialize(client) {
    // Enregistrer la commande au démarrage
    client.once('ready', () => {
       // registerDerankCommand(client); // La commande est maintenant enregistrée dans maintemp.js
    });

    client.on('interactionCreate', async interaction => {
        if (interaction.isChatInputCommand() && !interaction.guild) {
            return interaction.reply({
                embeds: [
                    new EmbedBuilder()
                        .setDescription('❌ Les commandes ne sont pas disponibles en message privé.')
                        .setColor(0xED4245)
                ],
                ephemeral: true,
            });
        }

        if (interaction.isChatInputCommand() && interaction.commandName === 'derank-urgence') {
            handleCommand(interaction);
        } else if (interaction.isButton() && (interaction.customId.startsWith('derank_approve') || interaction.customId.startsWith('derank_refuse'))) {
            handleButton(interaction);
        }
    });
}

async function handleCommand(interaction) {
    // 1. Vérifier les permissions de l\'initiateur
    if (!interaction.member.roles.cache.has(EMERGENCY_ROLE_ID)) {
        return interaction.reply({ content: 'Vous n\'avez pas la permission d\'utiliser cette commande.', ephemeral: true });
    }

    // 2. Vérifier le cooldown
    const now = Date.now();
    if (now - lastDerankTimestamp < COOLDOWN_DURATION) {
        const remainingTime = Math.ceil((COOLDOWN_DURATION - (now - lastDerankTimestamp)) / 60000);
        return interaction.reply({ content: `Cette commande est en cooldown. Veuillez attendre encore ${remainingTime} minute(s).`, ephemeral: true });
    }

    const targetUser = interaction.options.getUser('utilisateur');
    const targetMember = await interaction.guild.members.fetch(targetUser.id).catch(() => null);

    // 3. Valider la cible
    if (!targetMember) {
        return interaction.reply({ content: 'Cet utilisateur n\'est pas dans le serveur.', ephemeral: true });
    }
    if (targetUser.id === interaction.user.id) {
        return interaction.reply({ content: 'Vous ne pouvez pas vous cibler vous-même.', ephemeral: true });
    }
    if (targetUser.id === interaction.client.user.id) {
        return interaction.reply({ content: 'Vous ne pouvez pas me cibler.', ephemeral: true });
    }
    if (activeProposals.has(targetUser.id)) {
        return interaction.reply({ content: 'Une procédure de derank est déjà en cours pour cet utilisateur.', ephemeral: true });
    }

    // 4. Créer la proposition
    const proposal = {
        initiatorId: interaction.user.id,
        targetId: targetUser.id,
        approvers: [interaction.user.id],
        messageId: null,
        channelId: interaction.channelId,
    };
    activeProposals.set(targetUser.id, proposal);

    const embed = new EmbedBuilder()
        .setTitle('🚨 Procédure de Derank d\'Urgence 🚨')
        .setDescription(`Une procédure de derank d\'urgence a été lancée par <@${interaction.user.id}> contre <@${targetUser.id}>.`)
        .addFields(
            { name: 'Approbations requises', value: `${REQUIRED_APPROVALS}` },
            { name: 'Approbations actuelles', value: `1 (Initiateur)` },
            { name: 'Approuvé par', value: `<@${interaction.user.id}>` }
        )
        .setColor('Red')
        .setTimestamp();

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`derank_approve_${targetUser.id}`).setLabel('Approuver').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`derank_refuse_${targetUser.id}`).setLabel('Refuser').setStyle(ButtonStyle.Danger)
    );

    const message = await interaction.channel.send({ embeds: [embed], components: [row] });
    proposal.messageId = message.id;

    await interaction.reply({ content: `La procédure de derank d\'urgence contre <@${targetUser.id}> a été lancée.`, ephemeral: true });
}

async function handleButton(interaction) {
    const targetId = interaction.customId.split('_')[2];
    const proposal = activeProposals.get(targetId);

    if (!proposal) {
        return interaction.reply({ content: 'Cette procédure de derank n\'est plus active.', ephemeral: true });
    }

    // 1. Vérifier les permissions du votant
    if (!interaction.member.roles.cache.has(EMERGENCY_ROLE_ID)) {
        return interaction.reply({ content: 'Vous n\'avez pas la permission de voter.', ephemeral: true });
    }
    if (proposal.approvers.includes(interaction.user.id)) {
        return interaction.reply({ content: 'Vous avez déjà approuvé cette procédure.', ephemeral: true });
    }
     if (interaction.user.id === proposal.targetId) {
        return interaction.reply({ content: 'La personne visée ne peut pas participer au vote.', ephemeral: true });
    }


    const isApprove = interaction.customId.startsWith('derank_approve');

    if (!isApprove) { // C\'est un refus
        const finalEmbed = EmbedBuilder.from(interaction.message.embeds[0])
            .setColor('DarkGrey')
            .setTitle('Procédure Annulée')
            .setDescription(`La procédure de derank contre <@${targetId}> a été **refusée** par <@${interaction.user.id}>.`);
        
        const disabledRow = ActionRowBuilder.from(interaction.message.components[0]);
        disabledRow.components.forEach(c => c.setDisabled(true));

        await interaction.message.edit({ embeds: [finalEmbed], components: [disabledRow] });
        activeProposals.delete(targetId);
        return interaction.reply({ content: 'Vous avez refusé la procédure.', ephemeral: true });
    }

    // C\'est une approbation
    proposal.approvers.push(interaction.user.id);

    if (proposal.approvers.length >= REQUIRED_APPROVALS) {
        // --- Exécuter le Derank ---
        const guild = interaction.guild;
        const targetMember = await guild.members.fetch(targetId).catch(() => null);
        const baseRole = await guild.roles.fetch(BASE_ROLE_ID).catch(() => null);

        if (!targetMember || !baseRole) {
             const finalEmbed = EmbedBuilder.from(interaction.message.embeds[0])
                .setColor('DarkGrey')
                .setTitle('Procédure Échouée')
                .setDescription(`Erreur: La cible ou le rôle de base est introuvable.`);
             const disabledRow = ActionRowBuilder.from(interaction.message.components[0]);
             disabledRow.components.forEach(c => c.setDisabled(true));
             await interaction.message.edit({ embeds: [finalEmbed], components: [disabledRow] });
             activeProposals.delete(targetId);
             return;
        }

        const rolesToRemove = targetMember.roles.cache.filter(role => role.position > baseRole.position);
        
        try {
            await targetMember.roles.remove(rolesToRemove, 'Procédure de derank d\'urgence');
            lastDerankTimestamp = Date.now();

            const finalEmbed = EmbedBuilder.from(interaction.message.embeds[0])
                .setColor('Green')
                .setTitle('✅ Derank d\'Urgence Effectué')
                .setDescription(`<@${targetId}> a été derank avec succès.ப்புகளை`) // Typo: 'success' should be 'succès' or similar, but keeping original for minimal change.
                .setFields(
                    { name: 'Approbations', value: `${proposal.approvers.length}/${REQUIRED_APPROVALS}` },
                    { name: 'Approuvé par', value: proposal.approvers.map(id => `<@${id}>`).join(', ') }
                );
            
            const disabledRow = ActionRowBuilder.from(interaction.message.components[0]);
            disabledRow.components.forEach(c => c.setDisabled(true));
            await interaction.message.edit({ embeds: [finalEmbed], components: [disabledRow] });
            activeProposals.delete(targetId);

        } catch (error) {
            console.error('[Derank-Urgence] Erreur lors du derank:', error);
            await interaction.channel.send(`Une erreur est survenue en tentant de derank <@${targetId}>.`);
        }

    } else {
        // --- Mettre à jour le message de vote ---
        const updatedEmbed = EmbedBuilder.from(interaction.message.embeds[0])
            .setFields(
                { name: 'Approbations requises', value: `${REQUIRED_APPROVALS}` },
                { name: 'Approbations actuelles', value: `${proposal.approvers.length}` },
                { name: 'Approuvé par', value: proposal.approvers.map(id => `<@${id}>`).join(', ') }
            );
        
        await interaction.message.edit({ embeds: [updatedEmbed] });
        await interaction.reply({ content: 'Votre approbation a été enregistrée.', ephemeral: true });
    }
}

module.exports = { initialize };
