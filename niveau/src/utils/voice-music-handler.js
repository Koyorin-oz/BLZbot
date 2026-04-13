const {
    ActionRowBuilder,
    StringSelectMenuBuilder,
    StringSelectMenuOptionBuilder,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
} = require('discord.js');
const logger = require('./logger');
const { getMusicSession, resolveYoutubeQueryToTracks, searchYoutubeVideos } = require('./voice-music-manager');
const { parseMusicButtonId, parseMusicSelectId } = require('./voice-music-panel');
const { normalizeYoutubePlayUrl } = require('./youtube-html-search');

/** @type {Map<string, { results: { title: string, url: string, durationRaw?: string }[], expires: number }>} */
const pendingSearches = new Map();
const PENDING_TTL_MS = 8 * 60 * 1000;

function pendingKey(guildId, userId) {
    return `${guildId}:${userId}`;
}

function prunePending() {
    const now = Date.now();
    for (const [k, v] of pendingSearches) {
        if (v.expires < now) pendingSearches.delete(k);
    }
}

/**
 * Logique partagée avec `/musique play` et le modal « Ajouter ».
 * @param {(opts: import('discord.js').InteractionReplyOptions) => Promise<unknown>} editReply
 */
async function executeMusicPlayCore({ guildId, userId, member, client, query, editReply }) {
    const vc = member?.voice?.channel;
    if (!vc?.isVoiceBased?.()) {
        await editReply({
            content: 'Connecte-toi d’abord au **salon vocal** où la musique doit jouer.',
        });
        return;
    }

    const session = getMusicSession(guildId);
    session._client = client;

    const direct = await resolveYoutubeQueryToTracks(query, userId);
    if (direct?.length) {
        session.ensureConnection(client, vc);
        const n = session.enqueueMany(direct);
        if (n === 0) {
            await editReply({ content: 'La file est pleine.', components: [] });
            return;
        }
        await session.startOrContinue(client, vc);
        await session.refreshPanel();
        const extra = direct.length > 1 ? ` (${n} morceau(x) depuis playlist / lien)` : '';
        await editReply({ content: `Ajouté à la file${extra}.`, components: [] });
        return;
    }

    let results;
    try {
        results = await searchYoutubeVideos(query, userId);
    } catch (e) {
        await editReply({
            content: `Recherche impossible : ${e?.message || 'erreur'}. Réessaie ou colle un lien YouTube.`,
            components: [],
        });
        return;
    }

    if (!results.length) {
        await editReply({
            content: 'Aucun résultat — précise le titre ou envoie une URL YouTube.',
            components: [],
        });
        return;
    }

    storePendingSearch(guildId, userId, results);
    const row = buildSearchSelectRow(guildId, userId, results);
    await editReply({
        content: '**Choisis un résultat** (menu ci-dessous) :',
        components: [row],
    });
}

/**
 * @param {import('discord.js').ModalSubmitInteraction} interaction
 */
async function handleMusicPlayModal(interaction) {
    const parts = interaction.customId.split(':');
    if (parts.length !== 3 || parts[0] !== 'blzmm' || parts[1] !== 'play') return;
    const guildId = parts[2];
    if (!/^\d{17,22}$/.test(guildId) || interaction.guildId !== guildId) {
        return interaction.reply({ content: 'Requête invalide.', flags: 64 });
    }

    const q = interaction.fields.getTextInputValue('blzm_query')?.trim();
    if (!q) {
        return interaction.reply({ content: 'Champ vide.', flags: 64 });
    }

    await interaction.deferReply({ flags: 64 });
    await executeMusicPlayCore({
        guildId,
        userId: interaction.user.id,
        member: interaction.member,
        client: interaction.client,
        query: q,
        editReply: (opts) => interaction.editReply(opts),
    });
}

/**
 * @param {import('discord.js').ButtonInteraction} interaction
 */
async function handleMusicButton(interaction) {
    const parsed = parseMusicButtonId(interaction.customId);
    if (!parsed) return;

    const { action, guildId } = parsed;
    if (interaction.guildId !== guildId) {
        return interaction.reply({ content: 'Salon incorrect.', flags: 64 });
    }

    const session = getMusicSession(guildId);
    session._client = interaction.client;

    if (action === 'playlist') {
        const { openPlaylistPanel } = require('./voice-music-playlist-ui');
        return openPlaylistPanel(interaction, guildId, interaction.user.id);
    }

    if (action === 'playprompt') {
        const modal = new ModalBuilder()
            .setCustomId(`blzmm:play:${guildId}`)
            .setTitle('Ajouter à la file')
            .addComponents(
                new ActionRowBuilder().addComponents(
                    new TextInputBuilder()
                        .setCustomId('blzm_query')
                        .setLabel('Titre ou lien YouTube')
                        .setStyle(TextInputStyle.Short)
                        .setRequired(true)
                        .setMaxLength(500)
                )
            );
        return interaction.showModal(modal);
    }

    if (action === 'clear') {
        session.queue.length = 0;
        await interaction.deferUpdate().catch(() => null);
        await session.refreshPanel();
        return interaction.followUp({ content: '🧹 File vidée (lecture en cours inchangée).', flags: 64 }).catch(() => null);
    }

    const vc = interaction.member?.voice?.channel;
    if (!vc?.isVoiceBased?.()) {
        return interaction.reply({
            content: 'Connecte-toi au **salon vocal** où tu veux écouter la musique.',
            flags: 64,
        });
    }

    await interaction.deferUpdate().catch(() => null);

    try {
        session.ensureConnection(interaction.client, vc);
    } catch (e) {
        logger.error('[MUSIC] join:', e);
        return interaction.followUp({ content: 'Impossible de rejoindre le vocal.', flags: 64 }).catch(() => null);
    }

    switch (action) {
        case 'prev': {
            const ok = session.previous();
            if (!ok) {
                return interaction.followUp({ content: 'Pas de morceau précédent.', flags: 64 }).catch(() => null);
            }
            break;
        }
        case 'pause': {
            if (!session.current) {
                return interaction.followUp({ content: 'Rien ne joue.', flags: 64 }).catch(() => null);
            }
            session.pause();
            break;
        }
        case 'resume': {
            session.resume();
            break;
        }
        case 'skip': {
            if (!session.current && !session.queue.length) {
                return interaction.followUp({ content: 'File vide.', flags: 64 }).catch(() => null);
            }
            session.skip();
            break;
        }
        case 'queue': {
            const lines = session.getQueueLines();
            return interaction
                .followUp({
                    content: lines.join('\n').slice(0, 1900),
                    flags: 64,
                })
                .catch(() => null);
        }
        case 'stop': {
            session.stopAndClear();
            break;
        }
        default:
            return;
    }

    await session.refreshPanel();
}

