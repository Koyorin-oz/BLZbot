const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const CONFIG = require('../config.js');
const { parseDuration, msToReadableTime, getModeratorTitleWithArticle } = require('../utils/helpers');
const { denyUnlessCanMod } = require('../utils/mod-access');
const { deferEphemeral } = require('../utils/interaction-ack');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('to')
        .setDescription('Mettre un membre en time out (mute) avec une durée et une raison.')
        .setDefaultMemberPermissions(null)
        .addUserOption((option) =>
            option.setName('utilisateur').setDescription('Le membre à time out').setRequired(true),
        )
        .addStringOption((option) =>
            option.setName('temps').setDescription('Durée (ex: 10m, 2h, 1j, 3w)').setRequired(true),
        )
        .addStringOption((option) =>
            option.setName('raison').setDescription('Raison du time out').setRequired(true),
        )
        .addAttachmentOption((option) =>
            option.setName('preuve').setDescription('Preuve (capture d\'écran)').setRequired(false),
        )
        .toJSON(),

    async execute(interaction, { dbManager }) {
        const denied = denyUnlessCanMod(interaction, PermissionFlagsBits.ModerateMembers);
        if (denied) return interaction.reply(denied);
        if (!(await deferEphemeral(interaction))) return;

        const utilisateur = interaction.options.getUser('utilisateur');
        const temps = interaction.options.getString('temps');
        const raison = interaction.options.getString('raison');
        const preuve = interaction.options.getAttachment('preuve');
        const modérateur = interaction.member;

        const duréeMs = parseDuration(temps);
        if (!duréeMs) {
            return interaction.editReply({
                content: '❌ Format de temps invalide. Exemples : 10m, 2h, 1j, 3w.',
            });
        }
        const maxDurationMs = 28 * 24 * 60 * 60 * 1000;
        if (duréeMs > maxDurationMs) {
            return interaction.editReply({ content: '❌ Durée maximale : 28 jours.' });
        }

        const membreCible = await interaction.guild.members.fetch(utilisateur.id).catch(() => null);
        if (!membreCible) {
            return interaction.editReply({ content: '❌ Membre introuvable.' });
        }
        if (membreCible.roles.highest.position >= modérateur.roles.highest.position) {
            return interaction.editReply({
                content: '❌ Vous ne pouvez pas time out ce membre (hiérarchie des rôles).',
            });
        }
        if (membreCible.roles.highest.position >= interaction.guild.members.me.roles.highest.position) {
            return interaction.editReply({
                content: '❌ Je ne peux pas time out ce membre (hiérarchie des rôles).',
            });
        }

        try {
            await membreCible.timeout(duréeMs, raison);
            const duréeTexte = msToReadableTime(duréeMs);
            const dbSanctions = dbManager.getSanctionsDb();

            dbSanctions.run(
                'INSERT INTO sanctions (userId, type, reason, moderatorId, duration, date) VALUES (?, ?, ?, ?, ?, ?)',
                [membreCible.id, 'Time Out', raison, modérateur.id, duréeTexte, Date.now()],
                async function (err) {
                    if (err) console.error('to sanction insert:', err);
                    const sanctionId = this?.lastID;

                    const canalLog = interaction.guild.channels.cache.get(CONFIG.STAFF_WARN_CHANNEL_ID);
                    if (canalLog?.isTextBased()) {
                        const moderatorTitleWithArticle = getModeratorTitleWithArticle(modérateur);
                        let messageLog = `# ${membreCible.user.tag} (${membreCible.id}) a été time out pendant ${duréeTexte} pour « ${raison} » par ${moderatorTitleWithArticle} <@${modérateur.id}>`;
                        let sentMessage;
                        if (preuve?.contentType?.startsWith('image/')) {
                            sentMessage = await canalLog.send({
                                content: messageLog,
                                files: [{ attachment: preuve.url, name: preuve.name }],
                            });
                        } else {
                            if (preuve) messageLog += '\n⚠️ Preuve non acceptée (captures d\'écran uniquement).';
                            sentMessage = await canalLog.send({ content: messageLog });
                        }
                        if (sentMessage && sanctionId) {
                            dbSanctions.run(
                                'UPDATE sanctions SET log_message_id = ?, log_channel_id = ? WHERE id = ?',
                                [sentMessage.id, sentMessage.channel.id, sanctionId],
                            );
                        }
                    }
                },
            );

            await interaction.editReply({
                content: `✅ ${membreCible.user.tag} a été time out pendant ${duréeTexte}.`,
            });
        } catch (erreur) {
            console.error('Erreur /to:', erreur);
            await interaction.editReply({ content: '❌ Erreur lors du time out.' });
        }
    },
};
