/**
 * Système de vérification (OAuth Discord + IP + détection d'alts).
 *
 * Point d'entrée unique : `installVerificationSystem(client, opts)`. Cette fonction est
 * conçue pour être intégrée à un bot existant (ici le bot modération) **sans casser ses
 * listeners** : elle ajoute des écouteurs `interactionCreate` et `guildMemberAdd` qui
 * filtrent strictement les customIds qui leur appartiennent (`verify:*`, `setup:*`).
 *
 * Composants posés :
 *  - Listener `interactionCreate` qui gère :
 *      • bouton `verify:go`            → DM lien OAuth signé (state HMAC, 30 min)
 *      • menus `setup:panel_ch`,
 *               `setup:verified_role`,
 *               `setup:log_noip`        → mise à jour de la config par guilde
 *      • boutons `setup:embed_modal`,
 *                `setup:embed_default`,
 *                `setup:publish`         → édition du contenu / publication du panneau
 *      • modal `setup:embed_submit`     → enregistrement du contenu personnalisé
 *  - Listener `guildMemberAdd` : si le membre était déjà vérifié, on lui réattribue le rôle.
 *  - Serveur Express sur `HTTP_PORT` qui sert `/oauth/start` et `/oauth/callback`.
 *  - Routage des logs :
 *      • salon `cfg.log_channel_no_ip_id` (sans IP)              → embed riche public
 *      • DM aux IDs listés dans OWNER_DM_IDS (avec IP brute)     → même embed + champs sensibles
 *
 * Les commandes slash `/verify` et `/setup-verification` sont enregistrées par le système
 * de déploiement existant du bot modération (fichiers `commands/verify.js` + `setup-verification.js`),
 * pas ici. Ce module fournit uniquement les helpers consommés par ces commandes.
 */
const {
    Events,
    PermissionFlagsBits,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ChannelSelectMenuBuilder,
    RoleSelectMenuBuilder,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    ChannelType,
    MessageFlags,
} = require('discord.js');

const { signState, hashEmail, hashIp } = require('./cryptoUtil');
const {
    getGuildConfig,
    upsertGuildConfig,
    getEffectiveEmbed,
    resetEmbedToDefault,
    findVerifiedInGuild,
    saveVerifiedForGuild,
} = require('./database');
const { addGuildMemberRole } = require('./discordApi');
const { createVerifyServer } = require('./verifyServer');
const {
    buildSuccessEmbed,
    buildAltEmbed,
    buildAltActionRow,
    buildVpnEmbed,
    buildFailEmbed,
    withSensitiveFields,
} = require('./embeds');

function isGuildAdmin(interaction) {
    return Boolean(
        interaction.guild && interaction.memberPermissions?.has(PermissionFlagsBits.Administrator),
    );
}

function buildSetupRows() {
    return [
        new ActionRowBuilder().addComponents(
            new ChannelSelectMenuBuilder()
                .setCustomId('setup:panel_ch')
                .setPlaceholder('Salon du panneau (embed + bouton)')
                .setMinValues(1)
                .setMaxValues(1)
                .setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement),
        ),
        new ActionRowBuilder().addComponents(
            new RoleSelectMenuBuilder()
                .setCustomId('setup:verified_role')
                .setPlaceholder('Rôle donné après vérification')
                .setMinValues(1)
                .setMaxValues(1),
        ),
        new ActionRowBuilder().addComponents(
            new ChannelSelectMenuBuilder()
                .setCustomId('setup:log_noip')
                .setPlaceholder('Salon logs (sans adresse IP)')
                .setMinValues(1)
                .setMaxValues(1)
                .setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement),
        ),
        new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('setup:publish')
                .setLabel('Publier / mettre à jour le panneau')
                .setStyle(ButtonStyle.Success),
            new ButtonBuilder()
                .setCustomId('setup:embed_modal')
                .setLabel("Personnaliser l'embed")
                .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
                .setCustomId('setup:embed_default')
                .setLabel('Embed par défaut')
                .setStyle(ButtonStyle.Secondary),
        ),
    ];
}

