const {
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
} = require('discord.js');

function btnId(guildId, action) {
    return `blzm:${action}:${guildId}`;
}

/** @param {string} guildId @param {object} session */
function buildMusicPanelPayload(guildId, session) {
    const qPreview = session.queue.slice(0, 4).map((t, i) => `${i + 1}. ${truncate(t.title, 60)}`);
    const more = session.queue.length > 4 ? `\n*+${session.queue.length - 4} dans la file*` : '';

    let body = '';
    if (session.current) {
        body = `**En cours**\n${truncate(session.current.title, 90)}`;
        if (session.isPaused()) {
            body += '\n\n*⏸ En pause*';
        }
    } else {
        body = '*Aucune lecture — bouton **Ajouter** ou `/musique play`.*';
    }

    if (qPreview.length) {
        body += `\n\n**File**\n${qPreview.join('\n')}${more}`;
    }

    const embed = new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle('Lecteur — YouTube')
        .setDescription(body)
        .setFooter({
            text: 'Transport : Précédent · Pause · Suivant · File · Stop · Ajouter · Vider file',
        });

    const secondary = ButtonStyle.Secondary;
    const danger = ButtonStyle.Danger;
    const paused = session.isPaused();

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(btnId(guildId, 'prev'))
            .setStyle(secondary)
            .setLabel('Précédent')
            .setEmoji('⏮️'),
        new ButtonBuilder()
            .setCustomId(btnId(guildId, paused ? 'resume' : 'pause'))
            .setStyle(ButtonStyle.Primary)
            .setLabel(paused ? 'Reprendre' : 'Pause')
            .setEmoji(paused ? '▶️' : '⏸️'),
        new ButtonBuilder()
            .setCustomId(btnId(guildId, 'skip'))
            .setStyle(secondary)
            .setLabel('Suivant')
            .setEmoji('⏭️'),
        new ButtonBuilder()
            .setCustomId(btnId(guildId, 'queue'))
            .setStyle(secondary)
            .setLabel('File')
            .setEmoji('📋'),
        new ButtonBuilder()
            .setCustomId(btnId(guildId, 'stop'))
            .setStyle(danger)
            .setLabel('Stop')
            .setEmoji('⏹️')
    );

    const row2 = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(btnId(guildId, 'playprompt'))
            .setStyle(ButtonStyle.Success)
            .setLabel('Ajouter')
            .setEmoji('➕'),
        new ButtonBuilder()
            .setCustomId(btnId(guildId, 'clear'))
            .setStyle(secondary)
            .setLabel('Vider file')
            .setEmoji('🧹')
    );

    return { embeds: [embed], components: [row, row2] };
}

function truncate(s, n) {
    const t = String(s || '');
    if (t.length <= n) return t;
    return `${t.slice(0, n - 1)}…`;
}

/**
 * @param {string} customId
 * @returns {{ action: string, guildId: string } | null}
 */
function parseMusicButtonId(customId) {
    if (!customId.startsWith('blzm:')) return null;
    const parts = customId.split(':');
    if (parts.length !== 3) return null;
    const [, action, guildId] = parts;
    if (!/^\d{17,22}$/.test(guildId)) return null;
    const allowed = new Set(['prev', 'pause', 'resume', 'skip', 'queue', 'stop', 'playprompt', 'clear']);
    if (!allowed.has(action)) return null;
    return { action, guildId };
}

/**
 * @param {string} customId
 */
function parseMusicSelectId(customId) {
    if (!customId.startsWith('blzmpick:')) return null;
    const parts = customId.split(':');
    if (parts.length !== 4) return null;
    const [, guildId, userId] = parts;
    if (!/^\d{17,22}$/.test(guildId) || !/^\d{17,22}$/.test(userId)) return null;
    return { guildId, userId };
}

module.exports = {
    buildMusicPanelPayload,
    parseMusicButtonId,
    parseMusicSelectId,
    btnId,
};
