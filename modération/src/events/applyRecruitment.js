const {
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    ActionRowBuilder,
    EmbedBuilder,
    ButtonBuilder,
    ButtonStyle,
    LabelBuilder,
    MessageFlags,
} = require('discord.js');
const CONFIG = require('../config.js');

const DRAFT_TTL_MS = 24 * 60 * 60 * 1000;
const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const EPHEMERAL = MessageFlags.Ephemeral;

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

    if (Date.now() - Number(row.updated_at || 0) > DRAFT_TTL_MS) {
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

    let step1;
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

function isGone(err) {
    return err?.code === 10062 || err?.code === 40060;
}

async function safeReply(interaction, payload) {
    try {
        if (interaction.deferred || interaction.replied) {
            return await interaction.followUp(payload);
        }
        return await interaction.reply(payload);
    } catch (err) {
        if (!isGone(err)) console.error('[Candidature] reply:', err?.message || err);
        return null;
    }
}

async function safeEdit(interaction, payload) {
    try {
        if (interaction.deferred || interaction.replied) {
            return await interaction.editReply(payload);
        }
        return await interaction.reply(payload);
    } catch (err) {
        if (!isGone(err)) console.error('[Candidature] editReply:', err?.message || err);
        return null;
    }
}

async function safeShowModal(interaction, modal) {
    try {
        await interaction.showModal(modal);
        return true;
    } catch (err) {
        console.error('[Candidature] showModal:', err?.message || err);
        await safeReply(interaction, {
            content: '❌ Interaction expirée. Reclique sur le bouton pour recommencer.',
            flags: EPHEMERAL,
        });
        return false;
    }
}

function safeText(text) {
    const str = String(text || '').trim();
    if (!str || str === 'undefined' || str === 'null') return '[Non renseigné]';
    return str;
}

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
        i = end > i ? end : i + maxLen;
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
    const parts = chunkText(fullText);

    return parts.map((part, index) => {
        const embed = new EmbedBuilder().setDescription(part).setColor('#0099ff');
        if (index === 0) {
            embed
                .setTitle(title.substring(0, 256))
                .setAuthor({ name: interaction.user.tag, iconURL: interaction.user.displayAvatarURL() });
        }
        if (index === parts.length - 1) {
            embed.setFooter({ text: 'Fin de la candidature' }).setTimestamp();
        }
        return ensureEmbedDescription(embed);
    });
}

