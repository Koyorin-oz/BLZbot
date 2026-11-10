const { isLive } = require('./live');
const store = require('./store');
const { grantEventCurrency } = require('../utils/db-halloween');
const { EmbedBuilder } = require('discord.js');
const { progress, memberHasShopRole, generalId, generalChannel } = require('./rewards');
const { parisParts, PRC_ROLE_ID, COLOR, eventRunning } = require('./config');
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
    if (!eventRunning()) return;

    const citrouille = store.bumpMsg(message.author.id);
    grantEventCurrency(message.author.id, { bonbons: 1, citrouilles: citrouille });
    await progress(message.client, message.guild, message.author.id, 'messages', 1);

    if (await memberHasShopRole(message.member)) {
        await progress(message.client, message.guild, message.author.id, 'roles', 1);
    }
}

async function onVoiceMinute(client, guild, userId) {
    if (!guild || !isLive(guild.id) || !eventRunning()) return;
    grantEventCurrency(userId, { bonbons: 3, citrouilles: 1 });
    await progress(client, guild, userId, 'voice', 1);
}

async function onLevel(client, guild, userId) {
    if (!guild || !isLive(guild.id)) return;
    await progress(client, guild, userId, 'level', 1);
}

async function tickPrc(client) {
    if (!eventRunning()) return;

    const { TEST_GUILD_ID, MAIN_GUILD_ID } = require('./config');
    const ids = [TEST_GUILD_ID, MAIN_GUILD_ID];
    for (const id of ids) {
        if (!isLive(id)) continue;
        const guild = client.guilds.cache.get(id) || (await client.guilds.fetch(id).catch(() => null));
        if (!guild) continue;
        const lastMsg = Number(store.meta(`prc:lastmsg:${id}`) || 0);
        const lastPing = Number(store.meta(`prc:lastping:${id}`) || 0);
        const now = Date.now();
        if (!lastMsg || now - lastMsg < PRC_GAP) continue;
        if (now - lastPing < PRC_COOLDOWN) continue;
        const ch = await generalChannel(guild);
        if (!ch) continue;
        await ch.send(prcPayload('Le salon est silencieux depuis **plus d\'une heure**… même les fantômes s\'ennuient 👻')).catch(() => {});
        store.meta(`prc:lastping:${id}`, now);
    }
}

function prcPayload(text) {
    const embed = new EmbedBuilder()
        .setColor(COLOR.purple)
        .setTitle('🕯️ Ping Revive Chat')
        .setDescription(`${text}\n\nVenez faire revivre le chat ! 💬\n🍬 Chaque message vous rapporte des **bonbons**, et 🎃 des **citrouilles** tous les 3 messages.`)
        .setFooter({ text: 'Halloween 2026' });
    return { content: `<@&${PRC_ROLE_ID}>`, embeds: [embed], allowedMentions: { roles: [PRC_ROLE_ID] } };
}

async function manualPrc(interaction) {
    if (!eventRunning()) {
        return interaction.reply({ content: 'L’événement Halloween n’est pas actif.', ephemeral: true });
    }

    const ch = await generalChannel(interaction.guild);
    if (!ch) {
        return interaction.reply({ content: 'Salon général introuvable.', ephemeral: true });
    }
    await ch.send(prcPayload(`${interaction.user} lance un appel : le chat a besoin de vous !`));
    store.meta(`prc:lastping:${interaction.guild.id}`, Date.now());
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
