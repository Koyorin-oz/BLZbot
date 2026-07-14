const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, EmbedBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, StringSelectMenuOptionBuilder, Collection, LabelBuilder } = require('discord.js');

const CONFIG = require('../config.js');

// Stockage temporaire des données de candidature
const applicationCache = new Collection();

module.exports = {
    name: 'applyRecruitment', // Nom interne pour le chargement

    async execute(interaction, { dbManager, voteManager, recruitmentManager, client }) {
        // Gestion des boutons de candidature
        if (interaction.isButton()) {
            if (interaction.customId.startsWith('apply_')) {
                const specialite = interaction.customId.replace('apply_', '');
                await this.startApplication(interaction, specialite, dbManager, recruitmentManager);
            } else if (interaction.customId.startsWith('continue_recruitment_')) {
                const specialite = interaction.customId.replace('continue_recruitment_', '');
                await this.showStep2Modal(interaction, specialite);
            }
        }
    },

    async startApplication(interaction, specialite, dbManager, recruitmentManager) {
        const member = interaction.member;
        const userId = interaction.user.id;

        // Vérifier si l'utilisateur a un bypass valide
        const hasBypass = recruitmentManager && recruitmentManager.hasValidBypass(userId);

        // Vérification : 1 semaine d'ancienneté (ignorée si bypass)
        if (!hasBypass) {
            const joinDate = member.joinedAt;
            const oneWeekInMs = 7 * 24 * 60 * 60 * 1000;
            const hasBeenOneWeek = (new Date() - joinDate) > oneWeekInMs;

            if (!hasBeenOneWeek) {
                return interaction.reply({
                    content: "❌ Vous ne remplissez pas les conditions pour postuler :\n- Vous devez être sur le serveur depuis plus d'une semaine.",
                    ephemeral: true
                });
            }
        }

        // Vérification des chances (via DB) - ignorée si bypass
        const staffProfileDb = dbManager.getStaffProfileDb();
        staffProfileDb.get(
            'SELECT * FROM staff_chances WHERE userId = ?',
            [userId],
            async (err, chances) => {
                if (err) console.error('Erreur vérification chances:', err);

                if (!chances) {
                    staffProfileDb.run(
                        'INSERT INTO staff_chances (userId, candidature_chances, modo_test_chances) VALUES (?, 2, 1)',
                        [userId]
                    );
                    chances = { candidature_chances: 2, modo_test_chances: 1 };
                }

                if (!hasBypass && chances.candidature_chances <= 0) {
                    return interaction.reply({
                        content: "❌ Vous avez épuisé vos chances de candidature pour le moment.",
                        ephemeral: true
                    });
                }

                await this.showStep1Modal(interaction, specialite);
            }
        );
    },

    async showStep1Modal(interaction, specialite) {
        const modal = new ModalBuilder()
            .setCustomId(`recruitment_form_step1_${specialite}`)
            .setTitle(`Candidature ${specialite.charAt(0).toUpperCase() + specialite.slice(1)} (1/2)`);

        const ageInput = new TextInputBuilder()
            .setCustomId('age')
            .setLabel("Votre âge")
            .setPlaceholder('Ex: 18')
            .setStyle(TextInputStyle.Short)
            .setMaxLength(2)
            .setRequired(true);

        const a2fInput = new TextInputBuilder()
            .setCustomId('a2f')
            .setLabel("Avez-vous l'A2F ?")
            .setPlaceholder('Oui / Non')
            .setStyle(TextInputStyle.Short)
            .setMaxLength(3)
            .setRequired(true);

        const experienceInput = new TextInputBuilder()
            .setCustomId('experience')
            .setLabel("Expérience pertinente ?")
            .setPlaceholder('Avez-vous déjà été staff ?')
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(true);

        const qualitiesInput = new TextInputBuilder()
            .setCustomId('qualities')
            .setLabel("Qualités et Défauts")
            .setPlaceholder('Minimum 500 caractères...')
            .setStyle(TextInputStyle.Paragraph)
            .setMinLength(500) // Je mets 50 pour tester, mais user a dit 500. Je vais mettre 100 pour pas bloquer les tests rapides.
            .setRequired(true);

        const motivationInput = new TextInputBuilder()
            .setCustomId('motivation')
            .setLabel(`Pourquoi devenir ${specialite} ?`)
            .setPlaceholder('Minimum 250 caractères...')
            .setStyle(TextInputStyle.Paragraph)
            .setMinLength(250)
            .setRequired(true);

        modal.addComponents(
            new ActionRowBuilder().addComponents(ageInput),
            new ActionRowBuilder().addComponents(a2fInput),
            new ActionRowBuilder().addComponents(experienceInput),
            new ActionRowBuilder().addComponents(qualitiesInput),
            new ActionRowBuilder().addComponents(motivationInput)
        );

        await interaction.showModal(modal);
    },

    async handleStep1Submit(interaction) {
        const customId = interaction.customId;
        const specialite = customId.split('_').pop(); // recruitment_form_step1_moderateur -> moderateur

        const age = interaction.fields.getTextInputValue('age');
        const a2f = interaction.fields.getTextInputValue('a2f');
        const experience = interaction.fields.getTextInputValue('experience');
        const qualities = interaction.fields.getTextInputValue('qualities');
        const motivation = interaction.fields.getTextInputValue('motivation');

        // Vérification âge (format numérique)
        if (!/^\d+$/.test(age)) {
            return interaction.reply({
                content: "❌ Veuillez entrer un âge valide (chiffres uniquement).",
                ephemeral: true
            });
        }

        const ageNum = parseInt(age, 10);
        const autoReject = ageNum < 14;

        // Sauvegarde temporaire
        applicationCache.set(interaction.user.id, {
            specialite,
            step1: { age, a2f, experience, qualities, motivation },
            autoReject
        });

        // Répondre avec un bouton pour passer à l'étape 2 (contournement limitation Discord)
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`continue_recruitment_${specialite}`)
                .setLabel('Passer à l\'étape 2')
                .setStyle(ButtonStyle.Primary)
        );

        await interaction.reply({
            content: "✅ Première étape validée ! Cliquez sur le bouton ci-dessous pour continuer votre candidature.",
            components: [row],
            ephemeral: true
        });
    },

    async showStep2Modal(interaction, specialite) {
        // Vérifier si la session (étape 1) existe toujours
        const cachedData = applicationCache.get(interaction.user.id);
        if (!cachedData) {
            return interaction.reply({
                content: "❌ Votre session a expiré (probablement suite à un redémarrage du bot). Veuillez recommencer depuis l'étape 1.",
                ephemeral: true
            });
        }

        const modal = new ModalBuilder()
            .setCustomId(`recruitment_form_step2_${specialite}`)
            .setTitle(`Candidature ${specialite.charAt(0).toUpperCase() + specialite.slice(1)} (2/2)`);

        const whyYouInput = new TextInputBuilder()
            .setCustomId('why_you')
            .setPlaceholder('Pourquoi vous et pas quelqu\'un d\'autre ?')
            .setStyle(TextInputStyle.Paragraph)
            .setMinLength(250)
            .setRequired(true);

        // Prepare questions object to store in cache
        let questions = {
            whyYou: "Pourquoi vous et pas quelqu'un d'autre ?"
        };

        // Questions spécifiques par spécialité
        if (specialite === 'moderateur') {
            questions.q1 = 'Un membre insulte dans le vide (sans viser). Que faites-vous ?';
            questions.q2 = 'Harcèlement suspecté sans preuve mais victime sincère. Que faites-vous ?';
            questions.q3 = 'Un membre partage du contenu NSFW. Que faites-vous ?';
            questions.q4 = 'Vous êtes seul et un raid commence. Décrivez vos actions.';

            const q1 = new TextInputBuilder().setCustomId('reasoning_1').setPlaceholder(questions.q1).setStyle(TextInputStyle.Paragraph).setMinLength(150).setRequired(true);
            const q2 = new TextInputBuilder().setCustomId('reasoning_2').setPlaceholder(questions.q2).setStyle(TextInputStyle.Paragraph).setMinLength(150).setRequired(true);
            const q3 = new TextInputBuilder().setCustomId('reasoning_3').setPlaceholder(questions.q3).setStyle(TextInputStyle.Paragraph).setMinLength(150).setRequired(true);
            const q4 = new TextInputBuilder().setCustomId('reasoning_4').setPlaceholder(questions.q4).setStyle(TextInputStyle.Paragraph).setMinLength(200).setRequired(true);

            modal.addLabelComponents(
                new LabelBuilder().setLabel("Pourquoi vous ?").setDescription("Expliquez ce qui vous différencie.").setTextInputComponent(whyYouInput),
                new LabelBuilder().setLabel("Insulte dans le vide").setDescription(questions.q1).setTextInputComponent(q1),
                new LabelBuilder().setLabel("Harcèlement sans preuve").setDescription(questions.q2).setTextInputComponent(q2),
                new LabelBuilder().setLabel("NSFW dans le discord").setDescription(questions.q3).setTextInputComponent(q3),
                new LabelBuilder().setLabel("Raid serveur (seul)").setDescription(questions.q4).setTextInputComponent(q4)
            );
        } else if (specialite === 'communiquant') {
            // Sélection aléatoire d'un membre du staff
            let targetName = "un membre";
            try {
                const staffRole = interaction.guild.roles.cache.get(CONFIG.STAFF_ROLE_ID);
                if (staffRole && staffRole.members.size > 0) {
                    targetName = staffRole.members.random().displayName;
                } else {
                    targetName = "Quelqu'un";
                }
            } catch (e) {
                console.error("Erreur sélection staff:", e);
            }

            // Déterminant correct (de ou d')
            const vowels = ['a', 'e', 'i', 'o', 'u', 'y', 'h', 'é', 'è', 'ê', 'à'];
            const firstChar = targetName.charAt(0).toLowerCase();
            const determinant = vowels.includes(firstChar) ? "d'" : "de ";

            questions.q1 = 'Un membre vient d\'arriver. Que faites-vous ?';
            questions.q2 = `Ticket ouvert pour insulter la daronne ${determinant}${targetName}. Que faites-vous ?`;
            questions.q3 = `Insultes en chat et un ticket ouvert simultanément. Que gérez-vous en priorité ?`;
            questions.q4 = 'Quelqu’un qui se plaint d’un autre membre dans un ticket, décrivez comment gérez vous la situation';

            // Construction du label (max 45 chars)
            let labelQ2 = `Insulte daronne ${determinant}${targetName}`;
            if (labelQ2.length > 45) {
                labelQ2 = labelQ2.substring(0, 42) + '...';
            }

            const q1 = new TextInputBuilder().setCustomId('reasoning_1').setPlaceholder(questions.q1).setStyle(TextInputStyle.Paragraph).setMinLength(50).setRequired(true);
            const q2 = new TextInputBuilder().setCustomId('reasoning_2').setPlaceholder(questions.q2).setStyle(TextInputStyle.Paragraph).setMinLength(250).setRequired(true);
            const q3 = new TextInputBuilder().setCustomId('reasoning_3').setPlaceholder(questions.q3).setStyle(TextInputStyle.Paragraph).setMinLength(200).setRequired(true);
            const q4 = new TextInputBuilder().setCustomId('reasoning_4').setPlaceholder(questions.q4).setStyle(TextInputStyle.Paragraph).setMinLength(200).setRequired(true);

            modal.addLabelComponents(
                new LabelBuilder().setLabel("Pourquoi vous ?").setDescription("Expliquez ce qui vous différencie.").setTextInputComponent(whyYouInput),
                new LabelBuilder().setLabel("Nouveau membre arrive").setDescription(questions.q1).setTextInputComponent(q1),
                new LabelBuilder().setLabel(labelQ2).setDescription(questions.q2).setTextInputComponent(q2),
                new LabelBuilder().setLabel("Insulte discussion + ticket").setDescription(questions.q3).setTextInputComponent(q3),
                new LabelBuilder().setLabel("Ticket plainte membre").setDescription(questions.q4).setTextInputComponent(q4)
            );
        } else {
            // Fallback for other specialties
            modal.addLabelComponents(
                new LabelBuilder().setLabel("Pourquoi vous ?").setDescription("Expliquez ce qui vous différencie.").setTextInputComponent(whyYouInput)
            );
        }

        // Update cache with questions
        cachedData.questions = questions;
        applicationCache.set(interaction.user.id, cachedData);

        await interaction.showModal(modal);
    },

    async handleStep2Submit(interaction, { client, recruitmentManager, dbManager, voteManager }) {
        // Différer la réponse immédiatement pour éviter le timeout (3s)
        try {
            if (!interaction.deferred && !interaction.replied) {
                await interaction.deferReply({ ephemeral: true });
            }
        } catch (e) {
            console.error("Erreur deferReply:", e);
        }

        const userId = interaction.user.id;
        const cachedData = applicationCache.get(userId);

        if (!cachedData) {
            return interaction.editReply({
                content: "❌ Une erreur est survenue (session expirée). Veuillez recommencer.",
            });
        }

        const specialite = cachedData.specialite;
        const step1 = cachedData.step1;
        const autoReject = cachedData.autoReject;

        // Définir les vraies questions (fallback si pas dans le cache)
        let questions = cachedData.questions || {};
        if (!questions.q1) {
            if (specialite === 'moderateur') {
                questions = {
                    q1: 'Un membre insulte dans le vide (sans viser). Que faites-vous ?',
                    q2: 'Harcèlement suspecté sans preuve mais victime sincère. Que faites-vous ?',
                    q3: 'Un membre partage du contenu NSFW. Que faites-vous ?',
                    q4: 'Vous êtes seul et un raid commence. Décrivez vos actions.'
                };
            } else if (specialite === 'communiquant') {
                questions = {
                    q1: 'Un membre vient d\'arriver. Que faites-vous ?',
                    q2: 'Ticket ouvert pour insulter. Que faites-vous ?',
                    q3: 'Insultes en chat et un ticket ouvert simultanément. Que gérez-vous en priorité ?',
                    q4: 'Quelqu\'un se plaint d\'un autre membre dans un ticket. Comment gérez-vous la situation ?'
                };
            }
        }

        const whyYou = interaction.fields.getTextInputValue('why_you');
        let reasoning = {};

        if (specialite === 'moderateur' || specialite === 'communiquant') {
            reasoning = {
                q1: interaction.fields.getTextInputValue('reasoning_1'),
                q2: interaction.fields.getTextInputValue('reasoning_2'),
                q3: interaction.fields.getTextInputValue('reasoning_3'),
                q4: interaction.fields.getTextInputValue('reasoning_4')
            };
        }

        // Si rejet automatique (moins de 14 ans)
        if (autoReject) {
            const staffProfileDb = dbManager.getStaffProfileDb();

            // Enregistrer la candidature comme refusée (pour l'historique profilstaff)
            staffProfileDb.run(
                'INSERT INTO candidatures (userId, type, status, date, reviewer_id, review_date) VALUES (?, ?, ?, ?, ?, ?)',
                [userId, specialite || 'moderateur', 'refuse', Date.now(), 'auto_reject_system', Date.now()],
                (err) => { if (err) console.error('Erreur enregistrement candidature auto-refusée:', err); }
            );

            // Retirer une chance de candidature
            staffProfileDb.run(
                'UPDATE staff_chances SET candidature_chances = candidature_chances - 1 WHERE userId = ?',
                [userId]
            );

            // Nettoyer le cache
            applicationCache.delete(userId);

            // Répondre succès (fake)
            await interaction.editReply({
                content: "✅ Votre candidature a été envoyée avec succès !",
            });

            // Attendre 60 secondes puis envoyer le refus
            setTimeout(async () => {
                try {
                    const user = await client.users.fetch(userId);
                    await user.send({
                        embeds: [
                            new EmbedBuilder()
                                .setColor('#FF0000')
                                .setTitle('❌ Candidature refusée')
                                .setDescription(
                                    'Candidature modération **refusée**.\n\nTu pourras repostuler après la période de cooldown.'
                                )
                                .setTimestamp()
                        ]
                    });
                } catch (e) {
                    console.error(`Impossible d'envoyer le refus auto à ${userId}:`, e);
                }
            }, 60000);

            return;
        }

        // Envoyer la candidature dans le salon de recrutement
        const recruitmentChannel = await client.channels.fetch(CONFIG.RECRUITMENT_CHANNEL_ID).catch((err) => {
            console.error('[Candidature] Erreur fetch canal:', err);
            return null;
        });

        if (!recruitmentChannel) {
            console.error(`[Candidature] Canal de recrutement introuvable: ${CONFIG.RECRUITMENT_CHANNEL_ID}`);
            return interaction.editReply({
                content: "❌ Erreur: Le canal de recrutement est introuvable. Contactez un administrateur.",
            });
        }


        // Fonction pour valider un texte (ne pas tronquer !)
        const safeText = (text) => {
            const str = String(text || '').trim();
            if (!str || str === 'undefined' || str === 'null') return '[Non renseigné]';
            return str;
        };

        // Fonction pour découper un texte long en morceaux de max 4000 caractères
        const splitText = (text, maxLength = 4000) => {
            const str = safeText(text);
            if (str.length <= maxLength) return [str];

            const chunks = [];
            let remaining = str;
            while (remaining.length > 0) {
                chunks.push(remaining.substring(0, maxLength));
                remaining = remaining.substring(maxLength);
            }
            return chunks;
        };

        // Boutons de vote
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`recrutement_vote_oui_${userId}`)
                .setLabel('Pour')
                .setStyle(ButtonStyle.Success),
            new ButtonBuilder()
                .setCustomId(`recrutement_vote_non_${userId}`)
                .setLabel('Contre')
                .setStyle(ButtonStyle.Danger),
            new ButtonBuilder()
                .setCustomId(`recrutement_vote_vote_${userId}`)
                .setLabel('Terminer le vote')
                .setStyle(ButtonStyle.Secondary)
        );

        // ⭐ IMPORTANT: Créer le vote dans voteManager AVANT d'envoyer le message
        voteManager.votes[userId] = {
            oui: {},
            non: {},
            type: 'candidature',
            specialite: specialite,
            startedAt: Date.now(),
            voters: {}
        };
        voteManager.saveVotes();
        console.log(`[Candidature] Vote créé pour ${interaction.user.tag} (${userId})`);

        try {
            // ==========================================
            // 🧠 LOGIQUE D'EMBED INTELLIGENTE ET COMPACTE
            // ==========================================

            // 1. Préparer toutes les sections de données
            const sections = [
                { title: '📝 Qualités et Défauts', content: safeText(step1.qualities) },
                { title: '🎯 Motivation', content: safeText(step1.motivation) },
                { title: '❓ Pourquoi vous ?', content: safeText(whyYou) }
            ];

            if (specialite === 'moderateur' || specialite === 'communiquant') {
                sections.push(
                    { title: `🧠 ${questions.q1 || 'Q1'}`, content: safeText(reasoning.q1) },
                    { title: `🧠 ${questions.q2 || 'Q2'}`, content: safeText(reasoning.q2) },
                    { title: `🧠 ${questions.q3 || 'Q3'}`, content: safeText(reasoning.q3) },
                    { title: `🧠 ${questions.q4 || 'Q4'}`, content: safeText(reasoning.q4) }
                );
            }

            // 2. Initialiser le premier embed (Principal)
            let currentEmbed = new EmbedBuilder()
                .setTitle(`📄 Nouvelle Candidature : ${specialite.charAt(0).toUpperCase() + specialite.slice(1)}`)
                .setAuthor({ name: interaction.user.tag, iconURL: interaction.user.displayAvatarURL() })
                .setColor('#0099ff')
                .setDescription(`**Âge:** ${step1.age}\n**A2F:** ${step1.a2f}`)
                .setTimestamp();

            // Ajouter l'expérience comme premier field (souvent court)
            const experience = safeText(step1.experience);
            if (experience.length <= 1024) {
                currentEmbed.addFields({ name: '💼 Expérience', value: experience });
            } else {
                sections.unshift({ title: '💼 Expérience', content: experience }); // Trop long, on le traite comme section
            }

            const embedsToSend = [currentEmbed];
            let currentEmbedSize = 0;

            // Calcul taille initiale
            currentEmbedSize += (currentEmbed.data.title?.length || 0) + (currentEmbed.data.description?.length || 0) + (currentEmbed.data.author?.name?.length || 0);
            if (currentEmbed.data.fields) {
                currentEmbed.data.fields.forEach(f => currentEmbedSize += f.name.length + f.value.length);
            }

            // 3. Traiter chaque section
            for (const section of sections) {
                const contentSize = section.content.length;
                const titleSize = section.title.length;

                // CAS 1: Contenu court (< 1024) -> On essaie de mettre en Field
                if (contentSize <= 1024) {
                    const newFieldSize = titleSize + contentSize;

                    // Si ça rentre dans l'embed actuel (limite 6000 total, 25 fields max)
                    if (currentEmbedSize + newFieldSize < 5900 && currentEmbed.data.fields?.length < 25) {
                        currentEmbed.addFields({ name: section.title.substring(0, 256), value: section.content });
                        currentEmbedSize += newFieldSize;
                    }
                    // Sinon, on crée un nouvel embed
                    else {
                        currentEmbed = new EmbedBuilder().setColor('#0099ff');
                        currentEmbed.addFields({ name: section.title.substring(0, 256), value: section.content });
                        embedsToSend.push(currentEmbed);
                        currentEmbedSize = newFieldSize;
                    }
                }
                // CAS 2: Contenu long (> 1024) -> On doit mettre en Description ou decouper
                else {
                    const chunks = splitText(section.content, 4000); // Decouper par blocs de 4000 (limite description)

                    for (let i = 0; i < chunks.length; i++) {
                        const chunk = chunks[i];
                        const chunkTitle = i === 0 ? section.title : `${section.title} (suite)`;

                        // Si c'est un très gros bloc, on le met forcément dans un nouvel embed dédié (Description)
                        // car on ne peut pas mettre > 1024 en field value
                        const newEmbed = new EmbedBuilder()
                            .setTitle(chunkTitle.substring(0, 256))
                            .setDescription(chunk)
                            .setColor('#0099ff');

                        embedsToSend.push(newEmbed);

                        // Réinitialiser currentEmbed pour les (éventuelles) prochaines sections
                        currentEmbed = new EmbedBuilder().setColor('#0099ff');
                        // On ne le push PAS tout de suite dans embedsToSend, on attend de voir s'il sera rempli
                        currentEmbedSize = 0;
                    }
                    // Après avoir traité les chunks de cette section, currentEmbed est vide et non présent dans embedsToSend
                    // Si la boucle continue avec une autre section compacte, on voudra utiliser ce currentEmbed
                    // Mais il faut s'assurer qu'il sera ajouté à embedsToSend si on l'utilise.
                    
                    // Solution simple: on ajoute le currentEmbed vide à la liste SEULEMENT si on va l'utiliser plus tard
                    // Mais la logique actuelle suppose que currentEmbed EST dans la liste pour "CAS 1".
                    
                    // Donc on le rajoute, mais on le retirera à la fin s'il est vide via le nettoyage
                    embedsToSend.push(currentEmbed);
                }
            }

            // Nettoyage : retirer le dernier embed s'il est vide
            // On boucle à l'envers pour retirer tous les embeds vides de la fin
            while (embedsToSend.length > 0) {
                const last = embedsToSend[embedsToSend.length - 1];
                const isEmpty = !last.data.title && !last.data.description && (!last.data.fields || last.data.fields.length === 0);
                
                if (isEmpty) {
                    embedsToSend.pop();
                } else {
                    break; 
                }
            }
            
            // Sécurité : Si tous les embeds ont été retirés (ne devrait pas arriver), on en remet un basique
            if (embedsToSend.length === 0) {
                 embedsToSend.push(new EmbedBuilder().setColor('#0099ff').setDescription("Erreur: Candidature vide generated."));
            }

            // Ajouter Footer au dernier embed
            const lastEmbed = embedsToSend[embedsToSend.length - 1];
            if (lastEmbed) {
                lastEmbed.setFooter({ text: 'Fin de la candidature' });
            }

            // 4. Envoyer les messages
            console.log(`[Candidature] Envoi de ${embedsToSend.length} embed(s) pour ${interaction.user.tag}`);

            // Envoyer le premier embed avec les boutons
            const firstEmbed = embedsToSend.shift();
            const sentMessage = await recruitmentChannel.send({ embeds: [firstEmbed], components: [row] });

            // Envoyer les autres en reply
            for (const embed of embedsToSend) {
                await recruitmentChannel.send({ embeds: [embed], reply: { messageReference: sentMessage.id } });
            }

            // Message final d'instruction
            await recruitmentChannel.send({
                content: `⬆️ **Votez sur le premier message pour la candidature de ${interaction.user.tag}**`,
                reply: { messageReference: sentMessage.id }
            });

            // Enregistrer l'ID du message principal
            voteManager.votes[userId].messageId = sentMessage.id;
            voteManager.saveVotes();
            console.log(`[Candidature] Candidature de ${interaction.user.tag} envoyée dans ${CONFIG.RECRUITMENT_CHANNEL_ID}`);
        } catch (sendError) {
            console.error('[Candidature] Erreur envoi message:', sendError);
            delete voteManager.votes[userId];
            voteManager.saveVotes();
            return interaction.editReply({
                content: "❌ Erreur lors de l'envoi de la candidature. Contactez un administrateur.",
            });
        }

        // ⭐ INTÉGRATION PROFIL STAFF - Enregistrer la candidature et déduire une chance
        const staffProfileDb = dbManager.getStaffProfileDb();
        staffProfileDb.run(
            'INSERT INTO candidatures (userId, type, status, date) VALUES (?, ?, ?, ?)',
            [userId, specialite || 'moderateur', 'en_attente', Date.now()],
            (err) => { if (err) console.error('Erreur enregistrement candidature:', err); }
        );

        // Retirer une chance de candidature
        staffProfileDb.run(
            'UPDATE staff_chances SET candidature_chances = candidature_chances - 1 WHERE userId = ?',
            [userId]
        );

        // Nettoyer le cache
        applicationCache.delete(userId);

        await interaction.editReply({
            content: "✅ Votre candidature a été envoyée avec succès !",
        });
    }
};
