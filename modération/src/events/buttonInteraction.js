const { EmbedBuilder } = require('discord.js');
const CONFIG = require('../config.js');

// Cache pour les points totaux possibles - évite de recalculer à chaque vote
const totalPointsCache = new Map();
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

/**
 * Calcule le total de points possibles dans le serveur
 * Basé sur les membres du rôle Staff principal, puis vérifie leur rôle le plus haut
 */
async function calculateTotalPossiblePoints(guild) {
    // Vérifier le cache
    const cached = totalPointsCache.get(guild.id);
    if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
        return cached.points;
    }

    // Rôle staff principal - tous les membres staff ont ce rôle
    const STAFF_ROLE_ID = '1172237685763608579';
    const staffRole = guild.roles.cache.get(STAFF_ROLE_ID);

    if (!staffRole) {
        console.log(`[Vote] ⚠️ Rôle Staff (${STAFF_ROLE_ID}) non trouvé dans le cache`);
        return 0;
    }

    // Collecter tous les membres staff et calculer leurs points
    const memberPoints = new Map(); // userId -> { points, name, role }

    staffRole.members.forEach(member => {
        // Pour chaque membre staff, trouver son rôle avec le plus de points
        let maxPoints = 0;
        let maxRoleName = 'Staff';

        for (const roleConfig of CONFIG.STAFF_ROLES) {
            if (roleConfig.points <= 0) continue;

            if (member.roles.cache.has(roleConfig.id)) {
                if (roleConfig.points > maxPoints) {
                    maxPoints = roleConfig.points;
                    maxRoleName = roleConfig.name;
                }
            }
        }

        // Minimum 1 point pour un membre staff (même si pas de rôle spécifique)
        if (maxPoints === 0) maxPoints = 1;

        memberPoints.set(member.id, {
            points: maxPoints,
            name: member.user.tag,
            role: maxRoleName
        });
    });

    // Calculer le total et afficher les détails
    let totalPoints = 0;
    const details = [];
    memberPoints.forEach((data, id) => {
        totalPoints += data.points;
        details.push(`${data.name}(${data.role}:${data.points}pts)`);
    });

    console.log(`[Vote] Points staff: ${totalPoints} pts, ${memberPoints.size} membres: ${details.join(', ') || 'aucun'}`);

    // Mettre en cache le résultat
    totalPointsCache.set(guild.id, {
        points: totalPoints,
        timestamp: Date.now()
    });

    return totalPoints;
}

/**
 * Termine un vote de manière programmée (utilisé par le timer automatique et le bouton)
 * @param {Message} message - Le message du vote
 * @param {Guild} guild - Le serveur Discord
 * @param {VoteManager} voteManager - Le gestionnaire de votes
 * @param {string|null} forceVoteKey - Clé du vote à terminer (optionnel, sinon détecté automatiquement)
 * @returns {Promise<{success: boolean, result: string, voteKey: string}>}
 */
