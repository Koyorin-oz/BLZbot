const {
    SlashCommandBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ContainerBuilder,
    ModalBuilder,
    MessageFlags,
    PermissionFlagsBits,
    SeparatorBuilder,
    SectionBuilder,
    StringSelectMenuBuilder,
    StringSelectMenuOptionBuilder,
    TextDisplayBuilder,
    TextInputBuilder,
    TextInputStyle,
} = require('discord.js');
const crypto = require('crypto');
const logger = require('../../utils/logger');
const {
    BUG_FORUM_CHANNEL_ID,
    EN_COURS_TAG_IDS,
    createBugForumPost,
    fetchAllBugForumThreads,
} = require('../../utils/bug-forum-tags');

const MODAL_CUSTOM_ID = 'bug_report_modal';
const FIELD_TITLE = 'bug_title';
const FIELD_DESCRIPTION = 'bug_description';
const PAGE_FIELD = 'bug_list_page';
const LIST_PREFIX = 'bug:list:';
const PAGE_SIZE = 5;
const TITLE_PREVIEW_LENGTH = 32;
const DESCRIPTION_PREVIEW_LENGTH = 64;
const DEFAULT_FILTER = 'current';
const FILTERS = ['current', 'reported', 'classified'];
const FILTER_TITLES = {
    current: 'Bugs actuels',
    reported: 'Bugs signalés',
    classified: 'Bugs classés',
};

function isValidFilter(filter) {
    return FILTERS.includes(filter);
}

function filterBugs(bugs, filter) {
    if (filter === 'reported') return bugs;

    return bugs.filter(({ thread }) => {
        const isCurrent = (thread.appliedTags || []).some((tagId) => EN_COURS_TAG_IDS.includes(tagId));
        return filter === 'current' ? isCurrent : !isCurrent;
    });
}

function getReporterId(message) {
    const reporterField = message?.embeds?.[0]?.fields?.find(
        (field) => field.name === 'ID Discord'
    );
    const reporterId = reporterField?.value?.replace(/[`]/g, '').trim();
    return /^\d{17,20}$/.test(reporterId || '') ? reporterId : null;
}

async function fetchReportedBugs(client) {
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
                bugs.push({
                    thread,
                    starterMessage,
                    reporterId: getReporterId(starterMessage),
                });
            } catch (error) {
                logger.warn(`[bug] Impossible de lire le premier message du fil ${thread.id}: ${error?.message || error}`);
            }
        }));
    }

    return bugs.sort((a, b) => b.thread.createdTimestamp - a.thread.createdTimestamp);
}

function buildListComponents(bugs, userId, token, filter, page, isAdmin) {
    const filteredBugs = filterBugs(bugs, filter);
    const totalPages = Math.max(1, Math.ceil(filteredBugs.length / PAGE_SIZE));
    const pageBugs = filteredBugs.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
    const container = new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
            `# 🐛 ${FILTER_TITLES[filter]}\n**${filteredBugs.length}** bug${filteredBugs.length > 1 ? 's' : ''} signalé${filteredBugs.length > 1 ? 's' : ''}.`
        )
    );

    if (pageBugs.length === 0) {
        container.addTextDisplayComponents(
            new TextDisplayBuilder().setContent('Aucun signalement dans cette catégorie.')
        );
    }

    for (const { thread, starterMessage, reporterId } of pageBugs) {
        const titleText = String(thread.name || 'Sans titre').replace(/\s+/g, ' ').trim();
        const description = String(starterMessage.embeds?.[0]?.description || 'Aucune description.')
            .replace(/\s+/g, ' ')
            .trim();
        const title = titleText.length > TITLE_PREVIEW_LENGTH
            ? `${titleText.slice(0, TITLE_PREVIEW_LENGTH - 1)}…`
            : titleText;
        const preview = description.length > DESCRIPTION_PREVIEW_LENGTH
            ? `${description.slice(0, DESCRIPTION_PREVIEW_LENGTH - 1)}…`
            : description;
        const infoButton = new ButtonBuilder()
            .setCustomId(`${LIST_PREFIX}info:${userId}:${token}:${thread.id}`)
            .setLabel('Informations')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(!isAdmin && reporterId !== userId);
        const section = new SectionBuilder()
            .addTextDisplayComponents(
                new TextDisplayBuilder().setContent(`### ${title}\n${preview}`)
            )
            .setButtonAccessory(infoButton);
        container.addSectionComponents(section);
    }

    container
        .addSeparatorComponents(new SeparatorBuilder())
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(`-# Page **${page + 1}/${totalPages}**`)
        );

    const components = [container];
    if (filteredBugs.length > 0) {
        const navigation = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`${LIST_PREFIX}prev:${userId}:${token}:${filter}:${page}`)
                .setLabel('◀️')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(totalPages === 1 || page === 0),
            new ButtonBuilder()
                .setCustomId(`${LIST_PREFIX}goto:${userId}:${token}:${filter}`)
                .setLabel(`Page ${page + 1}`)
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(totalPages === 1),
            new ButtonBuilder()
                .setCustomId(`${LIST_PREFIX}next:${userId}:${token}:${filter}:${page}`)
                .setLabel('▶️')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(totalPages === 1 || page === totalPages - 1)
        );
        components.push(navigation);
    }

    const filterMenu = new StringSelectMenuBuilder()
        .setCustomId(`${LIST_PREFIX}filter:${userId}:${token}`)
        .setPlaceholder('Filtrer les bugs')
        .addOptions(
            new StringSelectMenuOptionBuilder()
                .setLabel('Bugs actuels')
                .setValue('current')
                .setDescription('Bugs avec un tag En cours')
                .setDefault(filter === 'current'),
            new StringSelectMenuOptionBuilder()
                .setLabel('Bugs signalés')
                .setValue('reported')
                .setDescription('Tous les bugs signalés')
                .setDefault(filter === 'reported'),
            new StringSelectMenuOptionBuilder()
                .setLabel('Bugs classés')
                .setValue('classified')
                .setDescription('Bugs sans tag En cours')
                .setDefault(filter === 'classified')
        );
    components.push(new ActionRowBuilder().addComponents(filterMenu));

    return { components, flags: MessageFlags.IsComponentsV2 };
}

