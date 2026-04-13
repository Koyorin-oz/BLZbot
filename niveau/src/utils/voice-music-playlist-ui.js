const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const logger = require('./logger');
const { getMusicSession } = require('./voice-music-manager');
const { extractYoutubeVideoId, normalizeYoutubePlayUrl } = require('./youtube-html-search');
const {
    PAGE_SIZE,
    countUserPlaylist,
    getUserPlaylistPage,
    getPlaylistRow,
    parsePlaylistButtonId,
    idPlay,
    idQueue,
    idGotoPage,
} = require('./voice-music-playlist');

/**
 * @param {string} guildId
 * @param {string} userId
 * @param {number} page 0-based
 */
function buildPlaylistUIPayload(guildId, userId, page) {
    const total = countUserPlaylist(guildId, userId);
    const embed = new EmbedBuilder()
        .setColor(0x57f287)
        .setTitle('🎵 Ta playlist');

    if (total === 0) {
        embed.setDescription(
            '**Ta playlist est vide.**\n\n' +
                'Ajoute au moins un morceau avec **Ajouter** ou `/musique play`. ' +
                '**Chaque titre que tu fais jouer** avec le bot est **ajouté ici automatiquement**.'
        );
        return { embeds: [embed], components: [] };
    }

    const rows = getUserPlaylistPage(guildId, userId, page);
    const maxPage = Math.max(0, Math.ceil(total / PAGE_SIZE) - 1);
    const safePage = Math.min(Math.max(0, page), maxPage);
    const rowsSafe = safePage !== page ? getUserPlaylistPage(guildId, userId, safePage) : rows;

    const blocks = rowsSafe.map((r, i) => {
        const n = safePage * PAGE_SIZE + i + 1;
        const title = String(r.title || 'Sans titre').slice(0, 200);
        return `**${n}. ${title}**\n*Ajouté dans ta playlist*`;
    });
    embed.setDescription(blocks.join('\n\n') || '*Rien sur cette page.*');
    embed.setFooter({
        text: `${total} titre(s) · page ${safePage + 1}/${maxPage + 1}`,
    });

    /** @type {import('discord.js').ActionRowBuilder[]} */
    const components = [];
    for (const r of rowsSafe) {
        components.push(
            new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId(idPlay(guildId, userId, r.id))
                    .setStyle(ButtonStyle.Success)
                    .setLabel('Jouer / pause')
                    .setEmoji('▶️'),
                new ButtonBuilder()
                    .setCustomId(idQueue(guildId, userId, r.id))
                    .setStyle(ButtonStyle.Secondary)
                    .setLabel('File')
                    .setEmoji('📋')
            )
        );
    }

    const nav = [];
    if (safePage > 0) {
        nav.push(
            new ButtonBuilder()
                .setCustomId(idGotoPage(guildId, userId, safePage - 1))
                .setStyle(ButtonStyle.Secondary)
                .setLabel('Page précédente')
                .setEmoji('◀️')
        );
    }
    if (safePage < maxPage) {
        nav.push(
            new ButtonBuilder()
                .setCustomId(idGotoPage(guildId, userId, safePage + 1))
                .setStyle(ButtonStyle.Secondary)
                .setLabel('Page suivante')
                .setEmoji('▶️')
        );
    }
    if (nav.length) {
        components.push(new ActionRowBuilder().addComponents(...nav));
    }

    return { embeds: [embed], components };
}

/**
 * @param {import('discord.js').ButtonInteraction} interaction
 * @param {string} guildId
 * @param {string} userId
 */
async function openPlaylistPanel(interaction, guildId, userId) {
    await interaction.deferReply({ flags: 64 });
    await interaction.editReply(buildPlaylistUIPayload(guildId, userId, 0));
}

/**
 * @param {import('discord.js').ButtonInteraction} interaction
 */
