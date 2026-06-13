const { SlashCommandBuilder, AttachmentBuilder } = require('discord.js');
const { buildLoveCalcCard } = require('../../utils/canvas-love-calc');

function pickLovePhrase(percent, nameA, nameB) {
    if (percent >= 90) return `🔥 ${nameA} + ${nameB} = duo légendaire !`;
    if (percent >= 70) return '❤️ Ça sent très très bon cette histoire.';
    if (percent >= 45) return '😊 Du potentiel… continuez de discuter.';
    if (percent >= 20) return '😅 C’est compliqué, mais pas impossible.';
    return '💀 Ouch… ce ship est en danger.';
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('calcul-amour')
        .setDescription('Compatibilité entre deux membres.')
        .addUserOption((o) =>
            o.setName('membre1').setDescription('Premier membre').setRequired(true)
        )
        .addUserOption((o) =>
            o.setName('membre2').setDescription('Deuxième membre').setRequired(true)
        ),

    async execute(interaction) {
        await interaction.deferReply();

        const user1 = interaction.options.getUser('membre1', true);
        const user2 = interaction.options.getUser('membre2', true);

        if (!interaction.guild) {
            return interaction.editReply('Cette commande ne fonctionne que sur un serveur.');
        }

        const member1 = await interaction.guild.members.fetch(user1.id).catch(() => null);
        const member2 = await interaction.guild.members.fetch(user2.id).catch(() => null);

        if (!member1 || !member2) {
            return interaction.editReply('Impossible de récupérer les membres.');
        }

        const percent = user1.id === user2.id ? 100 : Math.floor(Math.random() * 101);
        const phrase = pickLovePhrase(percent, member1.displayName, member2.displayName);
        const buffer = await buildLoveCalcCard(user1, user2, percent);
        const file = new AttachmentBuilder(buffer, { name: 'calcul-amour.png' });

        return interaction.editReply({
            content: `💘 **${member1.displayName}** + **${member2.displayName}** = **${percent}%**\n${phrase}`,
            files: [file],
        });
    },
};
