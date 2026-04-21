const {
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    PermissionFlagsBits
} = require('discord.js');
const CONFIG = require('../config.js');

/**
 * Handler pour le formulaire de débannissement
 * Gère le bouton launch_form et les boutons de continuation
 */
module.exports = {
    name: 'debanFormHandler',

    /**
     * Gère le clic sur le bouton "Lancer le formulaire"
     */
    async handleLaunchForm(interaction, { voteManager, client }) {
        // Vérifier si l'utilisateur a déjà une demande en cours
        if (voteManager.activeDebanRequests?.has(interaction.user.id)) {
            return interaction.reply({
                content: "❌ Vous avez déjà une demande de débannissement en cours. Veuillez attendre la fin de votre demande actuelle.",
                ephemeral: true
            });
        }

        // Rôles autorisés à bypasser la vérification de ban (test du flux)
        const BYPASS_ROLE_IDS = [
            '1452608223634001940', // Administrateur
            '1433460236470980608', // Owner
        ];

        // Check rapide sur l'interaction (si le panel est sur le serveur principal)
        let isBypass = Boolean(
            interaction.member?.roles?.cache?.some(r => BYPASS_ROLE_IDS.includes(r.id)) ||
            interaction.member?.permissions?.has?.(PermissionFlagsBits.Administrator)
        );

        try {
            const mainGuild = await client.guilds.fetch(CONFIG.DEBAN_GUILD_ID).catch(err => {
                console.error(`[Deban] Impossible de fetch la guild principale (${CONFIG.DEBAN_GUILD_ID}):`, err?.code, err?.message);
                return null;
            });

            if (!mainGuild) {
                return interaction.reply({
                    content: '❌ Une erreur est survenue lors de la vérification du serveur principal.',
                    ephemeral: true
                });
            }

            // Fallback : vérifier le membre et ses rôles sur le serveur principal
            // si le panel est sur un autre serveur (PANEL_GUILD_ID ≠ DEBAN_GUILD_ID).
            if (!isBypass) {
                try {
                    const mainMember = await mainGuild.members.fetch(interaction.user.id);
                    isBypass = Boolean(
                        mainMember?.roles?.cache?.some(r => BYPASS_ROLE_IDS.includes(r.id)) ||
                        mainMember?.permissions?.has?.(PermissionFlagsBits.Administrator)
                    );
                } catch { /* user absent du serveur principal : pas de bypass */ }
            }

            // Bypass : ouvrir le formulaire direct, sans vérifier le ban
            if (isBypass) {
                console.log(`[Deban] Bypass staff : ${interaction.user.tag} (${interaction.user.id}) soumet une demande (test)`);
            } else {
                // Vérification normale : tenter de récupérer le ban de l'utilisateur
                try {
                    await mainGuild.bans.fetch(interaction.user.id);
                } catch (banError) {
                    if (banError?.code === 10026) {
                        // Unknown Ban : l'utilisateur n'est pas banni
                        return interaction.reply({
                            content: "❌ Vous n'êtes pas banni du serveur principal.\n\n" +
                                "Si vous pensez que c'est une erreur, veuillez contacter un modérateur.\n" +
                                "Si vous souhaitez rejoindre le serveur : https://discord.gg/UJNZxzmmPV",
                            ephemeral: true
                        });
                    }
                    // Autre erreur API (missing permissions, missing access, etc.) : log détaillé
                    console.error(`[Deban] Erreur ban fetch pour ${interaction.user.id} sur ${mainGuild.id}: code=${banError?.code} status=${banError?.status} msg=${banError?.message}`);
                    return interaction.reply({
                        content: `❌ Impossible de vérifier votre statut de bannissement (code ${banError?.code ?? 'inconnu'}). Contactez un modérateur.`,
                        ephemeral: true
                    });
                }
            }

            // OK : ouvrir le formulaire étape 1
            const modal = new ModalBuilder()
                .setCustomId('deban_form_step1')
                .setTitle('Débannissement - Étape 1/3');

            const whyBanned = new TextInputBuilder()
                .setCustomId('whyBanned')
                .setLabel('Pourquoi avez-vous été banni ?')
                .setPlaceholder("Expliquez brièvement pourquoi vous avez été banni.")
                .setStyle(TextInputStyle.Paragraph)
                .setMaxLength(1000)
                .setRequired(true);

            const whenBanned = new TextInputBuilder()
                .setCustomId('whenBanned')
                .setLabel('Quand avez-vous été banni ?')
                .setPlaceholder("Exemple : 15/08/2022")
                .setStyle(TextInputStyle.Short)
                .setMaxLength(100)
                .setRequired(true);

            const whoBanned = new TextInputBuilder()
                .setCustomId('whoBanned')
                .setLabel('Par qui avez-vous été banni ?')
                .setPlaceholder("Indiquez le modérateur, si vous le connaissez.")
                .setStyle(TextInputStyle.Short)
                .setMaxLength(100)
                .setRequired(false);

            modal.addComponents(
                new ActionRowBuilder().addComponents(whyBanned),
                new ActionRowBuilder().addComponents(whenBanned),
                new ActionRowBuilder().addComponents(whoBanned)
            );

            await interaction.showModal(modal);

        } catch (error) {
            console.error(`Erreur lors de la vérification du bannissement pour ${interaction.user.id}:`, error);
            return interaction.reply({
                content: '❌ Une erreur est survenue lors de la vérification de votre statut de bannissement.',
                ephemeral: true
            });
        }
    },

    /**
     * Gère le bouton "Continuer vers Étape 2"
     */
    async handleContinueStep2(interaction) {
        const modal = new ModalBuilder()
            .setCustomId('deban_form_step2')
            .setTitle('Débannissement - Étape 2/3');

        const readRules = new TextInputBuilder()
            .setCustomId('readRules')
            .setLabel('Avez-vous lu et compris les règles ?')
            .setPlaceholder("Répondez par Oui ou Non.")
            .setStyle(TextInputStyle.Short)
            .setMaxLength(50)
            .setRequired(true);

        const brokenRule = new TextInputBuilder()
            .setCustomId('brokenRule')
            .setLabel('Quelle règle avez-vous enfreinte ?')
            .setPlaceholder("Ex : Langage inapproprié, spam, etc.")
            .setStyle(TextInputStyle.Paragraph)
            .setMaxLength(1000)
            .setRequired(true);

        const whyUnban = new TextInputBuilder()
            .setCustomId('whyUnban')
            .setLabel('Pourquoi méritez-vous un débannissement ?')
            .setPlaceholder("Expliquez pourquoi on devrait vous débannir.")
            .setStyle(TextInputStyle.Paragraph)
            .setMaxLength(1000)
            .setRequired(true);

        const lessonLearned = new TextInputBuilder()
            .setCustomId('lessonLearned')
            .setLabel('Quelle leçon avez-vous apprise ?')
            .setPlaceholder("Que retenez-vous de cette expérience ?")
            .setStyle(TextInputStyle.Paragraph)
            .setMaxLength(1000)
            .setRequired(true);

        const avoidRepeat = new TextInputBuilder()
            .setCustomId('avoidRepeat')
            .setLabel('Comment éviterez-vous cela à l\'avenir ?')
            .setPlaceholder("Quelles mesures prendrez-vous ?")
            .setStyle(TextInputStyle.Paragraph)
            .setMaxLength(1000)
            .setRequired(true);

        modal.addComponents(
            new ActionRowBuilder().addComponents(readRules),
            new ActionRowBuilder().addComponents(brokenRule),
            new ActionRowBuilder().addComponents(whyUnban),
            new ActionRowBuilder().addComponents(lessonLearned),
            new ActionRowBuilder().addComponents(avoidRepeat)
        );

        await interaction.showModal(modal);
    },

    /**
     * Gère le bouton "Continuer vers Étape 3"
     */
    async handleContinueStep3(interaction) {
        const modal = new ModalBuilder()
            .setCustomId('deban_form_step3')
            .setTitle('Débannissement - Étape 3/3');

        const contribution = new TextInputBuilder()
            .setCustomId('contribution')
            .setLabel('Comment contribuerez-vous au serveur ?')
            .setPlaceholder("Comment contribuerez-vous positivement ?")
            .setStyle(TextInputStyle.Paragraph)
            .setMaxLength(1000)
            .setRequired(true);

        const objectives = new TextInputBuilder()
            .setCustomId('objectives')
            .setLabel('Quels sont vos objectifs sur le serveur ?')
            .setPlaceholder("Quels sont vos projets si vous êtes débanni ?")
            .setStyle(TextInputStyle.Paragraph)
            .setMaxLength(1000)
            .setRequired(true);

        const additionalInfo = new TextInputBuilder()
            .setCustomId('additionalInfo')
            .setLabel('Informations supplémentaires (optionnel)')
            .setPlaceholder("Ajoutez toute info complémentaire si besoin.")
            .setStyle(TextInputStyle.Paragraph)
            .setMaxLength(1000)
            .setRequired(false);

        modal.addComponents(
            new ActionRowBuilder().addComponents(contribution),
            new ActionRowBuilder().addComponents(objectives),
            new ActionRowBuilder().addComponents(additionalInfo)
        );

        await interaction.showModal(modal);
    },

    /**
     * Gère la soumission du modal Étape 1
     */
    async handleStep1Submit(interaction, { voteManager }) {
        const whyBanned = interaction.fields.getTextInputValue('whyBanned');
        const whenBanned = interaction.fields.getTextInputValue('whenBanned');
        const whoBanned = interaction.fields.getTextInputValue('whoBanned');

        // Stocker les données temporairement
        voteManager.formData.set(interaction.user.id, {
            whyBanned,
            whenBanned,
            whoBanned,
            discordUsername: interaction.user.username,
            discordId: interaction.user.id
        });

        const continueBtn = new ButtonBuilder()
            .setCustomId('deban_continue_step2')
            .setLabel("📝 Continuer vers Étape 2")
            .setStyle(ButtonStyle.Primary);

        const row = new ActionRowBuilder().addComponents(continueBtn);

        await interaction.reply({
            content: '✅ **Étape 1 complétée !**\n\nCliquez sur le bouton ci-dessous pour passer à l\'étape 2.',
            ephemeral: true,
            components: [row]
        });
    },

    /**
     * Gère la soumission du modal Étape 2
     */
    async handleStep2Submit(interaction, { voteManager }) {
        const readRules = interaction.fields.getTextInputValue('readRules');
        const brokenRule = interaction.fields.getTextInputValue('brokenRule');
        const whyUnban = interaction.fields.getTextInputValue('whyUnban');
        const lessonLearned = interaction.fields.getTextInputValue('lessonLearned');
        const avoidRepeat = interaction.fields.getTextInputValue('avoidRepeat');

        // Récupérer et mettre à jour les données
        const data = voteManager.formData.get(interaction.user.id) || {};
        Object.assign(data, {
            readRules,
            brokenRule,
            whyUnban,
            lessonLearned,
            avoidRepeat
        });
        voteManager.formData.set(interaction.user.id, data);

        const continueBtn = new ButtonBuilder()
            .setCustomId('deban_continue_step3')
            .setLabel("📝 Continuer vers Étape 3")
            .setStyle(ButtonStyle.Primary);

        const row = new ActionRowBuilder().addComponents(continueBtn);

        await interaction.reply({
            content: '✅ **Étape 2 complétée !**\n\nCliquez sur le bouton ci-dessous pour passer à l\'étape finale.',
            ephemeral: true,
            components: [row]
        });
    },

    /**
     * Gère la soumission du modal Étape 3 - Lance le vote
     */
    async handleStep3Submit(interaction, { voteManager, client }) {
        const contribution = interaction.fields.getTextInputValue('contribution');
        const objectives = interaction.fields.getTextInputValue('objectives');
        const additionalInfo = interaction.fields.getTextInputValue('additionalInfo');

        // Récupérer et finaliser les données
        const data = voteManager.formData.get(interaction.user.id) || {};
        Object.assign(data, {
            contribution,
            objectives,
            additionalInfo
        });

        // Créer le rapport complet
        const report =
            `**📋 Demande de débannissement**\n\n` +
            `**🔒 Contexte du bannissement :**\n` +
            `- **Raison :** ${data.whyBanned}\n` +
            `- **Date :** ${data.whenBanned}\n` +
            `- **Banni par :** ${data.whoBanned || 'Non renseigné'}\n\n` +
            `**💭 Réflexions :**\n` +
            `- **Règles lues :** ${data.readRules}\n` +
            `- **Règle enfreinte :** ${data.brokenRule}\n` +
            `- **Motif débannissement :** ${data.whyUnban}\n` +
            `- **Leçon apprise :** ${data.lessonLearned}\n` +
            `- **Prévention future :** ${data.avoidRepeat}\n\n` +
            `**🚀 Engagement futur :**\n` +
            `- **Contribution :** ${data.contribution}\n` +
            `- **Objectifs :** ${data.objectives}\n` +
            `- **Infos complémentaires :** ${data.additionalInfo || 'Aucune'}\n\n` +
            `**👤 Informations utilisateur :**\n` +
            `- **Nom :** ${data.discordUsername}\n` +
            `- **ID :** ${data.discordId}`;

        // Déférer la réponse car startDebanVote peut prendre du temps
        await interaction.deferReply({ ephemeral: true });

        try {
            // Lancer le vote de débannissement
            await voteManager.startDebanVote(
                client,
                interaction,
                data,
                report,
                CONFIG.DEBAN_CHANNEL_ID,
                CONFIG.STAFF_ROLES.find(r => r.name === 'Staff')?.id || '1172237685763608579'
            );

            // Nettoyer les données temporaires
            voteManager.formData.delete(interaction.user.id);

        } catch (error) {
            console.error('Erreur lors du lancement du vote de débannissement:', error);
            await interaction.followUp({
                content: '❌ Une erreur est survenue lors de la soumission de votre demande. Veuillez réessayer.',
                ephemeral: true
            });
        }
    }
};