async function endVoteProgrammatically(message, guild, voteManager, forceVoteKey = null) {
    const embed = message.embeds[0];

    if (!embed) {
        console.error('[endVoteProgrammatically] Embed introuvable');
        return { success: false, result: 'Embed introuvable', voteKey: null };
    }

    // Trouver la clé du vote
    let voteKey = forceVoteKey;

    if (!voteKey) {
        // Essayer d'abord de trouver un userId dans la description (vote standard)
        const userIdMatch = embed.description?.match(/<@(\d+)>/);
        voteKey = userIdMatch ? userIdMatch[1] : null;

        // Si pas de userId, chercher le vote par messageId (votes personnalisés/bvote)
        if (!voteKey || !voteManager.votes[voteKey]) {
            for (const [key, voteData] of Object.entries(voteManager.votes)) {
                if (voteData.messageId === message.id) {
                    voteKey = key;
                    break;
                }
            }
        }
    }

    if (!voteKey || !voteManager.votes[voteKey]) {
        console.error('[endVoteProgrammatically] Vote introuvable');
        return { success: false, result: 'Vote introuvable', voteKey: null };
    }

    const vote = voteManager.votes[voteKey];
    const result = vote.oui > vote.non ? '✅ ACCEPTÉ' : '❌ REFUSÉ';
    const promoteUser = vote.oui > vote.non;

    const resultEmbed = EmbedBuilder.from(embed)
        .setColor(vote.oui > vote.non ? '#00FF00' : '#FF0000')
        .setFooter({ text: `Résultat: ${result}` });

    // Désactiver tous les boutons
    const disabledRow = message.components[0];
    if (disabledRow && disabledRow.components) {
        disabledRow.components.forEach(button => button.data.disabled = true);
    }

    await message.edit({ embeds: [resultEmbed], components: disabledRow ? [disabledRow] : [] });

    // ⭐ INTÉGRATION PROFIL STAFF - Gérer les candidatures et modo tests refusés
    const dbManager = require('../modules/database');
    const staffProfileDb = dbManager.getStaffProfileDb();
    if (staffProfileDb && !promoteUser) {
        if (vote.type === 'candidature') {
            // Candidature refusée
            staffProfileDb.run(
                `UPDATE candidatures SET status = 'refuse', reviewer_id = ?, review_date = ? 
                 WHERE id = (SELECT id FROM candidatures WHERE userId = ? AND status = 'en_attente' ORDER BY date DESC LIMIT 1)`,
                ['vote_system', Date.now(), voteKey],
                (err) => { if (err) console.error('Erreur MAJ candidature refusée:', err); }
            );
        } else if (vote.type === 'modo_test_to_modo') {
            // Modo test refusé (échec du passage en permanent)
            staffProfileDb.run(
                `UPDATE modo_test_periods SET status = 'termine', result = 'refuse', reviewer_id = ? 
                 WHERE id = (SELECT id FROM modo_test_periods WHERE userId = ? AND status IN ('en_cours', 'vote_en_cours') ORDER BY start_date DESC LIMIT 1)`,
                ['vote_system', voteKey],
                async (err) => { 
                    if (err) {
                        console.error('Erreur échec modo test:', err);
                    } else {
                        // Optionnel: Retirer le rôle modo test si échec ? 
                        // Habituellement oui, sinon ils restent modo test indéfiniment.
                        const member = await guild.members.fetch(voteKey).catch(() => null);
                        if (member) {
                            await member.roles.remove(CONFIG.MODO_TEST_ROLE_ID).catch(() => null);
                            await member.send('❌ Malheureusement, votre période de test n\'a pas été concluante pour le passage en modérateur permanent.').catch(() => null);
                        }
                    }
                }
            );
        }
    }

    // Gérer les promotions si le vote est accepté
    if (promoteUser && vote.type) {
        const member = await guild.members.fetch(voteKey).catch(() => null);

        if (member) {
            try {
                switch (vote.type) {
                    case 'candidature':
                        await member.roles.add(CONFIG.MODO_TEST_ROLE_ID).catch(() => null);
                        await member.send('🎉 GG vous êtes passé modérateur test !').catch(() => null);

                        const endDate = new Date();
                        endDate.setDate(endDate.getDate() + 21);
                        voteManager.modoTestData[voteKey] = endDate.toISOString();

                        const staffProfileDb = dbManager.getStaffProfileDb();
                        if (staffProfileDb) {
                            staffProfileDb.run(
                                `UPDATE candidatures SET status = 'accepte', reviewer_id = ?, review_date = ? 
                                 WHERE id = (SELECT id FROM candidatures WHERE userId = ? AND status = 'en_attente' ORDER BY date DESC LIMIT 1)`,
                                ['vote_system', Date.now(), voteKey],
                                (err) => { if (err) console.error('Erreur MAJ candidature:', err); }
                            );

                            const startTimestamp = Date.now();
                            const endTimestamp = endDate.getTime();
                            staffProfileDb.run(
                                'INSERT INTO modo_test_periods (userId, start_date, end_date, status) VALUES (?, ?, ?, ?)',
                                [voteKey, startTimestamp, endTimestamp, 'en_cours'],
                                (err) => { if (err) console.error('Erreur modo test period:', err); }
                            );

                            staffProfileDb.run(
                                'INSERT INTO staff_promotions (userId, role_id, role_name, date, promoted_by) VALUES (?, ?, ?, ?, ?)',
                                [voteKey, CONFIG.MODO_TEST_ROLE_ID, 'Modérateur Test', startTimestamp, 'vote_system'],
                                (err) => { if (err) console.error('Erreur promotion:', err); }
                            );

                            staffProfileDb.run(
                                'UPDATE staff_chances SET modo_test_chances = modo_test_chances - 1 WHERE userId = ?',
                                [voteKey],
                                (err) => { if (err) console.error('Erreur déduction chance modo test:', err); }
                            );
                        }
                        break;

                    case 'modo_test_to_modo':
                        await member.roles.remove(CONFIG.MODO_TEST_ROLE_ID).catch(() => null);
                        await member.roles.add(CONFIG.MODO_ROLE_ID).catch(() => null);
                        await member.send('🎉 GG vous êtes maintenant modérateur permanent !').catch(() => null);

                        const staffProfileDb2 = dbManager.getStaffProfileDb();
                        if (staffProfileDb2) {
                            staffProfileDb2.run(
                                `UPDATE modo_test_periods SET status = 'termine', result = 'accepte', reviewer_id = ? 
                                 WHERE id = (SELECT id FROM modo_test_periods WHERE userId = ? AND status IN ('en_cours', 'vote_en_cours') ORDER BY start_date DESC LIMIT 1)`,
                                ['vote_system', voteKey],
                                (err) => { if (err) console.error('Erreur fin modo test:', err); }
                            );

                            staffProfileDb2.run(
                                'INSERT INTO staff_promotions (userId, role_id, role_name, date, promoted_by) VALUES (?, ?, ?, ?, ?)',
                                [voteKey, CONFIG.MODO_ROLE_ID, 'Modérateur', Date.now(), 'vote_system'],
                                (err) => { if (err) console.error('Erreur promotion modo:', err); }
                            );
                        }
                        break;

                    case 'superviseur_to_admin_test':
                        await member.roles.add(CONFIG.ADMIN_TEST_ROLE_ID).catch(() => null);
                        await member.send('🎉 GG vous êtes maintenant administrateur test !').catch(() => null);
                        break;

                    case 'admin_test_to_admin':
                        await member.roles.remove(CONFIG.ADMIN_TEST_ROLE_ID).catch(() => null);
                        await member.roles.add(CONFIG.ADMIN_ROLE_ID).catch(() => null);
                        await member.send('🎉 GG vous êtes maintenant administrateur permanent !').catch(() => null);
                        break;
                }

                // Envoyer le message de confirmation
                const channel = message.channel;
                if (channel && channel.send) {
                    await channel.send(`✅ ${member.user.tag} a été promu avec succès !`);
                }
            } catch (error) {
                console.error('Erreur lors de la promotion:', error);
            }
        }
    }

    delete voteManager.votes[voteKey];
    voteManager.saveVotes();

    // Pour les votes custom, afficher le sujet, sinon afficher comme mention utilisateur
    const displayKey = vote.type === 'custom' ? `"${voteKey}"` : `<@${voteKey}>`;
    console.log(`[Vote] Vote terminé pour ${displayKey}: ${result}`);
    return { success: true, result, voteKey };
}

