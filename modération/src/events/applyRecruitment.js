const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, EmbedBuilder, ButtonBuilder, ButtonStyle, LabelBuilder } = require('discord.js');

const CONFIG = require('../config.js');

const DRAFT_TTL_MS = 24 * 60 * 60 * 1000;
const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;

function dbRun(db, sql, params = []) {
    return new Promise((resolve, reject) => {
        db.run(sql, params, function onRun(err) {
            if (err) reject(err);
            else resolve(this);
        });
    });
}

function dbGet(db, sql, params = []) {
    return new Promise((resolve, reject) => {
        db.get(sql, params, (err, row) => {
            if (err) reject(err);
            else resolve(row);
        });
    });
}

async function saveDraft(db, userId, data) {
    await dbRun(
        db,
        `INSERT INTO recruitment_drafts (userId, specialite, step1_json, questions_json, autoReject, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(userId) DO UPDATE SET
           specialite = excluded.specialite,
           step1_json = excluded.step1_json,
           questions_json = excluded.questions_json,
           autoReject = excluded.autoReject,
           updated_at = excluded.updated_at`,
        [
            userId,
            data.specialite,
            JSON.stringify(data.step1),
            data.questions ? JSON.stringify(data.questions) : null,
            data.autoReject ? 1 : 0,
            Date.now(),
        ],
    );
}

async function loadDraft(db, userId) {
    const row = await dbGet(db, 'SELECT * FROM recruitment_drafts WHERE userId = ?', [userId]);
    if (!row) return null;

    if (Date.now() - row.updated_at > DRAFT_TTL_MS) {
        await deleteDraft(db, userId);
        return null;
    }

    let questions = null;
    if (row.questions_json) {
        try {
            questions = JSON.parse(row.questions_json);
        } catch {
            questions = null;
        }
    }

    let step1 = null;
    try {
        step1 = JSON.parse(row.step1_json);
    } catch {
        await deleteDraft(db, userId);
        return null;
    }

    return {
        specialite: row.specialite,
        step1,
        questions,
        autoReject: Boolean(row.autoReject),
    };
}

async function deleteDraft(db, userId) {
    await dbRun(db, 'DELETE FROM recruitment_drafts WHERE userId = ?', [userId]);
}

function safeText(text) {
    const str = String(text || '').trim();
    if (!str || str === 'undefined' || str === 'null') return '[Non renseigné]';
    return str;
}

/** Découpe un texte long en morceaux valides pour embed.description (max 4096). */
function chunkText(text, maxLen = 4090) {
    const str = String(text || '').trim();
    if (!str) return ['[Non renseigné]'];

    const chunks = [];
    let i = 0;
    while (i < str.length) {
        let end = Math.min(i + maxLen, str.length);
        if (end < str.length) {
            const slice = str.slice(i, end);
            const lastNl = slice.lastIndexOf('\n');
            if (lastNl > 200) end = i + lastNl + 1;
        }
        const piece = str.slice(i, end).trim();
        if (piece.length > 0) chunks.push(piece);
        const next = end > i ? end : i + maxLen;
        i = next;
    }

    return chunks.length > 0 ? chunks : ['[Non renseigné]'];
}

function ensureEmbedDescription(embed) {
    const desc = embed.data?.description;
    if (!desc || String(desc).trim().length === 0) {
        embed.setDescription('…');
    } else if (String(desc).length > 4096) {
        embed.setDescription(String(desc).slice(0, 4096));
    }
    return embed;
}

