/**
 * Titre staff (colonne gauche) sur /profil et /testprofil : rôles de l’utilisateur qui lance la commande
 * sur la guilde principale BLZ (BLZ_MAIN_GUILD_ID ou 1097110036192448656).
 * Priorité : du plus haut au plus bas ; « Membre » seulement si aucun des rôles staff/VIP
 * et présence du rôle membre.
 */
const PREVIEW_STAFF_GUILD_ID = String(process.env.BLZ_MAIN_GUILD_ID || '1097110036192448656').trim();

const PREVIEW_INVOKER_STAFF_ROLES = [
    { id: '1454509448855818311', label: 'Fondateur' },
    { id: '1433460248789778524', label: 'Second Directeur' },
    { id: '1433460236470980608', label: 'Directeur' },
    { id: '1452608223634001940', label: 'Admin' },
    { id: '1452608118998433864', label: 'Superviseur' },
    { id: '1452608041454407711', label: 'Employé' },
    { id: '1433460304041218150', label: 'Employé Test' },
    { id: '1170361439345704962', label: 'VIP' },
];

const PREVIEW_INVOKER_MEMBRE_ROLE_ID = '1323236382881222797';

/**
 * @param {import('discord.js').Client} client
 * @param {string} invokerUserId
 * @returns {Promise<string|null>}
 */
async function getPreviewInvokerStaffTitle(client, invokerUserId) {
    if (!client || !invokerUserId || !PREVIEW_STAFF_GUILD_ID) return null;
    const guild =
        client.guilds.cache.get(PREVIEW_STAFF_GUILD_ID) ??
        (await client.guilds.fetch(PREVIEW_STAFF_GUILD_ID).catch(() => null));
    if (!guild) return null;
    const member = await guild.members.fetch(invokerUserId).catch(() => null);
    if (!member) return null;
    for (const { id, label } of PREVIEW_INVOKER_STAFF_ROLES) {
        if (member.roles.cache.has(id)) return label;
    }
    if (member.roles.cache.has(PREVIEW_INVOKER_MEMBRE_ROLE_ID)) return 'Membre';
    return null;
}

module.exports = {
    getPreviewInvokerStaffTitle,
    PREVIEW_STAFF_GUILD_ID,
};