module.exports = {
    name: 'buttonInteraction',
    endVoteProgrammatically,

    async execute(interaction, { voteManager, recruitmentManager, config, client }) {
        const customId = interaction.customId;

        // Gestion des votes standards
        if (customId === 'vote_oui' || customId === 'vote_non') {
            await handleStandardVote(interaction, voteManager, customId);
        }

        // Gestion des votes de débannissement
        else if (customId.startsWith('deban_vote_')) {
            await handleDebanVote(interaction, voteManager, customId);
        }

        // Gestion des votes de recrutement
        else if (customId.startsWith('recrutement_vote_')) {
            await handleRecruitmentVote(interaction, voteManager, recruitmentManager, client);
        }

        // Fin de vote
        else if (customId === 'fin_vote' || customId === 'fin_rankup_vote' || customId === 'fin_bvote') {
            await handleEndVote(interaction, voteManager);
        }

        // Fin de vote de débannissement
        else if (customId.startsWith('fin_deban_vote_')) {
            await handleEndDebanVote(interaction, voteManager, client, config);
        }

        // Accepter le règlement
        else if (customId === 'accept_reglement') {
            await handleAcceptReglement(interaction);
        }

        // Ajouter une règle
        else if (customId.startsWith('add_rule_')) {
            await handleAddRule(interaction);
        }

        // Terminer la création du règlement
        else if (customId.startsWith('finish_reglement_')) {
            await handleFinishReglement(interaction);
        }
    }
};

/**
 * Gère les votes standards (oui/non)
 */
async function handleStandardVote(interaction, voteManager, customId) {
    const message = interaction.message;
    const embed = message.embeds[0];

    if (!embed) {
        return interaction.reply({ content: 'Erreur: Embed introuvable.', ephemeral: true });
    }

    // Essayer d'abord de trouver un userId dans la description (vote standard)
    const userIdMatch = embed.description?.match(/<@(\d+)>/);
    let voteKey = userIdMatch ? userIdMatch[1] : null;

    // Si pas de userId, chercher le vote par messageId (votes personnalisés/bvote)
    if (!voteKey || !voteManager.votes[voteKey]) {
        // Chercher dans tous les votes celui qui correspond à ce message
        for (const [key, voteData] of Object.entries(voteManager.votes)) {
            if (voteData.messageId === message.id) {
                voteKey = key;
                break;
            }
        }
    }

    if (!voteKey || !voteManager.votes[voteKey]) {
        return interaction.reply({ content: 'Vote introuvable.', ephemeral: true });
    }

    const vote = voteManager.votes[voteKey];
    const voterId = interaction.user.id;
    const memberPoints = voteManager.getUserPoints(interaction.member);

    if (memberPoints === 0) {
        return interaction.reply({ content: 'Vous n\'avez pas les permissions pour voter.', ephemeral: true });
    }

    const voteType = customId === 'vote_oui' ? 'oui' : 'non';
    const previousVote = vote.voters[voterId];

    if (previousVote === voteType) {
        return interaction.reply({ content: `Vous avez déjà voté ${voteType}.`, ephemeral: true });
    }

    // Retirer l'ancien vote si existant
    if (previousVote) {
        vote[previousVote] -= memberPoints;
    }

    // Ajouter le nouveau vote
    vote[voteType] += memberPoints;
    vote.voters[voterId] = voteType;

    voteManager.saveVotes();

    // Mettre à jour l'embed
    const updatedEmbed = EmbedBuilder.from(embed)
        .setFields(
            { name: 'Oui', value: vote.oui.toString(), inline: true },
            { name: 'Non', value: vote.non.toString(), inline: true }
        );

    await message.edit({ embeds: [updatedEmbed] });
    await interaction.reply({ content: `Vote enregistré: ${voteType}`, ephemeral: true });

    // ⭐ MAJORITÉ AUTOMATIQUE - Vérifier si la majorité absolue est atteinte
    // Calculer le total de points possibles dans tout le serveur
    const totalPossiblePoints = await calculateTotalPossiblePoints(interaction.guild);
    const majorityNeeded = Math.floor(totalPossiblePoints / 2) + 1;

    // Dès qu'un camp atteint la majorité absolue (>50% du total possible), le vote se termine
    // Cela permet de clore le vote dès qu'un camp ne peut plus être rattrapé
    if (vote.oui >= majorityNeeded || vote.non >= majorityNeeded) {
        const winner = vote.oui >= majorityNeeded ? 'OUI' : 'NON';
        const winnerPoints = vote.oui >= majorityNeeded ? vote.oui : vote.non;
        console.log(`🎯 Majorité absolue atteinte: ${winner} (${winnerPoints}/${totalPossiblePoints} points, majorité à ${majorityNeeded})`);

        setTimeout(async () => {
            try {
                await handleEndVote({ message, guild: interaction.guild, reply: () => { } }, voteManager);
            } catch (error) {
                console.error('Erreur lors de la fin automatique du vote:', error);
            }
        }, 2000); // Délai de 2 secondes pour permettre la mise à jour de l'embed
    }
}