function buildRecruitmentEmbeds(interaction, { specialite, step1, whyYou, reasoning, questions }) {
    const blocks = [
        `**Âge :** ${safeText(step1.age)}`,
        `**A2F :** ${safeText(step1.a2f)}`,
        '',
        '**💼 Expérience**',
        safeText(step1.experience),
        '',
        '**📝 Qualités et Défauts**',
        safeText(step1.qualities),
        '',
        '**🎯 Motivation**',
        safeText(step1.motivation),
        '',
        '**❓ Pourquoi vous ?**',
        safeText(whyYou),
    ];

    if (specialite === 'moderateur' || specialite === 'communiquant') {
        blocks.push(
            '',
            `**🧠 ${questions.q1 || 'Question 1'}**`,
            safeText(reasoning.q1),
            '',
            `**🧠 ${questions.q2 || 'Question 2'}**`,
            safeText(reasoning.q2),
            '',
            `**🧠 ${questions.q3 || 'Question 3'}**`,
            safeText(reasoning.q3),
            '',
            `**🧠 ${questions.q4 || 'Question 4'}**`,
            safeText(reasoning.q4),
        );
    }

    const fullText = blocks.join('\n');
    const title = `📄 Candidature ${specialite.charAt(0).toUpperCase() + specialite.slice(1)} — ${interaction.user.tag}`;
    const MAX_DESC = 4090;
    const embeds = [];

    if (fullText.length <= MAX_DESC) {
        embeds.push(
            new EmbedBuilder()
                .setTitle(title.substring(0, 256))
                .setAuthor({ name: interaction.user.tag, iconURL: interaction.user.displayAvatarURL() })
                .setDescription(fullText)
                .setColor('#0099ff')
                .setTimestamp(),
        );
        return embeds;
    }

    const parts = [];
    let current = '';
    for (const line of fullText.split('\n')) {
        const next = current ? `${current}\n${line}` : line;
        if (next.length > MAX_DESC && current.length > 0) {
            parts.push(current);
            current = line;
        } else {
            current = next;
        }
    }
    if (current.trim()) parts.push(current);

    parts.forEach((part, index) => {
        const embed = new EmbedBuilder()
            .setDescription(part)
            .setColor('#0099ff');
        if (index === 0) {
            embed
                .setTitle(title.substring(0, 256))
                .setAuthor({ name: interaction.user.tag, iconURL: interaction.user.displayAvatarURL() });
        }
        if (index === parts.length - 1) {
            embed.setFooter({ text: 'Fin de la candidature' }).setTimestamp();
        }
        embeds.push(embed);
    });

    return embeds;
}

