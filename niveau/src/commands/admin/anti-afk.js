const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const {
    setGloballyDisabled,
    isVoiceAfkGloballyDisabled,
} = require('../../utils/voice-afk-checker');
const voiceAfkRuntime = require('../../utils/voice-afk-runtime');

function formatVoirLines() {
    const s = voiceAfkRuntime.getSnapshot();
    const off = isVoiceAfkGloballyDisabled();
    return [
        `**Système :** ${off ? 'désactivé' : 'activé'}`,
        `**Délai aléatoire :** ${s.minIntervalMinutes}–${s.maxIntervalMinutes} min entre deux créneaux`,
        `**Chance par créneau :** ${s.eventChancePercent} %`,
        `**Sanction (échec captcha) :** ${s.penaltyDurationMinutes} min`,
        `**Gains vocal pendant la sanction :** RP ${s.penalizedRpPercent} % · XP ${s.penalizedXpPercent} % · Stars ${s.penalizedStarsPercent} %`,
        `_Fichier : \`niveau/voice-afk.runtime.json\`_`,
    ].join('\n');
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('anti-afk')
        .setDescription('Anti-AFK vocal : activer/désactiver, délai entre checks, et sévérité des sanctions.')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addSubcommand((sub) =>
            sub
                .setName('activation')
                .setDescription('Coupe ou réactive complètement les captchas aléatoires et la planification.')
                .addStringOption((option) =>
                    option
                        .setName('statut')
                        .setDescription('Off = plus aucun timer ni captcha.')
                        .setRequired(true)
                        .addChoices(
                            { name: 'Activé (on)', value: 'on' },
                            { name: 'Désactivé (off)', value: 'off' }
                        )
                )
        )
        .addSubcommand((sub) =>
            sub
                .setName('delai')
                .setDescription('Temps entre deux tirages aléatoires + optionnellement la probabilité.')
                .addIntegerOption((o) =>
                    o
                        .setName('min_minutes')
                        .setDescription('Minimum entre deux vérifications')
                        .setRequired(true)
                        .setMinValue(5)
                        .setMaxValue(180)
                )
                .addIntegerOption((o) =>
                    o
                        .setName('max_minutes')
                        .setDescription('Maximum (≥ min)')
                        .setRequired(true)
                        .setMinValue(5)
                        .setMaxValue(180)
                )
                .addIntegerOption((o) =>
                    o
                        .setName('chance_pourcent')
                        .setDescription('Probabilité à chaque créneau (0–100). Laisser vide = ne pas changer.')
                        .setRequired(false)
                        .setMinValue(0)
                        .setMaxValue(100)
                )
        )
        .addSubcommand((sub) =>
            sub
                .setName('sanctions')
                .setDescription('Durée et % des gains vocal (XP, RP, Stars) après échec au captcha.')
                .addIntegerOption((o) =>
                    o
                        .setName('duree_minutes')
                        .setDescription('Durée de la pénalité')
                        .setRequired(true)
                        .setMinValue(1)
                        .setMaxValue(1440)
                )
                .addIntegerOption((o) =>
                    o
                        .setName('rp_pourcent')
                        .setDescription('% du gain RP vocal habituel (ex. 50 = moitié)')
                        .setRequired(true)
                        .setMinValue(0)
                        .setMaxValue(100)
                )
                .addIntegerOption((o) =>
                    o
                        .setName('xp_pourcent')
                        .setDescription('% du gain XP vocal. Vide = garder la valeur actuelle.')
                        .setRequired(false)
                        .setMinValue(0)
                        .setMaxValue(100)
                )
                .addIntegerOption((o) =>
                    o
                        .setName('stars_pourcent')
                        .setDescription('% Stars (vocal / cohérence). Vide = garder la valeur actuelle.')
                        .setRequired(false)
                        .setMinValue(0)
                        .setMaxValue(100)
                )
        )
        .addSubcommand((sub) => sub.setName('voir').setDescription('Affiche la configuration en cours.')),

    async execute(interaction) {
        const sub = interaction.options.getSubcommand();

        if (sub === 'activation') {
            const status = interaction.options.getString('statut');
            const turnOff = status === 'off';
            setGloballyDisabled(turnOff);
            const nowOff = isVoiceAfkGloballyDisabled();
            await interaction.reply({
                content: nowOff
                    ? '**Anti-AFK vocal désactivé.** Plus de timers ni de captchas. Utilise `/anti-afk activation` → Activé pour réactiver.'
                    : '**Anti-AFK vocal activé.** La planification aléatoire reprend selon les réglages (`/anti-afk voir`).',
                flags: MessageFlags.Ephemeral,
            });
            return;
        }

        if (sub === 'delai') {
            const minM = interaction.options.getInteger('min_minutes', true);
            const maxM = interaction.options.getInteger('max_minutes', true);
            const chance = interaction.options.getInteger('chance_pourcent');

            if (minM > maxM) {
                await interaction.reply({
                    content: '**Erreur :** `min_minutes` doit être inférieur ou égal à `max_minutes`.',
                    flags: MessageFlags.Ephemeral,
                });
                return;
            }

            voiceAfkRuntime.setDelai({
                minMinutes: minM,
                maxMinutes: maxM,
                chancePercent: chance,
            });
            const s = voiceAfkRuntime.getSnapshot();
            await interaction.reply({
                content: `**Délai mis à jour.** Entre **${s.minIntervalMinutes}** et **${s.maxIntervalMinutes}** min · chance **${s.eventChancePercent}** %.`,
                flags: MessageFlags.Ephemeral,
            });
            return;
        }

        if (sub === 'sanctions') {
            const duree = interaction.options.getInteger('duree_minutes', true);
            const rp = interaction.options.getInteger('rp_pourcent', true);
            const xp = interaction.options.getInteger('xp_pourcent');
            const stars = interaction.options.getInteger('stars_pourcent');

            voiceAfkRuntime.setSanctions({
                durationMinutes: duree,
                rpPercent: rp,
                xpPercent: xp,
                starsPercent: stars,
            });
            const s = voiceAfkRuntime.getSnapshot();
            await interaction.reply({
                content: `**Sanctions mises à jour.** ${s.penaltyDurationMinutes} min · RP **${s.penalizedRpPercent}** % · XP **${s.penalizedXpPercent}** % · Stars **${s.penalizedStarsPercent}** %.`,
                flags: MessageFlags.Ephemeral,
            });
            return;
        }

        if (sub === 'voir') {
            await interaction.reply({
                content: formatVoirLines(),
                flags: MessageFlags.Ephemeral,
            });
        }
    },
};