/**
 * Gère les votes de débannissement
 */
async function handleDebanVote(interaction, voteManager, customId, client) {
    const parts = customId.split('_');
    const voteType = parts[2]; // 'oui' ou 'non'
    const targetUserId = parts[3];

    const message = interaction.message;
    const embed = message.embeds[0];

    if (!voteManager.debanVotes[targetUserId]) {
        return interaction.reply({ content: 'Vote de débannissement introuvable.', ephemeral: true });
    }

    // Un user ne peut pas voter sur sa propre demande de deban
    if (interaction.user.id === targetUserId) {
        return interaction.reply({ content: '❌ Vous ne pouvez pas voter sur votre propre demande de débannissement.', ephemeral: true });
    }

    const vote = voteManager.debanVotes[targetUserId];
    const voterId = interaction.user.id;
    const memberPoints = voteManager.getUserPoints(interaction.member);

    if (memberPoints === 0) {
        return interaction.reply({ content: 'Vous n\'avez pas les permissions pour voter.', ephemeral: true });
    }

    const previousVote = vote.voters[voterId];

    if (previousVote === voteType) {
        return interaction.reply({ content: `Vous avez déjà voté ${voteType}.`, ephemeral: true });
    }

    // Retirer l'ancien vote si existant
    if (previousVote) {
        vote[previousVote] -= memberPoints;
    }

    // Ajouter le nouveau vote
    vote[voteType] += memberPoints;
    vote.voters[voterId] = voteType;

    voteManager.saveDebanVotes();

    // Mettre à jour l'embed
    const updatedEmbed = EmbedBuilder.from(embed)
        .setFields(
            { name: 'Oui', value: vote.oui.toString(), inline: true },
            { name: 'Non', value: vote.non.toString(), inline: true }
        );

    await message.edit({ embeds: [updatedEmbed] });
    await interaction.reply({ content: `Vote enregistré : **${voteType}** (${memberPoints} pts).`, ephemeral: true });

    // Majorité absolue automatique : dès qu'un camp dépasse 50% du total possible, on clôt.
    try {
        const totalPossiblePoints = await calculateTotalPossiblePoints(interaction.guild);
        const majorityNeeded = Math.floor(totalPossiblePoints / 2) + 1;

        if (totalPossiblePoints > 0 && (vote.oui >= majorityNeeded || vote.non >= majorityNeeded)) {
            const winner = vote.oui >= majorityNeeded ? 'OUI' : 'NON';
            console.log(`[Deban] Majorité absolue atteinte pour ${targetUserId}: ${winner} (${vote.oui} oui / ${vote.non} non, seuil ${majorityNeeded}/${totalPossiblePoints})`);
            setTimeout(async () => {
                try {
                    await endDebanVoteProgrammatically(message, interaction.guild, voteManager, client, targetUserId);
                } catch (err) {
                    console.error('[Deban] Erreur fin auto (majorité):', err);
                }
            }, 2000);
        }
    } catch (err) {
        console.error('[Deban] Erreur calcul majorité auto:', err);
    }
}

/**
 * Termine un vote de débannissement de manière programmatique (utilisé par la majorité auto).
 * Factorise la logique de fin de vote pour éviter la duplication entre le bouton et la majorité auto.
 */
