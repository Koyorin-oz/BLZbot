const { SlashCommandBuilder, AttachmentBuilder, PermissionFlagsBits } = require('discord.js');
const CONFIG = require('../config.js');
const { renderStaffProfileCardV2, STAFF_CARD_BUILD } = require('../utils/canvas-staff-v2');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('profil-staff-v2')
        .setDescription('Carte staff compacte (même données que /profilstaff, style carte profil v2).')
        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
        .addUserOption((option) =>
            option.setName('utilisateur').setDescription('Membre staff à afficher').setRequired(false)
        ),

    async execute(interaction, { dbManager }) {
        const member = interaction.member;

        const hasStaffRole = CONFIG.STAFF_ROLES.some((role) => member.roles.cache.has(role.id));
        if (!hasStaffRole) {
            return interaction.reply({
                content: '❌ Cette commande est réservée aux membres du staff.',
                ephemeral: true,
            });
        }

        await interaction.deferReply({ ephemeral: true });

        const targetUser = interaction.options.getUser('utilisateur') || interaction.user;
        const targetMember = await interaction.guild.members.fetch(targetUser.id).catch(() => null);

        if (!targetMember) {
            return interaction.editReply({ content: '❌ Membre introuvable sur ce serveur.' });
        }

        let isTargetStaff = false;
        let targetStaffRoleName = 'Membre';
        for (const role of CONFIG.STAFF_ROLES) {
            if (targetMember.roles.cache.has(role.id)) {
                isTargetStaff = true;
                targetStaffRoleName = role.name;
                break;
            }
        }

        if (!isTargetStaff) {
            return interaction.editReply({
                content: '❌ La cible n’a pas un rôle staff : utilise `/profilstaff` avec le type **Profil Membre** pour un membre.',
            });
        }

        try {
            const staffProfileDb = dbManager.getStaffProfileDb();
            const sanctionsDb = dbManager.getSanctionsDb();
            const staffWarnsDb = dbManager.getStaffWarnsDb();

            const queryAll = (db, sql, params) =>
                new Promise((resolve, reject) => {
                    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])));
                });
            const queryGet = (db, sql, params) =>
                new Promise((resolve, reject) => {
                    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row)));
                });

            const [
                candidatures,
                modoTestPeriods,
                appreciations,
                promotions,
                sensitivity,
                sanctionsCountRow,
                staffWarnsCountRow,
                chances,
            ] = await Promise.all([
                queryAll(staffProfileDb, 'SELECT * FROM candidatures WHERE userId = ? ORDER BY date DESC', [
                    targetUser.id,
                ]),
                queryAll(staffProfileDb, 'SELECT * FROM modo_test_periods WHERE userId = ? ORDER BY start_date DESC', [
                    targetUser.id,
                ]),
                queryAll(staffProfileDb, 'SELECT * FROM modo_test_appreciations WHERE userId = ? ORDER BY date DESC', [
                    targetUser.id,
                ]),
                queryAll(staffProfileDb, 'SELECT * FROM staff_promotions WHERE userId = ? ORDER BY date DESC', [
                    targetUser.id,
                ]),
                queryGet(staffProfileDb, 'SELECT * FROM staff_sensitivity WHERE userId = ? AND active = 1', [
                    targetUser.id,
                ]),
                queryGet(sanctionsDb, 'SELECT COUNT(*) as count FROM sanctions WHERE moderatorId = ?', [targetUser.id]),
                queryGet(staffWarnsDb, 'SELECT COUNT(*) as count FROM staff_warns WHERE userId = ?', [targetUser.id]),
                queryGet(staffProfileDb, 'SELECT * FROM staff_chances WHERE userId = ?', [targetUser.id]),
            ]);

            const profileData = {
                user: targetUser,
                member: targetMember,
                staffRole: targetStaffRoleName,
                candidatures,
                modoTestPeriods,
                sanctions: sanctionsCountRow ? sanctionsCountRow.count : 0,
                staffWarns: staffWarnsCountRow ? staffWarnsCountRow.count : 0,
                appreciations,
                promotions,
                inSensitivity: !!sensitivity,
                sensitivityEnd: sensitivity ? sensitivity.end_date : null,
                candidatureChances: chances ? chances.candidature_chances : 2,
                modoTestChances: chances ? chances.modo_test_chances : 1,
            };

            const imageBuffer = await renderStaffProfileCardV2(profileData);
            const attachment = new AttachmentBuilder(imageBuffer, {
                name: `profil-staff-v2-${Date.now()}.png`,
            });

            return interaction.editReply({
                content: `🛡️ **Profil staff (v2)** — ${targetMember.displayName}\n_build ${STAFF_CARD_BUILD}_`,
                files: [attachment],
            });
        } catch (error) {
            console.error('Erreur génération profil-staff-v2:', error);
            return interaction.editReply({ content: '❌ Erreur lors de la génération de la carte staff.' });
        }
    },
};
