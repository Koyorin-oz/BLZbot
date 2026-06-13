/**
 * Commande /puits - Système de Puits de Combat (MAJ Mars 2026)
 * 
 * Sous-commandes :
 * - /puits afficher : Voir sa progression et ses tirages disponibles
 * - /puits tirer [nombre] : Effectuer un ou plusieurs tirages
 * - /puits historique : Voir l'historique de ses tirages
 */

const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType } = require('discord.js');
const { getOrCreateUser } = require('../../utils/db-users');
const { getPuitsStatus, performTirages, applyTirageRewards, getPuitsDisplayData, getTirageCost, TIRAGE_COSTS, TIRAGE_COSTS_VIP, MAX_TIRAGES_FREE, MAX_TIRAGES_VIP, PT_PER_MESSAGE, PT_PER_VOICE_MINUTE } = require('../../utils/puits-system');
const { handleCommandError } = require('../../utils/error-handler');

// Emojis pour les barres de progression
function createProgressBar(current, max, length = 20) {
    const filled = Math.min(length, Math.floor((current / max) * length));
    const empty = length - filled;
    return '█'.repeat(filled) + '░'.repeat(empty);
}

function formatTierCosts(isVip) {
    const costs = isVip ? TIRAGE_COSTS_VIP : TIRAGE_COSTS;
    return costs.map(tier => {
        return `Tirage ${tier.from}-${tier.to} : **${tier.cost} PT**`;
    }).join('\n');
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('puits')
        .setDescription('Puits de combat : tirages et récompenses.')
        .addSubcommand(sub =>
            sub.setName('afficher')
                .setDescription('Voir votre progression dans le puits de combat.'))
        .addSubcommand(sub =>
            sub.setName('tirer')
                .setDescription('Effectuer un ou plusieurs tirages dans le puits.')
                .addIntegerOption(opt =>
                    opt.setName('nombre')
                        .setDescription('Nombre de tirages à effectuer (1 par défaut)')
                        .setMinValue(1)
                        .setMaxValue(70)
                        .setRequired(false)))
        .addSubcommand(sub =>
            sub.setName('historique')
                .setDescription('Voir l\'historique de vos tirages ce mois-ci.')),

    async execute(interaction) {
        try {
            const userId = interaction.user.id;
            getOrCreateUser(userId, interaction.user.username);

            const subcommand = interaction.options.getSubcommand();

            if (subcommand === 'afficher') {
                await handleAfficher(interaction, userId);
            } else if (subcommand === 'tirer') {
                await handleTirer(interaction, userId);
            } else if (subcommand === 'historique') {
                await handleHistorique(interaction, userId);
            }
        } catch (error) {
            await handleCommandError(interaction, error);
        }
    }
};

async function handleAfficher(interaction, userId) {
    await interaction.deferReply();

    const data = getPuitsDisplayData(userId);
    const maxTirages = data.isVip ? MAX_TIRAGES_VIP : MAX_TIRAGES_FREE;

    const embed = new EmbedBuilder()
        .setTitle('🏆 Puits de Combat')
        .setColor(data.puitsComplete ? '#FFD700' : '#3498db')
        .setDescription(data.puitsComplete
            ? '✨ **Votre puits est vidé !** Attendez le reset mensuel pour un nouveau puits.'
            : `Accumulez des PT et tirez des récompenses aléatoires !\n\n*+${PT_PER_MESSAGE} PT par message | +${PT_PER_VOICE_MINUTE} PT par minute de vocal*`)
        .addFields(
            {
                name: '📊 Progression',
                value: [
                    `**Tirages effectués :** ${data.totalTirages} / ${maxTirages}`,
                    `**Tier actuel :** ${data.currentTier}`,
                    `\n${createProgressBar(data.totalTirages, maxTirages)} ${Math.floor((data.totalTirages / maxTirages) * 100)}%`,
                ].join('\n'),
                inline: false,
            },
            {
                name: '💎 Points de Tirage (PT)',
                value: [
                    `**PT actuels :** ${data.tiragePoints.toLocaleString('fr-FR')} PT`,
                    data.cost ? `**Prochain tirage :** ${data.cost.toLocaleString('fr-FR')} PT` : '**Puits vidé !**',
                    data.cost ? `\n${createProgressBar(data.tiragePoints, data.cost, 15)} ${data.progressPercent}%` : '',
                ].join('\n'),
                inline: true,
            },
            {
                name: '🎰 Tirages disponibles',
                value: data.available > 0
                    ? `**${data.available}** tirage(s) prêt(s) !\nUtilisez \`/puits tirer\``
                    : data.puitsComplete
                        ? '🏆 Puits vidé !'
                        : '❌ Pas assez de PT',
                inline: true,
            },
        );

    if (data.isVip) {
        embed.setFooter({ text: '⭐ VIP - 20 tirages bonus + réductions sur les coûts PT' });
    }

    // Coûts par tier
    embed.addFields({
        name: '📋 Coûts par tier',
        value: formatTierCosts(data.isVip),
        inline: false,
    });

    // Bouton pour tirer si disponible
    const components = [];
    if (data.available > 0) {
        const buttons = [
            new ButtonBuilder()
                .setCustomId('puits_tirer_1')
                .setLabel('🎰 Tirer x1')
                .setStyle(ButtonStyle.Primary),
        ];

        // Bouton x5 seulement si available > 5 (sinon TOUT suffit)
        if (data.available > 5) {
            buttons.push(
                new ButtonBuilder()
                    .setCustomId('puits_tirer_5')
                    .setLabel('🎰 Tirer x5')
                    .setStyle(ButtonStyle.Success),
            );
        }

        // Bouton TOUT seulement si available >= 2 (pour éviter doublon avec x1)
        if (data.available >= 2) {
            buttons.push(
                new ButtonBuilder()
                    .setCustomId(`puits_tirer_${data.available}`)
                    .setLabel(`🎰 Tirer TOUT (x${data.available})`)
                    .setStyle(ButtonStyle.Danger),
            );
        }

        const row = new ActionRowBuilder().addComponents(...buttons);
        components.push(row);
    }

    const response = await interaction.editReply({ embeds: [embed], components });

    // Collector pour les boutons de tirage
    if (components.length > 0) {
        const collector = response.createMessageComponentCollector({
            componentType: ComponentType.Button,
            filter: (i) => i.user.id === userId && i.customId.startsWith('puits_tirer_'),
            time: 60_000,
        });

        collector.on('collect', async (buttonInteraction) => {
            const count = parseInt(buttonInteraction.customId.split('_')[2]);
            await executeTirage(buttonInteraction, userId, count);
            collector.stop();
        });

        collector.on('end', (_, reason) => {
            if (reason === 'time') {
                interaction.editReply({ components: [] }).catch(() => {});
            }
        });
    }
}

