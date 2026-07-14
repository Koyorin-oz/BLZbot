const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, EmbedBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, StringSelectMenuOptionBuilder } = require('discord.js');
const { LabelBuilder } = require('discord.js');
const CONFIG = require('../config.js');

module.exports = {
    name: 'applyModeratorButton',
    
    async execute(interaction, { dbManager, voteManager, recruitmentManager, client }) {
        const member = interaction.member;
        const userId = interaction.user.id;

        // Vérification des conditions (version backup)
        const joinDate = member.joinedAt;
        const oneWeekInMs = 7 * 24 * 60 * 60 * 1000;
        const hasBeenOneWeek = (new Date() - joinDate) > oneWeekInMs;
        
        if (!hasBeenOneWeek) {
            return interaction.reply({
                content: "Vous ne remplissez pas les conditions pour postuler :\n- Vous devez être sur le serveur depuis plus d'une semaine.",
                ephemeral: true
            });
        }

        // Vérifier les chances de candidature
        const staffProfileDb = dbManager.getStaffProfileDb();
        staffProfileDb.get(
            'SELECT * FROM staff_chances WHERE userId = ?',
            [userId],
            async (err, chances) => {
                if (err) console.error('Erreur vérification chances:', err);
                
                // Créer par défaut si n'existe pas
                if (!chances) {
                    staffProfileDb.run(
                        'INSERT INTO staff_chances (userId, candidature_chances, modo_test_chances) VALUES (?, 2, 1)',
                        [userId]
                    );
                    chances = { candidature_chances: 2, modo_test_chances: 1 };
                }
                
                if (chances.candidature_chances <= 0) {
                    return interaction.reply({
                        content: '❌ Vous n\'avez plus de chances de candidature. Vous récupérez une chance tous les 6 mois.',
                        ephemeral: true
                    });
                }

                // Créer le formulaire de candidature - Étape 1 (système backup)
                const modal = new ModalBuilder()
                    .setCustomId('moderation_form_step1')
                    .setTitle('Candidature Modérateur - 1/2');

                const a2fSelect = new StringSelectMenuBuilder()
                    .setCustomId('a2f')
                    .setPlaceholder('Avez-vous l\'A2F ?')
                    .setRequired(true)
                    .addOptions(
                        new StringSelectMenuOptionBuilder()
                            .setLabel('Oui')
                            .setValue('Oui'),
                        new StringSelectMenuOptionBuilder()
                            .setLabel('Non')
                            .setValue('Non')
                    );

                const ageSelect = new StringSelectMenuBuilder()
                    .setCustomId('age')
                    .setPlaceholder('Avez-vous 13 ans ou + ?')
                    .setRequired(true)
                    .addOptions(
                        new StringSelectMenuOptionBuilder()
                            .setLabel('Oui')
                            .setValue('Oui'),
                        new StringSelectMenuOptionBuilder()
                            .setLabel('Non')
                            .setValue('Non')
                    );

                const qualitiesDefects = new TextInputBuilder()
                    .setCustomId('qualitiesDefects')
                    .setPlaceholder('Soyez détaillé.')
                    .setStyle(TextInputStyle.Paragraph)
                    .setMinLength(250)
                    .setRequired(true);

                modal.addLabelComponents(
                    new LabelBuilder()
                        .setLabel('Avez-vous l\'A2F ?')
                        .setStringSelectMenuComponent(a2fSelect),
                    new LabelBuilder()
                        .setLabel('Avez-vous 13 ans ou + ?')
                        .setStringSelectMenuComponent(ageSelect),
                    new LabelBuilder()
                        .setLabel('Qualités et défauts ?')
                        .setTextInputComponent(qualitiesDefects)
                );

                await interaction.showModal(modal);
            }
        );
    },

    /**
     * Traiter la soumission du modal - Étape 1 (système backup)
     */
    async handleStep1Submit(interaction, { dbManager }) {
        const a2fSelection = interaction.fields.getStringSelectValues('a2f');
        const a2f = a2fSelection[0] || 'Non renseigné';
        const ageSelection = interaction.fields.getStringSelectValues('age');
        const age = ageSelection[0] || 'Non renseigné';
        const qualitiesDefects = interaction.fields.getTextInputValue('qualitiesDefects');
        
        // Stocker temporairement les données
        if (!global.candidatureFormData) {
            global.candidatureFormData = new Map();
        }
        global.candidatureFormData.set(interaction.user.id, { a2f, age, qualitiesDefects });

        const continueBtn = new ButtonBuilder()
            .setCustomId('continue_moderation_step2')
            .setLabel("Continuer vers étape 2")
            .setStyle(ButtonStyle.Primary);
        const row = new ActionRowBuilder().addComponents(continueBtn);

        await interaction.reply({
            content: 'Étape 1 complétée. Cliquez pour passer à l\'étape 2.',
            ephemeral: true,
            components: [row]
        });
    },

    /**
     * Afficher le modal étape 2 (système backup)
     */
    async showStep2Modal(interaction) {
        const modal = new ModalBuilder()
            .setCustomId('moderation_form_step2')
            .setTitle('Candidature Modérateur - 2/2');

        const modExperience = new TextInputBuilder()
            .setCustomId('modExperience')
            .setPlaceholder('Nom du serveur et nombre de membres.')
            .setStyle(TextInputStyle.Short)
            .setRequired(false);

        const whyYou = new TextInputBuilder()
            .setCustomId('whyYou')
            .setPlaceholder('Pourquoi vous et pas quelqu\'un d\'autre ?')
            .setStyle(TextInputStyle.Paragraph)
            .setMinLength(100)
            .setRequired(true);

        const motivation = new TextInputBuilder()
            .setCustomId('motivation')
            .setPlaceholder('Vos motivations et vos buts.')
            .setStyle(TextInputStyle.Paragraph)
            .setMinLength(100)
            .setRequired(true);

        modal.addLabelComponents(
            new LabelBuilder()
                .setLabel('Expérience en modération ?')
                .setDescription('Donnez le nom du serveur et son nombre de membres si applicable.')
                .setTextInputComponent(modExperience),
            new LabelBuilder()
                .setLabel('Pourquoi vous ?')
                .setDescription('Expliquez ce qui vous différencie.')
                .setTextInputComponent(whyYou),
            new LabelBuilder()
                .setLabel('Pourquoi ce rôle ?')
                .setDescription('Partagez vos motivations et objectifs.')
                .setTextInputComponent(motivation)
        );

        await interaction.showModal(modal);
    },

    /**
     * Traiter la soumission du modal - Étape 2
     */
    async handleStep2Submit(interaction, { dbManager, voteManager, recruitmentManager, client }) {
        const modExperience = interaction.fields.getTextInputValue('modExperience');
        const whyYou = interaction.fields.getTextInputValue('whyYou');
        const motivation = interaction.fields.getTextInputValue('motivation');
        
        if (!global.candidatureFormData) {
            global.candidatureFormData = new Map();
        }
        const data = global.candidatureFormData.get(interaction.user.id) || {};
        Object.assign(data, { modExperience, whyYou, motivation });

        // ⭐ INTÉGRATION PROFIL STAFF - Enregistrer la candidature et déduire une chance
        const staffProfileDb = dbManager.getStaffProfileDb();
        
        staffProfileDb.run(
            'INSERT INTO candidatures (userId, type, status, date) VALUES (?, ?, ?, ?)',
            [interaction.user.id, 'moderateur', 'en_attente', Date.now()],
            (err) => {
                if (err) console.error('Erreur enregistrement candidature:', err);
            }
        );

        // Déduire une chance de candidature
        staffProfileDb.run(
            'UPDATE staff_chances SET candidature_chances = candidature_chances - 1 WHERE userId = ?',
            [interaction.user.id],
            (err) => {
                if (err) console.error('Erreur déduction chance:', err);
            }
        );

        // Créer le rapport
        const report =
            `**Candidature pour Modérateur**\n\n` +
            `**Informations de base :**\n` +
            `- **A2F :** ${data.a2f}\n` +
            `- **13 ans ou + :** ${data.age}\n` +
            `**Réponses :**\n` +
            `- **Qualités et défauts :**\n${data.qualitiesDefects}\n\n` +
            `- **Expérience en modération :**\n${data.modExperience || 'Non renseigné'}\n\n` +
            `- **Pourquoi vous et pas quelqu'un d'autre ?**\n${data.whyYou}\n\n` +
            `- **Pourquoi voulez-vous être modérateur ?**\n${data.motivation}\n\n` +
            `**Informations utilisateur :**\n` +
            `- **Nom :** ${interaction.user.username}\n` +
            `- **ID :** ${interaction.user.id}`;

        // Vérifier avertissement places
        const pendingApplications = Object.keys(voteManager.votes).filter(id => {
            const vote = voteManager.votes[id];
            return vote && vote.type === 'candidature';
        }).length;
        const availablePlaces = recruitmentManager.getAvailablePlaces();

        if (availablePlaces > 0 && pendingApplications >= availablePlaces) {
            const message = `⚠️ Votre candidature a bien été soumise, mais il y a déjà **${pendingApplications}** candidatures en attente. Si les **${availablePlaces}** premières candidatures sont acceptées, la vôtre sera automatiquement refusée.`;
            await interaction.user.send(message).catch(console.error);
        } else if (availablePlaces === 0) {
            const message = `⚠️ Le recrutement est actuellement fermé ou n'a pas de places disponibles. Votre candidature ne sera pas examinée pour le moment.`;
            await interaction.user.send(message).catch(console.error);
        }

        // Lancer le vote de candidature (version backup avec boutons personnalisés)
        await this.startCandidatureVote(interaction, report, voteManager, client);
        global.candidatureFormData.delete(interaction.user.id);

        await interaction.reply({
            content: 'Votre candidature a été soumise avec succès et un vote a été lancé.',
            ephemeral: true
        });
    },

    /**
     * Lancer un vote de candidature (version backup)
     */
    async startCandidatureVote(interaction, reportContent, voteManager, client) {
        const userId = interaction.user.id;
        const targetChannel = await client.channels.fetch(CONFIG.RECRUITMENT_CHANNEL_ID);
        
        if (!targetChannel) {
            console.error(`Le salon de candidature avec l'ID ${CONFIG.RECRUITMENT_CHANNEL_ID} est introuvable.`);
            return null;
        }

        // Protection: limiter la taille totale de l'embed (limite Discord: 6000 caractères)
        const title = `📝 Candidature Modérateur: ${interaction.user.tag}`;
        const embedOverhead = 300; // Titre + fields + timestamp + thumbnail + marge
        const maxContentSize = 6000 - embedOverhead;
        
        const embeds = [];
        
        if (reportContent.length <= maxContentSize) {
            // Un seul embed suffit - cas optimal
            const embed = new EmbedBuilder()
                .setTitle(title)
                .setDescription(reportContent)
                .addFields(
                    { name: '✅ Pour', value: '0', inline: true },
                    { name: '❌ Contre', value: '0', inline: true }
                )
                .setColor('#00FF00')
                .setTimestamp()
                .setThumbnail(interaction.user.displayAvatarURL());
            embeds.push(embed);
        } else {
            // Diviser en plusieurs embeds (limite: 4090 caractères par description)
            const MAX_DESC = 4090;
            const parts = [];
            let current = '';
            const lines = reportContent.split('\n');
            
            for (const line of lines) {
                if ((current + line + '\n').length > MAX_DESC && current.length > 0) {
                    parts.push(current.trim());
                    current = line + '\n';
                } else {
                    current += line + '\n';
                }
            }
            if (current.trim()) parts.push(current.trim());
            
            // Créer les embeds
            parts.forEach((part, i) => {
                const embed = new EmbedBuilder()
                    .setDescription(part)
                    .setColor('#00FF00');
                
                if (i === 0) {
                    embed.setTitle(title).setThumbnail(interaction.user.displayAvatarURL());
                }
                
                if (i === parts.length - 1) {
                    embed.addFields(
                        { name: '✅ Pour', value: '0', inline: true },
                        { name: '❌ Contre', value: '0', inline: true }
                    ).setTimestamp();
                }
                
                embeds.push(embed);
            });
        }

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`recrutement_vote_oui_${userId}`)
                .setLabel('✅ Pour')
                .setStyle(ButtonStyle.Success),
            new ButtonBuilder()
                .setCustomId(`recrutement_vote_non_${userId}`)
                .setLabel('❌ Contre')
                .setStyle(ButtonStyle.Danger),
            new ButtonBuilder()
                .setCustomId(`fin_candidature_vote_${userId}`)
                .setLabel('🏁 Fin du Vote')
                .setStyle(ButtonStyle.Secondary)
        );

        const voteMessage = await targetChannel.send({
            content: '@here Nouvelle candidature !',
            embeds: embeds,
            components: [row]
        });

        // Enregistrer le vote avec timer de 24h
        const startTime = Date.now();
        const endTime = startTime + (24 * 60 * 60 * 1000);

        voteManager.votes[userId] = {
            messageId: voteMessage.id,
            channelId: targetChannel.id,
            oui: 0,
            non: 0,
            voters: {},
            type: 'candidature',
            startTime: startTime,
            endTime: endTime
        };
        voteManager.saveVotes();

        // ⭐ TIMER - Fin automatique après 24h
        setTimeout(async () => {
            try {
                const channel = await client.channels.fetch(targetChannel.id);
                const message = await channel.messages.fetch(voteMessage.id);
                
                if (voteManager.votes[userId]) {
                    const handleEndVote = require('./buttonInteraction').handleEndVote;
                    if (handleEndVote) {
                        await handleEndVote({ message, guild: channel.guild, reply: () => Promise.resolve() }, voteManager);
                    }
                }
            } catch (error) {
                console.error('Erreur fin automatique vote candidature:', error);
            }
        }, 24 * 60 * 60 * 1000);

        // ⭐ RAPPEL - 2h avant la fin
        setTimeout(async () => {
            try {
                const pingStaffRole = CONFIG.STAFF_ROLES.find(r => r.name === 'PingStaff')?.id;
                if (pingStaffRole) {
                    await targetChannel.send({
                        content: `<@&${pingStaffRole}> ⏰ **Rappel**: Il reste 2 heures pour voter sur la candidature de <@${userId}> !`
                    });
                }
            } catch (error) {
                console.error('Erreur envoi rappel vote:', error);
            }
        }, 22 * 60 * 60 * 1000);

        return voteMessage;
    }
};
