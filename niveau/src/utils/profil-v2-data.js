const path = require('node:path');
const fs = require('node:fs');
const { getOrCreateUser } = require('./db-users');
const { getGuildOfUser, getGuildMembersWithDetails } = require('./db-guilds');
const { getDisplayRank, RANKS } = require('./ranks');
const { renderProfilePreviewVariant } = require('./canvas-profile-variants');
const { getOngoingWar } = require('./guild/guild-wars');
const { getPreviewInvokerStaffTitle } = require('./preview-invoker-staff-title');
const { syncUserBadges } = require('./quests');

/**
 * Charge tout le contexte nécessaire à la fiche 2 + boutons (/profil-v2).
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 * @returns {Promise<{ error: string } | { targetUser: import('discord.js').User, member: import('discord.js').GuildMember, user: object, guild: object|null, rank: object, nextRank: object|null, rankIconPath: string, totalDebt: number, debtTimeRemaining: any, vocalNerfStatus: string|null, highestRoleName: string, previewHasGuild: boolean, meta: object|undefined, renderMainPngBuffer: () => Promise<Buffer> }>}
 */
async function loadFiche2ProfileData(interaction) {
    const targetUser = interaction.options.getUser('membre') || interaction.user;
    const member = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
    if (!member) {
        return { error: 'Membre introuvable sur ce serveur.' };
    }

    syncUserBadges(targetUser.id, member);

    const user = getOrCreateUser(targetUser.id, targetUser.username);
    const guild = getGuildOfUser(targetUser.id);
    user.guild_name = guild ? guild.name : 'Aucune Guilde';
    user.guild_level = guild ? guild.level : 1;
    user.guild_emoji = guild ? guild.emoji : '🛡️';
    user.guild_treasury = guild ? guild.treasury : 0;
    user.guild_treasury_capacity = guild ? guild.treasury_capacity : 0;
    user.guild_upgrade_level = guild ? guild.upgrade_level : 1;
    user.guild_total_treasury_generated = guild ? guild.total_treasury_generated : 0;
    user.guild_wars_won = guild ? guild.wars_won : 0;

    if (guild) {
        const guildMembers = getGuildMembersWithDetails(guild.id);
        user.guild_members = guildMembers.length;
        user.guild_member_slots = guild.member_slots;
        const { calculateDailyIncome } = require('./guild/guild-treasury');
        user.guild_treasury_income = calculateDailyIncome(guild);
    } else {
        user.guild_members = 0;
        user.guild_member_slots = 5;
        user.guild_treasury_income = 0;
    }

    let guildState = 'En Paix';
    if (guild) {
        const war = getOngoingWar(guild.id);
        if (war) guildState = 'En Guerre';
    }
    user.guild_state = guildState;

    const rank = getDisplayRank(targetUser.id, user.points);
    const rankIndex = RANKS.findIndex((r) => r.name === rank.name);
    const nextRank = rankIndex < RANKS.length - 1 ? RANKS[rankIndex + 1] : null;

    const { getTotalDebt, getClosestDebtDeadline } = require('./loan-system');
    const totalDebt = getTotalDebt(targetUser.id);
    const debtTimeRemaining = getClosestDebtDeadline(targetUser.id);

    const today = new Date().setHours(0, 0, 0, 0);
    let dailyVoiceXP = user.daily_voice_xp || 0;
    let dailyVoicePoints = user.daily_voice_points || 0;
    if ((user.daily_voice_last_reset || 0) < today) {
        dailyVoiceXP = 0;
        dailyVoicePoints = 0;
    }
    let vocalNerfStatus = null;
    if (dailyVoiceXP >= 15000 || dailyVoicePoints >= 7000) {
        vocalNerfStatus = '⛔ Limite vocale journalière (0 gains).';
    } else if (dailyVoiceXP >= 10000 || dailyVoicePoints >= 5000) {
        vocalNerfStatus = '⚠️ Gains vocaux /5.';
    }

    let highestRoleName = 'Membre';
    if (member.roles.highest && member.roles.highest.name !== '@everyone') {
        highestRoleName = member.roles.highest.name;
    }

    let rankIconPath = path.resolve(__dirname, '..', 'assets', 'rank-icons', `${rankIndex + 1}.png`);
    if (!fs.existsSync(rankIconPath)) {
        rankIconPath = path.resolve(__dirname, '..', 'assets', 'rank-icons', '1.png');
    }

    const { PROFILE_PREVIEW_VARIANTS } = require('./canvas-profile-variants');
    const meta = PROFILE_PREVIEW_VARIANTS.find((v) => v.id === 'fiche_2');

    const previewHasGuild = Boolean(guild);

    const renderMainPngBuffer = async () => {
        const u = getOrCreateUser(targetUser.id, targetUser.username);
        u.guild_name = user.guild_name;
        u.guild_level = user.guild_level;
        u.guild_emoji = user.guild_emoji;
        u.guild_treasury = user.guild_treasury;
        u.guild_treasury_capacity = user.guild_treasury_capacity;
        u.guild_upgrade_level = user.guild_upgrade_level;
        u.guild_total_treasury_generated = user.guild_total_treasury_generated;
        u.guild_wars_won = user.guild_wars_won;
        u.guild_members = user.guild_members;
        u.guild_member_slots = user.guild_member_slots;
        u.guild_treasury_income = user.guild_treasury_income;
        u.guild_state = user.guild_state;

        const invokerStaffTitle = await getPreviewInvokerStaffTitle(interaction.client, interaction.user.id);
        const r = getDisplayRank(targetUser.id, u.points);

        return renderProfilePreviewVariant(
            {
                user: u,
                member,
                rank: r,
                nextRank,
                highestRoleName,
                rankIconPath,
                totalDebt: getTotalDebt(targetUser.id),
                debtTimeRemaining: getClosestDebtDeadline(targetUser.id),
                vocalNerfStatus,
                userId: targetUser.id,
                invokerStaffTitle,
                invokerMember: interaction.member,
                invokerUser: interaction.user,
                previewHasGuild,
            },
            'fiche_2'
        );
    };

    return {
        targetUser,
        member,
        user,
        guild,
        rank,
        nextRank,
        rankIconPath,
        totalDebt,
        debtTimeRemaining,
        vocalNerfStatus,
        highestRoleName,
        previewHasGuild,
        meta,
        renderMainPngBuffer,
    };
}

module.exports = { loadFiche2ProfileData };