async function endDebanVoteProgrammatically(message, guild, voteManager, client, targetUserId) {
    if (!voteManager.debanVotes[targetUserId]) return { success: false, reason: 'not_found' };

    const vote = voteManager.debanVotes[targetUserId];
    const accepted = vote.oui > vote.non;
    const result = accepted ? '✅ ACCEPTÉ' : '❌ REFUSÉ';

    const embed = message.embeds[0];
    if (embed) {
        const resultEmbed = EmbedBuilder.from(embed)
            .setColor(accepted ? '#00FF00' : '#FF0000')
            .setFooter({ text: `Résultat: ${result}` });

        const disabledRow = message.components[0];
        if (disabledRow?.components) {
            disabledRow.components.forEach(button => { if (button.data) button.data.disabled = true; });
        }
        await message.edit({ embeds: [resultEmbed], components: disabledRow ? [disabledRow] : [] }).catch(() => null);
    }

    // Débannir si accepté
    let unbanOk = true;
    if (accepted) {
        try {
            const mainGuild = await client.guilds.fetch(CONFIG.DEBAN_GUILD_ID);
            await mainGuild.bans.remove(targetUserId, 'Débannissement accepté par vote');
        } catch (error) {
            if (error?.code !== 10026) { // 10026 = Unknown Ban (déjà débanni)
                console.error('[Deban] Erreur lors du débannissement:', error);
                unbanOk = false;
            }
        }
    } else {
        // Refus → cooldown de 30 jours pour empêcher le spam de demandes
        voteManager.addDebanRefusalCooldown(targetUserId);
    }

    // Notifier le user en DM (best-effort)
    try {
        const user = await client.users.fetch(targetUserId).catch(() => null);
        if (user) {
            const dmEmbed = new EmbedBuilder()
                .setColor(accepted ? '#00FF00' : '#FF0000')
                .setTitle(accepted ? '✅ Demande de débannissement acceptée' : '❌ Demande de débannissement refusée')
                .setDescription(accepted
                    ? `Le staff a voté **en votre faveur**. Vous avez été débanni du serveur.\n\nLien d'invitation : https://discord.gg/UJNZxzmmPV`
                    : `Le staff a voté **contre** votre demande de débannissement.\n\nVous pourrez soumettre une nouvelle demande dans **30 jours**.`)
                .setTimestamp();
            await user.send({ embeds: [dmEmbed] }).catch(() => null);
        }
    } catch { /* DM fermés : on ignore */ }

    // Log dans le salon staff
    try {
        const logChannel = guild?.channels?.cache?.get(CONFIG.STAFF_WARN_CHANNEL_ID);
        if (logChannel?.isTextBased?.()) {
            await logChannel.send(
                `# Vote de débannissement terminé — <@${targetUserId}> (${targetUserId}) : ${result} (oui: ${vote.oui} / non: ${vote.non})`
                + (accepted && !unbanOk ? '\n⚠️ Le débannissement API a échoué — vérifiez manuellement.' : '')
            ).catch(() => null);
        }
    } catch (err) {
        console.error('[Deban] Erreur log salon staff:', err);
    }

    // Envoyer un message public dans le salon de vote
    if (message.channel?.isTextBased?.()) {
        if (accepted) {
            await message.channel.send(
                unbanOk
                    ? `✅ <@${targetUserId}> a été débanni avec succès suite au vote.`
                    : `⚠️ Le vote est accepté pour <@${targetUserId}>, mais le débannissement API a échoué. Un admin doit vérifier.`
            ).catch(() => null);
        } else {
            await message.channel.send(`❌ La demande de débannissement de <@${targetUserId}> a été refusée.`).catch(() => null);
        }
    }

    delete voteManager.debanVotes[targetUserId];
    voteManager.saveDebanVotes();
    voteManager.activeDebanRequests.delete(targetUserId);

    return { success: true, accepted, result };
}

/**
 * Termine un vote standard
 */
async function handleEndVote(interaction, voteManager) {
    const message = interaction.message;
    const guild = interaction.guild;

    // Utiliser la fonction centralisée de terminaison de vote
    const result = await endVoteProgrammatically(message, guild, voteManager);

    if (!result.success) {
        return interaction.reply({ content: `Erreur: ${result.result}`, ephemeral: true });
    }

    await interaction.reply({ content: `Le vote a été terminé. Résultat: ${result.result}`, ephemeral: true });
}

/**
 * Termine un vote de débannissement
 */
async function handleEndDebanVote(interaction, voteManager, client, config) {
    const targetUserId = interaction.customId.split('_')[3];
    const message = interaction.message;
    const embed = message.embeds[0];

    // Vérifier les permissions (Admin uniquement)
    const member = interaction.member;
    let voterRolePoints = 0;
    for (const role of member.roles.cache.values()) {
        const roleData = CONFIG.STAFF_ROLES.find(r => r.id === role.id);
        if (roleData && roleData.points > voterRolePoints) {
            voterRolePoints = roleData.points;
        }
    }

    const adminRole = CONFIG.STAFF_ROLES.find(r => r.name === 'Administrateur');
    const minPointsToEnd = adminRole ? adminRole.points : 5;

    if (voterRolePoints < minPointsToEnd) {
        return interaction.reply({
            content: '🔒 Seuls les **Administrateurs** peuvent terminer un vote de débannissement.',
            ephemeral: true
        });
    }

    if (!voteManager.debanVotes[targetUserId]) {
        return interaction.reply({ content: 'Vote de débannissement introuvable.', ephemeral: true });
    }

    const vote = voteManager.debanVotes[targetUserId];
    const result = vote.oui > vote.non ? '✅ ACCEPTÉ' : '❌ REFUSÉ';

    const resultEmbed = EmbedBuilder.from(embed)
        .setColor(vote.oui > vote.non ? '#00FF00' : '#FF0000')
        .setFooter({ text: `Résultat: ${result}` });

    // Désactiver tous les boutons
    const disabledRow = message.components[0];
    disabledRow.components.forEach(button => button.data.disabled = true);

    await message.edit({ embeds: [resultEmbed], components: [disabledRow] });

    // Si accepté, débannir l'utilisateur
    if (vote.oui > vote.non) {
        try {
            const guild = await client.guilds.fetch(CONFIG.DEBAN_GUILD_ID);
            await guild.bans.remove(targetUserId, 'Débannissement accepté par vote');
            await interaction.channel.send(`✅ L'utilisateur <@${targetUserId}> a été débanni avec succès.`);
        } catch (error) {
            console.error('Erreur lors du débannissement:', error);
            await interaction.channel.send(`⚠️ Erreur lors du débannissement de <@${targetUserId}>.`);
        }
    }

    delete voteManager.debanVotes[targetUserId];
    voteManager.saveDebanVotes();
    voteManager.activeDebanRequests.delete(targetUserId);

    await interaction.reply({ content: `Le vote de débannissement a été terminé. Résultat: ${result}`, ephemeral: true });
}

