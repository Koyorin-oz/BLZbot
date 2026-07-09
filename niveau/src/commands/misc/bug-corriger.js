const { SlashCommandBuilder } = require('discord.js');
const {
    isBugTrackerGuild,
    resolveBugForumThread,
    markBugAsFixed,
} = require('../../utils/bug-forum-tags');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('bug-corriger')
        .setDescription('Marque un signalement comme corrigé (forum blzbot-bugs — staff test).'),

    async execute(interaction) {
        if (!isBugTrackerGuild(interaction.guildId)) {
            return interaction.reply({
                content: '❌ Cette commande est réservée au serveur de suivi des bugs (staff test).',
                flags: 64,
            });
        }

        const thread = await resolveBugForumThread(interaction);
        if (!thread) {
            return interaction.reply({
                content:
                    '❌ Utilise cette commande **dans un fil** du forum **blzbot-bugs** (pas dans un salon texte).',
                flags: 64,
            });
        }

        await markBugAsFixed(thread);
        return interaction.reply({
            content: '✅ Tags **En cours** retirés — signalement marqué **Corrigé**.',
            flags: 64,
        });
    },
};
