const {
    SlashCommandBuilder,
    PermissionFlagsBits,
    ChannelType,
    MessageFlags,
} = require('discord.js');
const { buildWelcomeMessage, logWelcomeMemberMeta } = require('../events/welcome.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('test-bienvenue')
        .setDescription('Aperçu ou envoi test du message de bienvenue (Components V2).')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .addUserOption((option) =>
            option
                .setName('membre')
                .setDescription('Utilisateur à afficher dans le message (défaut : toi)')
        )
        .addChannelOption((option) =>
            option
                .setName('salon')
                .setDescription('Salon où envoyer le message (sinon aperçu éphémère uniquement)')
                .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
        )
        .toJSON(),

    /**
     * @param {import('discord.js').ChatInputCommandInteraction} interaction
     */
    async execute(interaction) {
        const targetUser = interaction.options.getUser('membre') ?? interaction.user;
        const channelOpt = interaction.options.getChannel('salon');

        const member =
            interaction.guild?.members.cache.get(targetUser.id) ??
            (await interaction.guild?.members.fetch({ user: targetUser }).catch(() => null));

        if (!member) {
            await interaction.reply({
                content: '❌ Impossible de résoudre ce membre sur ce serveur.',
                flags: MessageFlags.Ephemeral,
            });
            return;
        }

        let payload;
        try {
            payload = buildWelcomeMessage(member, { joinedAt: member.joinedAt ?? new Date() });
        } catch (e) {
            await interaction.reply({
                content: `❌ Configuration bienvenue invalide : ${e.message}`,
                flags: MessageFlags.Ephemeral,
            });
            return;
        }

        if (channelOpt) {
            const ch = await interaction.guild.channels.fetch(channelOpt.id).catch(() => null);
            if (!ch || !ch.isTextBased()) {
                await interaction.reply({
                    content: '❌ Salon texte invalide.',
                    flags: MessageFlags.Ephemeral,
                });
                return;
            }
            try {
                await ch.send({
                    components: payload.components,
                    flags: payload.flags,
                    allowedMentions: payload.allowedMentions,
                });
            } catch (sendErr) {
                await interaction.reply({
                    content: `❌ Impossible d’envoyer dans ce salon : ${sendErr.message || sendErr}`,
                    flags: MessageFlags.Ephemeral,
                });
                return;
            }
            await interaction.reply({
                content: `✅ Message de bienvenue envoyé dans ${ch}.`,
                flags: MessageFlags.Ephemeral,
            });
            return;
        }

        await interaction.reply({
            components: payload.components,
            flags: payload.flags | MessageFlags.Ephemeral,
            allowedMentions: payload.allowedMentions,
        });
    },
};
