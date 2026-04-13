const path = require('node:path');
const {
    SlashCommandBuilder,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    ActionRowBuilder,
    ChannelType,
    EmbedBuilder,
} = require('discord.js');
const logger = require('../../utils/logger');

/** Serveur forum bugs (fixe, indépendant du GUILD_ID test/prod). */
const BUG_TRACKER_GUILD_ID = '1493276404643532810';
const BUG_FORUM_CHANNEL_ID = '1493282774323302450';
const BUG_FORUM_TAG_ID = '1493284188504461322';

const MODAL_CUSTOM_ID = 'bug_report_modal';
const FIELD_TITLE = 'bug_title';
const FIELD_DESCRIPTION = 'bug_description';

function buildReporterLabel(interaction) {
    const u = interaction.user;
    const member = interaction.member;
    const display =
        member && typeof member.displayName === 'string' && member.displayName.length > 0
            ? member.displayName
            : u.globalName || u.username;
    return `${display} (@${u.username})`;
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('bug')
        .setDescription('Signaler un bug (formulaire — post créé sur le forum staff).'),

    async execute(interaction) {
        const modal = new ModalBuilder().setCustomId(MODAL_CUSTOM_ID).setTitle('Signaler un bug');

        const titleInput = new TextInputBuilder()
            .setCustomId(FIELD_TITLE)
            .setLabel('Titre du bug (nom du post)')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('Ex. : Le bouton daily ne répond pas')
            .setRequired(true)
            .setMinLength(3)
            .setMaxLength(100);

        const descInput = new TextInputBuilder()
            .setCustomId(FIELD_DESCRIPTION)
            .setLabel('Description détaillée')
            .setStyle(TextInputStyle.Paragraph)
            .setPlaceholder('Que s’est-il passé ? Étapes pour reproduire, captures si besoin…')
            .setRequired(true)
            .setMinLength(10)
            .setMaxLength(4000);

        modal.addComponents(
            new ActionRowBuilder().addComponents(titleInput),
            new ActionRowBuilder().addComponents(descInput)
        );

        await interaction.showModal(modal);
    },

    /**
     * @param {import('discord.js').ModalSubmitInteraction} interaction
     */
    async handleModalSubmit(interaction) {
        try {
            await interaction.deferReply({ flags: 64 });
        } catch {
            return;
        }

        const rawTitle = interaction.fields.getTextInputValue(FIELD_TITLE).trim().replace(/\s+/g, ' ');
        const description = interaction.fields.getTextInputValue(FIELD_DESCRIPTION).trim();

        if (!rawTitle || !description) {
            return interaction.editReply({
                content: '❌ Titre et description sont obligatoires.',
            });
        }

        const threadName = rawTitle.slice(0, 100);
        const reporter = buildReporterLabel(interaction);
        const userId = interaction.user.id;
        const whenFr = new Date().toLocaleString('fr-FR', {
            dateStyle: 'full',
            timeStyle: 'short',
            timeZone: 'Europe/Paris',
        });

        const descSlice = description.length > 3900 ? `${description.slice(0, 3897)}…` : description;

        const embed = new EmbedBuilder()
            .setTitle('🐛 Signalement')
            .setDescription(descSlice)
            .addFields(
                { name: 'Membre', value: reporter, inline: true },
                { name: 'ID Discord', value: `\`${userId}\``, inline: true },
                { name: 'Date du signalement', value: whenFr, inline: false }
            )
            .setColor(0xe67e22)
            .setTimestamp();

        try {
            const channel = await interaction.client.channels.fetch(BUG_FORUM_CHANNEL_ID);

            if (!channel || channel.type !== ChannelType.GuildForum) {
                logger.error(`[bug] Salon ${BUG_FORUM_CHANNEL_ID} introuvable ou pas un forum.`);
                return interaction.editReply({
                    content:
                        '❌ Le salon de signalement est indisponible. Préviens un administrateur (configuration forum).',
                });
            }

            if (channel.guildId !== BUG_TRACKER_GUILD_ID) {
                logger.warn(`[bug] Forum guild mismatch: ${channel.guildId} vs ${BUG_TRACKER_GUILD_ID}`);
            }

            await channel.threads.create({
                name: threadName,
                message: { embeds: [embed] },
                appliedTags: [BUG_FORUM_TAG_ID],
            });

            await interaction.editReply({
                content:
                    '✅ Merci ! Ton signalement a été créé sur le forum staff. Les équipes pourront le traiter.',
            });
        } catch (err) {
            const code = err?.code;
            const msg = err?.message || String(err);
            logger.error(`[bug] Création du post forum: ${msg}`, err);
            await interaction.editReply({
                content:
                    code === 50001 || code === 50013
                        ? '❌ Le bot n’a pas les droits pour poster sur le forum de bugs (invite-le sur le serveur staff avec accès au salon forum + tags).'
                        : `❌ Impossible de créer le post : ${msg}`,
            });
        }
    },
};