async function handlePlaylistButtonInteraction(interaction) {
    const parsed = parsePlaylistButtonId(interaction.customId);
    if (!parsed) return;

    if (interaction.user.id !== parsed.userId) {
        return interaction.reply({ content: 'Ce panneau playlist ne t’est pas destiné.', flags: 64 });
    }
    if (interaction.guildId !== parsed.guildId) {
        return interaction.reply({ content: 'Mauvais serveur.', flags: 64 });
    }

    if (parsed.kind === 'goto') {
        await interaction.deferUpdate().catch(() => null);
        try {
            await interaction.editReply(buildPlaylistUIPayload(parsed.guildId, parsed.userId, parsed.page));
        } catch (e) {
            logger.debug(`[MUSIC] playlist goto: ${e?.message || e}`);
        }
        return;
    }

    const session = getMusicSession(parsed.guildId);
    session._client = interaction.client;

    if (parsed.kind === 'queue') {
        await interaction.deferUpdate().catch(() => null);
        const row = getPlaylistRow(parsed.guildId, parsed.userId, parsed.rowId);
        if (!row) {
            return interaction.followUp({ content: 'Ce titre n’existe plus dans ta playlist.', flags: 64 }).catch(() => null);
        }
        const vc = interaction.member?.voice?.channel;
        if (!vc?.isVoiceBased?.()) {
            return interaction
                .followUp({ content: 'Connecte-toi à un **salon vocal** pour ajouter à la file.', flags: 64 })
                .catch(() => null);
        }
        try {
            session.ensureConnection(interaction.client, vc);
        } catch (e) {
            logger.error('[MUSIC] playlist queue join:', e);
            return interaction.followUp({ content: 'Impossible de rejoindre le vocal.', flags: 64 }).catch(() => null);
        }
        const track = {
            title: row.title,
            url: row.url,
            requestedBy: interaction.user.id,
        };
        if (!session.enqueue(track)) {
            return interaction.followUp({ content: 'La file est pleine.', flags: 64 }).catch(() => null);
        }
        await session.startOrContinue(interaction.client, vc);
        await session.refreshPanel();
        return interaction
            .followUp({
                content: `📋 Ajouté à la file : **${String(row.title).slice(0, 100)}**`,
                flags: 64,
            })
            .catch(() => null);
    }

    if (parsed.kind === 'play') {
        await interaction.deferUpdate().catch(() => null);
        const row = getPlaylistRow(parsed.guildId, parsed.userId, parsed.rowId);
        if (!row) {
            return interaction.followUp({ content: 'Ce titre n’existe plus dans ta playlist.', flags: 64 }).catch(() => null);
        }
        const vc = interaction.member?.voice?.channel;
        if (!vc?.isVoiceBased?.()) {
            return interaction
                .followUp({ content: 'Connecte-toi à un **salon vocal** pour lancer la lecture.', flags: 64 })
                .catch(() => null);
        }
        try {
            session.ensureConnection(interaction.client, vc);
        } catch (e) {
            logger.error('[MUSIC] playlist play join:', e);
            return interaction.followUp({ content: 'Impossible de rejoindre le vocal.', flags: 64 }).catch(() => null);
        }

        const curId = extractYoutubeVideoId(session.current?.url);
        const rowId = extractYoutubeVideoId(row.url);
        if (curId && rowId && curId === rowId) {
            if (session.isPaused()) {
                session.resume();
            } else {
                session.pause();
            }
            await session.refreshPanel();
            const msg = session.isPaused() ? '⏸️ Pause.' : '▶️ Lecture.';
            return interaction.followUp({ content: msg, flags: 64 }).catch(() => null);
        }

        const playUrl = normalizeYoutubePlayUrl(row.url);
        if (!playUrl) {
            return interaction
                .followUp({
                    content: 'Ce lien dans ta playlist n’est pas une URL YouTube valide. Supprime-le et rajoute le morceau.',
                    flags: 64,
                })
                .catch(() => null);
        }

        const track = {
            title: row.title,
            url: playUrl,
            requestedBy: interaction.user.id,
        };
        session.queue.unshift(track);
        if (session.current) {
            session.skip();
        } else {
            await session.startOrContinue(interaction.client, vc);
        }
        await session.refreshPanel();
        return interaction
            .followUp({ content: `▶️ Lecture : **${String(row.title).slice(0, 100)}**`, flags: 64 })
            .catch(() => null);
    }
}

module.exports = {
    buildPlaylistUIPayload,
    openPlaylistPanel,
    handlePlaylistButtonInteraction,
};
