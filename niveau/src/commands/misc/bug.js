const {
    SlashCommandBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ContainerBuilder,
    ModalBuilder,
    MessageFlags,
    SectionBuilder,
    TextDisplayBuilder,
    TextInputBuilder,
    TextInputStyle,
} = require('discord.js');
const crypto = require('crypto');
const logger = require('../../utils/logger');
const {
    BUG_FORUM_CHANNEL_ID,
    createBugForumPost,
    fetchAllBugForumThreads,
} = require('../../utils/bug-forum-tags');

const MODAL_CUSTOM_ID = 'bug_report_modal';
const FIELD_TITLE = 'bug_title';
const FIELD_DESCRIPTION = 'bug_description';
const PAGE_FIELD = 'bug_list_page';
const LIST_PREFIX = 'bug:list:';
const PAGE_SIZE = 5;
const DESCRIPTION_PREVIEW_LENGTH = 180;

function getReporterId(message) {
    const reporterField = message?.embeds?.[0]?.fields?.find(
        (field) => field.name === 'ID Discord'
    );
    const reporterId = reporterField?.value?.replace(/[`]/g, '').trim();
    return /^\d{17,20}$/.test(reporterId || '') ? reporterId : null;
}

async function fetchReportedBugs(client, userId) {
    const forum = await client.channels.fetch(BUG_FORUM_CHANNEL_ID);
    if (!forum || !forum.isThreadOnly?.()) {
        throw new Error(`Forum bugs introuvable (${BUG_FORUM_CHANNEL_ID})`);
    }

    const threads = [...await fetchAllBugForumThreads(forum)];
    const bugs = [];
    for (let i = 0; i < threads.length; i += 5) {
        await Promise.all(threads.slice(i, i + 5).map(async (thread) => {
            try {
                const starterMessage = await thread.fetchStarterMessage();
                if (getReporterId(starterMessage) === userId) {
                    bugs.push({ thread, starterMessage });
                }
            } catch (error) {
                logger.warn(`[bug] Impossible de lire le premier message du fil ${thread.id}: ${error?.message || error}`);
            }
        }));
    }

    return bugs.sort((a, b) => b.thread.createdTimestamp - a.thread.createdTimestamp);
}

function buildListComponents(bugs, userId, token, page) {
    const totalPages = Math.ceil(bugs.length / PAGE_SIZE);
    const pageBugs = bugs.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
    const container = new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
            `# 🐛 Mes signalements\n${bugs.length} bug${bugs.length > 1 ? 's' : ''} signalé${bugs.length > 1 ? 's' : ''}.`
        )
    );

    for (const { thread, starterMessage } of pageBugs) {
        const description = starterMessage.embeds?.[0]?.description || 'Aucune description.';
        const preview = description.length > DESCRIPTION_PREVIEW_LENGTH
            ? `${description.slice(0, DESCRIPTION_PREVIEW_LENGTH - 1)}…`
            : description;
        const infoButton = new ButtonBuilder()
            .setCustomId(`${LIST_PREFIX}info:${userId}:${token}:${thread.id}`)
            .setLabel('Informations')
            .setStyle(ButtonStyle.Secondary);
        const section = new SectionBuilder()
            .addTextDisplayComponents(
                new TextDisplayBuilder().setContent(`### ${thread.name} - Par ${getReporterName(starterMessage)}\n${preview}`)
            )
            .setButtonAccessory(infoButton);
        container.addSectionComponents(section);
    }

    const components = [container];
    if (totalPages > 0) {
        const navigation = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`${LIST_PREFIX}prev:${userId}:${token}:${page}`)
                .setLabel('◀️')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(totalPages === 1 || page === 0),
            new ButtonBuilder()
                .setCustomId(`${LIST_PREFIX}goto:${userId}:${token}`)
                .setLabel(`Page ${page + 1}`)
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(totalPages === 1),
            new ButtonBuilder()
                .setCustomId(`${LIST_PREFIX}next:${userId}:${token}:${page}`)
                .setLabel('▶️')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(totalPages === 1 || page === totalPages - 1)
        );
        components.push(navigation);
    }

    return { components, flags: MessageFlags.IsComponentsV2 };
}

