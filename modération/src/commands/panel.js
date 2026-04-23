const {
    SlashCommandBuilder,
    EmbedBuilder,
    ButtonBuilder,
    ActionRowBuilder,
    ButtonStyle,
    PermissionFlagsBits,
    ChannelType,
} = require('discord.js');

/**
 * Serveurs dans lesquels on accepte que /panel-deban poste le panel ou envoie les demandes.
 * On autorise le panel à être posté dans l'un et les demandes à arriver dans l'autre.
 */
const ALLOWED_PANEL_GUILD_IDS = [
    '1351221530998345828', // Serveur de support
    '1097110036192448656', // Serveur principal BLZ
];

/** Salons où on peut **afficher** le panneau (pas un parent forum : pas de message simple dedans). */
const PANEL_DISPLAY_CHANNEL_TYPES = new Set([
    ChannelType.GuildText,
    ChannelType.GuildAnnouncement,
]);

/** Destination des votes (`salon-deban`) : texte, annonces, ou salon forum enregistré via /panel-deban-forum. */
const DEBAN_VOTE_CHANNEL_TYPES = new Set([
    ChannelType.GuildText,
    ChannelType.GuildAnnouncement,
    ChannelType.GuildForum,
]);

function buildPanelPayload(debanChannelId) {
    const embed = new EmbedBuilder()
        .setTitle("📋 Formulaire de débannissement")
        .setDescription(
            "Cliquez sur le bouton ci-dessous pour commencer votre demande de débannissement.\n\n" +
            "⚠️ **Conditions requises :**\n" +
            "- Vous devez être banni du serveur principal\n" +
            "- Votre ban doit dater d'au moins 3 mois pour que le vote soit lancé immédiatement\n" +
            "- Si votre ban date de moins de 3 mois, votre demande sera mise en attente"
        )
        .setColor('#FFD700');

    // Encode le salon de destination directement dans le customId du bouton : pas besoin
    // de JSON persistant, chaque panel sait où envoyer ses demandes.
    const button = new ButtonBuilder()
        .setCustomId(`launch_form_${debanChannelId}`)
        .setLabel('🚀 Lancer le formulaire')
        .setStyle(ButtonStyle.Primary);

    const row = new ActionRowBuilder().addComponents(button);

    return { embeds: [embed], components: [row] };
}

/**
 * Résout un identifiant de salon (string) en objet Channel via le client, tous serveurs confondus.
 * Retourne null si introuvable, type non autorisé, ou hors des serveurs autorisés.
 * @param {{ forDebanDestination?: boolean }} [opts] — si true, accepte aussi un salon forum (cible des votes).
 */
async function resolveAllowedChannel(client, channelId, opts = {}) {
    const forDeban = Boolean(opts.forDebanDestination);
    if (!channelId || !/^\d{15,25}$/.test(channelId)) return null;
    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (!channel) return null;
    const allowed = forDeban ? DEBAN_VOTE_CHANNEL_TYPES : PANEL_DISPLAY_CHANNEL_TYPES;
    if (!allowed.has(channel.type)) return null;
    if (!ALLOWED_PANEL_GUILD_IDS.includes(String(channel.guild?.id))) return null;
    return channel;
}

/**
 * Vérifie que le bot peut poster dans un salon cross-guild.
 * @param {{ forDebanDestination?: boolean }} [opts]
 */
function botCanPostIn(channel, opts = {}) {
    const forDeban = Boolean(opts.forDebanDestination);
    const me = channel.guild?.members?.me;
    if (!me) return true; // fallback : on laisse passer, Discord renverra l'erreur à l'usage
    const perms = channel.permissionsFor?.(me);
    if (!perms) return true;
    if (channel.type === ChannelType.GuildForum) {
        if (!forDeban) return false;
        return (
            perms.has(PermissionFlagsBits.ViewChannel) &&
            perms.has(PermissionFlagsBits.CreatePublicThreads) &&
            perms.has(PermissionFlagsBits.SendMessagesInThreads)
        );
    }
    return perms.has(PermissionFlagsBits.ViewChannel) && perms.has(PermissionFlagsBits.SendMessages);
}