async function handleTirer(interaction, userId) {
    const count = interaction.options.getInteger('nombre') || 1;
    await interaction.deferReply();
    await executeTirage(interaction, userId, count, true);
}

async function executeTirage(interaction, userId, count, isSlashCommand = false) {
    const result = performTirages(userId, count);

    if (!result.success) {
        const errorEmbed = new EmbedBuilder()
            .setColor('#e74c3c')
            .setDescription(result.message);

        if (isSlashCommand) {
            return interaction.editReply({ embeds: [errorEmbed] });
        } else {
            return interaction.update({ embeds: [errorEmbed], components: [] });
        }
    }

    // Appliquer les récompenses
    const rewardMessages = await applyTirageRewards(interaction.client, userId, result.rewards);

    // Construire l'embed des résultats
    const embed = new EmbedBuilder()
        .setTitle('🎰 Résultat du Tirage')
        .setColor('#2ecc71')
        .setDescription(result.message);

    // Afficher chaque récompense
    const rewardList = result.rewards.map((r, i) => {
        return `**Tirage #${r.tirageNumber}** → ${rewardMessages[i] || r.name}`;
    }).join('\n');

    embed.addFields({ name: '🎁 Récompenses obtenues', value: rewardList || 'Aucune', inline: false });

    // Nouveau statut
    const newStatus = result.newStatus;
    embed.addFields(
        {
            name: '📊 Après tirage',
            value: [
                `**PT restants :** ${newStatus.tiragePoints.toLocaleString('fr-FR')} PT`,
                `**Tirages :** ${newStatus.totalTirages} / ${newStatus.maxTirages}`,
                `**Tirages disponibles :** ${newStatus.available}`,
            ].join('\n'),
            inline: false,
        }
    );

    if (newStatus.puitsComplete) {
        embed.setFooter({ text: '🏆 Félicitations ! Vous avez vidé votre puits de combat !' });
    }

    if (isSlashCommand) {
        await interaction.editReply({ embeds: [embed], components: [] });
    } else {
        await interaction.update({ embeds: [embed], components: [] });
    }
}

async function handleHistorique(interaction, userId) {
    await interaction.deferReply({ ephemeral: true });

    const data = getPuitsDisplayData(userId);
    const history = data.history;

    if (history.length === 0) {
        return interaction.editReply({ content: '📜 Aucun tirage effectué ce mois-ci.' });
    }

    // Grouper par pages de 15
    const pageSize = 15;
    const pages = [];
    for (let i = 0; i < history.length; i += pageSize) {
        pages.push(history.slice(i, i + pageSize));
    }

    let currentPage = 0;

    const buildEmbed = (page) => {
        const embed = new EmbedBuilder()
            .setTitle('📜 Historique des Tirages')
            .setColor('#9b59b6')
            .setFooter({ text: `Page ${page + 1}/${pages.length} | ${history.length} tirage(s) total` });

        const lines = pages[page].map(t => {
            const date = new Date(t.timestamp).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });
            return `**#${t.tirage_number}** (${date}) → ${t.reward_type}: ${t.reward_id} x${t.reward_amount}`;
        });

        embed.setDescription(lines.join('\n'));
        return embed;
    };

    await interaction.editReply({ embeds: [buildEmbed(0)] });
}
