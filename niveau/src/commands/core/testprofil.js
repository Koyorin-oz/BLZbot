const path = require('node:path');
const fs = require('node:fs');
const { SlashCommandBuilder, AttachmentBuilder, MessageFlags } = require('discord.js');
const { getOrCreateUser } = require('../../utils/db-users');
const { getGuildOfUser, getGuildMembersWithDetails } = require('../../utils/db-guilds');
const { getDisplayRank, RANKS } = require('../../utils/ranks');
const {
    PROFILE_PREVIEW_VARIANTS,
    renderProfilePreviewVariant,
    normalizeProfileVariant,
} = require('../../utils/canvas-profile-variants');
const { handleCommandError } = require('../../utils/error-handler');
const { getOngoingWar } = require('../../utils/guild/guild-wars');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('testprofil')
        .setDescription('Aperçu fiches BLZ : Fiche 1 (2×3) ou Fiche 2 (fond identique à /profile, 1024×381).')
        .addStringOption((opt) =>
            opt
                .setName('style')
                .setDescription('Fiche 1 (2×3) ou Fiche 2 bois / chocolat (1024×381)')
                .setRequired(true)
                .addChoices(
                    { name: 'Fiche 1 — colonne + grille 2×3 (sauvegardée)', value: 'fiche_1' },
                    { name: 'Fiche 2 — bois / chocolat (1024×381)', value: 'fiche_2' }
                )
        )
        .addUserOption((opt) =>
            opt.setName('membre').setDescription('Membre à prévisualiser (défaut : vous)').setRequired(false)
        ),

    async execute(interaction) {
        try {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });

            const variant = normalizeProfileVariant(interaction.options.getString('style', true));
            const targetUser = interaction.options.getUser('membre') || interaction.user;
            const member = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
            if (!member) {
                return interaction.editReply({ content: 'Membre introuvable sur ce serveur.' });
            }

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
                const { calculateDailyIncome } = require('../../utils/guild/guild-treasury');
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

            const { getTotalDebt, getClosestDebtDeadline } = require('../../utils/loan-system');
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

            let rankIconPath = path.resolve(__dirname, '..', '..', 'assets', 'rank-icons', `${rankIndex + 1}.png`);
            if (!fs.existsSync(rankIconPath)) {
                rankIconPath = path.resolve(__dirname, '..', '..', 'assets', 'rank-icons', '1.png');
            }

            const meta = PROFILE_PREVIEW_VARIANTS.find((v) => v.id === variant);
            const png = await renderProfilePreviewVariant(
                {
                    user,
                    member,
                    rank,
                    nextRank,
                    highestRoleName,
                    rankIconPath,
                    totalDebt,
                    debtTimeRemaining,
                    vocalNerfStatus,
                    userId: targetUser.id,
                },
                variant
            );

            const file = new AttachmentBuilder(png, { name: `testprofil-${variant}.png` });
            const hint = meta ? `**${meta.label}** — _${meta.hint}_` : variant;

            return interaction.editReply({
                content:
                    `🧪 ${hint}\n` +
                    `La commande \`/profile\` officielle est inchangée.`,
                files: [file],
            });
        } catch (error) {
            await handleCommandError(interaction, error, interaction.client);
        }
    },
};