/**
 * @param {import('discord.js').StringSelectMenuInteraction} interaction
 */
async function handleMusicSelect(interaction) {
    const parsed = parseMusicSelectId(interaction.customId);
    if (!parsed) return;

    const { guildId, userId } = parsed;
    if (interaction.user.id !== userId) {
        return interaction.reply({ content: 'Ce menu est pour la personne qui a lancé la recherche.', flags: 64 });
    }
    if (interaction.guildId !== guildId) {
        return interaction.reply({ content: 'Serveur incorrect.', flags: 64 });
    }

    await interaction.deferUpdate().catch(() => null);

    prunePending();
    const key = pendingKey(guildId, userId);
    const pending = pendingSearches.get(key);
    if (!pending) {
        return interaction
            .editReply({
                content: 'Résultats expirés — relance **Ajouter** ou `/musique play`.',
                components: [],
            })
            .catch(() => null);
    }

    const idx = parseInt(interaction.values[0], 10);
    const pick = pending.results[idx];
    pendingSearches.delete(key);
    if (!pick) {
        return interaction.editReply({ content: 'Choix invalide.', components: [] }).catch(() => null);
    }

    const vc = interaction.member?.voice?.channel;
    if (!vc?.isVoiceBased?.()) {
        return interaction
            .editReply({
                content: 'Tu n’es plus en vocal — reconnecte-toi et relance la commande.',
                components: [],
            })
            .catch(() => null);
    }

    const session = getMusicSession(guildId);
    session._client = interaction.client;
    try {
        session.ensureConnection(interaction.client, vc);
    } catch (e) {
        logger.error('[MUSIC] select join:', e);
        return interaction
            .editReply({ content: 'Impossible de rejoindre le vocal.', components: [] })
            .catch(() => null);
    }

    const watchUrl = normalizeYoutubePlayUrl(pick.url);
    if (!watchUrl) {
        return interaction
            .editReply({
                content: 'Ce résultat n’a pas un lien YouTube exploitable. Réessaie ou colle l’URL de la vidéo.',
                components: [],
            })
            .catch(() => null);
    }

    const track = {
        title: pick.title,
        url: watchUrl,
        requestedBy: userId,
    };
    if (!session.enqueue(track)) {
        return interaction
            .editReply({ content: 'La file est pleine (limite atteinte).', components: [] })
            .catch(() => null);
    }

    await interaction
        .editReply({
            content: `Ajouté à la file : **${pick.title.slice(0, 120)}**`,
            components: [],
        })
        .catch(() => null);

    await session.startOrContinue(interaction.client, vc);
    await session.refreshPanel();
}

/**
 * @param {string} guildId
 * @param {string} userId
 * @param {{ title: string, url: string, durationRaw?: string }[]} results
 */
function storePendingSearch(guildId, userId, results) {
    prunePending();
    pendingSearches.set(pendingKey(guildId, userId), {
        results,
        expires: Date.now() + PENDING_TTL_MS,
    });
}

/**
 * @param {string} guildId
 * @param {string} userId
 */
function buildSearchSelectRow(guildId, userId, results) {
    const menu = new StringSelectMenuBuilder()
        .setCustomId(`blzmpick:${guildId}:${userId}`)
        .setPlaceholder('Choisis un résultat YouTube')
        .addOptions(
            results.slice(0, 10).map(
                (r, i) =>
                    new StringSelectMenuOptionBuilder()
                        .setLabel(truncateOpt(r.title, 100))
                        .setDescription(truncateOpt(r.durationRaw || 'Vidéo', 100))
                        .setValue(String(i))
            )
        );
    return new ActionRowBuilder().addComponents(menu);
}

function truncateOpt(s, n) {
    const t = String(s || '—');
    return t.length <= n ? t : `${t.slice(0, n - 1)}…`;
}

module.exports = {
    handleMusicButton,
    handleMusicSelect,
    handleMusicPlayModal,
    executeMusicPlayCore,
    storePendingSearch,
    buildSearchSelectRow,
};
