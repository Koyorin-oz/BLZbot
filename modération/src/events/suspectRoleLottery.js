/**
 * Tirage aléatoire du rôle « suspect » : environ 1 nouveau sur N arrivants.
 */
const fs = require('fs');
const path = require('path');
const CONFIG = require('../config.js');

const DATA_PATH = path.join(__dirname, '..', 'data', 'suspect-lottery.json');

function loadState() {
    try {
        if (fs.existsSync(DATA_PATH)) {
            return JSON.parse(fs.readFileSync(DATA_PATH, 'utf-8'));
        }
    } catch (err) {
        console.error('[SuspectLottery] Lecture état:', err?.message || err);
    }
    return {};
}

function saveState(state) {
    try {
        fs.mkdirSync(path.dirname(DATA_PATH), { recursive: true });
        fs.writeFileSync(DATA_PATH, JSON.stringify(state, null, 2), 'utf-8');
    } catch (err) {
        console.error('[SuspectLottery] Sauvegarde état:', err?.message || err);
    }
}

function getGuildBucket(state, guildId) {
    if (!state[guildId]) {
        state[guildId] = { pending: [] };
    }
    return state[guildId];
}

function isStaffMember(member) {
    const staffIds = (CONFIG.STAFF_ROLES || []).map((r) => r.id).filter(Boolean);
    return staffIds.some((id) => member.roles.cache.has(id));
}

/**
 * @param {import('discord.js').Guild} guild
 * @param {{ id: string }[]} pending
 * @param {string} suspectRoleId
 * @param {string|null} verifiedRoleId
 */
async function pickEligibleMember(guild, pending, suspectRoleId, verifiedRoleId) {
    const shuffled = [...pending].sort(() => Math.random() - 0.5);

    for (const entry of shuffled) {
        let member = guild.members.cache.get(entry.id);
        if (!member) {
            member = await guild.members.fetch(entry.id).catch(() => null);
        }
        if (!member || member.user.bot) continue;
        if (member.roles.cache.has(suspectRoleId)) continue;
        if (verifiedRoleId && member.roles.cache.has(verifiedRoleId)) continue;
        if (isStaffMember(member)) continue;
        return member;
    }

    return null;
}

/**
 * @param {import('discord.js').GuildMember} member
 */
async function handleMemberJoin(member) {
    const cfg = CONFIG.SUSPECT_ROLE_LOTTERY;
    if (!cfg?.ENABLED) return;
    if (member.user.bot) return;

    const guildId = String(cfg.GUILD_ID || CONFIG.MAIN_GUILD_ID || member.guild.id);
    if (member.guild.id !== guildId) return;

    const suspectRoleId = String(cfg.ROLE_ID || CONFIG.SUSPECT_ROLE_ID || '').trim();
    if (!/^\d{17,22}$/.test(suspectRoleId)) {
        console.error('[SuspectLottery] ROLE_ID invalide:', suspectRoleId);
        return;
    }

    const threshold = Math.max(2, Number(cfg.EVERY_N_JOINS) || 17);
    const verifiedRoleId = String(cfg.SKIP_IF_HAS_ROLE_ID || CONFIG.REGLEMENT_ACCEPTED_ROLE_ID || '').trim() || null;

    const state = loadState();
    const bucket = getGuildBucket(state, member.guild.id);
    bucket.pending.push({ id: member.id, at: Date.now() });

    if (bucket.pending.length < threshold) {
        saveState(state);
        return;
    }

    const pool = bucket.pending.splice(0, threshold);
    saveState(state);

    const winner = await pickEligibleMember(
        member.guild,
        pool,
        suspectRoleId,
        verifiedRoleId && /^\d{17,22}$/.test(verifiedRoleId) ? verifiedRoleId : null
    );

    if (!winner) {
        console.warn(
            `[SuspectLottery] Tirage sur ${threshold} arrivants — aucun membre éligible dans le pool (${pool.length} entrées).`
        );
        return;
    }

    const role = member.guild.roles.cache.get(suspectRoleId);
    if (!role) {
        console.error('[SuspectLottery] Rôle introuvable:', suspectRoleId);
        return;
    }

    try {
        await winner.roles.add(role, `Tirage aléatoire — 1 membre sur ${threshold} nouveaux arrivants`);
        console.log(
            `[SuspectLottery] Rôle ${role.name} → ${winner.user.tag} (tirage 1/${threshold} nouveaux arrivants)`
        );
    } catch (err) {
        console.error(
            `[SuspectLottery] Attribution impossible pour ${winner.user.tag}: ${err?.code || ''} ${err?.message || err} — place le rôle du bot au-dessus du rôle suspect.`
        );
    }
}

module.exports = { handleMemberJoin };