module.exports = {
    name: 'applyRecruitment',

    async execute(interaction, ctx) {
        if (!interaction.isButton()) return;

        try {
            if (interaction.customId.startsWith('apply_')) {
                const specialite = interaction.customId.replace('apply_', '');
                await this.startApplication(interaction, specialite, ctx.dbManager, ctx.recruitmentManager);
            } else if (interaction.customId.startsWith('continue_recruitment_')) {
                const specialite = interaction.customId.replace('continue_recruitment_', '');
                await this.showStep2Modal(interaction, specialite, ctx.dbManager);
            }
        } catch (err) {
            console.error('[Candidature] execute:', err);
            await safeReply(interaction, {
                content: '❌ Erreur candidature. Réessaie.',
                flags: EPHEMERAL,
            });
        }
    },

    async startApplication(interaction, specialite, dbManager, recruitmentManager) {
        const member = interaction.member;
        const userId = interaction.user.id;
        const hasBypass =
            recruitmentManager && typeof recruitmentManager.hasValidBypass === 'function'
                ? recruitmentManager.hasValidBypass(userId)
                : false;

        // Checks sync only — showModal doit partir dans les 3s Discord
        if (!hasBypass) {
            const joinDate = member?.joinedAt;
            const ok = joinDate && Date.now() - joinDate.getTime() > ONE_WEEK_MS;
            if (!ok) {
                return safeReply(interaction, {
                    content: "❌ Tu dois être sur le serveur depuis plus d'une semaine pour postuler.",
                    flags: EPHEMERAL,
                });
            }
        }

        // Modal d'abord ; les chances SQLite sont vérifiées à la soumission étape 1
        await this.showStep1Modal(interaction, specialite);
    },

    async showStep1Modal(interaction, specialite) {
        const modal = new ModalBuilder()
            .setCustomId(`recruitment_form_step1_${specialite}`)
            .setTitle(`Candidature ${String(specialite).slice(0, 12)} (1/2)`.slice(0, 45));

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
            .setPlaceholder('As-tu déjà été staff ?')
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(true);

        // Pas de minLength Discord (bouton Submit grisé) — check côté bot après
        const qualitiesInput = new TextInputBuilder()
            .setCustomId('qualities')
            .setLabel('Qualités et Défauts')
            .setPlaceholder('Développe un peu (vise ~300 caractères)')
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(true);

        const motivationInput = new TextInputBuilder()
            .setCustomId('motivation')
            .setLabel(`Pourquoi devenir ${String(specialite).slice(0, 18)} ?`.slice(0, 45))
            .setPlaceholder('Développe ta motivation (vise ~200 caractères)')
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(true);

        modal.addComponents(
            new ActionRowBuilder().addComponents(ageInput),
            new ActionRowBuilder().addComponents(a2fInput),
            new ActionRowBuilder().addComponents(experienceInput),
            new ActionRowBuilder().addComponents(qualitiesInput),
            new ActionRowBuilder().addComponents(motivationInput),
        );

        await safeShowModal(interaction, modal);
    },

    async handleStep1Submit(interaction, { dbManager, recruitmentManager }) {
        try {
            if (!interaction.deferred && !interaction.replied) {
                await interaction.deferReply({ flags: EPHEMERAL });
            }
        } catch (e) {
            if (isGone(e)) return;
            console.error('[Candidature] defer step1:', e?.message || e);
        }

        const specialite = interaction.customId.replace('recruitment_form_step1_', '');
        const age = interaction.fields.getTextInputValue('age');
        const a2f = interaction.fields.getTextInputValue('a2f');
        const experience = interaction.fields.getTextInputValue('experience');
        const qualities = interaction.fields.getTextInputValue('qualities');
        const motivation = interaction.fields.getTextInputValue('motivation');
        const userId = interaction.user.id;
        const staffProfileDb = dbManager.getStaffProfileDb();
        const hasBypass =
            recruitmentManager && typeof recruitmentManager.hasValidBypass === 'function'
                ? recruitmentManager.hasValidBypass(userId)
                : false;

        // Chances (reportées ici pour ne pas bloquer showModal)
        if (!hasBypass) {
            try {
                let chances = await dbGet(staffProfileDb, 'SELECT * FROM staff_chances WHERE userId = ?', [userId]);
                if (!chances) {
                    await dbRun(
                        staffProfileDb,
                        'INSERT OR IGNORE INTO staff_chances (userId, candidature_chances, modo_test_chances) VALUES (?, 2, 1)',
                        [userId],
                    );
                    chances = { candidature_chances: 2, modo_test_chances: 1 };
                }
                if (Number(chances.candidature_chances) <= 0) {
                    return safeEdit(interaction, {
                        content: '❌ Plus de chances de candidature pour le moment.',
                    });
                }
            } catch (err) {
                console.error('[Candidature] chances step1:', err);
            }
        }

        if (!/^\d+$/.test(age)) {
            return safeEdit(interaction, { content: '❌ Âge invalide (chiffres uniquement).' });
        }

        if (qualities.trim().length < 150) {
            return safeEdit(interaction, {
                content: `❌ Qualités/défauts trop courts (${qualities.trim().length}/150 min). Rouvre l’étape 1 et développe.`,
            });
        }
        if (motivation.trim().length < 100) {
            return safeEdit(interaction, {
                content: `❌ Motivation trop courte (${motivation.trim().length}/100 min). Rouvre l’étape 1 et développe.`,
            });
        }

        const ageNum = parseInt(age, 10);
        const autoReject = ageNum < 14;

        try {
            await saveDraft(staffProfileDb, userId, {
                specialite,
                step1: { age, a2f, experience, qualities, motivation },
                autoReject,
            });
        } catch (e) {
            console.error('[Candidature] save draft step1:', e);
            return safeEdit(interaction, {
                content: '❌ Impossible de sauvegarder. Réessaie dans un instant.',
            });
        }

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`continue_recruitment_${specialite}`)
                .setLabel("Passer à l'étape 2")
                .setStyle(ButtonStyle.Primary),
        );

        await safeEdit(interaction, {
            content: '✅ Étape 1 OK. Clique sur le bouton pour l’étape 2 (valable 24h).',
            components: [row],
        });
    },

    async showStep2Modal(interaction, specialite, dbManager) {
        const staffProfileDb = dbManager.getStaffProfileDb();
        let draft;

        try {
            draft = await loadDraft(staffProfileDb, interaction.user.id);
        } catch (e) {
            console.error('[Candidature] load draft step2:', e);
        }

        if (!draft || draft.specialite !== specialite) {
            return safeReply(interaction, {
                content: '❌ Session expirée / invalide. Recommence depuis l’étape 1.',
                flags: EPHEMERAL,
            });
        }

        const modal = new ModalBuilder()
            .setCustomId(`recruitment_form_step2_${specialite}`)
            .setTitle(`Candidature ${String(specialite).slice(0, 12)} (2/2)`.slice(0, 45));

        const whyYouInput = new TextInputBuilder()
            .setCustomId('why_you')
            .setPlaceholder("Pourquoi vous et pas quelqu'un d'autre ? (développe)")
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(true);

        const questions = {
            whyYou: "Pourquoi vous et pas quelqu'un d'autre ?",
        };

        if (specialite === 'moderateur') {
            questions.q1 = 'Un membre insulte dans le vide (sans viser). Que faites-vous ?';
            questions.q2 = 'Harcèlement suspecté sans preuve mais victime sincère. Que faites-vous ?';
            questions.q3 = 'Un membre partage du contenu NSFW. Que faites-vous ?';
            questions.q4 = 'Vous êtes seul et un raid commence. Décrivez vos actions.';

            const q1 = new TextInputBuilder().setCustomId('reasoning_1').setPlaceholder(questions.q1).setStyle(TextInputStyle.Paragraph).setRequired(true);
            const q2 = new TextInputBuilder().setCustomId('reasoning_2').setPlaceholder(questions.q2).setStyle(TextInputStyle.Paragraph).setRequired(true);
            const q3 = new TextInputBuilder().setCustomId('reasoning_3').setPlaceholder(questions.q3).setStyle(TextInputStyle.Paragraph).setRequired(true);
            const q4 = new TextInputBuilder().setCustomId('reasoning_4').setPlaceholder(questions.q4).setStyle(TextInputStyle.Paragraph).setRequired(true);

            modal.addLabelComponents(
                new LabelBuilder().setLabel('Pourquoi vous ?').setDescription('Ce qui vous différencie.').setTextInputComponent(whyYouInput),
                new LabelBuilder().setLabel('Insulte dans le vide').setDescription(questions.q1).setTextInputComponent(q1),
                new LabelBuilder().setLabel('Harcèlement sans preuve').setDescription(questions.q2).setTextInputComponent(q2),
                new LabelBuilder().setLabel('NSFW dans le discord').setDescription(questions.q3).setTextInputComponent(q3),
                new LabelBuilder().setLabel('Raid serveur (seul)').setDescription(questions.q4).setTextInputComponent(q4),
            );
        } else if (specialite === 'communiquant') {
            // Nom générique (pas de scan rôles) → showModal plus rapide, moins de timeouts
            questions.q1 = "Un membre vient d'arriver. Que faites-vous ?";
            questions.q2 = "Ticket ouvert pour insulter la daronne d'un staff. Que faites-vous ?";
            questions.q3 = 'Insultes en chat et un ticket ouvert simultanément. Que gérez-vous en priorité ?';
            questions.q4 = "Quelqu'un se plaint d'un autre membre dans un ticket. Comment gérez-vous ?";

            const q1 = new TextInputBuilder().setCustomId('reasoning_1').setPlaceholder(questions.q1).setStyle(TextInputStyle.Paragraph).setRequired(true);
            const q2 = new TextInputBuilder().setCustomId('reasoning_2').setPlaceholder(questions.q2).setStyle(TextInputStyle.Paragraph).setRequired(true);
            const q3 = new TextInputBuilder().setCustomId('reasoning_3').setPlaceholder(questions.q3).setStyle(TextInputStyle.Paragraph).setRequired(true);
            const q4 = new TextInputBuilder().setCustomId('reasoning_4').setPlaceholder(questions.q4).setStyle(TextInputStyle.Paragraph).setRequired(true);

            modal.addLabelComponents(
                new LabelBuilder().setLabel('Pourquoi vous ?').setDescription('Ce qui vous différencie.').setTextInputComponent(whyYouInput),
                new LabelBuilder().setLabel('Nouveau membre arrive').setDescription(questions.q1).setTextInputComponent(q1),
                new LabelBuilder().setLabel('Insulte daronne staff').setDescription(questions.q2).setTextInputComponent(q2),
                new LabelBuilder().setLabel('Insulte discussion + ticket').setDescription(questions.q3).setTextInputComponent(q3),
                new LabelBuilder().setLabel('Ticket plainte membre').setDescription(questions.q4).setTextInputComponent(q4),
            );
        } else {
            modal.addLabelComponents(
                new LabelBuilder().setLabel('Pourquoi vous ?').setDescription('Ce qui vous différencie.').setTextInputComponent(whyYouInput),
            );
        }

        draft.questions = questions;
        try {
            await saveDraft(staffProfileDb, interaction.user.id, draft);
        } catch (e) {
            console.error('[Candidature] update draft step2:', e);
        }

        await safeShowModal(interaction, modal);
    },

    async handleStep2Submit(interaction, { client, dbManager, voteManager }) {
        try {
            if (!interaction.deferred && !interaction.replied) {
                await interaction.deferReply({ flags: EPHEMERAL });
            }
        } catch (e) {
            if (isGone(e)) return;
            console.error('[Candidature] defer step2:', e?.message || e);
        }

        const userId = interaction.user.id;
        const staffProfileDb = dbManager.getStaffProfileDb();
        let draft;

        try {
            draft = await loadDraft(staffProfileDb, userId);
        } catch (e) {
            console.error('[Candidature] load draft step2 submit:', e);
        }

        if (!draft) {
            return safeEdit(interaction, {
                content: '❌ Session expirée. Recommence depuis l’étape 1.',
            });
        }

        const specialite = draft.specialite;
        const step1 = draft.step1;
        const autoReject = draft.autoReject;

        let questions = draft.questions || {};
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
                    q1: "Un membre vient d'arriver. Que faites-vous ?",
                    q2: 'Ticket ouvert pour insulter. Que faites-vous ?',
                    q3: 'Insultes en chat et un ticket ouvert simultanément. Que gérez-vous en priorité ?',
                    q4: "Plainte contre un membre dans un ticket. Comment gérez-vous ?",
                };
            }
        }

        let whyYou = '';
        try {
            whyYou = interaction.fields.getTextInputValue('why_you');
        } catch {
            whyYou = '';
        }

        let reasoning = {};
        if (specialite === 'moderateur' || specialite === 'communiquant') {
            try {
                reasoning = {
                    q1: interaction.fields.getTextInputValue('reasoning_1'),
                    q2: interaction.fields.getTextInputValue('reasoning_2'),
                    q3: interaction.fields.getTextInputValue('reasoning_3'),
                    q4: interaction.fields.getTextInputValue('reasoning_4'),
                };
            } catch (e) {
                console.error('[Candidature] fields step2:', e?.message || e);
                return safeEdit(interaction, {
                    content: '❌ Formulaire incomplet. Reprends l’étape 2.',
                });
            }
        }

        if (autoReject) {
            try {
                await dbRun(
                    staffProfileDb,
                    'INSERT INTO candidatures (userId, type, status, date, reviewer_id, review_date) VALUES (?, ?, ?, ?, ?, ?)',
                    [userId, specialite || 'moderateur', 'refuse', Date.now(), 'auto_reject_system', Date.now()],
                );
                await dbRun(
                    staffProfileDb,
                    'UPDATE staff_chances SET candidature_chances = MAX(candidature_chances - 1, 0) WHERE userId = ?',
                    [userId],
                );
            } catch (e) {
                console.error('[Candidature] auto-reject save:', e);
            }

            await deleteDraft(staffProfileDb, userId).catch(() => {});
            await safeEdit(interaction, { content: '✅ Candidature envoyée.' });

            setTimeout(async () => {
                try {
                    const user = await client.users.fetch(userId);
                    await user.send({
                        embeds: [
                            new EmbedBuilder()
                                .setColor('#FF0000')
                                .setTitle('❌ Candidature refusée')
                                .setDescription('Candidature **refusée**.\n\nTu pourras repostuler après le cooldown.')
                                .setTimestamp(),
                        ],
                    });
                } catch (e) {
                    console.error(`[Candidature] DM auto-refus ${userId}:`, e?.message || e);
                }
            }, 60000);

            return;
        }

        if (!voteManager) {
            return safeEdit(interaction, {
                content: '❌ Erreur interne (votes). Contacte un admin.',
            });
        }

        const recruitmentChannel = await client.channels
            .fetch(CONFIG.RECRUITMENT_CHANNEL_ID)
            .catch((err) => {
                console.error('[Candidature] fetch canal:', err?.message || err);
                return null;
            });

        if (!recruitmentChannel) {
            return safeEdit(interaction, {
                content: '❌ Canal de recrutement introuvable. Contacte un admin.',
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

        try {
            const embeds = buildRecruitmentEmbeds(interaction, {
                specialite,
                step1,
                whyYou,
                reasoning,
                questions,
            });

            const [firstEmbed, ...otherEmbeds] = embeds;
            const sentMessage = await recruitmentChannel.send({
                embeds: [ensureEmbedDescription(firstEmbed)],
                components: [row],
            });

            for (let i = 0; i < otherEmbeds.length; i += 10) {
                const batch = otherEmbeds.slice(i, i + 10).map(ensureEmbedDescription);
                await recruitmentChannel.send({ embeds: batch });
            }

            await recruitmentChannel.send({
                content: `⬆️ **Votez sur le premier message pour la candidature de ${interaction.user.tag}**`,
            });

            voteManager.votes[userId].messageId = sentMessage.id;
            voteManager.saveVotes();
            console.log(`[Candidature] ${interaction.user.tag} envoyée → ${CONFIG.RECRUITMENT_CHANNEL_ID}`);
        } catch (sendError) {
            console.error('[Candidature] envoi:', sendError);
            delete voteManager.votes[userId];
            voteManager.saveVotes();
            return safeEdit(interaction, {
                content: "❌ Erreur d'envoi de la candidature. Contacte un admin.",
            });
        }

        try {
            await dbRun(
                staffProfileDb,
                'INSERT INTO candidatures (userId, type, status, date) VALUES (?, ?, ?, ?)',
                [userId, specialite || 'moderateur', 'en_attente', Date.now()],
            );
            await dbRun(
                staffProfileDb,
                'UPDATE staff_chances SET candidature_chances = MAX(candidature_chances - 1, 0) WHERE userId = ?',
                [userId],
            );
        } catch (e) {
            console.error('[Candidature] save final:', e);
        }

        await deleteDraft(staffProfileDb, userId).catch(() => {});
        await safeEdit(interaction, {
            content: '✅ Candidature envoyée avec succès !',
        });
    },
};