module.exports = {
    name: 'applyRecruitment',

    async execute(interaction, { dbManager, voteManager, recruitmentManager, client }) {
        if (interaction.isButton()) {
            if (interaction.customId.startsWith('apply_')) {
                const specialite = interaction.customId.replace('apply_', '');
                await this.startApplication(interaction, specialite, dbManager, recruitmentManager);
            } else if (interaction.customId.startsWith('continue_recruitment_')) {
                const specialite = interaction.customId.replace('continue_recruitment_', '');
                await this.showStep2Modal(interaction, specialite, dbManager);
            }
        }
    },

    async startApplication(interaction, specialite, dbManager, recruitmentManager) {
        const member = interaction.member;
        const userId = interaction.user.id;
        const hasBypass = recruitmentManager && recruitmentManager.hasValidBypass(userId);

        if (!hasBypass) {
            const joinDate = member.joinedAt;
            const hasBeenOneWeek = joinDate && (Date.now() - joinDate.getTime()) > ONE_WEEK_MS;

            if (!hasBeenOneWeek) {
                return interaction.reply({
                    content: "❌ Vous ne remplissez pas les conditions pour postuler :\n- Vous devez être sur le serveur depuis plus d'une semaine.",
                    ephemeral: true,
                });
            }
        }

        const staffProfileDb = dbManager.getStaffProfileDb();
        staffProfileDb.get(
            'SELECT * FROM staff_chances WHERE userId = ?',
            [userId],
            async (err, chances) => {
                if (err) console.error('Erreur vérification chances:', err);

                if (!chances) {
                    staffProfileDb.run(
                        'INSERT INTO staff_chances (userId, candidature_chances, modo_test_chances) VALUES (?, 2, 1)',
                        [userId],
                    );
                    chances = { candidature_chances: 2, modo_test_chances: 1 };
                }

                if (!hasBypass && chances.candidature_chances <= 0) {
                    return interaction.reply({
                        content: '❌ Vous avez épuisé vos chances de candidature pour le moment.',
                        ephemeral: true,
                    });
                }

                await this.showStep1Modal(interaction, specialite);
            },
        );
    },

    async showStep1Modal(interaction, specialite) {
        const modal = new ModalBuilder()
            .setCustomId(`recruitment_form_step1_${specialite}`)
            .setTitle(`Candidature ${specialite.charAt(0).toUpperCase() + specialite.slice(1)} (1/2)`);

        const ageInput = new TextInputBuilder()
            .setCustomId('age')
            .setLabel('Votre âge')
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
            .setLabel('Expérience pertinente ?')
            .setPlaceholder('Avez-vous déjà été staff ?')
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(true);

        const qualitiesInput = new TextInputBuilder()
            .setCustomId('qualities')
            .setLabel('Qualités et Défauts')
            .setPlaceholder('Minimum 500 caractères...')
            .setStyle(TextInputStyle.Paragraph)
            .setMinLength(500)
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
            new ActionRowBuilder().addComponents(motivationInput),
        );

        await interaction.showModal(modal);
    },

    async handleStep1Submit(interaction, { dbManager }) {
        const customId = interaction.customId;
        const specialite = customId.split('_').pop();

        const age = interaction.fields.getTextInputValue('age');
        const a2f = interaction.fields.getTextInputValue('a2f');
        const experience = interaction.fields.getTextInputValue('experience');
        const qualities = interaction.fields.getTextInputValue('qualities');
        const motivation = interaction.fields.getTextInputValue('motivation');

        if (!/^\d+$/.test(age)) {
            return interaction.reply({
                content: '❌ Veuillez entrer un âge valide (chiffres uniquement).',
                ephemeral: true,
            });
        }

        const ageNum = parseInt(age, 10);
        const autoReject = ageNum < 14;
        const staffProfileDb = dbManager.getStaffProfileDb();

        try {
            await saveDraft(staffProfileDb, interaction.user.id, {
                specialite,
                step1: { age, a2f, experience, qualities, motivation },
                autoReject,
            });
        } catch (e) {
            console.error('[Candidature] Erreur sauvegarde brouillon étape 1:', e);
            return interaction.reply({
                content: '❌ Impossible de sauvegarder votre progression. Réessayez dans un instant.',
                ephemeral: true,
            });
        }

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`continue_recruitment_${specialite}`)
                .setLabel("Passer à l'étape 2")
                .setStyle(ButtonStyle.Primary),
        );

        await interaction.reply({
            content: '✅ Première étape validée ! Cliquez sur le bouton ci-dessous pour continuer votre candidature.',
            components: [row],
            ephemeral: true,
        });
    },

    async showStep2Modal(interaction, specialite, dbManager) {
        const staffProfileDb = dbManager.getStaffProfileDb();
        let cachedData;

        try {
            cachedData = await loadDraft(staffProfileDb, interaction.user.id);
        } catch (e) {
            console.error('[Candidature] Erreur lecture brouillon:', e);
        }

        if (!cachedData || cachedData.specialite !== specialite) {
            return interaction.reply({
                content: '❌ Votre session a expiré ou est invalide. Veuillez recommencer depuis l\'étape 1.',
                ephemeral: true,
            });
        }

        const modal = new ModalBuilder()
            .setCustomId(`recruitment_form_step2_${specialite}`)
            .setTitle(`Candidature ${specialite.charAt(0).toUpperCase() + specialite.slice(1)} (2/2)`);

        const whyYouInput = new TextInputBuilder()
            .setCustomId('why_you')
            .setPlaceholder("Pourquoi vous et pas quelqu'un d'autre ?")
            .setStyle(TextInputStyle.Paragraph)
            .setMinLength(250)
            .setRequired(true);

        const questions = {
            whyYou: "Pourquoi vous et pas quelqu'un d'autre ?",
        };

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
                new LabelBuilder().setLabel('Pourquoi vous ?').setDescription('Expliquez ce qui vous différencie.').setTextInputComponent(whyYouInput),
                new LabelBuilder().setLabel('Insulte dans le vide').setDescription(questions.q1).setTextInputComponent(q1),
                new LabelBuilder().setLabel('Harcèlement sans preuve').setDescription(questions.q2).setTextInputComponent(q2),
                new LabelBuilder().setLabel('NSFW dans le discord').setDescription(questions.q3).setTextInputComponent(q3),
                new LabelBuilder().setLabel('Raid serveur (seul)').setDescription(questions.q4).setTextInputComponent(q4),
            );
        } else if (specialite === 'communiquant') {
            let targetName = 'un membre';
            try {
                const staffRole = interaction.guild.roles.cache.get(CONFIG.STAFF_ROLE_ID);
                if (staffRole && staffRole.members.size > 0) {
                    targetName = staffRole.members.random().displayName;
                } else {
                    targetName = 'Quelqu\'un';
                }
            } catch (e) {
                console.error('Erreur sélection staff:', e);
            }

            const vowels = ['a', 'e', 'i', 'o', 'u', 'y', 'h', 'é', 'è', 'ê', 'à'];
            const firstChar = targetName.charAt(0).toLowerCase();
            const determinant = vowels.includes(firstChar) ? "d'" : 'de ';

            questions.q1 = 'Un membre vient d\'arriver. Que faites-vous ?';
            questions.q2 = `Ticket ouvert pour insulter la daronne ${determinant}${targetName}. Que faites-vous ?`;
            questions.q3 = 'Insultes en chat et un ticket ouvert simultanément. Que gérez-vous en priorité ?';
            questions.q4 = 'Quelqu’un qui se plaint d’un autre membre dans un ticket, décrivez comment gérez vous la situation';

            let labelQ2 = `Insulte daronne ${determinant}${targetName}`;
            if (labelQ2.length > 45) {
                labelQ2 = `${labelQ2.substring(0, 42)}...`;
            }

            const q1 = new TextInputBuilder().setCustomId('reasoning_1').setPlaceholder(questions.q1).setStyle(TextInputStyle.Paragraph).setMinLength(50).setRequired(true);
            const q2 = new TextInputBuilder().setCustomId('reasoning_2').setPlaceholder(questions.q2).setStyle(TextInputStyle.Paragraph).setMinLength(250).setRequired(true);
            const q3 = new TextInputBuilder().setCustomId('reasoning_3').setPlaceholder(questions.q3).setStyle(TextInputStyle.Paragraph).setMinLength(200).setRequired(true);
            const q4 = new TextInputBuilder().setCustomId('reasoning_4').setPlaceholder(questions.q4).setStyle(TextInputStyle.Paragraph).setMinLength(200).setRequired(true);

            modal.addLabelComponents(
                new LabelBuilder().setLabel('Pourquoi vous ?').setDescription('Expliquez ce qui vous différencie.').setTextInputComponent(whyYouInput),
                new LabelBuilder().setLabel('Nouveau membre arrive').setDescription(questions.q1).setTextInputComponent(q1),
                new LabelBuilder().setLabel(labelQ2).setDescription(questions.q2).setTextInputComponent(q2),
                new LabelBuilder().setLabel('Insulte discussion + ticket').setDescription(questions.q3).setTextInputComponent(q3),
                new LabelBuilder().setLabel('Ticket plainte membre').setDescription(questions.q4).setTextInputComponent(q4),
            );
        } else {
            modal.addLabelComponents(
                new LabelBuilder().setLabel('Pourquoi vous ?').setDescription('Expliquez ce qui vous différencie.').setTextInputComponent(whyYouInput),
            );
        }

        cachedData.questions = questions;
        try {
            await saveDraft(staffProfileDb, interaction.user.id, cachedData);
        } catch (e) {
            console.error('[Candidature] Erreur mise à jour brouillon étape 2:', e);
        }

        await interaction.showModal(modal);
    },

    async handleStep2Submit(interaction, { client, dbManager, voteManager }) {
        try {
            if (!interaction.deferred && !interaction.replied) {
                await interaction.deferReply({ ephemeral: true });
            }
        } catch (e) {
            console.error('Erreur deferReply:', e);
        }

        const userId = interaction.user.id;
        const staffProfileDb = dbManager.getStaffProfileDb();
        let cachedData;

        try {
            cachedData = await loadDraft(staffProfileDb, userId);
        } catch (e) {
            console.error('[Candidature] Erreur lecture brouillon étape 2:', e);
        }

        if (!cachedData) {
            return interaction.editReply({
                content: '❌ Une erreur est survenue (session expirée). Veuillez recommencer.',
            });
        }

        const specialite = cachedData.specialite;
        const step1 = cachedData.step1;
        const autoReject = cachedData.autoReject;

        let questions = cachedData.questions || {};
        if (!questions.q1) {
            if (specialite === 'moderateur') {
                questions = {
                    q1: 'Un membre insulte dans le vide (sans viser). Que faites-vous ?',
                    q2: 'Harcèlement suspecté sans preuve mais victime sincère. Que faites-vous ?',
                    q3: 'Un membre partage du contenu NSFW. Que faites-vous ?',
                    q4: 'Vous êtes seul et un raid commence. Décrivez vos actions.',
                };
            } else if (specialite === 'communiquant') {
                questions = {
                    q1: 'Un membre vient d\'arriver. Que faites-vous ?',
                    q2: 'Ticket ouvert pour insulter. Que faites-vous ?',
                    q3: 'Insultes en chat et un ticket ouvert simultanément. Que gérez-vous en priorité ?',
                    q4: 'Quelqu\'un se plaint d\'un autre membre dans un ticket. Comment gérez-vous la situation ?',
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
                q4: interaction.fields.getTextInputValue('reasoning_4'),
            };
        }

        if (autoReject) {
            staffProfileDb.run(
                'INSERT INTO candidatures (userId, type, status, date, reviewer_id, review_date) VALUES (?, ?, ?, ?, ?, ?)',
                [userId, specialite || 'moderateur', 'refuse', Date.now(), 'auto_reject_system', Date.now()],
                (err) => { if (err) console.error('Erreur enregistrement candidature auto-refusée:', err); },
            );

            staffProfileDb.run(
                'UPDATE staff_chances SET candidature_chances = candidature_chances - 1 WHERE userId = ?',
                [userId],
            );

            await deleteDraft(staffProfileDb, userId);

            await interaction.editReply({
                content: '✅ Votre candidature a été envoyée avec succès !',
            });

            setTimeout(async () => {
                try {
                    const user = await client.users.fetch(userId);
                    await user.send({
                        embeds: [
                            new EmbedBuilder()
                                .setColor('#FF0000')
                                .setTitle('❌ Candidature refusée')
                                .setDescription(
                                    'Candidature modération **refusée**.\n\nTu pourras repostuler après la période de cooldown.',
                                )
                                .setTimestamp(),
                        ],
                    });
                } catch (e) {
                    console.error(`Impossible d'envoyer le refus auto à ${userId}:`, e);
                }
            }, 60000);

            return;
        }

        if (!voteManager) {
            console.error('[Candidature] voteManager indisponible');
            return interaction.editReply({
                content: '❌ Erreur interne (votes). Contactez un administrateur.',
            });
        }

        const recruitmentChannel = await client.channels.fetch(CONFIG.RECRUITMENT_CHANNEL_ID).catch((err) => {
            console.error('[Candidature] Erreur fetch canal:', err);
            return null;
        });

        if (!recruitmentChannel) {
            console.error(`[Candidature] Canal de recrutement introuvable: ${CONFIG.RECRUITMENT_CHANNEL_ID}`);
            return interaction.editReply({
                content: '❌ Erreur : le canal de recrutement est introuvable. Contactez un administrateur.',
            });
        }

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
                .setStyle(ButtonStyle.Secondary),
        );

        voteManager.votes[userId] = {
            oui: {},
            non: {},
            type: 'candidature',
            specialite,
            startedAt: Date.now(),
            voters: {},
        };
        voteManager.saveVotes();
        console.log(`[Candidature] Vote créé pour ${interaction.user.tag} (${userId})`);

        try {
            const embeds = buildRecruitmentEmbeds(interaction, { specialite, step1, whyYou, reasoning, questions });
            console.log(`[Candidature] Envoi de ${embeds.length} embed(s) pour ${interaction.user.tag}`);

            const [firstEmbed, ...otherEmbeds] = embeds;
            const sentMessage = await recruitmentChannel.send({
                embeds: [firstEmbed],
                components: [row],
            });

            for (const embed of otherEmbeds) {
                await recruitmentChannel.send({ embeds: [embed] });
            }

            await recruitmentChannel.send({
                content: `⬆️ **Votez sur le premier message pour la candidature de ${interaction.user.tag}**`,
            });

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

        staffProfileDb.run(
            'INSERT INTO candidatures (userId, type, status, date) VALUES (?, ?, ?, ?)',
            [userId, specialite || 'moderateur', 'en_attente', Date.now()],
            (err) => { if (err) console.error('Erreur enregistrement candidature:', err); },
        );

        staffProfileDb.run(
            'UPDATE staff_chances SET candidature_chances = candidature_chances - 1 WHERE userId = ?',
            [userId],
        );

        await deleteDraft(staffProfileDb, userId);

        await interaction.editReply({
            content: '✅ Votre candidature a été envoyée avec succès !',
        });
    },
};