function describeConfig(cfg) {
    const c = cfg || {};
    const fmt = (id) => (id ? `<#${id}>` : '*(non défini)*');
    const role = c.verified_role_id ? `<@&${c.verified_role_id}>` : '*(non défini)*';
    return (
        `**Salon panneau :** ${fmt(c.panel_channel_id)}\n` +
        `**Rôle vérifié :** ${role}\n` +
        `**Logs sans IP :** ${fmt(c.log_channel_no_ip_id)}\n` +
        `**Logs avec IP :** *DM aux owners* (configuré via \`OWNER_DM_IDS\` dans \`.env\`)\n\n` +
        `Utilise les menus ci-dessous pour modifier chaque valeur, puis **Publier** pour poster le message public avec le bouton de vérification.`
    );
}

async function refreshPublicPanel(guild) {
    const cfg = getGuildConfig(guild.id);
    if (!cfg?.panel_channel_id || !cfg?.panel_message_id) return;
    const channel = await guild.channels.fetch(cfg.panel_channel_id).catch(() => null);
    if (!channel || !channel.isTextBased()) return;
    const msg = await channel.messages.fetch(cfg.panel_message_id).catch(() => null);
    if (!msg) return;
    const eff = getEffectiveEmbed(cfg);
    const embed = new EmbedBuilder().setTitle(eff.title).setDescription(eff.description).setColor(eff.color);
    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('verify:go').setLabel('🔐 Vérifier').setStyle(ButtonStyle.Primary),
    );
    await msg.edit({ embeds: [embed], components: [row] }).catch(() => {});
}

async function sendChannelEmbed(client, channelId, embed) {
    if (!channelId) return;
    try {
        const ch = await client.channels.fetch(channelId);
        if (ch && ch.isTextBased()) await ch.send({ embeds: [embed] });
    } catch (e) {
        console.error("[verif] impossible d'envoyer dans le salon", channelId, e.message || e);
    }
}

async function dmUserEmbed(client, userId, embed) {
    try {
        const user = await client.users.fetch(userId);
        await user.send({ embeds: [embed] });
    } catch (e) {
        console.error('[verif/dm] impossible de DM', userId, e.message || e);
    }
}

/**
 * Construit l'embed approprié selon le payload (succès / alt / échec) puis l'envoie :
 *  - dans le salon de logs sans IP (config par guilde)
 *  - en DM aux ownerDmIds (avec IP greffée)
 */
async function dispatchVerificationLog(client, ownerDmIds, p) {
    const { guildId, success, alts } = p;
    const cfg = getGuildConfig(guildId);

    let publicEmbed;
    if (!success) publicEmbed = await buildFailEmbed(client, p);
    else if ((alts || []).length > 0) publicEmbed = await buildAltEmbed(client, p);
    else publicEmbed = await buildSuccessEmbed(client, p);

    if (cfg?.log_channel_no_ip_id) {
        await sendChannelEmbed(client, cfg.log_channel_no_ip_id, publicEmbed);
    }

    if (ownerDmIds.length > 0) {
        let dmEmbed;
        if (!success) dmEmbed = await buildFailEmbed(client, p);
        else if ((alts || []).length > 0) dmEmbed = await buildAltEmbed(client, p);
        else dmEmbed = await buildSuccessEmbed(client, p);
        withSensitiveFields(dmEmbed, p);
        await Promise.allSettled(ownerDmIds.map((id) => dmUserEmbed(client, id, dmEmbed)));
    } else {
        console.warn(
            "[verif] OWNER_DM_IDS vide — le log avec IP n'a été envoyé à personne. Ajoute des IDs dans .env.",
        );
    }
}

/* -------------------------------------------------------------------------- *
 *  Public API
 * -------------------------------------------------------------------------- */

/**
 * Construit l'URL de vérification signée (state HMAC, expiration 30 min). Exposée
 * pour les commandes slash `/verify` et le bouton public `verify:go`.
 *
 * @param {{ publicBaseUrl: string, stateSecret: string }} cfg
 * @param {string} discordUserId
 * @param {string} guildId
 */
function buildVerifyUrl(cfg, discordUserId, guildId) {
    const state = signState({ discordUserId, guildId }, cfg.stateSecret);
    const base = cfg.publicBaseUrl.replace(/\/$/, '');
    return `${base}/verify/start?state=${encodeURIComponent(state)}`;
}

