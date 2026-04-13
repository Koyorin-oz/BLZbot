const { SlashCommandBuilder } = require('discord.js');
const {
    getMusicSession,
    resolveYoutubeQueryToTracks,
    searchYoutubeVideos,
} = require('../../utils/voice-music-manager');
const { storePendingSearch, buildSearchSelectRow } = require('../../utils/voice-music-handler');

function requireVoice(interaction) {
    const vc = interaction.member?.voice?.channel;
    if (!vc?.isVoiceBased?.()) {
        return {
            ok: false,
            reply: {
                content: 'Connecte-toi d’abord à un **salon vocal**.',
                flags: 64,
            },
        };
    }
    return { ok: true, vc };
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('musique')
        .setDescription('Lecteur YouTube : file d’attente, recherche et lecture dans ton vocal')
        .addSubcommand((s) =>
            s
                .setName('play')
                .setDescription('Recherche ou lien YouTube — ajoute à la file')
                .addStringOption((o) =>
                    o
                        .setName('requête')
                        .setDescription('Titre à chercher ou URL / playlist YouTube')
                        .setRequired(true)
                )
        )
        .addSubcommand((s) => s.setName('skip').setDescription('Morceau suivant'))
        .addSubcommand((s) => s.setName('pause').setDescription('Met en pause'))
        .addSubcommand((s) => s.setName('resume').setDescription('Reprend la lecture'))
        .addSubcommand((s) => s.setName('previous').setDescription('Morceau précédent'))
        .addSubcommand((s) => s.setName('queue').setDescription('Affiche la file d’attente'))
        .addSubcommand((s) => s.setName('stop').setDescription('Arrête et vide la file'))
        .addSubcommand((s) => s.setName('clear').setDescription('Vide la file sans quitter le vocal')),

    async execute(interaction) {
        if (!interaction.guild) {
            return interaction.reply({ content: 'Utilise cette commande sur un serveur.', flags: 64 });
        }

        const sub = interaction.options.getSubcommand();
        const guildId = interaction.guild.id;
        const session = getMusicSession(guildId);
        session._client = interaction.client;

        if (sub === 'play') {
            const q = interaction.options.getString('requête', true);
            const v = requireVoice(interaction);
            if (!v.ok) return interaction.reply(v.reply);

            await interaction.deferReply({ flags: 64 });

            const direct = await resolveYoutubeQueryToTracks(q, interaction.user.id);
            if (direct?.length) {
                session.ensureConnection(interaction.client, v.vc);
                const n = session.enqueueMany(direct);
                if (n === 0) {
                    return interaction.editReply({ content: 'La file est pleine.' });
                }
                await session.startOrContinue(interaction.client, v.vc);
                await session.refreshPanel();
                const extra =
                    direct.length > 1
                        ? ` (${n} morceau(x) depuis playlist / lien)`
                        : '';
                return interaction.editReply({ content: `Ajouté à la file${extra}.` });
            }

            let results;
            try {
                results = await searchYoutubeVideos(q, interaction.user.id);
            } catch (e) {
                return interaction.editReply({
                    content: `Recherche impossible : ${e?.message || 'erreur'}. Réessaie ou colle un lien YouTube.`,
                });
            }

            if (!results.length) {
                return interaction.editReply({ content: 'Aucun résultat — précise le titre ou envoie une URL YouTube.' });
            }

            storePendingSearch(guildId, interaction.user.id, results);
            const row = buildSearchSelectRow(guildId, interaction.user.id, results);
            return interaction.editReply({
                content: '**Choisis un résultat** (menu ci-dessous) :',
                components: [row],
            });
        }

        if (sub === 'queue') {
            const lines = session.getQueueLines();
            return interaction.reply({
                content: lines.join('\n').slice(0, 1900),
                flags: 64,
            });
        }

        if (sub === 'clear') {
            session.queue.length = 0;
            await session.refreshPanel();
            return interaction.reply({ content: '🗑️ File vidée (lecture en cours inchangée).', flags: 64 });
        }

        const v = requireVoice(interaction);
        if (!v.ok) return interaction.reply(v.reply);

        session.ensureConnection(interaction.client, v.vc);

        switch (sub) {
            case 'skip': {
                if (!session.current && !session.queue.length) {
                    return interaction.reply({ content: 'Rien en lecture.', flags: 64 });
                }
                session.skip();
                await session.refreshPanel();
                return interaction.reply({ content: '⏭️ Suivant.', flags: 64 });
            }
            case 'pause': {
                if (!session.current) {
                    return interaction.reply({ content: 'Rien ne joue.', flags: 64 });
                }
                session.pause();
                await session.refreshPanel();
                return interaction.reply({ content: '⏸️ Pause.', flags: 64 });
            }
            case 'resume': {
                session.resume();
                await session.refreshPanel();
                return interaction.reply({ content: '▶️ Lecture reprise.', flags: 64 });
            }
            case 'previous': {
                const ok = session.previous();
                if (!ok) {
                    return interaction.reply({ content: 'Pas de morceau précédent.', flags: 64 });
                }
                await session.refreshPanel();
                return interaction.reply({ content: '⏮️ Retour au précédent.', flags: 64 });
            }
            case 'stop': {
                session.stopAndClear();
                return interaction.reply({ content: '⏹️ Arrêté, file vidée.', flags: 64 });
            }
            default:
                return interaction.reply({ content: 'Sous-commande inconnue.', flags: 64 });
        }
    },
};
