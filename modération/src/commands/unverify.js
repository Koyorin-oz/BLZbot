/**
 * /unverify <utilisateur> [raison] — Réinitialise la vérification d'un membre.
 *
 * Effets :
 *   1. Retire le rôle vérifié (si présent)
 *   2. Supprime l'entrée DB de vérification (l'IP est libérée du registre d'alts
 *      pour cette guilde — la prochaine personne qui vient sur cette IP n'est plus
 *      considérée comme alt de l'ancien membre)
 *   3. Log dans le salon de logs sans IP (configuré via /setup-verification)
 *
 * **NB** : le rôle "non vérifié" (`UNVERIFIED_ROLE_ID`) n'est *pas* remis automatiquement.
 * Il est attribué manuellement par le staff quand un compte est flagué suspect ;
 * `unverify` se contente de retirer le rôle vérifié et de purger la DB, le staff reste
 * libre de remettre ou non un rôle de surveillance derrière.
 *
 * Réservé aux staff disposant d'une des permissions de modération courantes
 * (Administrator, ManageGuild, BanMembers, KickMembers, ModerateMembers) — même
 * politique que le bouton "Vérifier manuellement" sous l'embed alt.
 */
const {
    SlashCommandBuilder,
    PermissionFlagsBits,
    EmbedBuilder,
    MessageFlags,
} = require('discord.js');
const {
    getGuildConfig,
    findVerifiedInGuild,
    deleteVerifiedForGuild,
} = require('../lib/verification/database');
const { removeGuildMemberRole } = require('../lib/verification/discordApi');

function isStaff(memberPermissions) {
    if (!memberPermissions) return false;
    return (
        memberPermissions.has(PermissionFlagsBits.Administrator) ||
        memberPermissions.has(PermissionFlagsBits.ManageGuild) ||
        memberPermissions.has(PermissionFlagsBits.BanMembers) ||
        memberPermissions.has(PermissionFlagsBits.KickMembers) ||
        memberPermissions.has(PermissionFlagsBits.ModerateMembers)
    );
}

module.exports = {
    guildOnly: true,
    data: new SlashCommandBuilder()
        .setName('unverify')
        .setDescription("Réinitialise la vérification d'un membre (retire le rôle vérifié, libère l'IP).")
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .addUserOption((opt) =>
            opt
                .setName('utilisateur')
                .setDescription('Le membre à dé-vérifier')
                .setRequired(true),
        )
        .addStringOption((opt) =>
            opt
                .setName('raison')
                .setDescription("Raison (visible dans les logs)")
                .setMaxLength(500)
                .setRequired(false),
        ),
    async execute(interaction) {
        if (!interaction.guild) {
            await interaction.reply({
                content: 'À utiliser sur un serveur.',
                flags: MessageFlags.Ephemeral,
            });
            return;
        }
        if (!isStaff(interaction.memberPermissions)) {
            await interaction.reply({
                content:
                    "🔒 Réservé aux **modérateurs / superviseurs / admins**. Tu n'as pas la permission d'utiliser cette commande.",
                flags: MessageFlags.Ephemeral,
            });
            return;
        }

        const target = interaction.options.getUser('utilisateur', true);
        const reason = interaction.options.getString('raison') || 'Non précisée.';
        const cfg = getGuildConfig(interaction.guild.id);
        if (!cfg?.verified_role_id) {
            await interaction.reply({
                content:
                    "Le système de vérification n'est pas configuré sur ce serveur (rôle vérifié manquant). Lance `/setup-verification`.",
                flags: MessageFlags.Ephemeral,
            });
            return;
        }

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const member = await interaction.guild.members.fetch(target.id).catch(() => null);
        const wasInDb = Boolean(findVerifiedInGuild(interaction.guild.id, target.id));

        // 1. Retrait du rôle vérifié (best-effort — le membre n'est peut-être pas dans la guilde,
        //    ou n'a jamais eu le rôle).
        let roleRemoved = false;
        if (member?.roles?.cache?.has(cfg.verified_role_id)) {
            try {
                await removeGuildMemberRole(
                    interaction.client.token,
                    interaction.guild.id,
                    target.id,
                    cfg.verified_role_id,
                );
                roleRemoved = true;
            } catch (e) {
                console.warn(`[unverify] retrait rôle vérifié ${target.id} : ${e.message || e}`);
            }
        }

        // 2. Purge DB (libère l'IP du registre d'alts pour cette guilde).
        const dbDeleted = deleteVerifiedForGuild(interaction.guild.id, target.id);

        // 3. Réponse staff + log éventuel.
        const lines = [
            `🧹 **Vérification réinitialisée pour <@${target.id}>**`,
            `• Rôle vérifié retiré : ${roleRemoved ? '✅' : '❌ (absent ou échec)'}`,
            `• Entrée DB supprimée : ${dbDeleted ? '✅' : '— (déjà absente)'}`,
        ];
        if (!member) lines.push('• Membre absent du serveur (rôle non retiré, DB purgée).');
        if (!wasInDb && !roleRemoved) {
            lines.push(
                "\n⚠️ Ce membre n'avait jamais été vérifié sur ce serveur (rien à faire en pratique).",
            );
        }
        lines.push(`\n**Raison :** ${reason}`);

        await interaction.editReply({ content: lines.join('\n') });

        if (cfg.log_channel_no_ip_id) {
            try {
                const ch = await interaction.client.channels.fetch(cfg.log_channel_no_ip_id);
                if (ch && ch.isTextBased()) {
                    const embed = new EmbedBuilder()
                        .setColor(0xe67e22)
                        .setTitle('🧹 Vérification réinitialisée')
                        .setDescription(
                            `<@${target.id}> a été dé-vérifié par <@${interaction.user.id}>.\n` +
                                `Le membre devra repasser la vérification pour récupérer le rôle.`,
                        )
                        .addFields(
                            {
                                name: 'Actions effectuées',
                                value:
                                    `• Rôle vérifié retiré : ${roleRemoved ? 'oui' : 'non'}\n` +
                                    `• Entrée DB supprimée : ${dbDeleted ? 'oui' : 'non (déjà absente)'}`,
                                inline: false,
                            },
                            { name: 'Raison', value: String(reason).slice(0, 1024), inline: false },
                        )
                        .setTimestamp(new Date());
                    await ch.send({ embeds: [embed] });
                }
            } catch (e) {
                console.warn(`[unverify] log channel : ${e.message || e}`);
            }
        }
    },
};
