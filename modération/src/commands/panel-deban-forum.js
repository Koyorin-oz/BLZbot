/**
 * Crée un salon forum de débannissement (tags En cours / Deban / Refuse) sur un serveur
 * où le bot est présent, enregistre la config (clé = guild où la commande est lancée),
 * puis affiche le panneau « Lancer le formulaire » dans la réponse.
 *
 * Slash guild-only : principal BLZ **ou** serveur support (tickets).
 */
const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const CONFIG = require('../config.js');
const { buildPanelPayload } = require('./panel');
const { createDebanForum } = require('../modules/debanForum');

const PANEL_DEBAN_FORUM_ALLOWED_GUILDS = new Set([
    String(CONFIG.MAIN_GUILD_ID),
    String(CONFIG.TICKETS?.SUPPORT_GUILD_ID || '1351221530998345828'),
]);

module.exports = {
    /** Lu par deploy-slash-commands : ne pas publier en global Discord. */
    guildOnly: true,

    data: new SlashCommandBuilder()
        .setName('panel-deban-forum')
        .setDescription('Crée le forum de débannissement + tags, puis affiche le panneau de demande.')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .setDMPermission(false)
        .addStringOption((opt) =>
            opt
                .setName('serveur')
                .setDescription('Serveur qui hébergera le salon forum (souvent le principal).')
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
            console.error('[panel-deban-forum] autocomplete:', e?.message || e);
            try {
                await interaction.respond([]);
            } catch {
                /* noop */
            }
        }
    },

    async execute(interaction, { client } = {}) {
        const cli = client || interaction.client;

        if (!PANEL_DEBAN_FORUM_ALLOWED_GUILDS.has(String(interaction.guildId))) {
            return interaction.reply({
                content:
                    '❌ Cette commande n\'est disponible que sur le **serveur principal** ou le **serveur support**.',
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
            const { forumChannel } = await createDebanForum(cli, {
                testGuildId: interaction.guildId,
                forumGuildId,
                name: forumName,
                parentId: null,
            });

            const payload = buildPanelPayload(forumChannel.id);

            await interaction.editReply(payload);
        } catch (err) {
            console.error('[panel-deban-forum]', err);
            const msg = err?.message || String(err);
            await interaction.editReply({
                content: `❌ Impossible de créer le forum : ${msg}`,
            }).catch(() => null);
        }
    },
};
