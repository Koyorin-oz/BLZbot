const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const CONFIG = require('../config.js');
const { getModeratorTitleWithArticle } = require('../utils/helpers');
const { denyUnlessCanMod } = require('../utils/mod-access');
const { deferEphemeral } = require('../utils/interaction-ack');
const { RAW_RULES } = require('../utils/raw-rules');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('warn')
        .setDescription('Avertir un utilisateur.')
        .setDefaultMemberPermissions(null)
        .addUserOption((option) =>
            option.setName('utilisateur').setDescription('L\'utilisateur à avertir').setRequired(true),
        )
        .addStringOption((option) =>
            option
                .setName('regle')
                .setDescription('Règle enfreinte')
                .setRequired(true)
                .setAutocomplete(true),
        )
        .addStringOption((option) =>
            option.setName('raison').setDescription('Précision (optionnel)').setRequired(false),
        )
        .toJSON(),

    async autocomplete(interaction) {
        const focusedValue = interaction.options.getFocused().toLowerCase();
        const filtered = RAW_RULES
            .filter((rule) => rule.toLowerCase().includes(focusedValue))
            .slice(0, 25)
            .map((rule) => ({
                name: rule.length > 100 ? `${rule.substring(0, 97)}...` : rule,
                value: rule,
            }));

        await interaction.respond(filtered);
    },

    async execute(interaction, { dbManager }) {
        const denied = denyUnlessCanMod(interaction, PermissionFlagsBits.ModerateMembers);
        if (denied) {
            return interaction.reply(denied);
        }
        if (!(await deferEphemeral(interaction))) return;

        const utilisateur = interaction.options.getUser('utilisateur') || interaction.options.getUser('membre');
        if (!utilisateur) {
            const legacyStaffWarn =
                interaction.options.getString('degre') != null ||
                (interaction.options.getUser('membre') && !interaction.options.getString('regle'));
            return interaction.editReply({
                content: legacyStaffWarn
                    ? '❌ Tu utilises l’**ancien** `/warn` staff (membre / degré). Utilise **`/warn-passeport`** pour le passeport staff.\nPour une sanction membre : **`/warn`** avec *utilisateur* + *règle*.'
                    : '❌ Membre introuvable — choisis un utilisateur dans la liste Discord.',
            });
        }

        const regle = interaction.options.getString('regle');
        const raisonExtra = interaction.options.getString('raison');
        const finalReason = raisonExtra ? `${regle} - ${raisonExtra}` : regle;
        const modérateur = interaction.member;

        const membreCible = await interaction.guild.members.fetch(utilisateur.id).catch(() => null);
        if (!membreCible) {
            return interaction.editReply({ content: '❌ Membre introuvable.' });
        }
        if (membreCible.user.bot) {
            return interaction.editReply({ content: '❌ Impossible d\'avertir un bot.' });
        }
        if (membreCible.roles.highest.position >= modérateur.roles.highest.position) {
            return interaction.editReply({
                content: '❌ Vous ne pouvez pas avertir ce membre (hiérarchie des rôles).',
            });
        }

        const dbSanctions = dbManager.getSanctionsDb();
        const expires_at = Date.now() + 60 * 24 * 60 * 60 * 1000;

        dbSanctions.run(
            'INSERT INTO sanctions (userId, type, reason, moderatorId, date, expires_at, rule_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [membreCible.id, 'Warn', finalReason, modérateur.id, Date.now(), expires_at, null],
            async function (err) {
                if (err) {
                    console.error('Erreur insertion warn:', err);
                    return interaction.editReply({ content: '❌ Erreur lors de l\'ajout du warn.' });
                }

                const canalLog = interaction.guild.channels.cache.get(CONFIG.STAFF_WARN_CHANNEL_ID);
                if (canalLog?.isTextBased()) {
                    const moderatorTitleWithArticle = getModeratorTitleWithArticle(modérateur);
                    dbSanctions.all(
                        'SELECT id FROM sanctions WHERE userId = ? AND type = \'Warn\' AND active = 1 AND (expires_at IS NULL OR expires_at > ?)',
                        [membreCible.id, Date.now()],
                        async (countErr, rows) => {
                            const warnCount = !countErr && rows ? rows.length : 1;
                            const warnText = warnCount > 1 ? 'warns' : 'warn';
                            await canalLog
                                .send(
                                    `# ${membreCible.user.tag} (${membreCible.id}) a été warn pour « ${finalReason} » par ${moderatorTitleWithArticle} <@${modérateur.id}>\n-# Il est à ${warnCount} ${warnText}`,
                                )
                                .catch(() => {});
                        },
                    );
                }

                dbSanctions.all(
                    'SELECT id FROM sanctions WHERE userId = ? AND type = \'Warn\' AND active = 1 AND (expires_at IS NULL OR expires_at > ?)',
                    [membreCible.id, Date.now()],
                    async (countErr, rows) => {
                        const warnCount = !countErr && rows ? rows.length : 1;
                        if (warnCount >= 4) {
                            try {
                                await membreCible.ban({ reason: '4ème avertissement.' });
                                dbSanctions.run(
                                    'INSERT INTO sanctions (userId, type, reason, moderatorId, date) VALUES (?, ?, ?, ?, ?)',
                                    [membreCible.id, 'Ban', '4ème avertissement.', interaction.client.user.id, Date.now()],
                                );
                            } catch (e) {
                                console.error('warn auto-ban:', e?.message || e);
                            }
                        } else if (warnCount === 3) {
                            try {
                                const duration = 7 * 24 * 60 * 60 * 1000;
                                await membreCible.timeout(duration, '3ème avertissement.');
                                dbSanctions.run(
                                    'INSERT INTO sanctions (userId, type, reason, moderatorId, duration, date) VALUES (?, ?, ?, ?, ?, ?)',
                                    [
                                        membreCible.id,
                                        'Time Out',
                                        '3ème avertissement.',
                                        interaction.client.user.id,
                                        '1 semaine',
                                        Date.now(),
                                    ],
                                );
                            } catch (e) {
                                console.error('warn auto-timeout:', e?.message || e);
                            }
                        }
                    },
                );

                await interaction.editReply({
                    content: `✅ ${utilisateur.tag} a été averti pour : ${finalReason}.`,
                });
            },
        );
    },
};