/**
 * Démarre le serveur Express + pose les listeners Discord.js sur le client passé.
 * Conçu pour cohabiter avec les listeners existants du bot modération.
 *
 * Version sans OAuth : pas besoin de Client Secret. Le membre clique sur 🔐 Vérifier,
 * reçoit en DM un lien `/verify/start?state=<HMAC>` valide 30 min, ouvre la page,
 * confirme via un bouton (POST), et son IP est capturée à ce moment-là.
 *
 * @param {import('discord.js').Client} client
 * @param {{
 *   botToken: string,
 *   publicBaseUrl: string,
 *   stateSecret: string,
 *   httpPort: number,
 *   ownerDmIds: string[],
 * }} opts
 */
function installVerificationSystem(client, opts) {
    const required = ['botToken', 'publicBaseUrl', 'stateSecret'];
    for (const k of required) {
        if (!opts || !opts[k]) {
            console.warn(`[verif] désactivé : option manquante ${k}.`);
            return { server: null };
        }
    }
    const httpPort = Number.isFinite(opts.httpPort) && opts.httpPort > 0 ? opts.httpPort : 3782;
    const ownerDmIds = Array.isArray(opts.ownerDmIds) ? opts.ownerDmIds : [];

    if (ownerDmIds.length === 0) {
        console.warn(
            '[verif] OWNER_DM_IDS non défini — les logs avec IP ne seront DM à personne.\n' +
                '       Ajoute par exemple : OWNER_DM_IDS=965984018216665099,1278372257483456603',
        );
    } else {
        console.log(`[verif] Logs avec IP → DM à ${ownerDmIds.length} owner(s).`);
    }

    const { server } = createVerifyServer({
        botToken: opts.botToken,
        publicBaseUrl: opts.publicBaseUrl,
        stateSecret: opts.stateSecret,
        httpPort,
        onVerificationLog: (payload) => dispatchVerificationLog(client, ownerDmIds, payload),
    });

    client.on(Events.GuildMemberAdd, async (member) => {
        try {
            if (member.user.bot) return;
            const cfg = getGuildConfig(member.guild.id);
            if (!cfg?.verified_role_id) return;
            if (member.roles.cache.has(cfg.verified_role_id)) return;
            const row = findVerifiedInGuild(member.guild.id, member.id);
            if (!row) return;
            await addGuildMemberRole(client.token, member.guild.id, member.id, cfg.verified_role_id);
        } catch (e) {
            console.error('[verif/GuildMemberAdd]', e.message || e);
        }
    });

    client.on(Events.InteractionCreate, async (interaction) => {
        try {
            const cid = interaction.customId;

            if (interaction.isButton() && cid === 'verify:go') {
                await handleVerifyButton(interaction, opts, client);
                return;
            }
            if (interaction.isModalSubmit() && cid === 'setup:embed_submit') {
                await handleEmbedModalSubmit(interaction);
                return;
            }
            if (interaction.isChannelSelectMenu() && (cid === 'setup:panel_ch' || cid === 'setup:log_noip')) {
                await handleChannelSelect(interaction);
                return;
            }
            if (interaction.isRoleSelectMenu() && cid === 'setup:verified_role') {
                await handleRoleSelect(interaction);
                return;
            }
            if (
                interaction.isButton() &&
                (cid === 'setup:publish' || cid === 'setup:embed_modal' || cid === 'setup:embed_default')
            ) {
                await handleSetupButton(interaction);
                return;
            }
        } catch (e) {
            console.error('[verif/interactionCreate]', e);
            const payload = { content: `Erreur : ${e.message || e}`, flags: MessageFlags.Ephemeral };
            try {
                if (interaction.replied || interaction.deferred) await interaction.followUp(payload);
                else await interaction.reply(payload);
            } catch { /* on a déjà répondu ailleurs ou interaction expirée */ }
        }
    });

    return { server };
}

/* -------------------------------------------------------------------------- *
 *  Handlers (composants)
 * -------------------------------------------------------------------------- */

