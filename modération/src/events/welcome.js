/**
 * Module de bienvenue pour les nouveaux membres (Discord Components V2)
 */
const path = require('path');
const {
    ContainerBuilder,
    TextDisplayBuilder,
    SectionBuilder,
    ThumbnailBuilder,
    SeparatorBuilder,
    SeparatorSpacingSize,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    MessageFlags,
} = require('discord.js');
const CONFIG = require('../config.js');
const { stripHexToInt } = require(path.join(__dirname, '..', '..', '..', 'blz-embed-theme'));

const recentJoins = new Map();
const ANTI_DUPLICATE_MS = 5000;

function parseAccentColor(hex) {
    if (!hex) return stripHexToInt();
    return stripHexToInt(hex);
}

function channelJumpUrl(guildId, channelId) {
    return `https://discord.com/channels/${guildId}/${channelId}`;
}

/** Dates courtes pour le pied de message (épuré) */
function formatFrCompactDate(d) {
    return new Date(d).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
}

function formatFrCompactDateTime(d) {
    return new Date(d).toLocaleString('fr-FR', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    });
}

/**
 * Texte d’affichage pour l’emoji titre (custom ou 👋).
 * Cherche dans tout le cache client, puis fetch guilde source + API emojis.
 * @param {import('discord.js').Client} client
 */
async function resolveWelcomeTitleEmoji(client) {
    const w = CONFIG.WELCOME;
    const id = String(w.CUSTOM_WELCOME_EMOJI_ID || '').trim();
    if (!/^\d{17,22}$/.test(id)) return '👋';

    let emoji = client.emojis.cache.get(id);
    if (emoji) return emoji.toString();

    for (const g of client.guilds.cache.values()) {
        const e = g.emojis.cache.get(id);
        if (e) return e.toString();
    }

    const sourceGuildId = String(w.CUSTOM_WELCOME_EMOJI_SOURCE_GUILD_ID || '').trim();
    if (/^\d{17,22}$/.test(sourceGuildId)) {
        try {
            let guild = client.guilds.cache.get(sourceGuildId);
            if (!guild) guild = await client.guilds.fetch(sourceGuildId);

            await guild.emojis.fetch().catch(() => {});
            emoji = guild.emojis.cache.get(id);
            if (emoji) return emoji.toString();

            const fetched = await guild.emojis.fetch(id).catch(() => null);
            if (fetched) return fetched.toString();
        } catch (err) {
            console.warn('[Welcome] Résolution emoji — guilde source:', err?.message || err);
        }
    }

    const rawName = String(w.CUSTOM_WELCOME_EMOJI_NAME || '').trim();
    if (!rawName) {
        console.warn(
            '[Welcome] Emoji non résolu (ID ' +
                id +
                '). Mets `WELCOME_CUSTOM_EMOJI_NAME` dans le .env avec le nom exact de l’emoji ' +
                '(sans les deux-points), ou vérifie que le bot est sur la guilde où l’emoji est uploadé.'
        );
        return '👋';
    }

    const name = rawName.replace(/[^a-zA-Z0-9_]/g, '_').slice(0, 32) || 'emoji';
    const animated = Boolean(w.CUSTOM_WELCOME_EMOJI_ANIMATED);
    console.warn('[Welcome] Fallback <:nom:id> pour l’emoji — si l’image ne s’affiche pas, vérifie le nom.');
    return animated ? `<a:${name}:${id}>` : `<:${name}:${id}>`;
}

/** Infos compte / arrivée : uniquement pour les logs (plus affichées dans le message Discord). */
function logWelcomeMemberMeta(member) {
    const joinedAt = member.joinedAt ?? new Date();
    console.log(
        `[Welcome] ${member.user.tag} (${member.id}) — Compte créé le ${formatFrCompactDate(
            member.user.createdAt
        )} · Arrivée ${formatFrCompactDateTime(joinedAt)}`
    );
}

/**
 * @param {import('discord.js').GuildMember} member
 * @returns {Promise<{ components: import('discord.js').ContainerBuilder[]; flags: number; allowedMentions: { users: string[] } }>}
 */
