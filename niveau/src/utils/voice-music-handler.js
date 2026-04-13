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

    prunePending();
    const key = pendingKey(guildId, userId);
    const pending = pendingSearches.get(key);
    if (!pending) {
        return interaction.update({
            content: 'Résultats expirés — relance `/musique play`.',
            components: [],
        });
    }

    const idx = parseInt(interaction.values[0], 10);
    const pick = pending.results[idx];
    pendingSearches.delete(key);
    if (!pick) {
        return interaction.update({
            content: 'Choix invalide.',
            components: [],
        });
    }

    const vc = interaction.member?.voice?.channel;
    if (!vc?.isVoiceBased?.()) {
        return interaction.update({
            content: 'Tu n’es plus en vocal — reconnecte-toi et relance la commande.',
            components: [],
        });
    }

    const session = getMusicSession(guildId);
    session._client = interaction.client;
    session.ensureConnection(interaction.client, vc);

    const track = {
        title: pick.title,
        url: pick.url,
        requestedBy: userId,
    };
    if (!session.enqueue(track)) {
        return interaction.update({
            content: 'La file est pleine (limite atteinte).',
            components: [],
        });
    }

    await interaction.update({
        content: `Ajouté à la file : **${pick.title.slice(0, 120)}**`,
        components: [],
    });

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
    storePendingSearch,
    buildSearchSelectRow,
};
