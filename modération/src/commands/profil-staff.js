const { SlashCommandBuilder, AttachmentBuilder, PermissionFlagsBits } = require('discord.js');
const CONFIG = require('../config.js');
const { renderStaffProfileCardV2 } = require('../utils/canvas-staff-v2');
const { isBotOwner } = require('../utils/bot-owner');

/**
 * Liste des IDs de rôles « hauts admins » : tout rôle de `STAFF_ROLES` avec
 * `points >= 4` (Administrateur Test, Administrateur, Directeur, avia, Owner).
 * On la calcule une seule fois au require pour éviter une boucle à chaque appel.
 */
const HIGH_ADMIN_ROLE_IDS = new Set(
    (CONFIG.STAFF_ROLES || [])
        .filter((r) => Number(r.points || 0) >= 4)
        .map((r) => r.id)
);

module.exports = {
    data: new SlashCommandBuilder()
        .setName('profil-staff')
        .setDescription(
            'Fiche synthèse staff : candidatures, tests modo, sanctions, appréciations et sensibilité.'
        )
        // Filtre Discord côté UI : on demande Administrator pour ne pas afficher
        // la commande aux modos lambda. Le filtre runtime ci-dessous reste
        // l'autorité finale (rôles « hauts admins »).
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addUserOption((option) =>
            option
                .setName('utilisateur')
                .setDescription('Staff à afficher (par défaut : toi-même). Réservé aux hauts administrateurs.')
                .setRequired(false)
        ),

    async execute(interaction, { dbManager }) {
        const member = interaction.member;

        // Restriction : owner du bot OU un des rôles « hauts admins »
        // (Administrateur Test, Administrateur, Directeur, avia, Owner).
        // Volonté du chef : éviter le « concours » entre staffs lambda.
        const isHighAdmin =
            isBotOwner(interaction.user.id) ||
            (member?.roles?.cache &&
                [...HIGH_ADMIN_ROLE_IDS].some((id) => member.roles.cache.has(id)));
        if (!isHighAdmin) {
            return interaction.reply({
                content:
                    '❌ Cette commande est réservée aux **hauts administrateurs** (Admin / Directeur / Owner).',
                ephemeral: true,
            });
        }

        await interaction.deferReply();

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
                content:
                    '❌ La cible n’a pas un rôle staff : la carte `/profil-staff` est réservée aux comptes staff.',
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
                timeoutsRow,
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
                queryGet(
                    sanctionsDb,
                    "SELECT COUNT(*) as count FROM sanctions WHERE moderatorId = ? AND type = 'Time Out'",
                    [targetUser.id]
                ),
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
                timeoutsCount: timeoutsRow ? timeoutsRow.count : 0,
            };

            const imageBuffer = await renderStaffProfileCardV2(profileData);
            const attachment = new AttachmentBuilder(imageBuffer, {
                name: `profil-staff-${Date.now()}.png`,
            });

            return interaction.editReply({
                content: null,
                files: [attachment],
            });
        } catch (error) {
            console.error('Erreur génération profil-staff:', error);
            return interaction.editReply({ content: '❌ Erreur lors de la génération de la carte staff.' });
        }
    },
};