async function handleVerifyButton(interaction, opts, client) {
    if (!interaction.guild) {
        await interaction.reply({ content: 'Utilisable seulement sur un serveur.', flags: MessageFlags.Ephemeral });
        return;
    }
    const cfg = getGuildConfig(interaction.guild.id);
    if (!cfg?.verified_role_id) {
        await interaction.reply({
            content: "La vérification n'est pas configurée sur ce serveur.",
            flags: MessageFlags.Ephemeral,
        });
        return;
    }
    const member = interaction.member;
    if (member?.roles?.cache?.has(cfg.verified_role_id)) {
        await interaction.reply({ content: 'Tu es déjà vérifié.', flags: MessageFlags.Ephemeral });
        return;
    }
    const existing = findVerifiedInGuild(interaction.guild.id, interaction.user.id);
    if (existing) {
        try {
            await addGuildMemberRole(client.token, interaction.guild.id, interaction.user.id, cfg.verified_role_id);
            await interaction.reply({
                content: 'Tu étais déjà enregistré comme vérifié : le rôle a été réappliqué.',
                flags: MessageFlags.Ephemeral,
            });
        } catch (e) {
            await interaction.reply({
                content: `Impossible d'attribuer le rôle : ${e.message || e}`,
                flags: MessageFlags.Ephemeral,
            });
        }
        return;
    }
    const url = buildVerifyUrl(opts, interaction.user.id, interaction.guild.id);
    const linkRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setStyle(ButtonStyle.Link)
            .setURL(url)
            .setLabel('🔓 Ouvrir la page de vérification'),
    );
    await interaction.reply({
        content:
            'Clique sur le bouton ci-dessous pour ouvrir la page de vérification dans ton navigateur ' +
            '(reste connecté(e) au **même compte Discord**).\n' +
            'Une fois validé, tu recevras automatiquement le rôle.',
        components: [linkRow],
        flags: MessageFlags.Ephemeral,
    });
}

async function handleEmbedModalSubmit(interaction) {
    if (!interaction.guild || !isGuildAdmin(interaction)) {
        await interaction.reply({ content: 'Réservé aux administrateurs.', flags: MessageFlags.Ephemeral });
        return;
    }
    const title = interaction.fields.getTextInputValue('embed_title').trim();
    const description = interaction.fields.getTextInputValue('embed_description').trim();
    const colorRaw = interaction.fields.getTextInputValue('embed_color').trim();
    let embedColor = null;
    if (colorRaw) {
        const hex = colorRaw.startsWith('#') ? colorRaw.slice(1) : colorRaw;
        const n = parseInt(hex, 16);
        if (!Number.isNaN(n) && n >= 0 && n <= 0xffffff) embedColor = n;
    }
    upsertGuildConfig(interaction.guild.id, {
        embed_title: title || null,
        embed_description: description || null,
        embed_color: embedColor != null ? embedColor : null,
    });
    await refreshPublicPanel(interaction.guild);
    const cfg = getGuildConfig(interaction.guild.id);
    const warn = embedColor == null && colorRaw ? '\n⚠️ Couleur invalide ignorée (ex. `5865F2` ou `#5865F2`).' : '';
    await interaction.reply({
        content: `Embed mis à jour.${warn}`,
        embeds: [
            new EmbedBuilder()
                .setTitle('Configuration — vérification')
                .setDescription(describeConfig(cfg))
                .setColor(0x5865f2),
        ],
        components: buildSetupRows(),
        flags: MessageFlags.Ephemeral,
    });
}

async function handleChannelSelect(interaction) {
    if (!interaction.guild || !isGuildAdmin(interaction)) {
        await interaction.reply({ content: 'Réservé aux administrateurs.', flags: MessageFlags.Ephemeral });
        return;
    }
    const id = interaction.values[0];
    if (interaction.customId === 'setup:panel_ch') upsertGuildConfig(interaction.guild.id, { panel_channel_id: id });
    if (interaction.customId === 'setup:log_noip') upsertGuildConfig(interaction.guild.id, { log_channel_no_ip_id: id });
    const cfg = getGuildConfig(interaction.guild.id);
    await interaction.update({
        embeds: [
            new EmbedBuilder()
                .setTitle('Configuration — vérification')
                .setDescription(describeConfig(cfg))
                .setColor(0x5865f2),
        ],
        components: buildSetupRows(),
    });
}

