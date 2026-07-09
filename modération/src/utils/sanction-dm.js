const { EmbedBuilder, ChannelType } = require('discord.js');
const CONFIG = require('../config.js');

/** @typedef {'MUTE'|'WARN'|'KICK'} PostSanctionDmType */

const TYPE_META = {
    MUTE: { title: 'Mute (timeout)', past: 'mis en sourdine (timeout)' },
    WARN: { title: 'Avertissement', past: 'averti' },
    KICK: { title: 'Expulsion', past: 'expulsé du serveur' },
};

const COLORS = {
    MUTE: 0xd62828,
    WARN: 0xfee75c,
    KICK: 0xf26522,
    BAN: 0xed4245,
};

/**
 * MP avant bannissement (BLZ).
 * @param {{ guildName: string, reason: string, byLabel: string, durationLabel: string }} p
 */
function buildPreBanDmEmbed({ guildName, reason, byLabel, durationLabel }) {
    return new EmbedBuilder()
        .setColor(COLORS.BAN)
        .setTitle('Avertissement de modération — BLZ')
        .setDescription(
            [
                `Tu es sur le point d'être **banni** de **${guildName}**.`,
                '',
                'Si tu penses qu\'il s\'agit d\'une erreur, tu pourras faire une demande de débannissement via le lien qui t\'est envoyé juste après ce message.',
            ].join('\n'),
        )
        .addFields(
            { name: 'Sanctionné par', value: byLabel, inline: true },
            { name: 'Raison', value: reason || 'Aucune raison', inline: false },
            { name: 'Durée', value: durationLabel, inline: true },
            { name: 'Serveur', value: guildName, inline: true },
            { name: 'Action', value: 'Bannissement', inline: true },
        )
        .setTimestamp();
}

/**
 * MP après mute / warn / kick.
 */
function buildPostSanctionDmEmbed({ guildName, type, reason, byLabel, endsAt }) {
    const meta = TYPE_META[type] || { title: 'Sanction', past: 'sanctionné' };
    const embed = new EmbedBuilder()
        .setColor(COLORS[type] ?? 0xd62828)
        .setTitle(meta.title)
        .setDescription(`Tu as été **${meta.past}** sur **${guildName}**.`)
        .addFields(
            { name: 'Sanctionné par', value: byLabel, inline: true },
            { name: 'Raison', value: reason || 'Aucune raison', inline: false },
        );

    if (endsAt) {
        const ts = Math.floor(endsAt.getTime() / 1000);
        embed.addFields({
            name: 'Fin du mute',
            value: `<t:${ts}:F> (<t:${ts}:R>)`,
            inline: false,
        });
    }

    embed.setTimestamp();
    return embed;
}

/**
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 * @param {boolean} [anonymous]
 */
function moderatorLabelForDm(interaction, anonymous = false) {
    if (anonymous) return 'Anonyme';
    return interaction.user.tag;
}

/**
 * @param {import('discord.js').User} user
 * @param {import('discord.js').EmbedBuilder} embed
 */
async function trySendSanctionDm(user, embed) {
    return user
        .send({ embeds: [embed] })
        .then(() => true)
        .catch(() => false);
}

/**
 * Envoie le lien de débannissement (2e MP après l'embed ban).
 */
async function sendDebanInviteDm(user) {
    const url = CONFIG.DEBAN_INVITE_URL || 'https://discord.gg/UJNZxzmmPV';
    const text = [
        '**Débannissement**',
        '',
        'Rejoins le **serveur support** via le lien ci-dessous, puis clique sur **« Lancer le formulaire »** dans le salon déban pour déposer ta demande.',
        '',
        url,
    ].join('\n');
    return user
        .send({ content: text })
        .then(() => true)
        .catch(() => false);
}

function resolveFallbackChannelId() {
    return (
        String(process.env.SANCTION_FALLBACK_CHANNEL_ID || '').trim() ||
        CONFIG.SANCTION_FALLBACK_CHANNEL_ID ||
        CONFIG.STAFF_WARN_CHANNEL_ID
    );
}

/**
 * Fil privé si le MP est impossible.
 */
async function sendSanctionChannelFallback({ guild, user, embed }) {
    try {
        if (!guild || !user) return { ok: false, reason: 'missing_guild_or_user' };

        const channelId = resolveFallbackChannelId();
        const channel =
            guild.channels.cache.get(channelId) ||
            (await guild.channels.fetch(channelId).catch(() => null));
        if (!channel || typeof channel.threads?.create !== 'function') {
            return { ok: false, reason: 'channel_not_found_or_no_threads' };
        }

        const baseName = String(user.username || user.tag || user.id || 'membre').slice(0, 60);
        const threadName = `Sanction - ${baseName}`.slice(0, 100);

        const thread = await channel.threads.create({
            name: threadName,
            autoArchiveDuration: 10080,
            type: ChannelType.PrivateThread,
            invitable: false,
            reason: 'Notification de sanction (MP impossible)',
        });

        await thread.members.add(user.id).catch(() => null);

        await thread
            .send({
                content: `<@${user.id}>`,
                embeds: [embed],
                allowedMentions: { users: [user.id] },
            })
            .catch(() => null);

        await thread.setLocked(true, 'Notification sanction — lecture seule pour la cible').catch(() => null);

        return {
            ok: true,
            threadId: thread.id,
            url: `https://discord.com/channels/${guild.id}/${thread.id}`,
        };
    } catch (e) {
        return { ok: false, reason: String(e?.message || e).slice(0, 200) };
    }
}

/**
 * @param {{ dmOk: boolean, linkOk?: boolean, fallback?: { ok: boolean, threadId?: string, reason?: string } }} p
 */
function formatDmStatusForModReply(p) {
    const parts = [];
    if (p.dmOk) {
        parts.push('MP envoyé à la cible.');
        if (p.linkOk === false) parts.push('Le 2e message (lien débannissement) n\'a pas pu être envoyé.');
    } else if (p.fallback?.ok) {
        parts.push(`MP impossible — fil de notification : <#${p.fallback.threadId}>.`);
    } else {
        parts.push('MP impossible (DM fermés ou bot bloqué).');
        if (p.fallback?.reason) parts.push(`Fil privé impossible (\`${p.fallback.reason}\`).`);
    }
    return parts.join(' ');
}

module.exports = {
    buildPreBanDmEmbed,
    buildPostSanctionDmEmbed,
    moderatorLabelForDm,
    trySendSanctionDm,
    sendDebanInviteDm,
    sendSanctionChannelFallback,
    formatDmStatusForModReply,
};