module.exports = {
    TEST_DEBAN_BYPASS_GUILD_ID,
    ALLOWED_PANEL_GUILD_IDS,
    buildPanelPayload,

    data: new SlashCommandBuilder()
        .setName('panel-deban')
        .setDescription('Affiche le panneau de demande de débannissement (salons cross-serveur autorisés).')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .setDMPermission(false)
        .addStringOption(option =>
            option
                .setName('salon-deban')
                .setDescription('Salon des votes (texte, annonces ou forum sur support / principal).')
                .setRequired(true)
                .setAutocomplete(true)
        )
        .addStringOption(option =>
            option
                .setName('salon')
                .setDescription('Salon où poster le panel (support OU principal). Par défaut : salon courant.')
                .setRequired(false)
                .setAutocomplete(true)
        )
        .toJSON(),

    /**
     * Autocomplete : pour `salon-deban` inclut les forums ; pour `salon` (panneau) uniquement texte/annonces.
     * Filtrage par nom de salon / nom de serveur / ID, tronqué à 25 résultats (limite Discord).
     */
    async autocomplete(interaction) {
        try {
            const focused = interaction.options.getFocused(true);
            const query = String(focused.value || '').toLowerCase().trim();
            const forDeban = focused.name === 'salon-deban';
            const typeSet = forDeban ? DEBAN_VOTE_CHANNEL_TYPES : PANEL_DISPLAY_CHANNEL_TYPES;

            const suggestions = [];
            for (const gid of ALLOWED_PANEL_GUILD_IDS) {
                const guild = interaction.client.guilds.cache.get(gid);
                if (!guild) continue;

                // Tri : salons par position pour rendre l'autocomplete lisible
                const channels = [...guild.channels.cache.values()]
                    .filter(ch => typeSet.has(ch.type))
                    .sort((a, b) => (a.rawPosition ?? 0) - (b.rawPosition ?? 0));

                for (const ch of channels) {
                    const guildTag = guild.id === '1351221530998345828' ? 'Support' : 'Principal';
                    const suffix = ch.type === ChannelType.GuildForum ? ' (forum)' : '';
                    const label = `[${guildTag}] #${ch.name}${suffix}`;
                    if (query && !label.toLowerCase().includes(query) && !ch.id.includes(query)) continue;
                    suggestions.push({
                        name: label.slice(0, 100),
                        value: ch.id,
                    });
                    if (suggestions.length >= 25) break;
                }
                if (suggestions.length >= 25) break;
            }

            await interaction.respond(suggestions);
        } catch (err) {
            // L'autocomplete ne doit jamais crash l'interaction — on répond vide en cas de souci.
            console.error('[Panel] Autocomplete /panel-deban:', err?.message || err);
            try { await interaction.respond([]); } catch { /* noop */ }
        }
    },

    async execute(interaction, { client } = {}) {
        const cli = client || interaction.client;
        const debanChannelIdInput = interaction.options.getString('salon-deban');
        const panelChannelIdInput = interaction.options.getString('salon');

        // Résolution du salon de destination (requis)
        const debanChannel = await resolveAllowedChannel(cli, debanChannelIdInput, { forDebanDestination: true });
        if (!debanChannel) {
            return interaction.reply({
                content:
                    '❌ Salon de demandes (`salon-deban`) invalide. Utilisez l\'autocomplétion pour choisir un salon des serveurs **Support** ou **Principal**.',
                ephemeral: true,
            });
        }
        if (!botCanPostIn(debanChannel, { forDebanDestination: true })) {
            const forumHint =
                debanChannel.type === ChannelType.GuildForum
                    ? ' Pour un **forum**, il me faut **Voir le salon**, **Créer des fils publics** et **Envoyer des messages dans les fils**.'
                    : ' Il me faut **Voir le salon** et **Envoyer des messages**.';
            return interaction.reply({
                content: `❌ Je n'ai pas les permissions pour utiliser ${debanChannel} (serveur **${debanChannel.guild.name}**).${forumHint}`,
                ephemeral: true,
            });
        }

        // Résolution du salon où poster le panel (optionnel : défaut = salon courant de la commande)
        let target = interaction.channel;
        if (panelChannelIdInput) {
            const resolved = await resolveAllowedChannel(cli, panelChannelIdInput, { forDebanDestination: false });
            if (!resolved) {
                return interaction.reply({
                    content:
                        '❌ Salon d\'affichage du panel (`salon`) invalide. Utilisez l\'autocomplétion pour choisir un salon **texte ou annonces** (Support ou Principal).',
                    ephemeral: true,
                });
            }
            if (!botCanPostIn(resolved, { forDebanDestination: false })) {
                return interaction.reply({
                    content: `❌ Je n'ai pas les permissions pour poster dans ${resolved} (serveur **${resolved.guild.name}**).`,
                    ephemeral: true,
                });
            }
            target = resolved;
        }

        if (!target?.isTextBased?.()) {
            return interaction.reply({
                content: '❌ Le salon ciblé pour le panel doit être un salon textuel.',
                ephemeral: true,
            });
        }

        const payload = buildPanelPayload(debanChannel.id);

        // Cas 1 : salon cible === salon courant → reply direct (confirme à l'admin que c'est fait)
        if (target.id === interaction.channel?.id) {
            try {
                await interaction.reply(payload);
            } catch (err) {
                console.error('[Panel] Erreur reply panel:', err?.code, err?.message);
                if (!interaction.replied && !interaction.deferred) {
                    await interaction.reply({
                        content: `❌ Impossible de poster le panel (code ${err?.code ?? 'inconnu'}).`,
                        ephemeral: true,
                    });
                }
            }
            return;
        }

        // Cas 2 : salon cible différent (même serveur OU autre serveur) → channel.send puis confirmation
        try {
            const sent = await target.send(payload);
            const crossGuild = target.guild?.id !== interaction.guild?.id;
            const crossDeban = debanChannel.guild?.id !== target.guild?.id;
            const summary = [
                `✅ Panel posté dans ${target} (${sent.url})${crossGuild ? ` — serveur **${target.guild.name}**` : ''}.`,
                `📬 Les demandes seront envoyées dans ${debanChannel}${crossDeban ? ` — serveur **${debanChannel.guild.name}**` : ''}.`,
            ].join('\n');
            await interaction.reply({ content: summary, ephemeral: true });
        } catch (err) {
            console.error(`[Panel] Erreur envoi dans ${target?.id}:`, err?.code, err?.message, err);
            if (!interaction.replied && !interaction.deferred) {
                await interaction.reply({
                    content: `❌ Erreur lors du post du panel (code ${err?.code ?? 'inconnu'} : ${err?.message ?? 'inconnue'}).`,
                    ephemeral: true,
                });
            }
        }
    },
};
