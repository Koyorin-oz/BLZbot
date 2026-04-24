const { SlashCommandBuilder, PermissionFlagsBits, Colors } = require('discord.js');
const roleConfig = require('../../config/role.config.json');

const RANKS = roleConfig.rankRoles.creation;

function resolveColor(color) {
    if (!color) return undefined;
    if (typeof color === 'string' && Colors[color]) return Colors[color];
    return color;
}

/** Même tri que `discord.js` (rawPosition, puis id) — indice 0 = @everyone, dernier = rôle le plus haut. */
function sortRolesByGuildOrder(guild) {
    return Array.from(guild.roles.cache.values()).sort(
        (a, b) => a.rawPosition - b.rawPosition || Number(BigInt(a.id) - BigInt(b.id)),
    );
}


module.exports = {
    data: new SlashCommandBuilder()
        .setName('creer-roles')
        .setDescription('Crée tous les rôles de rangs du bot.')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });

        const guild = interaction.guild;
        const rolesToCreate = [...RANKS].reverse(); // Copie et inverse pour créer du plus haut au plus bas

        try {
            // 1. Trouver le rôle le plus peuplé
            await guild.members.fetch(); // S'assurer que tous les membres sont dans le cache
            const roles = await guild.roles.fetch();

            let mostPopulatedRole = null;
            let maxMembers = 0;

            roles.forEach(role => {
                if (role.name === '@everyone') return;
                if (role.members.size > maxMembers) {
                    maxMembers = role.members.size;
                    mostPopulatedRole = role;
                }
            });

            const targetPosition = mostPopulatedRole ? mostPopulatedRole.position : 1;

            // 2. Créer les rôles
            const createdRoles = [];
            for (const rank of rolesToCreate) {
                const existingRole = guild.roles.cache.find(r => r.name === rank.name);
                if (!existingRole) {
                    const c = resolveColor(rank.color);
                    const newRole = await guild.roles.create({
                        name: rank.name,
                        ...(c != null ? { colors: { primaryColor: c } } : {}),
                        permissions: [],
                    });
                    createdRoles.push(newRole);
                    console.log(`Rôle "${rank.name}" créé.`);
                }
            }

            // 3. Positionner les rôles
            // Plafonner : le bot ne peut placer un rôle qu’en dessous de son propre rôle (API 50013 sinon).
            const me = await guild.members.fetch(guild.client.user.id);
            const maxPos = me.roles.highest.position - 1;
            if (maxPos < 1) {
                await interaction.followUp(
                    'Rôles créés, mais le rôle **du bot** est trop bas : place-le **au-dessus** des rôles de rang, avec **Gérer les rôles**, puis relance la commande pour les positionner (ou place-les à la main).',
                );
                return;
            }

            // On positionne du plus bas (Plastique I) au plus haut (GOAT)
            const orderedRolesToPosition = createdRoles.reverse();
            let anyClamped = false;
            for (let i = 0; i < orderedRolesToPosition.length; i++) {
                const role = orderedRolesToPosition[i];
                const desired = targetPosition + i + 1;
                const pos = Math.max(1, Math.min(desired, maxPos));
                if (pos < desired) anyClamped = true;
                await role.setPosition(pos);
            }

            let msg = 'Tous les rôles de rangs ont été créés et positionnés avec succès !';
            if (anyClamped) {
                msg +=
                    ' *(Certaines positions ont été plafonnées : le rôle du bot doit rester **au-dessus** de ces rôles — ajuste l’ordre manuellement si besoin.)*';
            }
            await interaction.followUp({ content: msg, ephemeral: true });

        } catch (error) {
            console.error('Erreur lors de la création des rôles :', error);
            await interaction.followUp('Une erreur est survenue. Vérifiez les permissions du bot et réessayez.');
        }
    },
};
