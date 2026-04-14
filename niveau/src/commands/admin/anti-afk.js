const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const {
    setGloballyDisabled,
    isVoiceAfkGloballyDisabled,
} = require('../../utils/voice-afk-checker');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('anti-afk')
        .setDescription('Active ou désactive complètement le système anti-AFK vocal (captchas aléatoires).')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addStringOption((option) =>
            option
                .setName('statut')
                .setDescription('Désactiver arrête tout : plus de timers ni de captchas.')
                .setRequired(true)
                .addChoices(
                    { name: 'Désactivé (off)', value: 'off' },
                    { name: 'Activé (on)', value: 'on' }
                )
        ),

    async execute(interaction) {
        const status = interaction.options.getString('statut');
        const turnOff = status === 'off';

        setGloballyDisabled(turnOff);

        const nowOff = isVoiceAfkGloballyDisabled();
        await interaction.reply({
            content: nowOff
                ? '**Anti-AFK vocal désactivé.** Aucun captcha aléatoire ne sera lancé. Utilise `/anti-afk` → Activé pour réactiver.'
                : '**Anti-AFK vocal activé.** La planification aléatoire a repris (selon la config du module).',
            flags: MessageFlags.Ephemeral,
        });
    },
};
