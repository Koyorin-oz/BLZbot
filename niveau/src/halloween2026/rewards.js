const { PermissionFlagsBits } = require('discord.js');
const { ROAD } = require('./config');
const store = require('./store');
const { grantEventCurrency, getOrCreateEventUser } = require('../utils/db-halloween');

const HOUR = 60 * 60 * 1000;

function pay(userId, quest) {
    const mainDb = require('../database/database');
    const until = Date.now() + HOUR;
    if (quest.id === 'd23') grantEventCurrency(userId, { bonbons: 500 });
    else if (quest.id === 'd24') grantEventCurrency(userId, { citrouilles: 200 });
    else if (quest.id === 'd25' || quest.id === 'd29') {
        mainDb.prepare('UPDATE users SET xp_boost_until = ? WHERE id = ?').run(until, userId);
    } else if (quest.id === 'd26') {
        mainDb.prepare('UPDATE users SET stars_boost_until = ? WHERE id = ?').run(until, userId);
    } else if (quest.id === 'd27') grantEventCurrency(userId, { bonbons: 1000 });
    else if (quest.id === 'd28') grantEventCurrency(userId, { citrouilles: 400 });
    else if (quest.id === 'd30') store.addItem(userId, 'colliers', 3);
    else if (quest.id === 'd31') store.addItem(userId, 'fantomes', 1);
}

async function ensureRole(guild, name, color) {
    let role = guild.roles.cache.find((r) => r.name === name);
    if (!role) {
        role = await guild.roles.create({
            name,
            color,
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

async function progress(client, guild, userId, type, amount = 1) {
    const { activeQuests } = require('./config');
    const quests = activeQuests().filter((q) => q.type === type);
    const lines = [];
    for (const quest of quests) {
        const { justDone } = store.addProgress(userId, quest.id, amount, quest.goal);
        if (!justDone) continue;
        pay(userId, quest);
        lines.push(`Quête ${quest.date.slice(8)}/10 faite — ${quest.reward}`);
        if (store.completedCount(userId) >= ROAD.length) {
            const u = getOrCreateEventUser(userId);
            if (!u.streak_done) {
                lines.push('9/9 sans rater. Fais `/halloween-road` pour choisir x2 EXP ou le rôle Fantôme d\'Halloween.');
            }
        }
    }
    if (lines.length && guild) {
        const ch = guild.channels.cache.get(await generalId(guild)) || guild.systemChannel;
        if (ch?.isTextBased?.()) {
            ch.send(`<@${userId}> ${lines.join('\n')}`).catch(() => {});
        }
    }
    return lines;
}

async function generalId(guild) {
    const env = process.env.HALLOWEEN_GENERAL_CHANNEL_ID;
    if (env && guild.channels.cache.has(env)) return env;
    const found = guild.channels.cache.find(
        (c) => c.isTextBased?.() && /général|general/i.test(c.name),
    );
    return found?.id || null;
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
    ensureRole,
    memberHasShopRole,
    progress,
    generalId,
    giveShopRole,
    giveStreakRole,
    canManage,
};
