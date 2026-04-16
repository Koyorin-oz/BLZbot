const { SlashCommandBuilder, AttachmentBuilder, PermissionFlagsBits } = require('discord.js');
const CONFIG = require('../config.js');
const { renderStaffProfileCard, renderMemberProfileCard } = require('../utils/canvas-staff.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('profilstaff')
        .setDescription('Affiche le profil détaillé d\'un utilisateur (Staff ou Membre)')
        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
        .addUserOption(option =>
            option.setName('utilisateur')
                .setDescription('L\'utilisateur ciblé')
                .setRequired(false))
        .addStringOption(option =>
            option.setName('type')
                .setDescription('Le type de profil à afficher')
                .setRequired(false)
                .addChoices(
                    { name: '👤 Profil Membre', value: 'member' },
                    { name: '🛡️ Profil Staff', value: 'staff' }
                )),

    async execute(interaction, { dbManager }) {
        const member = interaction.member;
        
        // 1. Vérification des permissions de l\'exécuteur
        const hasStaffRole = CONFIG.STAFF_ROLES.some(role => 
            member.roles.cache.has(role.id)
        );

        if (!hasStaffRole) {
            return interaction.reply({
                content: '❌ Cette commande est réservée aux membres du staff.',
                ephemeral: true
            });
        }

        await interaction.deferReply();

        const targetUser = interaction.options.getUser('utilisateur') || interaction.user;
        const targetMember = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
        
        // Déterminer si la cible est staff
        let isTargetStaff = false;
        let targetStaffRoleName = 'Membre';
        if (targetMember) {
            for (const role of CONFIG.STAFF_ROLES) {
                if (targetMember.roles.cache.has(role.id)) {
                    isTargetStaff = true;
                    targetStaffRoleName = role.name;
                    break;
                }
            }
        }

        // Choix du type de profil
        let profileType = interaction.options.getString('type');
        
        // Logique automatique si pas de choix
        if (!profileType) {
            profileType = isTargetStaff ? 'staff' : 'member';
        }

        // =====================================================
        // GENERATION PROFIL STAFF
        // =====================================================
        if (profileType === 'staff') {
            if (!targetMember) {
                return interaction.editReply('❌ Membre introuvable sur ce serveur (nécessaire pour le profil staff).');
            }

            try {
                const staffProfileDb = dbManager.getStaffProfileDb();
                const sanctionsDb = dbManager.getSanctionsDb();
                const staffWarnsDb = dbManager.getStaffWarnsDb();

                // Fonctions d\'accès DB (Promisified)
                const queryAll = (db, sql, params) => new Promise((resolve, reject) => {
                    db.all(sql, params, (err, rows) => err ? reject(err) : resolve(rows || []));
                });
                const queryGet = (db, sql, params) => new Promise((resolve, reject) => {
                    db.get(sql, params, (err, row) => err ? reject(err) : resolve(row));
                });

                const [
                    candidatures,
                    modoTestPeriods,
                    appreciations,
                    promotions,
                    sensitivity,
                    sanctionsCountRow,
                    staffWarnsCountRow,
                    chances
                ] = await Promise.all([
                    queryAll(staffProfileDb, 'SELECT * FROM candidatures WHERE userId = ? ORDER BY date DESC', [targetUser.id]),
                    queryAll(staffProfileDb, 'SELECT * FROM modo_test_periods WHERE userId = ? ORDER BY start_date DESC', [targetUser.id]),
                    queryAll(staffProfileDb, 'SELECT * FROM modo_test_appreciations WHERE userId = ? ORDER BY date DESC', [targetUser.id]),
                    queryAll(staffProfileDb, 'SELECT * FROM staff_promotions WHERE userId = ? ORDER BY date DESC', [targetUser.id]),
                    queryGet(staffProfileDb, 'SELECT * FROM staff_sensitivity WHERE userId = ? AND active = 1', [targetUser.id]),
                    queryGet(sanctionsDb, 'SELECT COUNT(*) as count FROM sanctions WHERE moderatorId = ?', [targetUser.id]),
                    queryGet(staffWarnsDb, 'SELECT COUNT(*) as count FROM staff_warns WHERE userId = ?', [targetUser.id]),
                    queryGet(staffProfileDb, 'SELECT * FROM staff_chances WHERE userId = ?', [targetUser.id])
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
                    modoTestChances: chances ? chances.modo_test_chances : 1
                };

                const imageBuffer = await renderStaffProfileCard(profileData);
                const attachment = new AttachmentBuilder(imageBuffer, { name: 'profil-staff.png' });

                return interaction.editReply({
                    content: `🛡️ **Profil Staff :** ${targetMember.displayName}`,
                    files: [attachment]
                });

            } catch (error) {
                console.error('Erreur génération profil staff:', error);
                return interaction.editReply('❌ Erreur lors de la génération du profil staff.');
            }
        }

        // =====================================================
        // GENERATION PROFIL MEMBRE (Nouveau - Canvas)
        // =====================================================
        if (profileType === 'member') {
            try {
                const sanctionsDb = dbManager.getSanctionsDb();
                const notesDb = dbManager.getNotesDb();

                const queryAll = (db, sql, params) => new Promise((resolve, reject) => {
                    db.all(sql, params, (err, rows) => err ? reject(err) : resolve(rows || []));
                });

                // Récupérer tout l\'historique pour les stats
                const [allSanctions, notes] = await Promise.all([
                    queryAll(sanctionsDb, 'SELECT * FROM sanctions WHERE userId = ?', [targetUser.id]),
                    queryAll(notesDb, 'SELECT * FROM notes WHERE userId = ?', [targetUser.id])
                ]);

                // Calcul des statistiques
                const stats = {
                    warns: allSanctions.filter(s => s.type === 'Warn').length,
                    mutes: allSanctions.filter(s => s.type === 'Time Out').length,
                    bans: allSanctions.filter(s => s.type === 'Ban').length,
                    notes: notes.length
                };

                // Dernière sanction (triée par date décroissante)
                const lastSanction = allSanctions.sort((a, b) => b.date - a.date)[0] || null;

                let moderatorName = 'Inconnu';
                if (lastSanction && lastSanction.moderatorId) {
                    if (lastSanction.moderatorId === 'System') {
                        moderatorName = 'Système';
                    } else {
                        try {
                            const modUser = await interaction.client.users.fetch(lastSanction.moderatorId);
                            moderatorName = modUser.displayName; // ou username
                        } catch {
                            moderatorName = 'Inconnu';
                        }
                    }
                }

                const profileData = {
                    user: targetUser,
                    member: targetMember,
                    stats,
                    lastSanction,
                    moderatorName
                };

                const imageBuffer = await renderMemberProfileCard(profileData);
                const attachment = new AttachmentBuilder(imageBuffer, { name: 'profil-membre.png' });

                return interaction.editReply({
                    content: `👤 **Profil Membre :** ${targetUser.username}`,
                    files: [attachment]
                });

            } catch (error) {
                console.error('Erreur profil membre:', error);
                return interaction.editReply('❌ Erreur lors de la génération du profil membre.');
            }
        }
    }
};