/**
 * Gère l'acceptation du règlement
 */
async function handleAcceptReglement(interaction) {
    const member = interaction.member;
    const roleId = CONFIG.REGLEMENT_ACCEPTED_ROLE_ID;

    // Defer immédiatement pour éviter le timeout (3s)
    await interaction.deferReply({ flags: 64 });

    if (!roleId || roleId === 'ID_DU_ROLE_REGLEMENT_ACCEPTE') {
        return interaction.editReply({
            content: '⚠️ Le rôle "Règlement accepté" n\'est pas configuré dans config.js'
        });
    }

    try {
        // Vérifier si le membre a déjà le rôle
        if (member.roles.cache.has(roleId)) {
            return interaction.editReply({
                content: '✅ Vous avez déjà accepté le règlement !'
            });
        }

        // Ajouter le rôle
        await member.roles.add(roleId);
        await interaction.editReply({
            content: '✅ Vous avez accepté le règlement ! Le rôle vous a été attribué.'
        });
    } catch (error) {
        console.error('Erreur lors de l\'ajout du rôle règlement:', error);
        await interaction.editReply({
            content: '❌ Erreur lors de l\'attribution du rôle.'
        });
    }
}

/**
 * Affiche le modal pour ajouter une règle
 */
async function handleAddRule(interaction) {
    const reglementNom = interaction.customId.replace('add_rule_', '');
    const reglementCommand = require('../commands/reglement.js');
    await reglementCommand.showRuleModal(interaction, reglementNom, null);
}

/**
 * Termine et publie le règlement
 */
async function handleFinishReglement(interaction) {
    const reglementNom = interaction.customId.replace('finish_reglement_', '');
    const reglementCommand = require('../commands/reglement.js');

    try {
        // Publier le règlement dans le canal
        await reglementCommand.sendOrUpdateReglement(interaction, reglementNom, false);

        // Mettre à jour le message de confirmation
        await interaction.update({
            content: `✅ Le règlement **${reglementNom}** a été publié avec succès !`,
            components: []
        });
    } catch (error) {
        console.error('Erreur lors de la publication du règlement:', error);
        await interaction.update({
            content: '❌ Erreur lors de la publication du règlement.',
            components: []
        });
    }
}

/**
 * Gestion des votes de recrutement (système identique au backup)
 */
