/**
 * Titre staff (colonne gauche) sur /profil et /testprofil : rôles d’un utilisateur
 * sur la guilde principale BLZ (BLZ_MAIN_GUILD_ID ou 1097110036192448656).
 * Priorité : Owner serveur > rôles staff (du plus haut au plus bas) > Membre.
 */
const PREVIEW_STAFF_GUILD_ID = String(process.env.BLZ_MAIN_GUILD_ID || '1097110036192448656').trim();

// Priorité du plus haut au plus bas : on attribue le label du premier rôle trouvé sur le membre.
const PREVIEW_INVOKER_STAFF_ROLES = [
    { id: '1454509448855818311', label: 'Fondateur' },
    { id: '1433460236470980608', label: 'Dictateur' },
    { id: '1433460248789778524', label: 'Second Dictateur' },
    { id: '1452608223634001940', label: 'Admin' },
    { id: '1452608118998433864', label: 'Superviseur' },
    { id: '1452608041454407711', label: 'Employé' },
    { id: '1433460304041218150', label: 'Employé Test' },
    { id: '1170361439345704962', label: 'VIP' },
];

const PREVIEW_INVOKER_MEMBRE_ROLE_ID = '1323236382881222797';

/**
 * Retourne le titre staff à afficher pour un utilisateur donné.
 * @param {import('discord.js').Client} client
 * @param {string} userId
 * @returns {Promise<string|null>}
 */
async function getPreviewStaffTitleForUser(client, userId) {
    if (!client || !userId || !PREVIEW_STAFF_GUILD_ID) return null;
    const guild =
        client.guilds.cache.get(PREVIEW_STAFF_GUILD_ID) ??
        (await client.guilds.fetch(PREVIEW_STAFF_GUILD_ID).catch(() => null));
    if (!guild) return null;

    if (guild.ownerId === userId) return 'Owner';

    const member = await guild.members.fetch(userId).catch(() => null);
    if (!member) return null;
    for (const { id, label } of PREVIEW_INVOKER_STAFF_ROLES) {
        if (member.roles.cache.has(id)) return label;
    }
    if (member.roles.cache.has(PREVIEW_INVOKER_MEMBRE_ROLE_ID)) return 'Membre';
    return null;
}

/**
 * @deprecated Utiliser `getPreviewStaffTitleForUser` : on affiche le titre de la cible du /profil,
 *             pas de celui qui lance la commande. Conservé pour compat éventuelle.
 */
async function getPreviewInvokerStaffTitle(client, invokerUserId) {
    return getPreviewStaffTitleForUser(client, invokerUserId);
}

module.exports = {
    getPreviewStaffTitleForUser,
    getPreviewInvokerStaffTitle,
    PREVIEW_STAFF_GUILD_ID,
};