async function buildWelcomeMessage(member) {
    const w = CONFIG.WELCOME;
    const titleEmoji = await resolveWelcomeTitleEmoji(member.client);
    const regId = w.LINK_REGLEMENT_CHANNEL_ID;
    const ticketsId = w.LINK_TICKETS_CHANNEL_ID;

    if (!/^\d{17,22}$/.test(String(regId)) || !/^\d{17,22}$/.test(String(ticketsId))) {
        throw new Error('LINK_REGLEMENT_CHANNEL_ID ou LINK_TICKETS_CHANNEL_ID invalide dans config.js');
    }

    const guildId = member.guild.id;
    const serverName = member.guild.name;
    /** 128px = vignette plus petite, proche du rendu « embed compact » du screen. */
    const avatar = member.user.displayAvatarURL({ extension: 'png', size: 128 });

    /** Un seul TextDisplay évite l’espace vertical entre deux composants V2. Sauts `\n` simples (pas de `\n\n`). */
    const mainText = new TextDisplayBuilder().setContent(
        `## ${titleEmoji} **Bienvenue,** ${member} **!**\n` +
            `➜ Nous sommes ravis de te voir arriver sur le serveur **${serverName}** !\n` +
            `➜ N'hésite pas à aller faire un tour dans <#${regId}> et <#${ticketsId}> si t'as besoin d'aide.\n` +
            `➜ Passe un agréable séjour ici ! 🔥`
    );
    const thumbnail = new ThumbnailBuilder()
        .setURL(avatar)
        .setDescription(`Avatar — ${member.user.username}`);
    const mainSection = new SectionBuilder()
        .addTextDisplayComponents(mainText)
        .setThumbnailAccessory(thumbnail);

    const footerButtons = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setStyle(ButtonStyle.Link)
            .setLabel('📋 Règlement')
            .setURL(channelJumpUrl(guildId, regId)),
        new ButtonBuilder()
            .setStyle(ButtonStyle.Link)
            .setLabel('🪢 Tickets')
            .setURL(channelJumpUrl(guildId, ticketsId))
    );

    const container = new ContainerBuilder()
        .setAccentColor(parseAccentColor(w.ACCENT_COLOR))
        .addSectionComponents(mainSection)
        .addSeparatorComponents(
            new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
        )
        .addActionRowComponents(footerButtons);

    return {
        components: [container],
        flags: MessageFlags.IsComponentsV2,
        allowedMentions: { users: [member.id] },
    };
}

/**
 * @param {import('discord.js').GuildMember} member
 */
async function handleMemberJoin(member) {
    if (!CONFIG.WELCOME?.ENABLED) return;

    const now = Date.now();
    const lastJoin = recentJoins.get(member.id);
    if (lastJoin && now - lastJoin < ANTI_DUPLICATE_MS) {
        return;
    }
    recentJoins.set(member.id, now);

    if (recentJoins.size > 100) {
        const cutoff = now - ANTI_DUPLICATE_MS;
        for (const [id, time] of recentJoins) {
            if (time < cutoff) recentJoins.delete(id);
        }
    }

    const w = CONFIG.WELCOME;

    try {
        const channel = member.guild.channels.cache.get(w.CHANNEL_ID);
        if (!channel) {
            console.error('❌ [Welcome] Salon de bienvenue introuvable:', w.CHANNEL_ID);
            return;
        }

        logWelcomeMemberMeta(member);

        const payload = await buildWelcomeMessage(member);
        await channel.send({
            components: payload.components,
            flags: payload.flags,
            allowedMentions: payload.allowedMentions,
        });

        if (CONFIG.MEMBER_ROLE_ID) {
            try {
                const role = member.guild.roles.cache.get(CONFIG.MEMBER_ROLE_ID);
                if (role) {
                    await member.roles.add(role, 'Attribution automatique aux nouveaux arrivants');
                    console.log(`✅ Rôle membre attribué à ${member.user.tag}`);
                } else {
                    console.error('❌ [Welcome] Rôle membre introuvable:', CONFIG.MEMBER_ROLE_ID);
                }
            } catch (roleError) {
                console.error(
                    `❌ [Welcome] Rôle membre: ${roleError.code || ''} ${roleError.message || roleError} — place le rôle du bot au-dessus de celui attribué.`
                );
            }
        }
    } catch (error) {
        console.error("❌ [Welcome] Erreur lors de l'envoi du message de bienvenue:", error);
    }
}

module.exports = {
    handleMemberJoin,
    buildWelcomeMessage,
    logWelcomeMemberMeta,
};
