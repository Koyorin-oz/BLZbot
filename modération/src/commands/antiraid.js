const path = require('path');
const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits, ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize } = require('discord.js');
const CONFIG = require('../config.js');
const { BLZ_EMBED_STRIP_INT } = require(path.join(__dirname, '..', '..', '..', 'blz-embed-theme'));

module.exports = {
    data: new SlashCommandBuilder()
        .setName('antiraid')
        .setDescription('🛡️ Gestion du système anti-raid')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addSubcommand(subcommand =>
            subcommand
                .setName('status')
                .setDescription('📊 Voir le statut actuel du système anti-raid')
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('lockdown')
                .setDescription('🔒 Activer/désactiver le lockdown manuellement')
                .addBooleanOption(option =>
                    option
                        .setName('activer')
                        .setDescription('Activer (true) ou désactiver (false) le lockdown')
                        .setRequired(true)
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('clear')
                .setDescription('🧹 Retirer le rôle RAID de tous les membres et réinitialiser le système')
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('history')
                .setDescription('📜 Voir l\'historique des incidents de raid')
                .addIntegerOption(option =>
                    option
                        .setName('limite')
                        .setDescription('Nombre d\'incidents à afficher (défaut: 5)')
                        .setMinValue(1)
                        .setMaxValue(20)
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('score')
                .setDescription('📈 Modifier manuellement le score anti-raid')
                .addIntegerOption(option =>
                    option
                        .setName('valeur')
                        .setDescription('Nouvelle valeur du score (0 pour réinitialiser)')
                        .setRequired(true)
                        .setMinValue(0)
                        .setMaxValue(500)
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('invites')
                .setDescription('🔗 Réactiver les invitations après un lockdown')
        ),

    async execute(interaction, { antiRaidManager, config }) {
        // Vérifier que l'antiRaidManager est disponible
        if (!antiRaidManager) {
            return interaction.reply({
                content: '❌ Le système anti-raid n\'est pas initialisé.',
                ephemeral: true
            });
        }

        const subcommand = interaction.options.getSubcommand();

        switch (subcommand) {
            case 'status':
                await this.handleStatus(interaction, antiRaidManager);
                break;
            case 'lockdown':
                await this.handleLockdown(interaction, antiRaidManager);
                break;
            case 'clear':
                await this.handleClear(interaction, antiRaidManager);
                break;
            case 'history':
                await this.handleHistory(interaction, antiRaidManager);
                break;
            case 'score':
                await this.handleScore(interaction, antiRaidManager);
                break;
            case 'invites':
                await this.handleInvites(interaction, antiRaidManager);
                break;
        }
    },

    /**
     * Affiche le statut actuel du système anti-raid
     */
    async handleStatus(interaction, antiRaidManager) {
        const status = antiRaidManager.getStatus(interaction.guild.id);

        const actionThreshold = CONFIG.RAID_DETECTION?.ACTION_THRESHOLD || 50;
        const criticalThreshold = CONFIG.RAID_DETECTION?.CRITICAL_THRESHOLD || 100;

        // Calcul de la jauge visuelle
        const maxGauge = criticalThreshold + 20;
        const filledBlocks = Math.min(Math.floor((status.score / maxGauge) * 20), 20);
        const emptyBlocks = 20 - filledBlocks;
        
        let gaugeColor = '🟢';
        const accentColor = BLZ_EMBED_STRIP_INT;
        if (status.score >= actionThreshold) {
            gaugeColor = '🟠';
        }
        if (status.score >= criticalThreshold) {
            gaugeColor = '🔴';
        }

        const gauge = `${gaugeColor} ${'█'.repeat(filledBlocks)}${'░'.repeat(emptyBlocks)} ${status.score}/${criticalThreshold}`;

        // Statut textuel
        let statusText = '✅ Normal';
        let statusEmoji = '✅';
        
        if (status.lockdownActive) {
            statusText = '🔒 LOCKDOWN ACTIF';
            statusEmoji = '🔒';
        } else if (status.raidActive) {
            statusText = '⚠️ MODE RAID ACTIF';
            statusEmoji = '⚠️';
        }

        try {
            // Components V2
            const container = new ContainerBuilder()
                .setAccentColor(accentColor);

            // Titre
            container.addTextDisplayComponents(
                new TextDisplayBuilder().setContent(`# 🛡️ Statut Anti-Raid`)
            );

            container.addSeparatorComponents(
                new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small)
            );

            // État et stats
            container.addTextDisplayComponents(
                new TextDisplayBuilder().setContent(
                    `**État:** ${statusText}\n` +
                    `**Score de menace:** ${status.score}\n` +
                    `**Raiders détectés:** ${status.raiderCount}`
                )
            );

            container.addSeparatorComponents(
                new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small)
            );

            // Jauge
            container.addTextDisplayComponents(
                new TextDisplayBuilder().setContent(
                    `### Jauge de menace\n${gauge}`
                )
            );

            container.addSeparatorComponents(
                new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small)
            );

            // Configuration
            container.addTextDisplayComponents(
                new TextDisplayBuilder().setContent(
                    `**Seuils:**\n` +
                    `🟠 Mode Raid: ${actionThreshold}\n` +
                    `🔴 Lockdown: ${criticalThreshold}\n\n` +
                    `**Décroissance:** ${CONFIG.RAID_DETECTION?.DECAY_RATE || 1} pt/min`
                )
            );

            // Dernière mise à jour
            if (status.lastUpdate) {
                container.addSeparatorComponents(
                    new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small)
                );
                container.addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(`-# Dernière mise à jour: <t:${Math.floor(status.lastUpdate / 1000)}:R>`)
                );
            }

            await interaction.reply({ components: [container], flags: [4096] });
        } catch (error) {
            // Fallback embed classique
            console.log('[ANTIRAID CMD] Fallback vers embed classique:', error.message);
            
            const embed = new EmbedBuilder()
                .setTitle('🛡️ Statut Anti-Raid')
                .setColor(accentColor)
                .addFields(
                    { name: 'État', value: statusText, inline: true },
                    { name: 'Score de menace', value: `${status.score}`, inline: true },
                    { name: 'Raiders détectés', value: `${status.raiderCount}`, inline: true },
                    { name: 'Jauge de menace', value: gauge, inline: false },
                    { name: 'Seuils', value: `🟠 Mode Raid: ${actionThreshold}\n🔴 Lockdown: ${criticalThreshold}`, inline: true },
                    { name: 'Configuration', value: `Décroissance: ${CONFIG.RAID_DETECTION?.DECAY_RATE || 1} pt/min`, inline: true }
                )
                .setTimestamp()
                .setFooter({ text: 'Système Anti-Raid Intelligent' });

            if (status.lastUpdate) {
                const lastUpdateText = `<t:${Math.floor(status.lastUpdate / 1000)}:R>`;
                embed.addFields({ name: 'Dernière mise à jour', value: lastUpdateText, inline: true });
            }

            await interaction.reply({ embeds: [embed] });
        }
    },

    /**
     * Active ou désactive le lockdown manuellement
     */
    async handleLockdown(interaction, antiRaidManager) {
        const activer = interaction.options.getBoolean('activer');

        await interaction.deferReply();

        if (activer) {
            // Activer le lockdown
            await antiRaidManager.activateLockdown(interaction.guild.id, `Manuel par ${interaction.user.tag}`);
            
            try {
                const container = new ContainerBuilder()
                    .setAccentColor(BLZ_EMBED_STRIP_INT);

                container.addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(`# 🔒 Lockdown Activé`)
                );
                container.addSeparatorComponents(
                    new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small)
                );
                container.addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(
                        `Le lockdown a été activé manuellement.\n\n` +
                        `**Actions effectuées:**\n` +
                        `• Invitations désactivées\n` +
                        `• DM envoyés aux admins\n` +
                        `• Nouveaux membres recevront le rôle RAID`
                    )
                );
                container.addSeparatorComponents(
                    new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small)
                );
                container.addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(`-# Activé par <@${interaction.user.id}> • <t:${Math.floor(Date.now() / 1000)}:f>`)
                );

                await interaction.editReply({ components: [container], flags: [4096] });
            } catch (error) {
                const embed = new EmbedBuilder()
                    .setTitle('🔒 Lockdown Activé')
                    .setDescription('Le lockdown a été activé manuellement.')
                    .setColor(BLZ_EMBED_STRIP_INT)
                    .addFields(
                        { name: 'Actions effectuées', value: '• Invitations désactivées\n• DM envoyés aux admins\n• Nouveaux membres recevront le rôle RAID', inline: false },
                        { name: 'Activé par', value: `<@${interaction.user.id}>`, inline: true }
                    )
                    .setTimestamp();
                await interaction.editReply({ embeds: [embed] });
            }
        } else {
            // Désactiver le lockdown
            await antiRaidManager.deactivateLockdown(interaction.guild.id, interaction.user.id);

            try {
                const container = new ContainerBuilder()
                    .setAccentColor(BLZ_EMBED_STRIP_INT);

                container.addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(`# 🔓 Lockdown Désactivé`)
                );
                container.addSeparatorComponents(
                    new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small)
                );
                container.addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(
                        `Le lockdown a été désactivé.\n\n` +
                        `**Note:** Les invitations ont été automatiquement réactivées.`
                    )
                );
                container.addSeparatorComponents(
                    new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small)
                );
                container.addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(`-# Désactivé par <@${interaction.user.id}> • <t:${Math.floor(Date.now() / 1000)}:f>`)
                );

                await interaction.editReply({ components: [container], flags: [4096] });
            } catch (error) {
                const embed = new EmbedBuilder()
                    .setTitle('🔓 Lockdown Désactivé')
                    .setDescription('Le lockdown a été désactivé.')
                    .setColor(BLZ_EMBED_STRIP_INT)
                    .addFields(
                        { name: 'Note', value: 'Les invitations ont été automatiquement réactivées.', inline: false },
                        { name: 'Désactivé par', value: `<@${interaction.user.id}>`, inline: true }
                    )
                    .setTimestamp();
                await interaction.editReply({ embeds: [embed] });
            }
        }
    },

    /**
     * Retire le rôle RAID de tous les membres
     */
    async handleClear(interaction, antiRaidManager) {
        await interaction.deferReply();

        const cleared = await antiRaidManager.clearAllRaidRoles(interaction.guild, interaction.user.id);

        try {
            const container = new ContainerBuilder()
                .setAccentColor(BLZ_EMBED_STRIP_INT);

            container.addTextDisplayComponents(
                new TextDisplayBuilder().setContent(`# 🧹 Nettoyage Anti-Raid`)
            );
            container.addSeparatorComponents(
                new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small)
            );
            container.addTextDisplayComponents(
                new TextDisplayBuilder().setContent(
                    `Le système anti-raid a été réinitialisé.\n\n` +
                    `**Rôles RAID retirés:** ${cleared} membres\n` +
                    `**Score réinitialisé:** Oui`
                )
            );
            container.addSeparatorComponents(
                new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small)
            );
            container.addTextDisplayComponents(
                new TextDisplayBuilder().setContent(`-# Effectué par <@${interaction.user.id}> • <t:${Math.floor(Date.now() / 1000)}:f>`)
            );

            await interaction.editReply({ components: [container], flags: [4096] });
        } catch (error) {
            const embed = new EmbedBuilder()
                .setTitle('🧹 Nettoyage Anti-Raid')
                .setDescription('Le système anti-raid a été réinitialisé.')
                .setColor(BLZ_EMBED_STRIP_INT)
                .addFields(
                    { name: 'Rôles RAID retirés', value: `${cleared} membres`, inline: true },
                    { name: 'Score réinitialisé', value: 'Oui', inline: true },
                    { name: 'Effectué par', value: `<@${interaction.user.id}>`, inline: true }
                )
                .setTimestamp();
            await interaction.editReply({ embeds: [embed] });
        }
    },

    /**
     * Affiche l'historique des incidents de raid
     */
    async handleHistory(interaction, antiRaidManager) {
        const limite = interaction.options.getInteger('limite') || 5;

        await interaction.deferReply();

        const incidents = await antiRaidManager.getIncidentHistory(interaction.guild.id, limite);

        if (incidents.length === 0) {
            return interaction.editReply({
                content: '📜 Aucun incident de raid enregistré pour ce serveur.',
                ephemeral: true
            });
        }

        try {
            const container = new ContainerBuilder()
                .setAccentColor(BLZ_EMBED_STRIP_INT);

            container.addTextDisplayComponents(
                new TextDisplayBuilder().setContent(`# 📜 Historique des Incidents de Raid`)
            );
            container.addSeparatorComponents(
                new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small)
            );

            for (const incident of incidents) {
                const detectedAt = `<t:${Math.floor(incident.detected_at / 1000)}:f>`;
                const resolvedAt = incident.resolved_at 
                    ? `<t:${Math.floor(incident.resolved_at / 1000)}:R>` 
                    : '❌ Non résolu';

                let statusEmoji = '🔴';
                if (incident.resolved_at) statusEmoji = '✅';

                container.addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(
                        `### ${statusEmoji} Incident #${incident.id}\n` +
                        `**Détecté:** ${detectedAt}\n` +
                        `**Score max:** ${incident.peak_score} • **Raiders:** ${incident.raider_count}\n` +
                        `**Lockdown:** ${incident.lockdown_activated ? '🔒 Oui' : '❌ Non'}\n` +
                        `**Critères:** ${incident.criteria_triggered || 'N/A'}\n` +
                        `**Résolution:** ${resolvedAt}`
                    )
                );
                container.addSeparatorComponents(
                    new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small)
                );
            }

            container.addTextDisplayComponents(
                new TextDisplayBuilder().setContent(`-# ${incidents.length} incident(s) affiché(s)`)
            );

            await interaction.editReply({ components: [container], flags: [4096] });
        } catch (error) {
            const embed = new EmbedBuilder()
                .setTitle('📜 Historique des Incidents de Raid')
                .setColor(BLZ_EMBED_STRIP_INT)
                .setTimestamp()
                .setFooter({ text: `${incidents.length} incident(s) affiché(s)` });

            for (const incident of incidents) {
                const detectedAt = `<t:${Math.floor(incident.detected_at / 1000)}:f>`;
                const resolvedAt = incident.resolved_at 
                    ? `<t:${Math.floor(incident.resolved_at / 1000)}:R>` 
                    : '❌ Non résolu';

                let status = '🔴 Non résolu';
                if (incident.resolved_at) {
                    status = '✅ Résolu';
                }

                embed.addFields({
                    name: `#${incident.id} - ${detectedAt}`,
                    value: [
                        `**Statut:** ${status}`,
                        `**Score max:** ${incident.peak_score}`,
                        `**Raiders:** ${incident.raider_count}`,
                        `**Lockdown:** ${incident.lockdown_activated ? '🔒 Oui' : '❌ Non'}`,
                        `**Critères:** ${incident.criteria_triggered || 'N/A'}`,
                        `**Résolution:** ${resolvedAt}`
                    ].join('\n'),
                    inline: true
                });
            }

            await interaction.editReply({ embeds: [embed] });
        }
    },

    /**
     * Modifie manuellement le score anti-raid
     */
    async handleScore(interaction, antiRaidManager) {
        const valeur = interaction.options.getInteger('valeur');

        // Obtenir les données du serveur
        const guildData = antiRaidManager.getGuildData(interaction.guild.id);
        const ancienScore = guildData.score;

        // Modifier le score
        guildData.score = valeur;
        guildData.lastUpdate = Date.now();

        // Vérifier si on doit désactiver le mode raid
        const actionThreshold = CONFIG.RAID_DETECTION?.ACTION_THRESHOLD || 50;
        if (valeur < actionThreshold && guildData.raidActive) {
            await antiRaidManager.deactivateRaidMode(interaction.guild.id);
        }

        try {
            const container = new ContainerBuilder()
                .setAccentColor(BLZ_EMBED_STRIP_INT);

            container.addTextDisplayComponents(
                new TextDisplayBuilder().setContent(`# 📈 Score Anti-Raid Modifié`)
            );
            container.addSeparatorComponents(
                new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small)
            );
            
            let description = `**Ancien score:** ${ancienScore}\n**Nouveau score:** ${valeur}`;
            if (valeur === 0) {
                description += '\n\n⚠️ Le score a été réinitialisé à 0. Le mode raid a été désactivé.';
            }
            
            container.addTextDisplayComponents(
                new TextDisplayBuilder().setContent(description)
            );
            container.addSeparatorComponents(
                new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small)
            );
            container.addTextDisplayComponents(
                new TextDisplayBuilder().setContent(`-# Modifié par <@${interaction.user.id}> • <t:${Math.floor(Date.now() / 1000)}:f>`)
            );

            await interaction.reply({ components: [container], flags: [4096] });
        } catch (error) {
            const embed = new EmbedBuilder()
                .setTitle('📈 Score Anti-Raid Modifié')
                .setColor(BLZ_EMBED_STRIP_INT)
                .addFields(
                    { name: 'Ancien score', value: `${ancienScore}`, inline: true },
                    { name: 'Nouveau score', value: `${valeur}`, inline: true },
                    { name: 'Modifié par', value: `<@${interaction.user.id}>`, inline: true }
                )
                .setTimestamp();

            if (valeur === 0) {
                embed.setDescription('⚠️ Le score a été réinitialisé à 0. Le mode raid a été désactivé.');
            }

            await interaction.reply({ embeds: [embed] });
        }
    },

    /**
     * Réactive les invitations après un lockdown
     */
    async handleInvites(interaction, antiRaidManager) {
        await interaction.deferReply();

        try {
            await antiRaidManager.enableInvites(interaction.guild);

            try {
                const container = new ContainerBuilder()
                    .setAccentColor(BLZ_EMBED_STRIP_INT);

                container.addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(`# 🔗 Invitations Réactivées`)
                );
                container.addSeparatorComponents(
                    new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small)
                );
                container.addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(`La création d'invitations a été réactivée pour @everyone.`)
                );
                container.addSeparatorComponents(
                    new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small)
                );
                container.addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(`-# Réactivé par <@${interaction.user.id}> • <t:${Math.floor(Date.now() / 1000)}:f>`)
                );

                await interaction.editReply({ components: [container], flags: [4096] });
            } catch (err) {
                const embed = new EmbedBuilder()
                    .setTitle('🔗 Invitations Réactivées')
                    .setDescription('La création d\'invitations a été réactivée pour @everyone.')
                    .setColor(BLZ_EMBED_STRIP_INT)
                    .addFields(
                        { name: 'Réactivé par', value: `<@${interaction.user.id}>`, inline: true }
                    )
                    .setTimestamp();
                await interaction.editReply({ embeds: [embed] });
            }
        } catch (error) {
            console.error('[ANTI-RAID] Erreur réactivation invitations:', error);
            await interaction.editReply({
                content: '❌ Une erreur est survenue lors de la réactivation des invitations.',
                ephemeral: true
            });
        }
    }
};