async function handleListButton(interaction) {
    if (!interaction.customId.startsWith(LIST_PREFIX)) return false;

    const [, , action, ownerId, token, value, pageValue] = interaction.customId.split(':');
    if (ownerId !== interaction.user.id) {
        await interaction.reply({ content: '❌ Cette liste ne vous appartient pas.', flags: MessageFlags.Ephemeral });
        return true;
    }

    if (action === 'goto') {
        if (!isValidFilter(value)) {
            await interaction.reply({ content: '❌ Ce filtre n’est plus valide.', flags: MessageFlags.Ephemeral });
            return true;
        }
        const modal = new ModalBuilder()
            .setCustomId(`${LIST_PREFIX}modal:${ownerId}:${token}:${value}`)
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
        const isAdmin = interaction.memberPermissions?.has(PermissionFlagsBits.Administrator) || false;
        if (getReporterId(starterMessage) !== ownerId && !isAdmin) {
            return interaction.editReply({ content: '❌ Ce signalement ne vous appartient pas.' });
        }

        const embed = starterMessage.embeds?.[0];
        const reporter = embed?.fields?.find((field) => field.name === 'Membre')?.value || 'Inconnu';
        const tags = (thread.appliedTags || [])
            .map((tagId) => forum.availableTags.find((tag) => tag.id === tagId)?.name)
            .filter(Boolean);
        const details = new ContainerBuilder()
            .addTextDisplayComponents(
                new TextDisplayBuilder().setContent(
                    `# 🐛 Informations du signalement\n` +
                    `**Titre :** ${thread.name}\n` +
                    `**Signalé par :** ${isAdmin ? reporter : '🔒 Réservé à l’administration'}\n` +
                    `**Signalé le :** <t:${Math.floor(thread.createdTimestamp / 1000)}:F>\n` +
                    `**Statut :** ${tags.length ? tags.join(', ') : 'Aucun'}\n` +
                    `**Fil :** ${thread.archived ? 'Archivé' : 'Actif'}${thread.locked ? ' et verrouillé' : ''}\n` +
                    `**Lien :** ${isAdmin ? `[Ouvrir le post](${thread.url})` : '🔒 Réservé à l’administration'}\n` +
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
        const filter = value;
        const currentPage = Number(pageValue);
        if (!isValidFilter(filter)) {
            await interaction.reply({ content: '❌ Ce filtre n’est plus valide.', flags: MessageFlags.Ephemeral });
            return true;
        }
        if (!Number.isInteger(currentPage) || currentPage < 0) {
            await interaction.reply({ content: '❌ Cette page n’est plus valide.', flags: MessageFlags.Ephemeral });
            return true;
        }

        await interaction.deferUpdate();
        const bugs = await fetchReportedBugs(interaction.client);
        const totalPages = Math.max(1, Math.ceil(filterBugs(bugs, filter).length / PAGE_SIZE));
        const isAdmin = interaction.memberPermissions?.has(PermissionFlagsBits.Administrator) || false;
        const page = Math.min(
            Math.max(currentPage + (action === 'next' ? 1 : -1), 0),
            totalPages - 1
        );
        await interaction.editReply(buildListComponents(bugs, ownerId, token, filter, page, isAdmin));
        return true;
    }

    await interaction.reply({
        content: '❌ Ce bouton n’est plus valide.',
        flags: MessageFlags.Ephemeral,
    });
    return true;
}

async function handlePageModalSubmit(interaction) {
    const [, , , ownerId, token, filter] = interaction.customId.split(':');
    if (ownerId !== interaction.user.id) {
        await interaction.reply({ content: '❌ Cette liste ne vous appartient pas.', flags: MessageFlags.Ephemeral });
        return;
    }
    if (!isValidFilter(filter)) {
        await interaction.reply({ content: '❌ Ce filtre n’est plus valide.', flags: MessageFlags.Ephemeral });
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
    const bugs = await fetchReportedBugs(interaction.client);
    const totalPages = Math.max(1, Math.ceil(filterBugs(bugs, filter).length / PAGE_SIZE));
    const page = Math.min(Math.max(requestedPage - 1, 0), totalPages - 1);
    const isAdmin = interaction.memberPermissions?.has(PermissionFlagsBits.Administrator) || false;
    await interaction.editReply(buildListComponents(bugs, ownerId, token, filter, page, isAdmin));
}

async function handleListFilter(interaction) {
    if (!interaction.customId.startsWith(`${LIST_PREFIX}filter:`)) return false;

    const [, , , ownerId] = interaction.customId.split(':');
    if (ownerId !== interaction.user.id) {
        await interaction.reply({ content: '❌ Cette liste ne vous appartient pas.', flags: MessageFlags.Ephemeral });
        return true;
    }

    const filter = interaction.values[0];
    if (!isValidFilter(filter)) {
        await interaction.reply({ content: '❌ Ce filtre n’est pas valide.', flags: MessageFlags.Ephemeral });
        return true;
    }

    const [, , , , token] = interaction.customId.split(':');
    await interaction.deferUpdate();
    const bugs = await fetchReportedBugs(interaction.client);
    const isAdmin = interaction.memberPermissions?.has(PermissionFlagsBits.Administrator) || false;
    await interaction.editReply(buildListComponents(bugs, ownerId, token, filter, 0, isAdmin));
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
            subcommand.setName('lister').setDescription('Lister les signalements du forum.')
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
                const bugs = await fetchReportedBugs(interaction.client);
                const token = crypto.randomBytes(6).toString('hex');
                const isAdmin = interaction.memberPermissions?.has(PermissionFlagsBits.Administrator) || false;
                await interaction.editReply(
                    buildListComponents(bugs, interaction.user.id, token, DEFAULT_FILTER, 0, isAdmin)
                );
            } catch (error) {
                logger.error('[bug] Impossible de lister les signalements:', error);
                await interaction.editReply({
                    content: '❌ Impossible de récupérer les signalements pour le moment.',
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
    handleListFilter,
    handlePageModalSubmit,
};
