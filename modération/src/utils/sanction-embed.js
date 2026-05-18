const { EmbedBuilder } = require('discord.js');

/**
 * Embed de confirmation staff (réponse à la commande slash).
 */
function buildSanctionEmbed({ guildName, targetLabel, reason, moderatorLabel, endsAt }) {
    const embed = new EmbedBuilder()
        .setColor(0xd62828)
        .setTitle('Sanction appliquée')
        .setDescription(`Sanction enregistrée sur **${guildName}**.`);

    embed.addFields(
        { name: 'Membre', value: targetLabel, inline: false },
        { name: 'Raison', value: reason || 'Aucune raison', inline: false },
        { name: 'Modérateur', value: moderatorLabel, inline: false },
    );

    if (endsAt) {
        const ts = Math.floor(endsAt.getTime() / 1000);
        embed.addFields({
            name: 'Fin de la sanction',
            value: `<t:${ts}:F> (<t:${ts}:R>)`,
            inline: false,
        });
    }

    embed.setTimestamp();
    return embed;
}

module.exports = { buildSanctionEmbed };
