const { isLive } = require('./live');
const store = require('./store');
const { grantEventCurrency } = require('../utils/db-halloween');
const { progress, memberHasShopRole, generalId } = require('./rewards');
const { parisParts, PRC_ROLE_ID } = require('./config');
const { handleChatEvent } = require('./events');

const PRC_GAP = 60 * 60 * 1000;
const PRC_COOLDOWN = 24 * 60 * 60 * 1000;

async function onMessage(message) {
    if (!message.guild || message.author.bot) return;
    if (!isLive(message.guild.id)) return;

    const gid = message.guild.id;
    const general = await generalId(message.guild);
    if (general && message.channel.id === general) {
        store.meta(`prc:lastmsg:${gid}`, Date.now());
        await handleChatEvent(message);
    }

    if (store.isCursed(message.author.id)) {
        /* les gains messages restent, la malus est sur XP / starss / RP */
    }

    const citrouille = store.bumpMsg(message.author.id);
    grantEventCurrency(message.author.id, { bonbons: 1, citrouilles: citrouille });
    await progress(message.client, message.guild, message.author.id, 'messages', 1);

    if (await memberHasShopRole(message.member)) {
        await progress(message.client, message.guild, message.author.id, 'roles', 1);
    }
}

async function onVoiceMinute(client, guild, userId) {
    if (!guild || !isLive(guild.id)) return;
    grantEventCurrency(userId, { bonbons: 3, citrouilles: 1 });
    await progress(client, guild, userId, 'voice', 1);
}

async function onLevel(client, guild, userId) {
    if (!guild || !isLive(guild.id)) return;
    await progress(client, guild, userId, 'level', 1);
}

async function tickPrc(client) {
    const { TEST_GUILD_ID, MAIN_GUILD_ID } = require('./config');
    const ids = [TEST_GUILD_ID, MAIN_GUILD_ID];
    for (const id of ids) {
        if (!isLive(id)) continue;
        const guild = client.guilds.cache.get(id) || (await client.guilds.fetch(id).catch(() => null));
        if (!guild) continue;
        const channelId = await generalId(guild);
        if (!channelId) continue;
        const lastMsg = Number(store.meta(`prc:lastmsg:${id}`) || 0);
        const lastPing = Number(store.meta(`prc:lastping:${id}`) || 0);
        const now = Date.now();
        if (!lastMsg || now - lastMsg < PRC_GAP) continue;
        if (now - lastPing < PRC_COOLDOWN) continue;
        const ch = await guild.channels.fetch(channelId).catch(() => null);
        if (!ch?.isTextBased?.()) continue;
        await ch.send(`<@&${PRC_ROLE_ID}> le général est mort depuis 1h, venez parler.`).catch(() => {});
        store.meta(`prc:lastping:${id}`, now);
    }
}

async function manualPrc(interaction) {
    const guild = interaction.guild;
    const channelId = await generalId(guild);
    const ch = channelId ? await guild.channels.fetch(channelId).catch(() => null) : null;
    if (!ch?.isTextBased?.()) {
        return interaction.reply({ content: 'Salon général introuvable (nom avec « général », ou HALLOWEEN_GENERAL_CHANNEL_ID).', ephemeral: true });
    }
    await ch.send(`<@&${PRC_ROLE_ID}> ping revive (manuel) par ${interaction.user}.`);
    store.meta(`prc:lastping:${guild.id}`, Date.now());
    const p = parisParts();
    return interaction.reply({ content: `PRC envoyé dans <#${ch.id}> (${p.date} ${p.hour}h).`, ephemeral: true });
}

function start(client) {
    const { startEvents } = require('./events');
    const { registerBetaCommands } = require('./register');
    startEvents(client);
    setInterval(() => tickPrc(client).catch(() => {}), 60 * 1000);
    setTimeout(() => registerBetaCommands(client, false).catch(() => {}), 4000);
}

module.exports = { onMessage, onVoiceMinute, onLevel, manualPrc, start, tickPrc };
