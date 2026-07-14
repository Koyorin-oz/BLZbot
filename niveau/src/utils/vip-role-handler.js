const { EmbedBuilder } = require('discord.js');
const db = require('../database/database');
const logger = require('./logger');
const roleConfig = require('../config/role.config.json');

const VIP_ROLE_ID = roleConfig.specialRoles?.vip?.id || roleConfig.roleIds?.vip;

/**
 * Gère la soumission du modal de création/modification de rôle VIP personnalisé.
 */
async function handleVipRoleModal(interaction) {

    await interaction.deferReply({ ephemeral: true });

    const userId = interaction.user.id;
    const guild = interaction.guild;

    try {
        // Récupérer les valeurs du modal
        let roleName = interaction.fields.getTextInputValue('vip_role_name').trim();
        let roleColor = interaction.fields.getTextInputValue('vip_role_color').trim();
        let roleIcon = null;

        // Gestion file upload via la payload JSON brute de l'interaction (priorité à l'image uploadée)
        let uploadedIconUrl = null;
        let uploadedIconSize = 0;
        let uploadedIconType = null;
        try {
            // Extraction via la donnée brute de l'interaction
            const raw = interaction.toJSON ? interaction.toJSON() : interaction;
            const rawData = interaction.data || raw.data || raw || {};
            const components = rawData.components || rawData.data?.components || [];
            const resolved = rawData.resolved || rawData.data?.resolved || {};

            // Chercher l'attachment via resolved
            if (components.length > 0 && resolved.attachments) {
                let fileId = null;
                for (const row of components) {
                    const comps = row.components || (row.component ? [row.component] : []);
                    for (const comp of comps) {
                        if (comp.custom_id === 'vip_role_icon_upload' && comp.type === 19) {
                            fileId = Array.isArray(comp.values) && comp.values.length > 0
                                ? comp.values[0]
                                : comp.value || null;
                            break;
                        }
                    }
                    if (fileId) break;
                }

                if (fileId) {
                    const att = resolved.attachments[fileId] || resolved.attachments[fileId.toString()];
                    if (att) {
                        uploadedIconUrl = att.url;
                        uploadedIconSize = att.size || 0;
                        uploadedIconType = att.content_type || att.contentType || null;
                    }
                }
            }
        } catch (e) {
            console.error('Erreur extraction attachment modal VIP:', e);
        }

        // Vérification immédiate du type de l'image (si c'est bien une image)
        if (uploadedIconUrl && uploadedIconType && !uploadedIconType.startsWith('image/')) {
            return interaction.editReply({ content: '❌ Le fichier uploadé n\'est pas une image valide.' });
        }

        // Si pas d'image uploadée, prendre le champ texte (emoji ou URL)
        let iconBuffer = null;
        let iconType = null;
        if (uploadedIconUrl) {
            // Télécharger l'image (utilise fetch natif de Node.js 18+)
            const res = await fetch(uploadedIconUrl);
            if (!res.ok) {
                return interaction.editReply({ content: '❌ Impossible de télécharger l\'image uploadée (Erreur HTTP ' + res.status + ').' });
            }
            const arrayBuf = await res.arrayBuffer();
            const buf = Buffer.from(arrayBuf);
            if (buf.length > 256 * 1024) {
                // Compresser avec sharp
                const { compressToJpeg } = require('./image-compress');
                try {
                    iconBuffer = await compressToJpeg(buf, 256);
                    iconType = 'buffer';
                } catch (err) {
                    if (err.message && err.message.includes('unsupported image format')) {
                        return interaction.editReply({ content: '❌ Le format de l\'image uploadée n\'est pas supporté (seuls JPG, PNG, WEBP sont acceptés).' });
                    }
                    return interaction.editReply({ content: '❌ Impossible de compresser l\'image uploadée. Merci d\'utiliser une image plus légère.' });
                }
            } else {
                iconBuffer = buf;
                iconType = 'buffer';
            }
            roleIcon = uploadedIconUrl;
        } else {
            try {
                roleIcon = interaction.fields.getTextInputValue('vip_role_icon')?.trim() || null;
                if (roleIcon && (roleIcon.startsWith('http://') || roleIcon.startsWith('https://'))) {
                    // Utilise fetch natif de Node.js 18+
                    const resp = await fetch(roleIcon);
                    if (!resp.ok) {
                        return interaction.editReply({ content: '❌ Impossible de télécharger l\'image depuis l\'URL fournie (Erreur HTTP ' + resp.status + ').' });
                    }
                    const arrayBuf = await resp.arrayBuffer();
                    const buf = Buffer.from(arrayBuf);
                    if (buf.length > 256 * 1024) {
                        const { compressToJpeg } = require('./image-compress');
                        try {
                            iconBuffer = await compressToJpeg(buf, 256);
                            iconType = 'buffer';
                        } catch (err) {
                            if (err.message && err.message.includes('unsupported image format')) {
                                return interaction.editReply({ content: '❌ Le format de l\'image fournie n\'est pas supporté (seuls JPG, PNG, WEBP sont acceptés).' });
                            }
                            return interaction.editReply({ content: '❌ Impossible de compresser l\'image fournie. Merci d\'utiliser une image plus légère.' });
                        }
                    } else {
                        iconBuffer = buf;
                        iconType = 'buffer';
                    }
                }
            } catch {}
        }

        // --- Validation couleur ---
        roleColor = roleColor.replace('#', '');
        if (!/^[0-9A-Fa-f]{6}$/.test(roleColor)) {
            return interaction.editReply({ content: '❌ La couleur doit être un code hexadécimal valide (ex: `#FF5733` ou `FF5733`).' });
        }
        roleColor = `#${roleColor}`;

        // --- Validation nom ---
        if (roleName.length < 1 || roleName.length > 100) {
            return interaction.editReply({ content: '❌ Le nom du rôle doit faire entre 1 et 100 caractères.' });
        }

        // --- Trouver la position du rôle VIP pour placer le nouveau juste au-dessus ---
        const vipRole = guild.roles.cache.get(VIP_ROLE_ID);
        if (!vipRole) {
            return interaction.editReply({ content: '❌ Le rôle VIP est introuvable sur ce serveur.' });
        }
        const targetPosition = vipRole.position + 1;

        // --- Vérifier si l'utilisateur a déjà un rôle personnalisé ---
        const existing = db.prepare('SELECT * FROM vip_custom_roles WHERE user_id = ?').get(userId);

        let role;

        if (existing) {
            // Supprimer l'ancien rôle Discord
            const oldRole = guild.roles.cache.get(existing.role_id);
            if (oldRole) {
                try {
                    await oldRole.delete('Rôle VIP personnalisé remplacé');
                    logger.info(`[VIP-Role] Ancien rôle ${oldRole.name} supprimé pour ${interaction.user.tag}`);
                } catch (err) {
                    logger.error(`[VIP-Role] Erreur suppression ancien rôle ${existing.role_id}:`, err);
                }
            }
        }

        // --- Créer le nouveau rôle ---
        const roleOptions = {
            name: roleName,
            color: roleColor,
            reason: `Rôle VIP personnalisé pour ${interaction.user.tag}`,
            position: targetPosition
        };

        role = await guild.roles.create(roleOptions);
        logger.info(`[VIP-Role] Rôle "${roleName}" (${role.id}) créé pour ${interaction.user.tag}`);

        // --- Appliquer l'icône si fournie ---
        let iconApplied = false;
        let iconFailureMessage = null;
        if (roleIcon) {
            try {
                if (iconBuffer && iconType === 'buffer') {
                    await role.setIcon(iconBuffer, `Icône VIP pour ${interaction.user.tag}`);
                    logger.info(`[VIP-Role] Icône compressée appliquée au rôle ${role.name}`);
                    iconApplied = true;
                } else if (roleIcon.startsWith('http://') || roleIcon.startsWith('https://')) {
                    await role.setIcon(roleIcon, `Icône VIP pour ${interaction.user.tag}`);
                    logger.info(`[VIP-Role] Icône URL appliquée au rôle ${role.name}`);
                    iconApplied = true;
                } else {
                    await role.setIcon(roleIcon, `Icône VIP pour ${interaction.user.tag}`);
                    logger.info(`[VIP-Role] Emoji appliqué au rôle ${role.name}`);
                    iconApplied = true;
                }
            } catch (iconError) {
                logger.warn(`[VIP-Role] Impossible d'appliquer l'icône au rôle:`, iconError.message);
                const lowerMsg = String(iconError.message || '').toLowerCase();
                if (lowerMsg.includes('boost') || lowerMsg.includes('tier 2') || lowerMsg.includes('premium')) {
                    iconFailureMessage = 'Impossible d’appliquer l’icône : le serveur n’est pas boosté au niveau 2 requis pour les icônes de rôle.';
                } else if (lowerMsg.includes('image') || lowerMsg.includes('format') || lowerMsg.includes('unsupported') || lowerMsg.includes('png') || lowerMsg.includes('jpeg') || lowerMsg.includes('webp')) {
                    iconFailureMessage = 'Impossible d’appliquer l’icône : le format de l’image n’est pas supporté. Utilise une image JPG, PNG ou un WEBP.';
                } else {
                    iconFailureMessage = 'Impossible d’appliquer l’icône. Assure-toi que le serveur est boost niveau 2+ et que le format est supporté.';
                }
            }
        }

        // --- Positionner correctement le rôle ---
        try {
            await role.setPosition(targetPosition);
        } catch (posError) {
            logger.warn(`[VIP-Role] Impossible de positionner le rôle exactement au-dessus du VIP:`, posError.message);
        }

        // --- Attribuer le rôle au membre ---
        const member = await guild.members.fetch(userId);
        await member.roles.add(role, 'Rôle VIP personnalisé');

        // --- Sauvegarder en base de données ---
        const now = Date.now();
        if (existing) {
            db.prepare(`
                UPDATE vip_custom_roles 
                SET role_id = ?, role_name = ?, role_color = ?, role_icon = ?, updated_at = ?
                WHERE user_id = ?
            `).run(role.id, roleName, roleColor, roleIcon, now, userId);
        } else {
            db.prepare(`
                INSERT INTO vip_custom_roles (user_id, role_id, role_name, role_color, role_icon, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            `).run(userId, role.id, roleName, roleColor, roleIcon, now, now);
        }

        // --- Réponse ---
        const embed = new EmbedBuilder()
            .setTitle('👑 Rôle VIP Personnalisé')
            .setColor(roleColor)
            .setDescription(existing 
                ? `Ton rôle VIP a été **modifié** avec succès !` 
                : `Ton rôle VIP a été **créé** avec succès !`)
            .addFields(
                { name: '📝 Nom', value: roleName, inline: true },
                { name: '🎨 Couleur', value: roleColor, inline: true },
                { name: '🖼️ Icône', value: iconApplied ? '✅ Icône appliquée' : (roleIcon ? '❌ Icône non appliquée' : 'Aucune icône fournie'), inline: true }
            );

        if (iconFailureMessage) {
            embed.addFields({ name: '⚠️ Icône', value: iconFailureMessage, inline: false });
        }

        embed.setFooter({ text: 'Utilise /role-vip à nouveau pour modifier ton rôle' })
            .setTimestamp();

        return interaction.editReply({ embeds: [embed] });

    } catch (error) {
        logger.error('[VIP-Role] Erreur lors de la création/modification du rôle:', error);
        return interaction.editReply({ content: '❌ Une erreur est survenue lors de la création du rôle.' });
    }
}

/**
 * Supprime le rôle VIP personnalisé d'un utilisateur.
 * Appelé quand l'utilisateur perd son rôle VIP.
 */
async function removeVipCustomRole(guild, userId) {
    try {
        const entry = db.prepare('SELECT * FROM vip_custom_roles WHERE user_id = ?').get(userId);
        if (!entry) return;

        const role = guild.roles.cache.get(entry.role_id);
        if (role) {
            await role.delete(`Rôle VIP personnalisé supprimé : l'utilisateur a perdu le VIP`);
            logger.info(`[VIP-Role] Rôle "${entry.role_name}" supprimé car ${userId} a perdu le VIP`);
        }

        db.prepare('DELETE FROM vip_custom_roles WHERE user_id = ?').run(userId);
    } catch (error) {
        logger.error(`[VIP-Role] Erreur suppression rôle VIP personnalisé pour ${userId}:`, error);
    }
}

module.exports = { handleVipRoleModal, removeVipCustomRole };
