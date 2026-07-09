const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const CONFIG = require('../config.js');
const { getModeratorTitleWithArticle } = require('../utils/helpers.js');
const { denyUnlessCanMod } = require('../utils/mod-access');
const {
    buildPostSanctionDmEmbed,
    moderatorLabelForDm,
    trySendSanctionDm,
    sendSanctionChannelFallback,
    formatDmStatusForModReply,
} = require('../utils/sanction-dm.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('kick')
        .setDescription('Expulser un membre du serveur.')
        .setDefaultMemberPermissions(null)
        .addUserOption(option =>
            option.setName('utilisateur')
                .setDescription('Le membre à expulser')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('raison')
                .setDescription('Raison de l\'expulsion')
                .setRequired(false))
        .addStringOption(option =>
            option.setName('regle')
                .setDescription('Règle du règlement (optionnel)')
                .setRequired(false)
                .setAutocomplete(true))
        .toJSON(),

    async autocomplete(interaction, { dbManager }) {
        const focusedValue = interaction.options.getFocused().toLowerCase();
        const dbRules = dbManager.getRulesDb();

        dbRules.all('SELECT rules FROM reglements', [], (err, rows) => {
            if (err) {
                console.error('Erreur autocomplete règles:', err);
                return interaction.respond([]);
            }

            const allRules = [];
            rows.forEach(row => {
                try {
                    const rules = JSON.parse(row.rules);
                    rules.forEach(rule => {
                        allRules.push({
                            name: `${rule.number}. ${rule.title}`,
                            value: `${rule.number}. ${rule.title}`
                        });
                    });
                } catch (e) {
                    console.error('Erreur parse rules:', e);
                }
            });

            const filtered = allRules.filter(rule =>
                rule.name.toLowerCase().includes(focusedValue)
            ).slice(0, 25);

            interaction.respond(filtered);
        });
    },

    async execute(interaction, { dbManager }) {
        const denied = denyUnlessCanMod(interaction, PermissionFlagsBits.KickMembers);
        if (denied) {
            return interaction.reply({ ...denied, ephemeral: true });
        }

        const utilisateur = interaction.options.getUser('utilisateur');
        const raison = interaction.options.getString('raison');
        const regle = interaction.options.getString('regle');
        const modérateur = interaction.member;

        // Construire la raison finale
        let finalReason = '';
        if (regle && raison) {
            finalReason = `${regle} - ${raison}`;
        } else if (regle) {
            finalReason = regle;
        } else if (raison) {
            finalReason = raison;
        } else {
            finalReason = 'Aucune raison spécifiée';
        }

        const membreCible = await interaction.guild.members.fetch(utilisateur.id).catch(() => null);

        if (!membreCible) {
            return interaction.reply({
                content: '❌ Ce membre n\'est pas sur le serveur.',
                ephemeral: true
            });
        }

        if (membreCible.roles.highest.position >= interaction.guild.members.me.roles.highest.position) {
            return interaction.reply({
                content: '❌ Je ne peux pas expulser ce membre car il est au-dessus de moi.',
                ephemeral: true
            });
        }

        if (membreCible.roles.highest.position >= modérateur.roles.highest.position) {
            return interaction.reply({
                content: '❌ Vous ne pouvez pas expulser ce membre car il est au même niveau ou au-dessus de vous.',
                ephemeral: true
            });
        }

        await interaction.deferReply({ ephemeral: true });

        try {
            await membreCible.kick(finalReason);

            const postEmbed = buildPostSanctionDmEmbed({
                guildName: interaction.guild.name,
                type: 'KICK',
                reason: finalReason,
                byLabel: moderatorLabelForDm(interaction),
            });
            const dmOk = await trySendSanctionDm(utilisateur, postEmbed);
            const fallback = dmOk
                ? { ok: false }
                : await sendSanctionChannelFallback({
                    guild: interaction.guild,
                    user: utilisateur,
                    embed: postEmbed,
                });
            const dmStatus = formatDmStatusForModReply({ dmOk, fallback });

            const dbSanctions = dbManager.getSanctionsDb();
            dbSanctions.run(
                `INSERT INTO sanctions (userId, type, reason, moderatorId, date) VALUES (?, ?, ?, ?, ?)`,
                [utilisateur.id, 'Kick', finalReason, modérateur.id, Date.now()],
                async function (err) {
                    if (err) {
                        console.error('Erreur insertion sanction kick:', err);
                        return;
                    }
                    const sanctionId = this.lastID;

                    // Log
                    const canalLog = interaction.guild.channels.cache.get(CONFIG.STAFF_WARN_CHANNEL_ID);
                    if (canalLog && canalLog.isTextBased()) {
                        const moderatorTitleWithArticle = getModeratorTitleWithArticle(modérateur);
                        const messageLog = `# ${utilisateur.tag} (${utilisateur.id}) a été expulsé (kick) pour la raison : "${finalReason}" par ${moderatorTitleWithArticle} <@${modérateur.id}>`;

                        const sentMessage = await canalLog.send({ content: messageLog });

                        // Mettre à jour la sanction avec l'ID du message de log
                        if (sentMessage) {
                            dbSanctions.run(
                                'UPDATE sanctions SET log_message_id = ?, log_channel_id = ? WHERE id = ?',
                                [sentMessage.id, sentMessage.channel.id, sanctionId]
                            );
                        }
                    }
                }
            );

            await interaction.editReply({
                content: `✅ ${utilisateur.tag} a été expulsé.\n${dmStatus}`,
            });
        } catch (erreur) {
            console.error('Erreur lors de l\'expulsion :', erreur);
            if (interaction.deferred) {
                await interaction.editReply({
                    content: '❌ Une erreur est survenue lors de l\'expulsion.',
                }).catch(() => {});
            } else {
                await interaction.reply({
                    content: '❌ Une erreur est survenue lors de l\'expulsion.',
                    ephemeral: true,
                }).catch(() => {});
            }
        }
    }
};
