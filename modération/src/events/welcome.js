/**
 * Module de bienvenue pour les nouveaux membres (Discord Components V2)
 */
const {
    ContainerBuilder,
    TextDisplayBuilder,
    SectionBuilder,
    ThumbnailBuilder,
    SeparatorBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    MessageFlags,
} = require('discord.js');
const CONFIG = require('../config.js');

const recentJoins = new Map();
const ANTI_DUPLICATE_MS = 5000;

function parseAccentColor(hex) {
    if (!hex) return 0x2f3136;
    const s = String(hex).replace(/^#/, '');
    const n = parseInt(s, 16);
    return Number.isNaN(n) ? 0x2f3136 : n;
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
 * @param {import('discord.js').GuildMember} member
 * @param {{ joinedAt?: Date }} [options]
 * @returns {{ components: import('discord.js').ContainerBuilder[]; flags: number; allowedMentions: { users: string[] } }}
 */
function buildWelcomeMessage(member, options = {}) {
    const w = CONFIG.WELCOME;
    const regId = w.LINK_REGLEMENT_CHANNEL_ID;
    const ticketsId = w.LINK_TICKETS_CHANNEL_ID;

    if (!/^\d{17,22}$/.test(String(regId)) || !/^\d{17,22}$/.test(String(ticketsId))) {
        throw new Error('LINK_REGLEMENT_CHANNEL_ID ou LINK_TICKETS_CHANNEL_ID invalide dans config.js');
    }

    const guildId = member.guild.id;
    const serverName = member.guild.name;
    const joinedAt = options.joinedAt ?? member.joinedAt ?? new Date();
    const createdAt = member.user.createdAt;
    const avatar = member.user.displayAvatarURL({ extension: 'png', size: 256 });

    /** Ligne du haut + PP du membre à droite (comme l’embed du screen). */
    const header = new TextDisplayBuilder().setContent(
        `# 👋 **Bienvenue,** ${member} **!**`
    );
    const thumbnail = new ThumbnailBuilder()
        .setURL(avatar)
        .setDescription(`Avatar — ${member.user.username}`);
    const section = new SectionBuilder().addTextDisplayComponents(header).setThumbnailAccessory(thumbnail);

    /** Corps : uniquement les 3 lignes ➔ (le titre est dans la section au-dessus). */
    const body = new TextDisplayBuilder().setContent(
        `➔ Nous sommes ravis de te voir arriver sur **${serverName}** !\n\n` +
            `➔ N'hésite pas à aller faire un tour dans <#${regId}> et <#${ticketsId}> si t'as besoin d'aide.\n\n` +
            `➔ **Passe un agréable séjour ici !** 🔥`
    );

    /** Plus petit que le reste (sous-texte Discord). */
    const footerMeta = new TextDisplayBuilder().setContent(
        `-# Compte créé le ${formatFrCompactDate(createdAt)} · Arrivée ${formatFrCompactDateTime(joinedAt)}`
    );

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setStyle(ButtonStyle.Link)
            .setLabel('Règlement')
            .setURL(channelJumpUrl(guildId, regId)),
        new ButtonBuilder()
            .setStyle(ButtonStyle.Link)
            .setLabel('Infos / Aide')
            .setURL(channelJumpUrl(guildId, ticketsId))
    );

    const container = new ContainerBuilder()
        .setAccentColor(parseAccentColor(w.ACCENT_COLOR))
        .addTextDisplayComponents(welcomeBody)
        .addActionRowComponents(row);

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

        const payload = buildWelcomeMessage(member, { joinedAt: member.joinedAt ?? new Date() });
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
};
