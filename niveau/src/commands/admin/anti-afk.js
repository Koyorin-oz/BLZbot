const {
    SlashCommandBuilder,
    PermissionFlagsBits,
    MessageFlags,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    ActionRowBuilder,
} = require('discord.js');
const {
    setGloballyDisabled,
    isVoiceAfkGloballyDisabled,
} = require('../../utils/voice-afk-checker');
const voiceAfkRuntime = require('../../utils/voice-afk-runtime');

const MODAL_CUSTOM_ID = 'anti_afk_config_modal';
const TEXT_INPUT_ID = 'anti_afk_config_text';

function stripAccents(s) {
    return s.normalize('NFD').replace(/\p{M}/gu, '');
}

/** @returns {{ errors: string[], actif?: boolean, patch: Record<string, number> }} */
function parseAntiAfkModalText(raw) {
    const errors = [];
    /** @type {Record<string, number>} */
    const patch = {};
    let actif;

    const keyMap = new Map([
        ['min', 'minIntervalMinutes'],
        ['minminutes', 'minIntervalMinutes'],
        ['minimum', 'minIntervalMinutes'],
        ['max', 'maxIntervalMinutes'],
        ['maxminutes', 'maxIntervalMinutes'],
        ['maximum', 'maxIntervalMinutes'],
        ['chance', 'eventChancePercent'],
        ['proba', 'eventChancePercent'],
        ['duree', 'penaltyDurationMinutes'],
        ['dureeminutes', 'penaltyDurationMinutes'],
        ['duration', 'penaltyDurationMinutes'],
        ['rp', 'penalizedRpPercent'],
        ['xp', 'penalizedXpPercent'],
        ['stars', 'penalizedStarsPercent'],
        ['starss', 'penalizedStarsPercent'],
    ]);

    const lines = String(raw || '').split(/\r?\n/);
    for (const line of lines) {
        const t = line.trim();
        if (!t || t.startsWith('#')) continue;

        const eq = t.match(/^\s*([^:=#]+?)\s*[:=]\s*(.+?)\s*$/);
        if (!eq) {
            errors.push(`(avertissement) Ligne ignorée : ${t.slice(0, 60)}`);
            continue;
        }

        const rawKey = stripAccents(eq[1].trim().toLowerCase()).replace(/\s+/g, '');
        const rawVal = eq[2].trim().toLowerCase();

        if (rawKey === 'actif' || rawKey === 'active' || rawKey === 'onoff') {
            if (['on', '1', 'true', 'oui', 'yes', 'actif', 'active'].includes(rawVal)) {
                actif = true;
            } else if (['off', '0', 'false', 'non', 'no', 'inactif', 'desactive', 'désactivé'].includes(rawVal)) {
                actif = false;
            } else {
                errors.push(`Valeur actif invalide : ${eq[2].trim()} (utilise on ou off).`);
            }
            continue;
        }

        const field = keyMap.get(rawKey);
        if (!field) {
            errors.push(`(avertissement) Clé inconnue, ignorée : ${eq[1].trim()}`);
            continue;
        }

        const num = Number(String(eq[2].trim()).replace(',', '.'));
        if (!Number.isFinite(num)) {
            errors.push(`${eq[1].trim()} : nombre invalide`);
            continue;
        }

        patch[field] = Math.round(num);
    }

    return { errors, actif, patch };
}

function buildModalDefaultText() {
    const s = voiceAfkRuntime.getSnapshot();
    const on = !isVoiceAfkGloballyDisabled();
    return [
        '# Une ligne = clé: valeur. Modifie seulement ce que tu veux.',
        '# Clés : actif, min, max, chance, duree, rp, xp, stars',
        '',
        `actif: ${on ? 'on' : 'off'}`,
        `min: ${s.minIntervalMinutes}`,
        `max: ${s.maxIntervalMinutes}`,
        `chance: ${s.eventChancePercent}`,
        `duree: ${s.penaltyDurationMinutes}`,
        `rp: ${s.penalizedRpPercent}`,
        `xp: ${s.penalizedXpPercent}`,
        `stars: ${s.penalizedStarsPercent}`,
    ].join('\n');
}

function buildAntiAfkModal() {
    const modal = new ModalBuilder().setCustomId(MODAL_CUSTOM_ID).setTitle('Configuration anti-AFK vocal');

    const input = new TextInputBuilder()
        .setCustomId(TEXT_INPUT_ID)
        .setLabel('Réglages (lignes clé: valeur)')
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true)
        .setMaxLength(4000)
        .setValue(buildModalDefaultText());

    modal.addComponents(new ActionRowBuilder().addComponents(input));
    return modal;
}

/**
 * @param {import('discord.js').ModalSubmitInteraction} interaction
 */
async function handleAntiAfkModalSubmit(interaction) {
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
        await interaction.reply({
            content: 'Réservé aux administrateurs.',
            flags: MessageFlags.Ephemeral,
        });
        return;
    }

    const body = interaction.fields.getTextInputValue(TEXT_INPUT_ID);
    const { errors, actif, patch } = parseAntiAfkModalText(body);

    const blocking = errors.filter((e) => !e.startsWith('(avertissement)'));
    if (blocking.length > 0) {
        await interaction.reply({
            content: `**Impossible d’enregistrer.**\n${blocking.slice(0, 8).map((e) => `• ${e}`).join('\n')}`,
            flags: MessageFlags.Ephemeral,
        });
        return;
    }

    if (actif !== undefined) {
        setGloballyDisabled(!actif);
    }

    if (Object.keys(patch).length > 0) {
        voiceAfkRuntime.applyRuntimePatch(patch);
    }

    const s = voiceAfkRuntime.getSnapshot();
    const off = isVoiceAfkGloballyDisabled();
    const warn =
        errors.length > 0
            ? `\n_Note : ${errors.length} avertissement(s) (lignes ignorées ou clés inconnues)._`
            : '';

    await interaction.reply({
        content:
            `**Anti-AFK enregistré.**\n` +
            `**Système :** ${off ? 'désactivé' : 'activé'}\n` +
            `**Délai :** ${s.minIntervalMinutes}–${s.maxIntervalMinutes} min · **Chance :** ${s.eventChancePercent} %\n` +
            `**Sanction :** ${s.penaltyDurationMinutes} min · **RP/XP/Stars :** ${s.penalizedRpPercent} % / ${s.penalizedXpPercent} % / ${s.penalizedStarsPercent} %${warn}`,
        flags: MessageFlags.Ephemeral,
    });
}

module.exports = {
    MODAL_CUSTOM_ID,
    handleAntiAfkModalSubmit,

    data: new SlashCommandBuilder()
        .setName('anti-afk')
        .setDescription('Ouvre un formulaire pour configurer l’anti-AFK vocal (délai, sanctions, on/off).')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    async execute(interaction) {
        await interaction.showModal(buildAntiAfkModal());
    },
};