async function handleListButton(interaction) {
    if (!interaction.customId.startsWith(LIST_PREFIX)) return false;

    const [, , action, ownerId, token, value] = interaction.customId.split(':');
    if (ownerId !== interaction.user.id) {
        await interaction.reply({ content: '❌ Cette liste ne vous appartient pas.', flags: MessageFlags.Ephemeral });
        return true;
    }

    if (action === 'goto') {
        const modal = new ModalBuilder()
            .setCustomId(`${LIST_PREFIX}modal:${ownerId}:${token}`)
            .setTitle('Aller à une page');
        const pageInput = new TextInputBuilder()
            .setCustomId(PAGE_FIELD)
            .setLabel('Numéro de page')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('Ex. : 2')
            .setRequired(true)
            .setMinLength(1)
            .setMaxLength(10);
        modal.addComponents(new ActionRowBuilder().addComponents(pageInput));
        await interaction.showModal(modal);
        return true;
    }

    if (action === 'info') {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const forum = await interaction.client.channels.fetch(BUG_FORUM_CHANNEL_ID);
        const thread = await forum.threads.fetch(value);
        const starterMessage = await thread.fetchStarterMessage();
        if (getReporterId(starterMessage) !== ownerId) {
            return interaction.editReply({ content: '❌ Ce signalement ne vous appartient pas.' });
        }

        const embed = starterMessage.embeds?.[0];
        const tags = (thread.appliedTags || [])
            .map((tagId) => forum.availableTags.find((tag) => tag.id === tagId)?.name)
            .filter(Boolean);
        const details = new ContainerBuilder()
            .addTextDisplayComponents(
                new TextDisplayBuilder().setContent(
                    `# 🐛 Informations du signalement\n` +
                    `**Titre :** ${thread.name}\n` +
                    `**Signalé par :** ${embed?.fields?.find((field) => field.name === 'Membre')?.value || 'Inconnu'}\n` +
                    `**Signalé le :** <t:${Math.floor(thread.createdTimestamp / 1000)}:F>\n` +
                    `**Statut :** ${tags.length ? tags.join(', ') : 'Aucun'}\n` +
                    `**Fil :** ${thread.archived ? 'Archivé' : 'Actif'}${thread.locked ? ' et verrouillé' : ''}\n` +
                    `**Lien :** [Ouvrir le post](${thread.url})\n` +
                    `**ID :** \`${thread.id}\``
                ),
                new TextDisplayBuilder().setContent(
                    `### Description\n${(embed?.description || 'Aucune description.').slice(0, 3900)}`
                )
            );
        await interaction.editReply({
            components: [details],
            flags: MessageFlags.IsComponentsV2,
        });
        return true;
    }

    if (action === 'prev' || action === 'next') {
        const currentPage = Number(value);
        if (!Number.isInteger(currentPage) || currentPage < 0) {
            await interaction.reply({ content: '❌ Cette page n’est plus valide.', flags: MessageFlags.Ephemeral });
            return true;
        }

        await interaction.deferUpdate();
        const bugs = await fetchReportedBugs(interaction.client, ownerId);
        const totalPages = Math.max(1, Math.ceil(bugs.length / PAGE_SIZE));
        const page = Math.min(
            Math.max(currentPage + (action === 'next' ? 1 : -1), 0),
            totalPages - 1
        );
        await interaction.editReply(buildListComponents(bugs, ownerId, token, page));
        return true;
    }

    await interaction.reply({
        content: '❌ Ce bouton n’est plus valide.',
        flags: MessageFlags.Ephemeral,
    });
    return true;
}

async function handlePageModalSubmit(interaction) {
    const [, , , ownerId, token] = interaction.customId.split(':');
    if (ownerId !== interaction.user.id) {
        await interaction.reply({ content: '❌ Cette liste ne vous appartient pas.', flags: MessageFlags.Ephemeral });
        return;
    }

    const input = interaction.fields.getTextInputValue(PAGE_FIELD).trim();
    if (!/^\d+$/.test(input)) {
        await interaction.reply({ content: '❌ Indiquez un numéro de page valide.', flags: MessageFlags.Ephemeral });
        return;
    }

    const requestedPage = Number(input);
    if (!Number.isSafeInteger(requestedPage)) {
        await interaction.reply({ content: '❌ Indiquez un numéro de page valide.', flags: MessageFlags.Ephemeral });
        return;
    }

    await interaction.deferUpdate();
    const bugs = await fetchReportedBugs(interaction.client, ownerId);
    const totalPages = Math.max(1, Math.ceil(bugs.length / PAGE_SIZE));
    const page = Math.min(Math.max(requestedPage - 1, 0), totalPages - 1);
    await interaction.editReply(buildListComponents(bugs, ownerId, token, page));
}

