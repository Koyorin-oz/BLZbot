const { PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const { ROAD, COLOR, GENERAL_CHANNEL_ID } = require('./config');
const store = require('./store');
const { grantEventCurrency, getOrCreateEventUser } = require('../utils/db-halloween');

const HOUR = 60 * 60 * 1000;

/** +1h de boost, ajouté à la fin d'un boost déjà en cours. */
function addBoostHour(userId, column) {
    const mainDb = require('../database/database');
    const now = Date.now();
    mainDb.prepare(`UPDATE users SET ${column} = MAX(COALESCE(${column}, 0), ?) + ? WHERE id = ?`).run(now, HOUR, userId);
}

function pay(userId, quest) {
    if (quest.id === 'd23') grantEventCurrency(userId, { bonbons: 500 });
    else if (quest.id === 'd24') grantEventCurrency(userId, { citrouilles: 200 });
    else if (quest.id === 'd25' || quest.id === 'd29') addBoostHour(userId, 'xp_boost_until');
    else if (quest.id === 'd26') addBoostHour(userId, 'stars_boost_until');
    else if (quest.id === 'd27') grantEventCurrency(userId, { bonbons: 1000 });
    else if (quest.id === 'd28') grantEventCurrency(userId, { citrouilles: 400 });
    else if (quest.id === 'd30') store.addItem(userId, 'colliers', 3);
    else if (quest.id === 'd31') store.addItem(userId, 'fantomes', 1);
}

async function ensureRole(guild, name, color) {
    let role = guild.roles.cache.find((r) => r.name === name);
    if (!role) {
        role = await guild.roles.create({
            name,
            colors: { primaryColor: color },
            reason: 'Halloween 2026',
            permissions: [],
        });
    }
    return role;
}

async function memberHasShopRole(member) {
    if (!member) return false;
    return member.roles.cache.some((r) => r.name === 'Roi des citrouilles' || r.name === 'Roi des bonbons');
}

/** Quêtes déjà fermées au lancement sur le principal : validées et payées une fois par joueur. */
function ensureMissed(userId) {
    const { questOpen, parisParts, MAIN_GUILD_ID } = require('./config');
    const launchedAt = Number(store.meta(`launched_at:${MAIN_GUILD_ID}`) || 0);
    if (!launchedAt) return;
    const launch = new Date(launchedAt);
    const launchDate = parisParts(launch).date;
    for (const quest of ROAD) {
        if (quest.date >= launchDate || questOpen(quest, launch)) continue;
        const row = store.roadRow(userId, quest.id);
        if (row.done) continue;
        store.db.prepare('UPDATE hw_road SET progress = ?, done = 1 WHERE user_id = ? AND quest_id = ?').run(quest.goal, userId, quest.id);
        pay(userId, quest);
    }
}

async function progress(client, guild, userId, type, amount = 1) {
    ensureMissed(userId);
    const { activeQuests } = require('./config');
    const quests = activeQuests().filter((q) => q.type === type);
    const done = [];
    for (const quest of quests) {
        const { justDone } = store.addProgress(userId, quest.id, amount, quest.goal);
        if (!justDone) continue;
        pay(userId, quest);
        done.push(quest);
    }
    if (!done.length || !guild) return done;

    const count = store.completedCount(userId);
    const embed = new EmbedBuilder()
        .setColor(COLOR.orange)
        .setTitle('🎃 Quête Halloween validée !')
        .setDescription(done.map((q) => `✅ **${q.label}** (${q.date.slice(8)}/10)\n🎁 Récompense : **${q.reward}**`).join('\n\n'))
        .addFields({ name: '🛣️ Road', value: `**${count}/${ROAD.length}** quêtes faites`, inline: true })
        .setFooter({ text: 'Halloween 2026 · /halloween-road pour voir ta progression' });
    if (count >= ROAD.length && !getOrCreateEventUser(userId).streak_done) {
        embed.setColor(COLOR.purple).addFields({
            name: '👻 Road parfaite !',
            value: 'Fais `/halloween-road` pour choisir **x2 EXP jusqu\'au reset** ou le rôle **Fantôme d\'Halloween**.',
        });
    }
    const ch = await generalChannel(guild);
    if (ch) ch.send({ content: `<@${userId}>`, embeds: [embed] }).catch(() => {});
    return done;
}

async function generalId(guild) {
    for (const id of [process.env.HALLOWEEN_GENERAL_CHANNEL_ID, GENERAL_CHANNEL_ID]) {
        if (id && guild.channels.cache.has(id)) return id;
    }
    const found = guild.channels.cache.find(
        (c) => c.isTextBased?.() && /général|general/i.test(c.name),
    );
    return found?.id || null;
}

async function generalChannel(guild) {
    const id = await generalId(guild);
    if (!id) return null;
    const ch = guild.channels.cache.get(id) || (await guild.channels.fetch(id).catch(() => null));
    return ch?.isTextBased?.() ? ch : null;
}

async function giveShopRole(member, item) {
    const color = item.id === 'role_citrouilles' ? '#E67E22' : '#F1C40F';
    const role = await ensureRole(member.guild, item.name, color);
    await member.roles.add(role);
    return role;
}

async function giveStreakRole(member) {
    const role = await ensureRole(member.guild, "Fantôme d'Halloween", '#9B59B6');
    await member.roles.add(role);
    store.setFlag(member.id, 'streak_done', 1);
    store.setFlag(member.id, 'perm_xp', 0);
}

function canManage(guild) {
    const me = guild.members.me;
    return me?.permissions?.has(PermissionFlagsBits.ManageRoles);
}

module.exports = {
    pay,
    addBoostHour,
    ensureMissed,
    ensureRole,
    memberHasShopRole,
    progress,
    generalId,
    generalChannel,
    giveShopRole,
    giveStreakRole,
    canManage,
};
