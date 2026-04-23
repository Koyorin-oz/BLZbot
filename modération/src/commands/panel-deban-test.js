/**
 * Commande réservée au serveur de TEST : crée un salon forum de débannissement
 * (tags En cours / Deban / Refuse) sur un serveur au choix où le bot est présent,
 * enregistre la config, puis poste le panneau « Lancer le formulaire » dans le salon courant.
 *
 * Déployée en GUILDE uniquement sur le serveur de test (voir deploy-slash-commands.js).
 */
const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const CONFIG = require('../config.js');
const { TEST_DEBAN_BYPASS_GUILD_ID, buildPanelPayload } = require('./panel');
const { createDebanForum } = require('../modules/debanForum');

/** Serveurs où un admin peut créer le forum de votes deban (test + production). */
const FORUM_SETUP_GUILD_IDS = new Set([
    String(TEST_DEBAN_BYPASS_GUILD_ID),
    String(CONFIG.MAIN_GUILD_ID),
]);

module.exports = {
    /** Lu par deploy-slash-commands : ne pas publier en global Discord. */
    guildOnly: true,

    data: new SlashCommandBuilder()
        .setName('panel-deban-test')
        .setDescription(
            '[TEST uniquement] Crée le forum de débannissement + tags, puis affiche le panneau de demande.'
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .setDMPermission(false)
        .addStringOption((opt) =>
            opt
                .setName('serveur')
                .setDescription('Serveur qui hébergera le salon forum (support, principal, test, …).')
                .setRequired(true)
                .setAutocomplete(true)
        )
        .addStringOption((opt) =>
            opt
                .setName('nom')
                .setDescription('Nom du salon forum (défaut : deban-forum)')
                .setRequired(false)
                .setMaxLength(80)
        ),

    async autocomplete(interaction) {
        try {
            const focused = interaction.options.getFocused(true);
            if (focused.name !== 'serveur') {
                return interaction.respond([]);
            }
            const q = String(focused.value || '')
                .toLowerCase()
                .trim();
            const rows = [];
            for (const g of interaction.client.guilds.cache.values()) {
                const label = `${g.name} (${g.memberCount} membres)`;
                if (q && !label.toLowerCase().includes(q) && !g.id.includes(q)) continue;
                rows.push({ name: label.slice(0, 100), value: g.id });
                if (rows.length >= 25) break;
            }
            await interaction.respond(rows);
        } catch (e) {
            console.error('[panel-deban-test] autocomplete:', e?.message || e);
            try {
                await interaction.respond([]);
            } catch {
                /* noop */
            }
        }
    },

    async execute(interaction, { client } = {}) {
        const cli = client || interaction.client;

        if (String(interaction.guildId) !== String(TEST_DEBAN_BYPASS_GUILD_ID)) {
            return interaction.reply({
                content:
                    '❌ Cette commande n\'est utilisable **que** sur le serveur de test BLZ (mode forum déban).',
                ephemeral: true,
            });
        }

        const forumGuildId = interaction.options.getString('serveur');
        const rawName = interaction.options.getString('nom');
        const forumName = (rawName && rawName.trim()) || 'deban-forum';

        if (!/^\d{15,25}$/.test(forumGuildId)) {
            return interaction.reply({ content: '❌ Serveur invalide.', ephemeral: true });
        }

        const hostGuild = await cli.guilds.fetch(forumGuildId).catch(() => null);
        if (!hostGuild) {
            return interaction.reply({
                content:
                    '❌ Je ne suis pas membre de ce serveur ou l\'ID est introuvable. Invitez le bot puis réessayez.',
                ephemeral: true,
            });
        }

        await interaction.deferReply({ ephemeral: false });

        try {
            const { forumChannel, tags } = await createDebanForum(cli, {
                testGuildId: interaction.guildId,
                forumGuildId,
                name: forumName,
                parentId: null,
            });

            const payload = buildPanelPayload(forumChannel.id);

            await interaction.editReply({
                content:
                    `✅ Forum **${forumChannel.name}** créé sur **${hostGuild.name}**.\n` +
                    `Tags : \`En cours\` / \`Deban\` / \`Refuse\`\n` +
                    `Les demandes créent un **post** dans ce forum. À la fin du vote, le post est **verrouillé** (le staff peut encore écrire).`,
                ...payload,
            });
        } catch (err) {
            console.error('[panel-deban-test]', err);
            const msg = err?.message || String(err);
            await interaction.editReply({
                content: `❌ Impossible de créer le forum : ${msg}`,
            }).catch(() => null);
        }
    },
};
