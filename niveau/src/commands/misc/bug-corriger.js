const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const {
    BUG_TRACKER_GUILD_ID,
    isBugForumThread,
    markBugThreadCorrige,
} = require('../../utils/bug-forum');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('bug-corriger')
        .setDescription('Marque le post bug du forum comme corrigé (serveur dev uniquement).')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageThreads)
        .setDMPermission(false),

    async execute(interaction) {
        if (interaction.guildId !== BUG_TRACKER_GUILD_ID) {
            return interaction.reply({
                content: '❌ Cette commande est réservée au serveur de suivi des bugs.',
                flags: 64,
            });
        }

        const channel = interaction.channel;
        if (!channel?.isThread?.() || channel.type !== ChannelType.PublicThread) {
            return interaction.reply({
                content: '❌ Utilise cette commande **dans le fil** d’un bug du forum `blzbot-bugs`.',
                flags: 64,
            });
        }

        if (!isBugForumThread(channel)) {
            return interaction.reply({
                content: '❌ Ce fil n’est pas un post du forum bugs (`blzbot-bugs`).',
                flags: 64,
            });
        }

        try {
            const result = await markBugThreadCorrige(channel);
            return interaction.reply({
                content: `✅ Bug marqué **corrigé** — tag <#${channel.id}> mis à jour.${
                    result.removed.length ? ` (retiré : ${result.removed.length} tag(s) en cours)` : ''
                }`,
                flags: 64,
            });
        } catch (err) {
            const code = err?.code;
            return interaction.reply({
                content:
                    code === 50013
                        ? '❌ Le bot n’a pas la permission de modifier les tags de ce post (Manage Threads + accès forum).'
                        : `❌ Impossible de mettre à jour les tags : ${err?.message || err}`,
                flags: 64,
            });
        }
    },
};
