/**
 * Commande /valeur - Système de Valeur (MAJ Mars 2026)
 * 
 * Sous-commandes :
 * - /valeur profil [utilisateur] : Voir le détail de sa valeur
 */

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getOrCreateUser } = require('../../utils/db-users');
const { getUserValueBreakdown, recalculateUserValue, TROPHY_VALUES } = require('../../utils/trophy-value-system');
const { handleCommandError } = require('../../utils/error-handler');

function formatValue(value) {
    if (value >= 1000000) {
        return `${(value / 1000000).toFixed(1)}M`;
    } else if (value >= 1000) {
        return `${(value / 1000).toFixed(1)}K`;
    }
    return value.toLocaleString('fr-FR');
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('valeur')
        .setDescription('Voir sa valeur.')
        .addSubcommand(sub =>
            sub.setName('profil')
                .setDescription('Voir le détail de votre valeur ou celle d\'un autre joueur.')
                .addUserOption(opt =>
                    opt.setName('utilisateur')
                        .setDescription('L\'utilisateur à consulter')
                        .setRequired(false))),

    async execute(interaction) {
        try {
            await handleProfil(interaction);
        } catch (error) {
            await handleCommandError(interaction, error);
        }
    }
};

async function handleProfil(interaction) {
    await interaction.deferReply();

    const targetUser = interaction.options.getUser('utilisateur') || interaction.user;
    const userData = getOrCreateUser(targetUser.id, targetUser.username);

    // Recalculer la valeur (frais)
    recalculateUserValue(targetUser.id);

    const breakdown = getUserValueBreakdown(targetUser.id);
    if (!breakdown) {
        return interaction.editReply({ content: '❌ Utilisateur non trouvé.' });
    }

    const embed = new EmbedBuilder()
        .setTitle(`💎 Valeur de ${targetUser.username}`)
        .setColor('#9b59b6')
        .setThumbnail(targetUser.displayAvatarURL({ size: 128 }))
        .setDescription(`**Valeur totale : ${formatValue(breakdown.total)}**\n**Classement : #${breakdown.rank}**`)
        .addFields(
            {
                name: '⚔️ Ranked (RP)',
                value: `${formatValue(breakdown.ranked)} valeur`,
                inline: true,
            },
            {
                name: '📈 Niveaux (XP)',
                value: `${formatValue(breakdown.xp)} valeur`,
                inline: true,
            },
            {
                name: '🔢 Points Comptage',
                value: `${formatValue(breakdown.pc)} valeur`,
                inline: true,
            },
            {
                name: '🏆 Trophées',
                value: `${formatValue(breakdown.trophies)} valeur`,
                inline: true,
            },
        );

    // Détail des trophées par rareté
    const trophyDetails = Object.entries(breakdown.trophyCounts)
        .filter(([_, count]) => count > 0)
        .map(([rarity, count]) => {
            const emoji = getRarityEmoji(rarity);
            return `${emoji} ${rarity}: **${count}** (${formatValue(TROPHY_VALUES[rarity] * count)})`;
        })
        .join('\n');

    if (trophyDetails) {
        embed.addFields({
            name: '🏅 Détail des trophées',
            value: trophyDetails,
            inline: false,
        });
    }

    // Répartition visuelle
    const parts = [
        { name: 'Ranked', value: breakdown.ranked },
        { name: 'XP', value: breakdown.xp },
        { name: 'PC', value: breakdown.pc },
        { name: 'Trophées', value: breakdown.trophies },
    ];

    const total = breakdown.total || 1;
    const barParts = parts.map(p => {
        const pct = Math.round((p.value / total) * 100);
        return pct > 0 ? `${p.name}: ${pct}%` : null;
    }).filter(Boolean);

    embed.setFooter({ text: barParts.join(' | ') });

    await interaction.editReply({ embeds: [embed] });
}

function getRarityEmoji(rarity) {
    const emojis = {
        'Commune': '⚪',
        'Rare': '🔵',
        'Épique': '🟣',
        'Légendaire': '🟡',
        'Mythique': '🔴',
        'Goatesque': '🌟',
        'Halloween': '🎃',
    };
    return emojis[rarity] || '❓';
}