async function handleRoleSelect(interaction) {
    if (!interaction.guild || !isGuildAdmin(interaction)) {
        await interaction.reply({ content: 'Réservé aux administrateurs.', flags: MessageFlags.Ephemeral });
        return;
    }
    const rid = interaction.values[0];
    upsertGuildConfig(interaction.guild.id, { verified_role_id: rid });
    const cfg = getGuildConfig(interaction.guild.id);
    await interaction.update({
        embeds: [
            new EmbedBuilder()
                .setTitle('Configuration — vérification')
                .setDescription(describeConfig(cfg))
                .setColor(0x5865f2),
        ],
        components: buildSetupRows(),
    });
}

async function handleSetupButton(interaction) {
    if (!interaction.guild || !isGuildAdmin(interaction)) {
        await interaction.reply({ content: 'Réservé aux administrateurs.', flags: MessageFlags.Ephemeral });
        return;
    }
    if (interaction.customId === 'setup:embed_modal') {
        const cfg = getGuildConfig(interaction.guild.id);
        const eff = getEffectiveEmbed(cfg);
        const modal = new ModalBuilder().setCustomId('setup:embed_submit').setTitle("Contenu de l'embed");
        const titleVal = String(cfg?.embed_title != null ? cfg.embed_title : eff.title).slice(0, 256) || ' ';
        const descVal = String(cfg?.embed_description != null ? cfg.embed_description : eff.description).slice(0, 4000) || ' ';
        modal.addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('embed_title')
                    .setLabel('Titre')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(false)
                    .setMaxLength(256)
                    .setValue(titleVal),
            ),
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('embed_description')
                    .setLabel('Description')
                    .setStyle(TextInputStyle.Paragraph)
                    .setRequired(false)
                    .setMaxLength(4000)
                    .setValue(descVal),
            ),
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('embed_color')
                    .setLabel('Couleur (hex, ex. 5865F2)')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(false)
                    .setMaxLength(7)
                    .setValue(
                        cfg?.embed_color != null ? Number(cfg.embed_color).toString(16).padStart(6, '0') : '5865f2',
                    ),
            ),
        );
        await interaction.showModal(modal);
        return;
    }
    if (interaction.customId === 'setup:embed_default') {
        resetEmbedToDefault(interaction.guild.id);
        await refreshPublicPanel(interaction.guild);
        const cfg = getGuildConfig(interaction.guild.id);
        await interaction.update({
            embeds: [
                new EmbedBuilder()
                    .setTitle('Configuration — vérification')
                    .setDescription(describeConfig(cfg))
                    .setColor(0x5865f2),
            ],
            components: buildSetupRows(),
        });
        return;
    }
    if (interaction.customId === 'setup:publish') {
        const cfg = getGuildConfig(interaction.guild.id);
        if (!cfg?.panel_channel_id || !cfg?.verified_role_id) {
            await interaction.reply({
                content: 'Choisis au minimum un **salon panneau** et un **rôle vérifié** avant de publier.',
                flags: MessageFlags.Ephemeral,
            });
            return;
        }
        const channel = await interaction.guild.channels.fetch(cfg.panel_channel_id).catch(() => null);
        if (!channel || !channel.isTextBased()) {
            await interaction.reply({
                content: 'Salon panneau introuvable ou type non supporté.',
                flags: MessageFlags.Ephemeral,
            });
            return;
        }
        const eff = getEffectiveEmbed(cfg);
        const embed = new EmbedBuilder().setTitle(eff.title).setDescription(eff.description).setColor(eff.color);
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('verify:go').setLabel('🔐 Vérifier').setStyle(ButtonStyle.Primary),
        );
        let messageId = cfg.panel_message_id;
        if (messageId) {
            const old = await channel.messages.fetch(messageId).catch(() => null);
            if (old) {
                await old.edit({ embeds: [embed], components: [row] });
            } else {
                const msg = await channel.send({ embeds: [embed], components: [row] });
                messageId = msg.id;
            }
        } else {
            const msg = await channel.send({ embeds: [embed], components: [row] });
            messageId = msg.id;
        }
        upsertGuildConfig(interaction.guild.id, { panel_message_id: messageId });
        await interaction.reply({
            content: `Panneau mis à jour dans <#${cfg.panel_channel_id}>.`,
            flags: MessageFlags.Ephemeral,
        });
    }
}

module.exports = {
    installVerificationSystem,
    buildVerifyUrl,
    describeConfig,
    buildSetupRows,
};