async function handleRecruitmentVote(interaction, voteManager, recruitmentManager, client) {
    const customId = interaction.customId;

    // Extraire l'action et l'userId
    const parts = customId.split('_');
    const actionType = parts[2]; // 'oui', 'non' ou 'vote'
    const userId = parts[3];

    // Vérifier si le vote existe
    if (!voteManager.votes[userId]) {
        console.log(`[Candidature] Vote non trouvé pour userId: ${userId}`);
        console.log(`[Candidature] Votes disponibles: ${Object.keys(voteManager.votes).join(', ') || 'aucun'}`);

        const expiredEmbed = new EmbedBuilder()
            .setTitle('⏰ Vote Expiré')
            .setDescription('Ce vote n\'existe plus ou a expiré.')
            .setColor('#FF0000')
            .setTimestamp();

        return await interaction.reply({
            embeds: [expiredEmbed],
            ephemeral: true
        });
    }

    const recruitmentVote = voteManager.votes[userId];
    const voterId = interaction.user.id;
    const member = interaction.member;

    // Calculer les points du votant
    let voterRolePoints = 0;
    for (const role of member.roles.cache.values()) {
        const roleData = CONFIG.STAFF_ROLES.find(r => r.id === role.id);
        if (roleData && roleData.points > voterRolePoints) {
            voterRolePoints = roleData.points;
        }
    }

    // Trouver le rôle Modérateur (points: 1 minimum pour voter)
    const modoRole = CONFIG.STAFF_ROLES.find(r => r.name === 'Modérateur');
    const minPointsToVote = modoRole ? modoRole.points : 1;
    if (voterRolePoints < minPointsToVote) {
        const permEmbed = new EmbedBuilder()
            .setTitle('🔒 Permissions Insuffisantes')
            .setDescription('Vous devez être au minimum **Modérateur** pour voter sur une candidature.')
            .setColor('#FF0000')
            .setTimestamp();

        return await interaction.reply({
            embeds: [permEmbed],
            ephemeral: true
        });
    }

    // Gestion du vote (oui/non)
    if (actionType === 'oui' || actionType === 'non') {
        // Vérifier si le votant a déjà voté dans l'autre catégorie
        const oppositeVote = actionType === 'oui' ? 'non' : 'oui';
        if (recruitmentVote[oppositeVote] && recruitmentVote[oppositeVote][voterId]) {
            delete recruitmentVote[oppositeVote][voterId];
        }

        // Si l'utilisateur clique sur le même bouton, annuler son vote
        if (recruitmentVote[actionType] && recruitmentVote[actionType][voterId]) {
            delete recruitmentVote[actionType][voterId];

            const removeEmbed = new EmbedBuilder()
                .setDescription(`🗑️ Votre vote **${actionType.toUpperCase()}** a été retiré.`)
                .setColor('#FFA500')
                .setTimestamp();

            await interaction.reply({
                embeds: [removeEmbed],
                ephemeral: true
            });
        } else {
            // Ajouter le vote
            if (!recruitmentVote[actionType]) {
                recruitmentVote[actionType] = {};
            }
            recruitmentVote[actionType][voterId] = voterRolePoints;

            const voteEmbed = new EmbedBuilder()
                .setDescription(`✅ Vous avez voté **${actionType.toUpperCase()}**`)
                .addFields({ name: '⚖️ Poids de votre vote', value: `${voterRolePoints} points`, inline: true })
                .setColor(actionType === 'oui' ? '#00FF00' : '#FF0000')
                .setTimestamp();

            await interaction.reply({
                embeds: [voteEmbed],
                ephemeral: true
            });
        }

        // Mettre à jour l'embed avec les nouveaux votes
        const totalOui = Object.values(recruitmentVote.oui || {}).reduce((a, b) => a + b, 0);
        const totalNon = Object.values(recruitmentVote.non || {}).reduce((a, b) => a + b, 0);
        const totalPossiblePoints = await calculateTotalPossiblePoints(interaction.guild);

        const ouiPercentage = totalPossiblePoints > 0 ? Math.min(100, Math.round((totalOui / totalPossiblePoints) * 100)) : 0;
        const nonPercentage = totalPossiblePoints > 0 ? Math.min(100, Math.round((totalNon / totalPossiblePoints) * 100)) : 0;

        const ouiBlocks = Math.min(10, Math.max(0, Math.floor(ouiPercentage / 10)));
        const nonBlocks = Math.min(10, Math.max(0, Math.floor(nonPercentage / 10)));
        const ouiBar = '🟩'.repeat(ouiBlocks) + '⬜'.repeat(10 - ouiBlocks);
        const nonBar = '🟥'.repeat(nonBlocks) + '⬜'.repeat(10 - nonBlocks);

        // Conserver tous les fields originaux et ajouter/mettre à jour le résultat du vote
        const originalFields = interaction.message.embeds[0].data.fields || [];

        // Filtrer pour retirer l'ancien field "Résultat du vote" s'il existe
        const fieldsWithoutResult = originalFields.filter(f => f.name !== '📊 Résultat du vote');

        // Ajouter le nouveau field de résultat
        const updatedEmbed = EmbedBuilder.from(interaction.message.embeds[0])
            .setFields([
                ...fieldsWithoutResult,
                {
                    name: '📊 Résultat du vote',
                    value: `✅ **OUI** : ${totalOui}/${totalPossiblePoints} points (${ouiPercentage}%)\n${ouiBar}\n\n❌ **NON** : ${totalNon}/${totalPossiblePoints} points (${nonPercentage}%)\n${nonBar}`,
                    inline: false
                }
            ]);

        await interaction.message.edit({ embeds: [updatedEmbed] });

        // Sauvegarder les votes
        voteManager.saveVotes();
    }

    // Gestion de la fin du vote
    else if (actionType === 'vote') {
        const dbManager = require('../modules/database');
        const staffProfileDb = dbManager.getStaffProfileDb();

        // Vérifier que c'est un admin (points >= 5 = Administrateur)
        const adminRole = CONFIG.STAFF_ROLES.find(r => r.name === 'Administrateur');
        const minPointsToEnd = adminRole ? adminRole.points : 5;
        if (voterRolePoints < minPointsToEnd) {
            const adminEmbed = new EmbedBuilder()
                .setTitle('🔒 Permissions Insuffisantes')
                .setDescription('Seuls les **Administrateurs** peuvent terminer un vote de recrutement.')
                .setColor('#FF0000')
                .setTimestamp();

            return await interaction.reply({
                embeds: [adminEmbed],
                ephemeral: true
            });
        }

        // Defer la réponse car les opérations suivantes peuvent prendre du temps
        await interaction.deferReply({ ephemeral: false });

        const totalOui = Object.values(recruitmentVote.oui || {}).reduce((a, b) => a + b, 0);
        const totalNon = Object.values(recruitmentVote.non || {}).reduce((a, b) => a + b, 0);

        const candidate = await client.users.fetch(userId);
        const guild = interaction.guild;

        // Si le vote est accepté
        if (totalOui > totalNon) {
            try {
                const now = Date.now();
                const modoTestEndDate = now + (21 * 24 * 60 * 60 * 1000);

                // Ajouter les rôles
                const guildMember = await guild.members.fetch(userId);
                await guildMember.roles.add([CONFIG.MODO_TEST_ROLE_ID, CONFIG.STAFF_ROLE_ID]);

                // ⭐ Intégration profil staff: candidature acceptée + démarrage modo test + promotion
                if (staffProfileDb) {
                    staffProfileDb.run(
                        `UPDATE candidatures SET status = 'accepte', reviewer_id = ?, review_date = ?
                         WHERE id = (SELECT id FROM candidatures WHERE userId = ? AND status = 'en_attente' ORDER BY date DESC LIMIT 1)`,
                        [interaction.user.id, now, userId],
                        (err) => { if (err) console.error('Erreur MAJ candidature acceptée (recrutement):', err); }
                    );

                    staffProfileDb.run(
                        'INSERT INTO modo_test_periods (userId, start_date, end_date, status) VALUES (?, ?, ?, ?)',
                        [userId, now, modoTestEndDate, 'en_cours'],
                        (err) => { if (err) console.error('Erreur création modo test period (recrutement):', err); }
                    );

                    staffProfileDb.run(
                        'INSERT INTO staff_promotions (userId, role_id, role_name, date, promoted_by) VALUES (?, ?, ?, ?, ?)',
                        [userId, CONFIG.MODO_TEST_ROLE_ID, 'Modérateur Test', now, interaction.user.id],
                        (err) => { if (err) console.error('Erreur insertion promotion modo test (recrutement):', err); }
                    );

                    staffProfileDb.run(
                        `UPDATE staff_chances
                         SET modo_test_chances = CASE
                             WHEN modo_test_chances > 0 THEN modo_test_chances - 1
                             ELSE 0
                         END
                         WHERE userId = ?`,
                        [userId],
                        (err) => { if (err) console.error('Erreur déduction chance modo test (recrutement):', err); }
                    );
                }

                // Envoyer un MP au candidat
                await candidate.send({
                    embeds: [
                        new EmbedBuilder()
                            .setColor('#00FF00')
                            .setTitle('✅ Candidature acceptée !')
                            .setDescription(`Félicitations ! Votre candidature pour rejoindre l'équipe de modération a été **acceptée** !\n\nBienvenue dans l'équipe ! 🎉`)
                            .setTimestamp()
                    ]
                }).catch(err => console.error('Impossible d\'envoyer le MP au candidat:', err));

                // Décrémenter les places (uniquement si accepté) et mettre à jour le message
                if (recruitmentVote.specialite) {
                    recruitmentManager.decrementPlaces(recruitmentVote.specialite);
                }
                await recruitmentManager.updateRecruitmentMessage(client);

                const acceptEmbed = new EmbedBuilder()
                    .setTitle('✅ Candidature Acceptée')
                    .setDescription(`La candidature de **${candidate.tag}** a été **acceptée** avec succès !`)
                    .addFields(
                        { name: '👤 Candidat', value: `${candidate.tag}`, inline: true },
                        { name: '📊 Résultat', value: `**${totalOui}** OUI vs **${totalNon}** NON`, inline: true },
                        { name: '🎭 Rôles attribués', value: `<@&${CONFIG.MODO_TEST_ROLE_ID}>`, inline: false }
                    )
                    .setColor('#00FF00')
                    .setTimestamp();

                await interaction.editReply({
                    embeds: [acceptEmbed]
                });
            } catch (error) {
                console.error('Erreur lors de l\'acceptation de la candidature:', error);

                const errorEmbed = new EmbedBuilder()
                    .setTitle('❌ Erreur')
                    .setDescription('Une erreur est survenue lors de l\'attribution des rôles.')
                    .setColor('#FF0000')
                    .setTimestamp();

                await interaction.editReply({
                    embeds: [errorEmbed]
                });
                return;
            }
        }
        // Si le vote est refusé
        else if (totalOui < totalNon) {
            if (staffProfileDb) {
                staffProfileDb.run(
                    `UPDATE candidatures SET status = 'refuse', reviewer_id = ?, review_date = ?
                     WHERE id = (SELECT id FROM candidatures WHERE userId = ? AND status = 'en_attente' ORDER BY date DESC LIMIT 1)`,
                    [interaction.user.id, Date.now(), userId],
                    (err) => { if (err) console.error('Erreur MAJ candidature refusée (recrutement):', err); }
                );
            }

            await candidate.send({
                embeds: [
                    new EmbedBuilder()
                        .setColor('#FF0000')
                        .setTitle('❌ Candidature refusée')
                        .setDescription(`Malheureusement, votre candidature pour rejoindre l'équipe de modération a été **refusée**.\n\n💡 **Ne vous découragez pas !**\nVous pourrez retenter votre chance plus tard. Continuez à être actif et respectueux sur le serveur. \n\n📅 Vous pourrez soumettre une nouvelle candidature après la période de cooldown.`)
                        .setTimestamp()
                ]
            }).catch(err => console.error('Impossible d\'envoyer le MP au candidat:', err));

            const refuseEmbed = new EmbedBuilder()
                .setTitle('❌ Candidature Refusée')
                .setDescription(`La candidature de **${candidate.tag}** a été **refusée**.`)
                .addFields(
                    { name: '👤 Candidat', value: `${candidate.tag}`, inline: true },
                    { name: '📊 Résultat', value: `**${totalOui}** OUI vs **${totalNon}** NON`, inline: true }
                )
                .setColor('#FF0000')
                .setTimestamp();

            await interaction.editReply({
                embeds: [refuseEmbed]
            });
        }
        // Égalité
        else {
            const equalityEmbed = new EmbedBuilder()
                .setTitle('⚖️ Égalité')
                .setDescription('Le vote est à égalité. Veuillez continuer à voter avant de terminer.')
                .setColor('#FFA500')
                .setTimestamp();

            await interaction.editReply({
                embeds: [equalityEmbed]
            });
            return;
        }

        // Désactiver les boutons
        const disabledRow = {
            type: 1,
            components: interaction.message.components[0].components.map(button => ({
                ...button.toJSON(),
                disabled: true
            }))
        };

        await interaction.message.edit({ components: [disabledRow] });

        // Supprimer le vote et le timer
        if (recruitmentVote.timer) {
            clearTimeout(recruitmentVote.timer);
        }
        if (recruitmentVote.reminderTimer) {
            clearTimeout(recruitmentVote.reminderTimer);
        }
        delete voteManager.votes[userId];
        voteManager.saveVotes();
    }
}