function buildReporterLabel(interaction) {
    const u = interaction.user;
    const member = interaction.member;
    const display =
        member && typeof member.displayName === 'string' && member.displayName.length > 0
            ? member.displayName
            : u.globalName || u.username;
    return `${display} (@${u.username})`;
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('bug')
        .setDescription('Signaler un bug (formulaire — post créé sur le forum staff).')
        .addSubcommand((subcommand) =>
            subcommand.setName('ajouter').setDescription('Signaler un bug via un formulaire.')
        )
        .addSubcommand((subcommand) =>
            subcommand.setName('lister').setDescription('Lister les bugs signalés par moi.')
        ),

    async execute(interaction) {
        if (interaction.options.getSubcommand() === 'ajouter') {
            const modal = new ModalBuilder().setCustomId(MODAL_CUSTOM_ID).setTitle('Signaler un bug');

            const titleInput = new TextInputBuilder()
                .setCustomId(FIELD_TITLE)
                .setLabel('Titre du bug (nom du post)')
                .setStyle(TextInputStyle.Short)
                .setPlaceholder('Ex. : Le bouton daily ne répond pas')
                .setRequired(true)
                .setMinLength(3)
                .setMaxLength(100);

            const descInput = new TextInputBuilder()
                .setCustomId(FIELD_DESCRIPTION)
                .setLabel('Description détaillée')
                .setStyle(TextInputStyle.Paragraph)
                .setPlaceholder('Que s’est-il passé ? Étapes pour reproduire, captures si besoin…')
                .setRequired(true)
                .setMinLength(10)
                .setMaxLength(4000);

            modal.addComponents(
                new ActionRowBuilder().addComponents(titleInput),
                new ActionRowBuilder().addComponents(descInput)
            );

            await interaction.showModal(modal);
        }
        else if (interaction.options.getSubcommand() === 'lister') {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });
            try {
                const bugs = await fetchReportedBugs(interaction.client, interaction.user.id);
                const token = crypto.randomBytes(6).toString('hex');
                if (bugs.length === 0) {
                    return interaction.editReply({
                        components: [
                            new ContainerBuilder().addTextDisplayComponents(
                                new TextDisplayBuilder().setContent('🐛 Vous n’avez signalé aucun bug.')
                            ),
                        ],
                        flags: MessageFlags.IsComponentsV2,
                    });
                }
                await interaction.editReply(buildListComponents(bugs, interaction.user.id, token, 0));
            } catch (error) {
                logger.error('[bug] Impossible de lister les signalements:', error);
                await interaction.editReply({
                    content: '❌ Impossible de récupérer vos signalements pour le moment.',
                });
            }
        }
    },

    /**
     * @param {import('discord.js').ModalSubmitInteraction} interaction
     */
    async handleModalSubmit(interaction) {
        try {
            await interaction.deferReply({ flags: 64 });
        } catch {
            return;
        }

        const rawTitle = interaction.fields.getTextInputValue(FIELD_TITLE).trim().replace(/\s+/g, ' ');
        const description = interaction.fields.getTextInputValue(FIELD_DESCRIPTION).trim();

        if (!rawTitle || !description) {
            return interaction.editReply({
                content: '❌ Titre et description sont obligatoires.',
            });
        }

        const threadName = rawTitle.slice(0, 100);
        const reporter = buildReporterLabel(interaction);
        const userId = interaction.user.id;

        const bodyText = description.length > 3900 ? `${description.slice(0, 3897)}…` : description;

        try {
            await createBugForumPost(interaction.client, {
                threadTitle: threadName,
                description: bodyText,
                reporterLabel: reporter,
                reporterId: userId,
            });

            await interaction.editReply({
                content:
                    '✅ Merci ! Ton signalement a été créé sur le forum staff. Les équipes pourront le traiter.',
            });
        } catch (err) {
            const code = err?.code;
            const msg = err?.message || String(err);
            logger.error(`[bug] Création du post forum: ${msg}`, err);
            await interaction.editReply({
                content:
                    code === 50001 || code === 50013
                        ? '❌ Le bot n’a pas les droits pour poster sur le forum de bugs (invite-le sur le serveur staff avec accès au salon forum + tags).'
                        : `❌ Impossible de créer le post : ${msg}`,
            });
        }
    },
    handleListButton,
    handlePageModalSubmit,
};
